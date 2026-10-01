import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, input, DestroyRef } from '@angular/core';
import { combineLatest, filter, map, of, Subject, switchMap, take, takeUntil, tap } from 'rxjs';
import { CoordinateHelper, MapClickEvent, MapClickToolConfigModel, MapClickToolModel, MapService, ToolTypeEnum } from '@tailormap-viewer/map';
import { Clipboard } from '@angular/cdk/clipboard';
import { Store } from '@ngrx/store';
import { FormControl, FormGroup, ValidationErrors, ReactiveFormsModule } from '@angular/forms';
import {
  BaseComponentTypeEnum,
  COORDINATE_DISPLAY_MAP_PROJECTION,
  CoordinateDisplayFormat,
  CoordinatePickerConfigModel,
  FeatureModel,
} from '@tailormap-viewer/api';
import { ApplicationStyleService } from '../../../services/application-style.service';
import { selectMapSettings } from '../../../map/state/map.selectors';
import { ComponentRegistrationService } from '../../../services';
import { MenubarService } from '../../menubar';
import { MobileLayoutService } from '../../../services/viewer-layout/mobile-layout.service';
import { ClickedCoordinatesMenuButtonComponent } from './clicked-coordinates-menu-button/clicked-coordinates-menu-button.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { withLatestFrom } from 'rxjs/operators';
import { selectComponentTitle } from '../../../state';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { NgTemplateOutlet, AsyncPipe } from '@angular/common';
import { TooltipDirective, ErrorMessageComponent } from '@tailormap-viewer/shared';
import { ComponentConfigHelper } from '../../../shared/helpers/component-config.helper';

type CoordinateBounds = [number, number, number, number];

@Component({
    selector: 'tm-clicked-coordinates',
    templateUrl: './clicked-coordinates.component.html',
    styleUrls: ['./clicked-coordinates.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ReactiveFormsModule,
        MatFormField,
        MatLabel,
        MatInput,
        MatButton,
        TooltipDirective,
        MatIcon,
        ErrorMessageComponent,
        NgTemplateOutlet,
        AsyncPipe,
    ],
})
export class ClickedCoordinatesComponent implements OnInit, OnDestroy {
  private store$ = inject(Store);
  private mapService = inject(MapService);
  private clipboard = inject(Clipboard);
  private componentRegistrationService = inject(ComponentRegistrationService);
  private menubarService = inject(MenubarService);
  private mobileLayoutService = inject(MobileLayoutService);
  private destroyRef = inject(DestroyRef);

  public noExpansionPanel = input<boolean>(false);
  public toolActive = signal<boolean>(false);

  public coordinatesForm = new FormGroup({
    x: new FormControl<string>('', { nonNullable: true }),
    y: new FormControl<string>('', { nonNullable: true }),
  });

  private destroyed = new Subject();
  private clickLocationSubject = new Subject<FeatureModel[]>();
  private clickLocationSubject$ = this.clickLocationSubject.asObservable();
  private mapCrs = '';
  private bounds: CoordinateBounds | null = null;
  private config: CoordinatePickerConfigModel = { enabled: true };
  private tool: string | undefined;

  public visible$ = combineLatest([
    this.menubarService.isComponentVisible$(BaseComponentTypeEnum.COORDINATE_PICKER),
    this.mobileLayoutService.isMobileLayoutEnabled$,
  ]).pipe(
    takeUntilDestroyed(this.destroyRef),
    map(([ visible, mobileLayoutEnabled ]) => visible || !mobileLayoutEnabled),
  );

  constructor() {
    this.coordinatesForm.setValidators(() => this.validateCurrentCoordinates());

    this.mapService.someToolsEnabled$([BaseComponentTypeEnum.COORDINATE_PICKER])
      .pipe(takeUntil(this.destroyed))
      .subscribe(enabled => {
        this.toolActive.set(enabled);
        if (!enabled) {
          this.coordinatesForm.patchValue({ x: '', y: '' }, { emitEvent: false });
          this.coordinatesForm.updateValueAndValidity({ emitEvent: false });
          this.clickLocationSubject.next([]);
        }
      });

    this.store$.select(selectMapSettings).pipe(
      takeUntil(this.destroyed),
      map(settings => {
        if (settings?.crs?.bounds && settings?.maxExtent) {
          this.mapCrs = settings.crs.code;
          const crsBounds = settings.crs.bounds;
          const maxExtent = settings.maxExtent;
          return [
            Math.max(crsBounds.minx, maxExtent.minx),
            Math.max(crsBounds.miny, maxExtent.miny),
            Math.min(crsBounds.maxx, maxExtent.maxx),
            Math.min(crsBounds.maxy, maxExtent.maxy),
          ] as CoordinateBounds;
        }
        return null;
      }),
    ).subscribe(bounds => {
      this.bounds = bounds;
      this.coordinatesForm.updateValueAndValidity({ emitEvent: false });
    });
  }

