import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { MapService } from '@tailormap-viewer/map';
import { getAppLayerModel } from '@tailormap-viewer/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApplicationLayerRefreshService } from './application-layer-refresh.service';
import { selectAutoRefreshableLayers } from '../state/map.selectors';

describe('ApplicationLayerRefreshService', () => {

  const refreshLayer = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    refreshLayer.mockReset();
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
            getLayerManager$: () => of({ refreshLayer }),
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

});
