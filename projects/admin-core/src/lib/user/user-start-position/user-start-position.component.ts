import { ChangeDetectionStrategy, Component, DestroyRef, inject, Input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatButton } from '@angular/material/button';
import { TailormapAdminApiV1Service, UserModel } from '@tailormap-admin/admin-api';
import { MapResponseModel, TailormapApiConstants } from '@tailormap-viewer/api';
import { ConfirmDialogService } from '@tailormap-viewer/shared';
import { StartPositionMapComponent, StartPositionSelection } from '@tailormap-viewer/map';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of, take, timeout } from 'rxjs';

interface StartApplication {
  id: string; name: string; title: string; crs: string; enabled: boolean;
}
interface StartPosition extends StartPositionSelection { crs: string; mayEdit?: boolean }

@Component({
  selector: 'tm-admin-user-start-position',
  templateUrl: './user-start-position.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatSelect, MatOption, MatSlideToggle, MatButton, StartPositionMapComponent ],
  styleUrl: './user-start-position.component.css',
})
export class UserStartPositionComponent {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private currentUsername = '';
  private userKey = '';
  private generation = 0;
  private previousApplicationId = '';
  private confirm = inject(ConfirmDialogService);
  public applications = signal<StartApplication[]>([]);
  public mapData = signal<MapResponseModel | null>(null);
  public previewPosition = signal<StartPositionSelection | null>(null);
  public rectangle = signal<number[] | null>(null);
  public busy = signal(false);
  public loaded = signal(false);
  public dirty = signal(false);
  public message = signal('');
  public applicationId = new FormControl('', { nonNullable: true });
  public form = new FormGroup({
    x: new FormControl<number | null>(null), y: new FormControl<number | null>(null), zoom: new FormControl<number | null>(null),
    mayEdit: new FormControl(false, { nonNullable: true }),
  });

  @Input() public set user(value: UserModel | null) {
    const key = JSON.stringify([ value?.username, [...(value?.groupNames ?? [])].sort() ]);
    if (key === this.userKey) { return; }
    const sameUser = this.currentUsername === value?.username;
    this.userKey = key;
    this.currentUsername = value?.username ?? '';
    if (!sameUser) { this.applicationId.setValue('', { emitEvent: false }); }
    this.loadApplications();
  }
  public get application() { return this.applications().find(a => a.id === this.applicationId.value); }