  public ngOnInit(): void {
    ComponentConfigHelper.componentConfig$<CoordinatePickerConfigModel>(
      this.store$,
      BaseComponentTypeEnum.COORDINATE_PICKER,
    )
      .pipe(takeUntil(this.destroyed))
      .subscribe(config => {
        this.config = config;
        this.coordinatesForm.updateValueAndValidity({ emitEvent: false });
      });

    this.mapService.createTool$<MapClickToolModel, MapClickToolConfigModel>({
      type: ToolTypeEnum.MapClick,
      owner: BaseComponentTypeEnum.COORDINATE_PICKER,
    })
      .pipe(
        takeUntil(this.destroyed),
        tap(({ tool }) => {
          this.tool = tool.id;
        }),
        switchMap(({ tool }) => tool?.mapClick$ || of(null)),
      ).subscribe(mapClick => this.handleMapClick(mapClick));

    this.mapService.renderFeatures$('tm-clicked-coordinates-layer', this.clickLocationSubject$, f => {
      const primaryColor = ApplicationStyleService.getPrimaryColor();
      if (f.__fid === 'clicked-coordinates-point') {
        return {
          styleKey: 'tm-clicked-coordinates',
          zIndex: 2000,
          pointType: 'circle',
          pointSize: 15,
          pointFillColor: 'transparent',
          pointStrokeColor: primaryColor,
          pointStrokeWidth: 3,
        };
      }
      return {
        styleKey: 'tm-clicked-coordinates-2',
        zIndex: 1999,
        pointType: 'square',
        pointSize: 5,
        pointRotation: 45,
        pointFillColor: 'transparent',
        pointStrokeColor: primaryColor,
        pointStrokeWidth: 2,
      };
    }).pipe(takeUntil(this.destroyed)).subscribe();

    this.componentRegistrationService.registerComponent(
      'mobile-menu-home',
      { type: BaseComponentTypeEnum.COORDINATE_PICKER, component: ClickedCoordinatesMenuButtonComponent },
    );

    this.mobileLayoutService.isMobileLayoutEnabled$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(enabled => enabled),
        switchMap(() => this.menubarService.isComponentVisible$(BaseComponentTypeEnum.COORDINATE_PICKER)),
      ).subscribe(visibleInMobileLayout => {
      if (visibleInMobileLayout) {
        this.menubarService.setMobilePanelHeight(190);
        this.toggle(false);
      } else if (this.toolActive()) {
        this.toggle(true);
      }
    });

