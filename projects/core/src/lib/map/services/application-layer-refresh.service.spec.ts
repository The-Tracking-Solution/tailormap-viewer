import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { LayerLoadStatusModel, MapService } from '@tailormap-viewer/map';
import { getAppLayerModel } from '@tailormap-viewer/api';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApplicationLayerRefreshService } from './application-layer-refresh.service';
import { selectAutoRefreshableLayers } from '../state/map.selectors';

describe('ApplicationLayerRefreshService', () => {

  const refreshLayer = vi.fn();
  let loads: BehaviorSubject<ReadonlyMap<string, LayerLoadStatusModel>>;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshLayer.mockReset();
    loads = new BehaviorSubject<ReadonlyMap<string, LayerLoadStatusModel>>(new Map());
    TestBed.configureTestingModule({
      providers: [
        ApplicationLayerRefreshService,
        provideMockStore({
          selectors: [
            {
              selector: selectAutoRefreshableLayers,
              value: [getAppLayerModel({ id: 'vehicles', autoRefreshInSeconds: 5 })],
            },
          ],
        }),
        {
          provide: MapService,
          useValue: {
            getLayerManager$: () => of({ refreshLayer, layerLoadStatus$: loads.asObservable() }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  test('should emit the layer id after an automatic layer refresh', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    const refreshedLayers: string[] = [];
    service.layerRefreshed$.subscribe(layerId => refreshedLayers.push(layerId));

    vi.advanceTimersByTime(5000);

    expect(refreshLayer).toHaveBeenCalledWith('vehicles');
    expect(refreshedLayers).toEqual(['vehicles']);
  });

  test('records a schedule without treating the timer as a successful load', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    const start = Date.now();
    expect(service.nextRefreshAt().get('vehicles')).toBe(start + 5000);
    expect(refreshLayer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(service.nextRefreshAt().get('vehicles')).toBe(start + 10000);
    expect(service.loadStatuses().get('vehicles')).toBeUndefined();
    expect(refreshLayer).toHaveBeenCalledTimes(1);
  });

  test('exposes actual WMS load results independently of the refresh trigger', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    loads.next(new Map([[ 'vehicles', { state: 'error', lastSuccessfulLoad: 1234 }]]));
    expect(service.loadStatuses().get('vehicles')).toEqual({ state: 'error', lastSuccessfulLoad: 1234 });
    expect(refreshLayer).not.toHaveBeenCalled();
  });

  test('removes the schedule and stops refreshes when the layer becomes hidden', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    service.setRefreshLayers([]);
    vi.advanceTimersByTime(15000);
    expect(service.nextRefreshAt().has('vehicles')).toBe(false);
    expect(refreshLayer).not.toHaveBeenCalled();
  });

  test('replaces the old timer when the configured interval changes', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    service.setRefreshLayers([{ ...getAppLayerModel(), id: 'vehicles', autoRefreshInSeconds: 10 }]);
    vi.advanceTimersByTime(5000);
    expect(refreshLayer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(refreshLayer).toHaveBeenCalledTimes(1);
  });

  test('does not duplicate timers for unchanged layers', () => {
    const service = TestBed.inject(ApplicationLayerRefreshService);
    service.setRefreshLayers([{ ...getAppLayerModel(), id: 'vehicles', autoRefreshInSeconds: 5 }]);
    vi.advanceTimersByTime(5000);
    expect(refreshLayer).toHaveBeenCalledTimes(1);
  });

  test('cleans up refreshes and observation on destroy', () => {
    TestBed.inject(ApplicationLayerRefreshService);
    TestBed.resetTestingModule();
    vi.advanceTimersByTime(15000);
    expect(refreshLayer).not.toHaveBeenCalled();
    expect(loads.observed).toBe(false);
  });

});