  constructor() {
    this.applicationId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.dirty()) { this.load(); return; }
      this.confirm.confirm$(
        $localize`:@@admin-core.user-start.discard-title:Unsaved start position`,
        $localize`:@@admin-core.user-start.discard-message:Discard the unsaved start position and select another application?`,
      ).pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(discard => {
        if (discard) { this.load(); }
        else { this.applicationId.setValue(this.previousApplicationId, { emitEvent: false }); }
      });
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dirty.set(true);
      if (this.form.controls.x.dirty || this.form.controls.y.dirty || this.form.controls.zoom.dirty) { this.rectangle.set(null); }
    });
  }

  private loadApplications() {
    const generation = ++this.generation;
    this.resetEditor(); this.applications.set([]);
    if (!this.currentUsername) { return; }
    this.busy.set(true);
    this.http.get<StartApplication[]>(`${TailormapAdminApiV1Service.BASE_URL}/users/${encodeURIComponent(this.currentUsername)}/start-position-applications`)
      .pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: applications => {
          if (generation !== this.generation) { return; }
          this.applications.set(applications); this.busy.set(false);
          if (!applications.some(a => a.id === this.applicationId.value)) {
            this.applicationId.setValue(applications.length === 1 ? applications[0].id : '', { emitEvent: false });
          }
          this.load();
        },
        error: () => {
          if (generation !== this.generation) { return; }
          this.busy.set(false);
          this.message.set($localize`:@@admin-core.user-start.apps-error:Could not load applications for this user.`);
      },
      });
  }
  private resetEditor() {
    this.loaded.set(false); this.busy.set(false); this.dirty.set(false); this.message.set('');
    this.mapData.set(null); this.rectangle.set(null); this.previewPosition.set(null);
    this.form.enable({ emitEvent: false });
    this.form.reset({}, { emitEvent: false });
  }
  private url() {
    return `${TailormapAdminApiV1Service.BASE_URL}/applications/${encodeURIComponent(this.applicationId.value)}/user-start-position/${encodeURIComponent(this.currentUsername)}`;
  }
  public load() {
    this.previousApplicationId = this.applicationId.value;
    const generation = ++this.generation;
    this.resetEditor();
    const app = this.application;
    if (!app) { return; }
    this.busy.set(true);
    forkJoin({
      position: this.http.get<StartPosition>(this.url()),
      map: this.http.get<MapResponseModel>(`${TailormapApiConstants.BASE_URL}/app/${encodeURIComponent(app.name)}/map`).pipe(catchError(() => of(null))),
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (generation !== this.generation) { return; }
        this.form.patchValue({ x: result.position.center?.[0] ?? null, y: result.position.center?.[1] ?? null,
          zoom: result.position.zoom ?? null, mayEdit: result.position.mayEdit === true }, { emitEvent: false });
        this.rectangle.set(result.position.extent ?? null);
        this.mapData.set(result.map); this.previewPosition.set(result.position);
        this.loaded.set(true); this.busy.set(false);
      },
      error: () => {
          if (generation !== this.generation) { return; }
          this.busy.set(false);
          this.message.set($localize`:@@admin-core.personal-start.load-error:Could not load this user's start position.`);
      },
    });
  }
  public choosePosition(position: StartPositionSelection) {
    this.rectangle.set(position.extent ?? null);
    this.form.patchValue({ x: position.center?.[0] ?? null, y: position.center?.[1] ?? null, zoom: position.zoom ?? null }, { emitEvent: false });
    this.form.markAsPristine();
    this.previewPosition.set(position); this.dirty.set(true);
  }
  public clearPosition() { this.choosePosition({ center: null, zoom: null, extent: null }); }
  public showManualPosition() {
    if (!this.valid) { return; }
    const { x, y, zoom } = this.form.getRawValue();
    this.previewPosition.set({ center: x === null ? null : [ x, y! ], zoom });
  }
  public get valid() {
    const e = this.rectangle();
    if (e) { return e.length === 4 && e.every(Number.isFinite) && e[0] < e[2] && e[1] < e[3]; }
    const { x, y, zoom } = this.form.getRawValue();
    return (x === null && y === null && zoom === null)
      || ([ x, y, zoom ].every(v => typeof v === 'number' && Number.isFinite(v)) && zoom !== null && zoom >= 0 && zoom <= 28);
  }
  public save() {
    if (!this.loaded() || this.busy() || !this.valid || !this.dirty() || !this.application) { return; }
    const generation = this.generation;
    const { x, y, zoom, mayEdit } = this.form.getRawValue();
    const extent = this.rectangle();
    const position: StartPosition = { crs: this.application.crs, center: extent || x === null ? null : [ x, y! ], zoom: extent ? null : zoom, extent, mayEdit };
    this.busy.set(true); this.message.set(''); this.form.disable({ emitEvent: false });
    this.http.put<void>(this.url(), position).pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (generation !== this.generation) { return; }
        this.busy.set(false); this.form.enable({ emitEvent: false }); this.dirty.set(false); this.form.markAsPristine();
        this.message.set($localize`:@@admin-core.personal-start.saved:User start position and permission saved.`);
      },
      error: () => {
        if (generation !== this.generation) { return; }
        this.busy.set(false); this.form.enable({ emitEvent: false });
        this.message.set($localize`:@@admin-core.personal-start.save-error:Could not save this user's start position. Reload if the application projection changed.`);
      },
    });
  }
}
