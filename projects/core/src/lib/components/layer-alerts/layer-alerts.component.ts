import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { BaseComponentTypeEnum, FeatureModel, HiddenLayerFunctionality, LayerAlertsConfigModel, TAILORMAP_API_V1_SERVICE } from '@tailormap-viewer/api';
import { FeatureHelper, GeometryHelper, MapService } from '@tailormap-viewer/map';
import { catchError, combineLatest, EMPTY, exhaustMap, map, merge, Observable, of, Subject, switchMap, take, takeUntil, timeout, timer } from 'rxjs';
import { selectComponentsConfigForType, selectViewerId } from '../../state/core.selectors';
import { selectLayers } from '../../map/state/map.selectors';
import { FeatureStylingHelper } from '../../shared/helpers/feature-styling.helper';
import {
  compareLayerAlertSnapshots, detectNewLayerAlerts, LAYER_ALERT_PAGE_SIZE, LayerAlert, parseLayerAlertRule, readLayerAlertSnapshot, LayerAlertRule,
} from './layer-alert-snapshot';

type TimedLayerAlert = LayerAlert & {
  ruleId: string;
  ruleLabel: string;
  sequence: number;
  observedAt: number;
};

type ViewportClassifier = ReturnType<typeof GeometryHelper.createViewportClassifier>;

type SourceState = 'waiting' | 'ready' | 'unavailable';
type RuleTarget = {
  id: string;
  label: string;
  rule: LayerAlertRule | undefined;
  available: boolean;
};
type RuleAlert = LayerAlert & { ruleId: string; ruleLabel: string };

