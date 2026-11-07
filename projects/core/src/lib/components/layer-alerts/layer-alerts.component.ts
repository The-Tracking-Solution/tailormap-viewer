import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { BaseComponentTypeEnum, FeatureModel, HiddenLayerFunctionality, LayerAlertsConfigModel, TAILORMAP_API_V1_SERVICE } from '@tailormap-viewer/api';
import { FeatureHelper, MapService } from '@tailormap-viewer/map';
import { catchError, EMPTY, exhaustMap, map, of, Subject, switchMap, take, takeUntil, timeout, timer } from 'rxjs';
import { selectComponentsConfigForType, selectViewerId } from '../../state/core.selectors';
import { selectLayers } from '../../map/state/map.selectors';
import { FeatureStylingHelper } from '../../shared/helpers/feature-styling.helper';
import { compareLayerAlertSnapshots, LAYER_ALERT_PAGE_SIZE, LayerAlert, parseLayerAlertRule, readLayerAlertSnapshot } from './layer-alert-snapshot';

interface TimedLayerAlert extends LayerAlert {
  sequence: number;
  observedAt: number;
}

const selectLayerAlertsConfig = selectComponentsConfigForType<LayerAlertsConfigModel>(BaseComponentTypeEnum.LAYER_ALERTS);
const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ALERTS = 20;
const HIGHLIGHT_DURATION_MS = 5_000;

@Component({
  selector: 'tm-layer-alerts',
  templateUrl: './layer-alerts.component.html',
  styleUrls: ['./layer-alerts.component.css'],
  imports: [DatePipe],
})
export class LayerAlertsComponent {
  private readonly store = inject(Store);
  private readonly api = inject(TAILORMAP_API_V1_SERVICE);
  private readonly mapService = inject(MapService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly highlight = new Subject<FeatureModel>();
  private readonly clearHighlight = new Subject<void>();
  private readonly configuration = toSignal(this.store.select(selectLayerAlertsConfig));
  private readonly applicationId = toSignal(this.store.select(selectViewerId));
  private readonly layers = toSignal(this.store.select(selectLayers), { initialValue: [] });
  private readonly rule = computed(() => {
    const config = this.configuration()?.config;
    return config?.enabled === true ? parseLayerAlertRule(config.rule) : undefined;
  });
  private readonly sourceAvailable = computed(() => {
    const rule = this.rule();
    const layer = this.layers().find(candidate => candidate.id === rule?.layerId);
    return !!layer?.hasAttributes
      && !layer.hiddenFunctionality?.includes(HiddenLayerFunctionality.featureInfo)
      && !layer.hiddenFunctionality?.includes(HiddenLayerFunctionality.attributeList);
  });
  private readonly target = computed(() => {
    const applicationId = this.applicationId();
    const rule = this.rule();
    return applicationId && rule && this.sourceAvailable() ? { applicationId, rule } : undefined;
  });

  public readonly configured = computed(() => this.configuration()?.config?.enabled === true);
  public readonly alerts = signal<TimedLayerAlert[]>([]);
  public readonly sourceState = signal<'waiting' | 'ready' | 'unavailable'>('waiting');
  private sequence = 0;

  constructor() {
    toObservable(this.target).pipe(
      switchMap(target => {
        this.reset();
        this.sourceState.set(target ? 'waiting' : 'unavailable');
        if (!target) {
          return EMPTY;
        }

        const { rule, applicationId } = target;
        let previous: ReturnType<typeof readLayerAlertSnapshot>;
        return timer(0, POLL_INTERVAL_MS).pipe(
          exhaustMap(() => this.api.getFeatures$({
            applicationId,
            layerId: rule.layerId,
            page: 1,
            pageSize: LAYER_ALERT_PAGE_SIZE,
            withAttachments: false,
            background: true,
          }).pipe(
            timeout({ first: REQUEST_TIMEOUT_MS }),
            map(response => readLayerAlertSnapshot(response, rule)),
            catchError((error: unknown) => {
              if (error instanceof HttpErrorResponse && [ 401, 403, 404, 405 ].includes(error.status)) {
                previous = undefined;
                this.reset();
              }
              return of(undefined);
            }),
          )),
          map(current => {
            this.sourceState.set(current ? 'ready' : 'unavailable');
            if (!current) {
              return [];
            }
            const alerts = previous ? compareLayerAlertSnapshots(previous, current, rule) : [];
            previous = current;
            return alerts;
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(alerts => {
      if (alerts.length) {
        const observedAt = Date.now();
        const newest = alerts.map(alert => ({ ...alert, observedAt, sequence: ++this.sequence }));
        this.alerts.update(history => [ ...newest, ...history ].slice(0, MAX_ALERTS));
      }
    });

    const highlightId = 'layer-alert-highlight';
    this.highlight.pipe(
      switchMap(feature => this.mapService.getProjectionCode$().pipe(
        take(1),
        switchMap(projection => {
          const { geometry, crs } = feature;
          const highlight = geometry && crs && crs !== projection
            ? { ...feature, geometry: FeatureHelper.transformGeometry(geometry, crs, projection), crs: projection }
            : feature;
          return this.mapService.renderFeatures$(
            highlightId,
            of(highlight),
            FeatureStylingHelper.getDefaultHighlightStyle(highlightId),
            { zoomToFeature: true },
          );
        }),
        catchError(() => EMPTY),
        takeUntil(timer(HIGHLIGHT_DURATION_MS)),
        takeUntil(this.clearHighlight),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  public showOnMap(feature: FeatureModel): void {
    if (feature.geometry) {
      this.highlight.next(feature);
    }
  }

  private reset(): void {
    this.alerts.set([]);
    this.clearHighlight.next();
  }
}
