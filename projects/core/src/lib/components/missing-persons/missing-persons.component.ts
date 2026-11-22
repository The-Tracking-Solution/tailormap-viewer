import { Component, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import {
  AuthenticatedUserService, BaseComponentTypeEnum, FeatureModel, MissingCase, MissingCaseInput, MissingConfiguration,
  MissingPersonsApiService, MissingSearchArea, MissingStatistic,
} from '@tailormap-viewer/api';
import { CoordinateHelper, MapClickToolConfigModel, MapClickToolModel, MapService, ToolTypeEnum } from '@tailormap-viewer/map';
import { BehaviorSubject, Observable, Subject, catchError, combineLatest, distinctUntilChanged, exhaustMap, finalize, of, switchMap, take, takeUntil, timer } from 'rxjs';
import { MenubarService } from '../menubar';
import { selectViewerId } from '../../state/core.selectors';
import { MissingPersonsMenuComponent } from './missing-persons-menu.component';
import { missingElapsed, missingIsoDate, missingLocalDate } from './missing-persons.helper';

@Component({
  selector: 'tm-missing-persons',
  templateUrl: './missing-persons.component.html',
  styleUrl: './missing-persons.component.css',
  imports: [ AsyncPipe, DatePipe, DecimalPipe, ReactiveFormsModule ],
})
export class MissingPersonsComponent implements OnDestroy {
  private readonly api = inject(MissingPersonsApiService);
  private readonly menus = inject(MenubarService);
  private readonly map = inject(MapService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changed = new Subject<void>();
  private readonly changedCase = new Subject<void>();
  private readonly context = new BehaviorSubject<string | null>(null);
  private readonly features = new BehaviorSubject<FeatureModel[]>([]);
  private app: string | null = null;
  private epoch = 0;
  private pending = 0;
  private pickTool: string | undefined;
  private photoUrl: string | null = null;
  private selectedFile: File | null = null;

  public readonly visible$ = this.menus.isComponentVisible$(BaseComponentTypeEnum.MISSING_PERSONS);
  public readonly configuration = signal<MissingConfiguration | null>(null);
  public readonly cases = signal<MissingCase[]>([]);
  public readonly statistics = signal<MissingStatistic[]>([]);
  public readonly selected = signal<MissingCase | null>(null);
  public readonly editing = signal(false);
  public readonly busy = signal(false);
  public readonly error = signal('');
  public readonly notice = signal('');
  public readonly photo = signal<string | null>(null);
  public readonly area = signal<MissingSearchArea | null>(null);
  public readonly tab = signal<'active' | 'closed'>('active');
  public readonly picking = signal<'lastSeen' | 'found' | null>(null);
  public readonly now = signal(Date.now());
  public readonly elapsed = missingElapsed;

  public readonly form = new FormGroup({
    lastSeenAt: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lon: new FormControl<number | null>(null, [ Validators.required, Validators.min(-180), Validators.max(180) ]),
    lat: new FormControl<number | null>(null, [ Validators.required, Validators.min(-90), Validators.max(90) ]),
    age: new FormControl<number | null>(null, [ Validators.min(0), Validators.max(120) ]),
    sex: new FormControl('unknown', { nonNullable: true }),
    speedKmh: new FormControl<number | null>(null, [ Validators.min(0.1), Validators.max(15) ]),
    speedConfirmed: new FormControl(false, { nonNullable: true }),
    waterRisk: new FormControl(false, { nonNullable: true }),
    urgent: new FormControl(false, { nonNullable: true }),
    ownerOrganisation: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    organisations: new FormControl<string[]>([], { nonNullable: true, validators: [Validators.required] }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    clothing: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
    reporter: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(150)] }),
    telephone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    details: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] }),
  });
  public readonly closing = new FormGroup({
    outcome: new FormControl('found', { nonNullable: true }),
    foundAt: new FormControl('', { nonNullable: true }),
    lon: new FormControl<number | null>(null), lat: new FormControl<number | null>(null),
    personVerified: new FormControl(false, { nonNullable: true }),
    policeConsidered: new FormControl(false, { nonNullable: true }),
    careConsidered: new FormControl(false, { nonNullable: true }),
    confirmDelete: new FormControl(false, { nonNullable: true }),
  });
  public readonly event = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] });
  public readonly eventKind = new FormControl('note', { nonNullable: true });

  constructor() {
    const store = inject(Store);
    const users = inject(AuthenticatedUserService);
    combineLatest([ store.select(selectViewerId), users.getUserDetails$() ]).pipe(
      distinctUntilChanged(([ a, x ], [ b, y ]) => a === b && JSON.stringify(x) === JSON.stringify(y)),
      takeUntilDestroyed(),
    ).subscribe(([ app, user ]) => {
      this.changed.next();
      this.epoch++;
      this.clear(); this.cases.set([]); this.statistics.set([]); this.configuration.set(null);
      this.app = user.isAuthenticated && app?.startsWith('app/') ? app : null;
      this.context.next(this.app);
      this.menus.deregisterComponent(BaseComponentTypeEnum.MISSING_PERSONS);
      if (this.app) {
        this.run(this.api.configuration$(this.app), config => {
          this.configuration.set(config);
          this.menus.registerComponent({ type: BaseComponentTypeEnum.MISSING_PERSONS, component: MissingPersonsMenuComponent });
          this.refresh();
        });
      }
    });

    timer(0, 30_000).pipe(takeUntilDestroyed()).subscribe(() => this.now.set(Date.now()));
    combineLatest([ this.visible$, this.context ]).pipe(
      switchMap(([ visible, app ]) => visible && app ? timer(30_000, 30_000).pipe(
        exhaustMap(() => this.api.cases$(app).pipe(catchError(() => of(null)))),
      ) : of()),
      takeUntilDestroyed(),
    ).subscribe(cases => {
      if (!cases) { this.clear(); this.cases.set([]); this.error.set('Verbinding of toegang verloren. Herlaad de module.'); return; }
      this.cases.set(cases);
      const current = this.selected();
      if (current && !cases.some(c => c.id === current.id)) { this.clear(); this.notice.set('Deze casus is afgesloten of niet meer toegankelijk.'); }
      else if (current && cases.some(c => c.id === current.id && c.version !== current.version)) {
        this.notice.set('Een collega heeft deze casus gewijzigd. Heropen de casus vóór je opslaat.');
      }
    });

    this.map.createTool$<MapClickToolModel, MapClickToolConfigModel>({
      type: ToolTypeEnum.MapClick, owner: BaseComponentTypeEnum.MISSING_PERSONS,
    }).pipe(
      switchMap(({ tool }) => { this.pickTool = tool.id; return tool.mapClick$; }),
      takeUntilDestroyed(),
    ).subscribe(click => {
      const target = this.picking();
      if (!target) { return; }
      this.map.getProjectionCode$().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(crs => {
        const [ lon, lat ] = CoordinateHelper.projectCoordinates(click.mapCoordinates, crs, 'EPSG:4326');
        if (target === 'lastSeen') { this.form.patchValue({ lon, lat }); this.form.markAsDirty(); }
        else { this.closing.patchValue({ lon, lat }); }
        this.stopPicking();
        this.render();
      });
    });
    this.map.renderFeatures$('missing-persons-private', this.features, feature => ({
      styleKey: `missing-${feature.__fid}`, zIndex: 2000,
      strokeColor: '#ad3d00', strokeWidth: 2, fillColor: 'rgba(255,140,0,0.12)',
      pointType: 'circle', pointSize: 11, pointFillColor: feature.__fid === 'found' ? '#087542' : '#ad3d00',
      pointStrokeColor: '#ffffff', pointStrokeWidth: 2,
    })).pipe(takeUntilDestroyed()).subscribe();
    this.form.controls.speedKmh.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.form.controls.speedConfirmed.setValue(false));
    this.form.controls.ownerOrganisation.valueChanges.pipe(takeUntilDestroyed()).subscribe(owner => {
      if (owner && !this.form.controls.organisations.value.includes(owner)) {
        this.form.controls.organisations.setValue([ ...this.form.controls.organisations.value, owner ]);
      }
    });
    this.visible$.pipe(takeUntilDestroyed()).subscribe(visible => {
      if (!visible) {
        if (this.editing()) { this.clear(); }
        this.cases.set([]); this.statistics.set([]); this.stopPicking();
      } else { this.menus.setMobilePanelHeight(650); this.refresh(); }
    });
  }

  private run<T>(request: Observable<T>, success: (value: T) => void): void {
    const epoch = this.epoch;
    this.pending++;
    this.busy.set(true); this.error.set('');
    request.pipe(takeUntil(this.changedCase), takeUntil(this.changed), takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (epoch === this.epoch) { this.pending = Math.max(0, this.pending - 1); this.busy.set(this.pending > 0); }
    })).subscribe({ next: value => { if (epoch === this.epoch) { success(value); } }, error: (error: unknown) => {
      if (epoch !== this.epoch) { return; }
      if (error instanceof HttpErrorResponse && [ 401, 403, 404 ].includes(error.status)) {
        this.clear(); this.cases.set([]); this.statistics.set([]);
      }
      this.error.set(error instanceof HttpErrorResponse && error.status === 409
        ? 'Een collega heeft de casus gewijzigd. Heropen de casus en controleer je wijziging.'
        : 'Actie niet gelukt. Controleer je invoer, verbinding en toegangsrechten.');
    } });
  }

  public refresh(): void {
    if (!this.app) { return; }
    if (this.tab() === 'active') { this.run(this.api.cases$(this.app), rows => this.cases.set(rows)); }
    else { this.run(this.api.statistics$(this.app), rows => this.statistics.set(rows)); }
  }

  public showTab(tab: 'active' | 'closed'): void { this.clear(); this.tab.set(tab); this.refresh(); }

  public create(): void {
    this.clear(); this.editing.set(true);
    const own = this.configuration()?.organisations.find(o => o.member)?.id ?? '';
    this.form.patchValue({ lastSeenAt: missingLocalDate(new Date().toISOString()), ownerOrganisation: own, organisations: own ? [own] : [] });
  }

  public open(id: string): void {
    if (!this.app) { return; }
    this.clear();
    this.run(this.api.case$(this.app, id), item => {
      this.selected.set(item); this.editing.set(true);
      this.form.patchValue({ ...item, ...item.intake, lastSeenAt: missingLocalDate(item.lastSeenAt),
        lon: item.lastSeen.lon, lat: item.lastSeen.lat, speedConfirmed: item.speedKmh !== null }, { emitEvent: false });
      this.render();
      if (item.hasPhoto) { this.loadPhoto(item.id); }
    });
  }

  public save(): void {
    if (!this.app || this.form.invalid) { this.form.markAllAsTouched(); return; }
    const value = this.form.getRawValue();
    const lastSeenAt = missingIsoDate(value.lastSeenAt);
    if (!lastSeenAt || Date.parse(lastSeenAt) > Date.now() || value.lon === null || value.lat === null
      || (value.speedKmh !== null && !value.speedConfirmed)) {
      this.error.set('Controleer tijd, locatie en de bevestiging van de loopsnelheid.'); return;
    }
    const body: MissingCaseInput = {
      version: this.selected()?.version ?? 0, lastSeenAt, lastSeen: { lon: value.lon, lat: value.lat },
      age: value.age, sex: value.sex, speedKmh: value.speedKmh, speedConfirmed: value.speedConfirmed,
      waterRisk: value.waterRisk, urgent: value.urgent, ownerOrganisation: value.ownerOrganisation, organisations: value.organisations,
      intake: { name: value.name, description: value.description, clothing: value.clothing,
        reporter: value.reporter, telephone: value.telephone, details: value.details },
    };
    const file = this.selectedFile;
    this.run(this.api.save$(this.app, body, this.selected()?.id), item => {
      this.selected.set(item); this.form.markAsPristine(); this.notice.set('Casus opgeslagen.');
      if (file && this.app) {
        this.run(this.api.upload$(this.app, item.id, item.version, file), () => { this.selectedFile = null; this.open(item.id); this.refresh(); });
      } else { this.open(item.id); this.refresh(); }
    });
  }

  public chooseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.selectedFile = null;
    if (file && (![ 'image/jpeg', 'image/png' ].includes(file.type) || file.size > 10_000_000)) {
      this.error.set('Kies een JPEG- of PNG-foto van maximaal 10 MB.'); input.value = ''; return;
    }
    this.selectedFile = file ?? null;
  }

  private loadPhoto(id: string): void {
    if (!this.app) { return; }
    this.api.photo$(this.app, id).pipe(takeUntil(this.changedCase), takeUntil(this.changed), takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: blob => {
        if (this.selected()?.id !== id) { return; }
        this.releasePhoto(); this.photoUrl = URL.createObjectURL(blob); this.photo.set(this.photoUrl);
      }, error: () => this.releasePhoto() });
  }

  public calculate(): void {
    const item = this.selected();
    if (!this.app || !item) { return; }
    this.run(this.api.area$(this.app, item.id), area => { this.area.set(area); this.render(); });
  }

  public pick(target: 'lastSeen' | 'found'): void { this.picking.set(target); this.map.enableTool(this.pickTool, true); }
  public stopPicking(): void { this.picking.set(null); if (this.pickTool) { this.map.disableTool(this.pickTool); } }

  public render(): void {
    const last = this.form.getRawValue(), found = this.closing.getRawValue();
    const features: FeatureModel[] = [];
    if (last.lon !== null && last.lat !== null) { features.push({ __fid: 'last-seen', attributes: {}, geometry: `POINT(${last.lon} ${last.lat})`, crs: 'EPSG:4326' }); }
    if (found.lon !== null && found.lat !== null) { features.push({ __fid: 'found', attributes: {}, geometry: `POINT(${found.lon} ${found.lat})`, crs: 'EPSG:4326' }); }
    const area = this.area();
    if (area) { features.push({ __fid: 'search', attributes: {}, geometry: area.geometry, crs: area.crs }); }
    this.features.next(features);
  }

  public zoom(): void { this.render(); this.map.zoomToFeatures(this.features.value); }

  public addEvent(): void {
    const item = this.selected();
    if (!this.app || !item || !this.event.value.trim() || this.event.invalid) { return; }
    this.run(this.api.event$(this.app, item.id, item.version, this.eventKind.value, this.event.value), () => this.open(item.id));
  }

  public close(): void {
    const item = this.selected(), value = this.closing.getRawValue();
    if (!this.app || !item) { return; }
    if (this.form.dirty) { this.error.set('Sla de gewijzigde casus eerst op voordat je afsluit.'); return; }
    const foundAt = value.outcome === 'found' ? missingIsoDate(value.foundAt) : null;
    if (!value.confirmDelete || !value.policeConsidered || !value.careConsidered
      || (value.outcome === 'found' && (!foundAt || value.lon === null || value.lat === null || !value.personVerified))) {
      this.error.set('Vul de vindgegevens en afsluitcontroles in.'); return;
    }
    this.run(this.api.close$(this.app, item.id, {
      ...value, version: item.version, foundAt,
      found: value.outcome === 'found' && value.lon !== null && value.lat !== null ? { lon: value.lon, lat: value.lat } : null,
    }), () => { this.clear(); this.notice.set('Afgesloten. Operationele gegevens en foto zijn verwijderd.'); this.refresh(); });
  }

  private releasePhoto(): void {
    if (this.photoUrl) { URL.revokeObjectURL(this.photoUrl); }
    this.photoUrl = null; this.photo.set(null);
  }

  public clear(): void {
    this.changedCase.next(); this.releasePhoto(); this.stopPicking();
    this.selectedFile = null; this.selected.set(null); this.editing.set(false); this.area.set(null);
    this.form.reset(); this.closing.reset(); this.event.reset(); this.eventKind.reset();
    this.features.next([]); this.notice.set('');
  }

  public ngOnDestroy(): void {
    this.changed.next(); this.clear(); this.changed.complete(); this.changedCase.complete();
    this.menus.deregisterComponent(BaseComponentTypeEnum.MISSING_PERSONS);
  }
}