const selectLayerAlertsConfig = selectComponentsConfigForType<LayerAlertsConfigModel>(BaseComponentTypeEnum.LAYER_ALERTS);
const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ALERTS = 20;
const ALERT_LIFETIME_MS = 60 * 60 * 1000;
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
  private readonly targets = computed<RuleTarget[]>(() => {
    const config = this.configuration()?.config;
    if (!config?.enabled) {
      return [];
    }
    const rules = config.rules ?? (config.rule ? [{ ...config.rule, id: 'legacy-rule' }] : []);
    return rules.flatMap((input, index) => {
      if (input?.enabled === false) {
        return [];
      }
      const rule = parseLayerAlertRule(input);
      const layer = this.layers().find(candidate => candidate.id === rule?.layerId);
      return [{
        id: `${index}:${input?.id ?? ''}`,
        label: input?.name || layer?.title || rule?.layerId || String(index + 1),
        rule,
        available: !!layer?.hasAttributes
          && !layer.hiddenFunctionality?.includes(HiddenLayerFunctionality.featureInfo)
          && !layer.hiddenFunctionality?.includes(HiddenLayerFunctionality.attributeList),
      }];
    });
  }, { equal: (previous, next) => JSON.stringify(previous) === JSON.stringify(next) });

  public readonly configured = computed(() => this.configuration()?.config?.enabled === true);
  public readonly alerts = signal<TimedLayerAlert[]>([]);
  private readonly sourceStates = signal<Record<string, SourceState>>({});
  public readonly sourceState = computed<SourceState>(() => {
    const states = Object.values(this.sourceStates());
    if (!states.length || states.includes('ready')) {
      return 'ready';
    }
    return states.includes('waiting') ? 'waiting' : 'unavailable';
  });
  public readonly sourceProblems = computed(() => this.targets().filter(target => this.sourceStates()[target.id] !== 'ready'));
  private readonly classifyViewport = toSignal(toObservable(this.targets).pipe(
    switchMap(targets => targets.some(target => target.rule?.mode === 'new-object')
      ? combineLatest([ this.mapService.getMapViewDetails$(), this.mapService.getProjectionCode$() ]).pipe(
        map(([ view, projection ]) => new Map(targets.map(target => [ target.id, target.rule?.mode === 'new-object'
          ? GeometryHelper.createViewportClassifier(view, projection, target.rule.bufferKm * 1000)
          : undefined ] as const))),
      )
      : of(new Map<string, ViewportClassifier>())),
  ));
  public readonly visibleAlerts = computed(() => {
    const classifiers = this.classifyViewport();
    return this.alerts().flatMap<TimedLayerAlert & { outsideView: boolean }>(alert => {
      if (alert.objectId === undefined) {
        return [{ ...alert, outsideView: false }];
      }
      const classify = classifiers?.get(alert.ruleId);
      const relation = alert.feature.geometry && classify?.(alert.feature.geometry, alert.feature.crs);
      return relation ? [{ ...alert, outsideView: relation === 'nearby' }] : [];
    }).slice(0, MAX_ALERTS);
  });
  private sequence = 0;

  constructor() {
    combineLatest([ toObservable(this.targets), toObservable(this.applicationId) ]).pipe(
      switchMap(([ targets, applicationId ]) => {
        this.reset();
        this.sourceStates.set(Object.fromEntries(targets.map(target => [ target.id, 'waiting' ])));
        return merge(...targets.map(target => this.pollRule(target, applicationId)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(alerts => {
      if (alerts.length) {
        const observedAt = Date.now();
        const newest = alerts.map(alert => ({ ...alert, observedAt, sequence: ++this.sequence }));
        this.alerts.update(history => {
          const counts = new Map<string, number>();
          return [ ...newest, ...history ].filter(alert => {
            if (alert.objectId !== undefined) {
              return true;
            }
            const count = counts.get(alert.ruleId) ?? 0;
            counts.set(alert.ruleId, count + 1);
            return count < MAX_ALERTS;
          });
        });
      }
    });

    toObservable(this.alerts).pipe(
      switchMap(alerts => {
        if (!alerts.length) {
          return EMPTY;
        }
        const oldest = Math.min(...alerts.map(alert => alert.observedAt));
        return timer(Math.max(0, oldest + ALERT_LIFETIME_MS - Date.now()));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      const cutoff = Date.now() - ALERT_LIFETIME_MS;
      this.alerts.update(alerts => alerts.filter(alert => alert.observedAt > cutoff));
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

  private pollRule(target: RuleTarget, applicationId: string | null | undefined): Observable<RuleAlert[]> {
    const { id, label, rule } = target;
    if (!applicationId || !rule || !target.available) {
      this.sourceStates.update(states => ({ ...states, [id]: 'unavailable' }));
      return EMPTY;
    }
    let previous: ReturnType<typeof readLayerAlertSnapshot>;
    const seen = new Set<string>();
    return timer(0, POLL_INTERVAL_MS).pipe(
      exhaustMap(() => this.api.getFeatures$({
        applicationId,
        layerId: rule.layerId,
        page: 1,
        pageSize: LAYER_ALERT_PAGE_SIZE,
        geometryInAttributes: rule.mode === 'new-object',
        withAttachments: false,
        background: true,
      }).pipe(
        timeout({ first: REQUEST_TIMEOUT_MS }),
        map(response => readLayerAlertSnapshot(response, rule)),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && [ 401, 403, 404, 405 ].includes(error.status)) {
            previous = undefined;
            seen.clear();
            this.alerts.update(history => history.filter(alert => alert.ruleId !== id));
          }
          return of(undefined);
        }),
      )),
      map(current => {
        this.sourceStates.update(states => ({ ...states, [id]: current ? 'ready' : 'unavailable' }));
        if (!current) {
          return [];
        }
        let alerts: LayerAlert[];
        if (rule.mode === 'new-object') {
          this.alerts.update(history => history.flatMap(alert => {
            if (alert.ruleId !== id) {
              return [alert];
            }
            const active = alert.objectId === undefined ? undefined : current.get(alert.objectId);
            return active ? [{ ...alert, label: active.label, feature: active.feature }] : [];
          }));
          alerts = detectNewLayerAlerts(current, seen, previous !== undefined);
        } else {
          alerts = previous ? compareLayerAlertSnapshots(previous, current, rule) : [];
        }
        previous = current;
        return alerts.map(alert => ({ ...alert, ruleId: id, ruleLabel: label }));
      }),
    );
  }

  private reset(): void {
    this.alerts.set([]);
    this.clearHighlight.next();
  }
}
