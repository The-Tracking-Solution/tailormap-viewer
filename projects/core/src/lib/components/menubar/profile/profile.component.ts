import { Component, ChangeDetectionStrategy, OnDestroy, inject, OnInit, input, DestroyRef, effect } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectShowLanguageSwitcher, selectShowLoginButton } from '../../../state/core.selectors';
import { combineLatest, distinctUntilChanged, map, Observable, Subject } from 'rxjs';
import { BaseComponentTypeEnum, SecurityModel } from '@tailormap-viewer/api';
import { Router, RouterLink } from '@angular/router';
import { AboutDialogComponent, LanguageToggleComponent } from '@tailormap-viewer/shared';
import { MatDialog } from '@angular/material/dialog';
import { AuthenticatedUserService } from '@tailormap-viewer/api';
import { ProfileMenuButtonComponent } from './profile-menu-button/profile-menu-button.component';
import { ComponentRegistrationService } from '../../../services';
import { SnackBarMessageComponent } from '@tailormap-viewer/shared';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MenubarService } from '../menubar.service';
import { MobileLayoutService } from '../../../services/viewer-layout/mobile-layout.service';
import { MenubarButtonComponent } from '../menubar-button/menubar-button.component';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { AsyncPipe } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PersonalStartExtentService } from '../../../map/services/personal-start-extent.service';
import { selectIn3dView } from '../../../map/state/map.selectors';

@Component({
    selector: 'tm-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MenubarButtonComponent,
        MatMenu,
        MatMenuItem,
        LanguageToggleComponent,
        RouterLink,
        AsyncPipe,
    ],
})
export class ProfileComponent implements OnInit, OnDestroy {
  public readonly personalStartExtent = inject(PersonalStartExtentService);
  private snackBar = inject(MatSnackBar);
  private store$ = inject(Store);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private authenticatedUserService = inject(AuthenticatedUserService);
  private componentRegistrationService = inject(ComponentRegistrationService);
  private menubarService = inject(MenubarService);
  private mobileLayoutService = inject(MobileLayoutService);
  private destroyRef = inject(DestroyRef);

  public inMobilePanel = input<boolean>(false);
  public readonly in3d$ = this.store$.select(selectIn3dView);
  private profileVisible = toSignal(this.menubarService.isComponentVisible$(BaseComponentTypeEnum.PROFILE), { initialValue: false });

  public showLanguageToggle$: Observable<boolean>;
  public userDetails$: Observable<SecurityModel | null>;
  public userIsAdmin$: Observable<boolean>;
  public showLoginButton$: Observable<boolean>;
  public icon$: Observable<string>;
  public visible$: Observable<boolean>;

  private destroyed = new Subject();

  constructor() {
    this.userDetails$ = this.authenticatedUserService.getUserDetails$();
    this.userIsAdmin$ = this.authenticatedUserService.isAdminUser$();
    this.showLanguageToggle$ = this.store$.select(selectShowLanguageSwitcher);
    this.showLoginButton$ = this.store$.select(selectShowLoginButton);
    this.visible$ = combineLatest([
      this.menubarService.isComponentVisible$(BaseComponentTypeEnum.PROFILE),
      this.mobileLayoutService.isMobileLayoutEnabled$,
    ]).pipe(
      takeUntilDestroyed(this.destroyRef),
      map(([ visible, mobileLayoutEnabled ]) => visible || !mobileLayoutEnabled),
      distinctUntilChanged(),
    );

    this.icon$ = combineLatest([
      this.userDetails$,
      this.showLoginButton$,
    ]).pipe(map(([ userDetails, showLoginButton ]) => {
      if (userDetails?.isAuthenticated) {
        return 'user';
      }
      return showLoginButton ? 'login' : 'settings';
    }));

    effect(() => {
      if (this.profileVisible()) {
        const extraHeight = this.personalStartExtent.available()
          ? 48 + (this.personalStartExtent.hasPreference() ? 48 : 0)
          : 0;
        this.menubarService.setMobilePanelHeight(255 + extraHeight);
      }
    });
  }

  public ngOnInit(): void {
    this.componentRegistrationService.registerComponent('mobile-menu-home', { type: BaseComponentTypeEnum.PROFILE, component: ProfileMenuButtonComponent });
  }

  public ngOnDestroy() {
    this.componentRegistrationService.deregisterComponent('mobile-menu-home', BaseComponentTypeEnum.PROFILE);
    this.destroyed.next(null);
    this.destroyed.complete();
  }

  public saveStartExtent() {
    this.personalStartExtent.save$().subscribe(saved => {
      SnackBarMessageComponent.open$(this.snackBar, { message: saved
        ? $localize `:@@core.profile.start-extent-saved:Personal start position saved`
        : $localize `:@@core.profile.start-extent-error:Could not update personal start position`, duration: 4000 }).subscribe();
    });
  }

  public clearStartExtent() {
    this.personalStartExtent.clear$().subscribe(cleared => {
      SnackBarMessageComponent.open$(this.snackBar, { message: cleared
        ? $localize `:@@core.profile.start-extent-cleared:Application start position restored`
        : $localize `:@@core.profile.start-extent-error:Could not update personal start position`, duration: 4000 }).subscribe();
    });
  }

  public logout() {
    this.authenticatedUserService.logout$()
      .subscribe(loggedOut => {
        if (loggedOut) {
          window.location.reload();
        }
      });
  }

  public login() {
    this.router.navigateByUrl('/login', { state: { routeBeforeLogin: this.router.url } });
  }

  public showAbout() {
    AboutDialogComponent.open(this.dialog, { restoreFocus: false });
  }

}
