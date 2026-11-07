import { describe, expect, test, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { provideHttpClient } from '@angular/common/http';
import { MapService } from '@tailormap-viewer/map';
import { BehaviorSubject, of } from 'rxjs';
import { ApplicationMapService } from './application-map.service';
import { ApplicationLayerRefreshService } from './application-layer-refresh.service';
import { BookmarkService } from '../../services/bookmark/bookmark.service';
import { MobileLayoutService } from '../../services/viewer-layout/mobile-layout.service';
import { selectIn3dView, selectMapOptions, selectOrderedVisibleBackgroundLayers,
  selectOrderedVisibleLayersWithServices } from '../state/map.selectors';
import { selectCQLFilters } from '../../state/filter-state/filter.selectors';

const options = {
  projection: 'EPSG:3857', projectionDefinition: '', initialExtent: [ 10, 20, 30, 40 ], maxExtent: [ -100, -100, 100, 100 ],
};

const setup = (bookmark: string | null) => {
  TestBed.resetTestingModule();
  const manager = { setLayers: vi.fn(), setBackgroundLayers: vi.fn() };
  const mapService = { initMap: vi.fn(), getLayerManager$: () => of(manager) };
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(),
    { provide: MapService, useValue: mapService },
    { provide: ApplicationLayerRefreshService, useValue: {} },
    { provide: BookmarkService, useValue: { registerFragment$: () => of(bookmark) } },
    { provide: MobileLayoutService, useValue: { isMobileLayoutEnabled$: of(false) } },
    { provide: Store, useValue: { select: (selector: unknown) => {
      if (selector === selectMapOptions) { return of(options); }
      if (selector === selectIn3dView) { return new BehaviorSubject(false); }
      if (selector === selectCQLFilters) { return of(new Map()); }
      if (selector === selectOrderedVisibleBackgroundLayers || selector === selectOrderedVisibleLayersWithServices) {
        return of([]);
      }
      return of([]);
    } } },
  ] });
  const service = TestBed.inject(ApplicationMapService);
  service.init();
  return { mapService, service };
};

describe('Start extent and explicit map links', () => {
  test('uses the loaded personal initial extent when no link position is present', () => {
    const { mapService, service } = setup(null);
    expect(mapService.initMap).toHaveBeenCalledWith({ ...options, controlOptions: { attributionPosition: 'right' } }, undefined);
    service.ngOnDestroy();
  });

  test('an explicit location link overrides the loaded personal extent', () => {
    const { mapService, service } = setup('50,60,12');
    expect(mapService.initMap).toHaveBeenCalledWith(
      { ...options, controlOptions: { attributionPosition: 'right' } },
      { initialCenter: [ 50, 60 ], initialZoom: 12 },
    );
    service.ngOnDestroy();
  });
});
