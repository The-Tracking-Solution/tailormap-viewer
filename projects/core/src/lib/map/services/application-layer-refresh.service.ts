import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAutoRefreshableLayers } from '../state/map.selectors';
import { Subject, Subscription, timer } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LayerLoadStatusModel, LayerManagerModel, MapService } from '@tailormap-viewer/map';
import { ExtendedAppLayerModel } from '../models';

interface RefreshableLayer extends ExtendedAppLayerModel {
  id: string;
  autoRefreshInSeconds: number;
}

@Injectable({
  providedIn: 'root',
})
export class ApplicationLayerRefreshService {
  private store$ = inject(Store);
  private destroyRef = inject(DestroyRef);
  private mapService = inject(MapService);


  private refreshingLayers = new Map<string, { subscription: Subscription; interval: number }>();
  private loadSubscription?: Subscription;
  public readonly loadStatuses = signal<ReadonlyMap<string, LayerLoadStatusModel>>(new Map());
  public readonly nextRefreshAt = signal<ReadonlyMap<string, number>>(new Map());
  public readonly now = signal(Date.now());
  private layerManager: LayerManagerModel | undefined;
  private layerRefreshed = new Subject<string>();

  public readonly layerRefreshed$ = this.layerRefreshed.asObservable();

  constructor() {
    this.mapService.getLayerManager$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(layerManager => {
        this.layerManager = layerManager;
        layerManager.setLayerLoadStatusIds?.(Array.from(this.refreshingLayers.keys()));
        this.loadSubscription?.unsubscribe();
        this.loadStatuses.set(new Map());
        this.loadSubscription = layerManager.layerLoadStatus$
          ?.pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(statuses => this.loadStatuses.set(statuses));
      });
    // One shared clock for all indicators, including stale/overdue status after tab suspension.
    timer(0, 1000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.refreshingLayers.size > 0) {
        this.now.set(Date.now());
      }
    });
    this.store$.select(selectAutoRefreshableLayers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(layers => {
        const refreshableLayers: RefreshableLayer[] = layers
          .filter((l): l is RefreshableLayer => typeof l.autoRefreshInSeconds === 'number');
        this.setRefreshLayers(refreshableLayers);
      });
  }

  public setRefreshLayers(refreshableLayer: RefreshableLayer[]) {
    refreshableLayer = refreshableLayer.filter(layer =>
      Number.isFinite(layer.autoRefreshInSeconds) && layer.autoRefreshInSeconds > 0);
    const ids = new Set(refreshableLayer.map(r => r.id));
    this.layerManager?.setLayerLoadStatusIds?.(Array.from(ids));
    const currentIds = Array.from(this.refreshingLayers.keys());
    currentIds.forEach((key) => {
      if (!ids.has(key)) {
        this.refreshingLayers.get(key)?.subscription.unsubscribe();
        this.refreshingLayers.delete(key);
        this.nextRefreshAt.update(current => {
          const next = new Map(current);
          next.delete(key);
          return next;
        });
      }
    });
    refreshableLayer.forEach(layer => {
      const interval = layer.autoRefreshInSeconds * 1000;
      if (this.refreshingLayers.get(layer.id)?.interval !== interval) {
        this.refreshingLayers.get(layer.id)?.subscription.unsubscribe();
        this.setNextRefresh(layer.id, interval);
        const refreshSubscription = timer(interval, interval)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.setNextRefresh(layer.id, interval);
            if (!this.layerManager) {
              return;
            }
            this.layerManager.refreshLayer(layer.id);
            this.layerRefreshed.next(layer.id);
          });
        this.refreshingLayers.set(layer.id, { subscription: refreshSubscription, interval });
      }
    });
  }

  private setNextRefresh(layerId: string, interval: number) {
    this.nextRefreshAt.update(current => new Map(current).set(layerId, Date.now() + interval));
  }

}