    this.mapService.someToolsEnabled$([BaseComponentTypeEnum.COORDINATE_PICKER])
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        withLatestFrom(
          this.menubarService.isComponentVisible$(BaseComponentTypeEnum.COORDINATE_PICKER),
          this.store$.select(selectComponentTitle(BaseComponentTypeEnum.MOBILE_MENUBAR_HOME, $localize `:@@core.home.menu:Menu`)),
        ),
      )
      .subscribe(([ enabledTool, visible, componentTitle ]) => {
        if (!enabledTool && visible) {
          this.menubarService.toggleActiveComponent(BaseComponentTypeEnum.MOBILE_MENUBAR_HOME, componentTitle);
        }
      });
  }

  public ngOnDestroy() {
    this.clickLocationSubject.complete();
    this.destroyed.next(null);
    this.destroyed.complete();
    this.componentRegistrationService.deregisterComponent('mobile-menu-home', BaseComponentTypeEnum.COORDINATE_PICKER);
  }

  public toggle(close?: boolean) {
    if (close === true || this.toolActive()) {
      this.mapService.disableTool(this.tool);
      return;
    }
    this.mapService.enableTool(this.tool, true);
  }

  public copy() {
    if (this.coordinatesForm.valid) {
      const values = this.coordinatesForm.getRawValue();
      this.clipboard.copy(`${values.x}, ${values.y}`);
    }
  }

  public goTo() {
    const mapCoordinates = this.toMapCoordinates();
    if (!mapCoordinates || !this.isWithinBounds(mapCoordinates)) {
      return;
    }
    this.pushLocationFeature(mapCoordinates);
    this.mapService.zoomTo(`POINT(${mapCoordinates[0]} ${mapCoordinates[1]})`, this.mapCrs);
  }

  private handleMapClick(mapClick: MapClickEvent | null) {
    if (!mapClick?.mapCoordinates) {
      return;
    }

    this.pushLocationFeature(mapClick.mapCoordinates);
    if (this.isLegacyMode()) {
      this.mapService.getRoundedCoordinates$(mapClick.mapCoordinates)
        .pipe(take(1))
        .subscribe(coordinates => {
          this.coordinatesForm.patchValue({ x: coordinates[0] ?? '', y: coordinates[1] ?? '' });
        });
      return;
    }

    try {
      const targetProjection = this.getTargetProjection();
      const targetCoordinates = targetProjection === this.mapCrs
        ? mapClick.mapCoordinates
        : CoordinateHelper.projectCoordinates(mapClick.mapCoordinates, this.mapCrs, targetProjection);
      const formatted = CoordinateHelper.formatCoordinates(targetCoordinates, targetProjection, this.getFormat());
      this.coordinatesForm.patchValue({ x: formatted[0], y: formatted[1] });
    } catch {
      this.coordinatesForm.patchValue({ x: '', y: '' });
    }
  }

  private toMapCoordinates(): [number, number] | null {
    const values = this.coordinatesForm.getRawValue();
    if (!values.x.trim() || !values.y.trim()) {
      return null;
    }

    const targetProjection = this.getTargetProjection();
    const targetCoordinates = CoordinateHelper.parseCoordinates(
      [ values.x, values.y ],
      this.getFormat(),
    );
    if (!targetCoordinates) {
      return null;
    }

    try {
      return targetProjection === this.mapCrs
        ? targetCoordinates
        : CoordinateHelper.projectCoordinates(targetCoordinates, targetProjection, this.mapCrs);
    } catch {
      return null;
    }
  }

  private validateCurrentCoordinates(): ValidationErrors | null {
    const mapCoordinates = this.toMapCoordinates();
    return mapCoordinates && this.isWithinBounds(mapCoordinates) ? null : { invalidCoordinates: true };
  }

  private isWithinBounds(coordinates: [number, number]): boolean {
    if (!this.bounds) {
      return true;
    }
    return coordinates[0] >= this.bounds[0] && coordinates[0] <= this.bounds[2] &&
      coordinates[1] >= this.bounds[1] && coordinates[1] <= this.bounds[3];
  }

  private isLegacyMode(): boolean {
    return !this.config.projection && !this.config.format;
  }

  private getTargetProjection(): string {
    const projection = this.config.projection || COORDINATE_DISPLAY_MAP_PROJECTION;
    return projection === COORDINATE_DISPLAY_MAP_PROJECTION ? this.mapCrs : projection;
  }

  private getFormat(): CoordinateDisplayFormat {
    const targetProjection = this.getTargetProjection();
    return targetProjection === 'EPSG:4326' ? (this.config.format || 'xy') : 'xy';
  }

  public getFirstCoordinateLabel(): string {
    return this.getFormat() === 'xy'
      ? $localize `:@@core.toolbar.coordinate-picker-x:X-coordinate`
      : $localize `:@@core.toolbar.coordinate-picker-latitude:Latitude`;
  }

  public getSecondCoordinateLabel(): string {
    return this.getFormat() === 'xy'
      ? $localize `:@@core.toolbar.coordinate-picker-y:Y-coordinate`
      : $localize `:@@core.toolbar.coordinate-picker-longitude:Longitude`;
  }

  private pushLocationFeature(coordinates: number[]) {
    this.clickLocationSubject.next([{
      __fid: 'clicked-coordinates-point', geometry: `POINT(${coordinates[0]} ${coordinates[1]})`, attributes: {},
    }, {
      __fid: 'clicked-coordinates-point-2', geometry: `POINT(${coordinates[0]} ${coordinates[1]})`, attributes: {},
    }]);
  }

  public getErrorMessage(): string {
    return $localize `:@@core.toolbar.coordinate-picker-invalid-input:Your input is invalid for the current application bounds`;
  }
}
