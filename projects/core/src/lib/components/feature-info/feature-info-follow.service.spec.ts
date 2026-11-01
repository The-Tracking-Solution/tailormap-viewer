import { beforeEach, describe, expect, test } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { getAppLayerModel } from '@tailormap-viewer/api';
import { FeatureInfoFollowService } from './feature-info-follow.service';
import { FeatureInfoModel } from './models';
import {
  selectCurrentlySelectedFeature, selectCurrentlySelectedLayerError, selectFeatureInfoDialogVisible,
} from './state/feature-info.selectors';
import { selectIn3dView } from '../../map/state/map.selectors';
import { getMapServiceMock } from '../../test-helpers/map-service.mock';
import { MapFollowService } from '../../services/map-follow.service';

describe('FeatureInfoFollowService', () => {
  let service: FeatureInfoFollowService;
  let store: MockStore;
  let follow: MapFollowService;
  let drag: Subject<void>;
  let mapMock: ReturnType<typeof getMapServiceMock>;
  const feature = (geometry = 'POINT (1 2)', layerId = 'layer-1'): FeatureInfoModel => ({
    __fid: 'unit-1', geometry, layer: { ...getAppLayerModel(), id: layerId, hasAttributes: true },
    sortedAttributes: [], sortedAttachmentsByAttribute: [], attachmentCount: 0,
  });
  const selectFeature = (value: FeatureInfoModel | null) => {
    store.overrideSelector(selectCurrentlySelectedFeature, value);
    store.refreshState();
  };

  beforeEach(() => {
    drag = new Subject<void>();
    mapMock = getMapServiceMock(null, null, { getPointerDrag$: () => drag });
    TestBed.configureTestingModule({ providers: [ mapMock.provider, provideMockStore({ selectors: [
      { selector: selectCurrentlySelectedFeature, value: feature() },
      { selector: selectFeatureInfoDialogVisible, value: true },
      { selector: selectIn3dView, value: false },
      { selector: selectCurrentlySelectedLayerError, value: null },
    ] }) ] });
    store = TestBed.inject(MockStore);
    service = TestBed.inject(FeatureInfoFollowService);
    follow = TestBed.inject(MapFollowService);
  });

  test('checks successful updates only while following is enabled', () => {
    const pan = mapMock.mapService.panToPointIfOutsideViewport;
    expect(pan).not.toHaveBeenCalled();
    service.toggle();
    expect(pan).toHaveBeenCalledWith('POINT (1 2)');
    selectFeature(feature());
    expect(pan).toHaveBeenCalledTimes(2);
    selectFeature(feature('POINT (3 4)'));
    expect(pan).toHaveBeenLastCalledWith('POINT (3 4)');
    service.toggle();
    selectFeature(feature('POINT (5 6)'));
    expect(pan).toHaveBeenCalledTimes(3);
  });

  test('stops on object/layer change even if the feature ID is identical', () => {
    service.toggle();
    selectFeature(feature('POINT (3 4)', 'layer-2'));
    expect(service.isFollowing()).toBe(false);
    expect(mapMock.mapService.panToPointIfOutsideViewport).toHaveBeenCalledTimes(1);
  });

  test('pauses on manual drag, supports resume and yields to GPS following', () => {
    service.toggle();
    drag.next();
    expect(service.isFollowing()).toBe(false);
    selectFeature(feature('POINT (3 4)'));
    expect(mapMock.mapService.panToPointIfOutsideViewport).toHaveBeenCalledTimes(1);
    service.toggle();
    expect(service.isFollowing()).toBe(true);
    expect(mapMock.mapService.panToPointIfOutsideViewport).toHaveBeenLastCalledWith('POINT (3 4)');
    follow.start('geolocation');
    expect(service.isFollowing()).toBe(false);
    follow.stop('feature-info');
    expect(follow.owner()).toBe('geolocation');
  });

  test.each([ selectFeatureInfoDialogVisible, selectIn3dView ])('stops when the window closes or 3D opens', selector => {
    service.toggle();
    store.overrideSelector(selector, selector === selectIn3dView);
    store.refreshState();
    expect(service.isFollowing()).toBe(false);
  });

  test('does not pan on failed updates, and resumes after a successful position update', () => {
    service.toggle();
    store.overrideSelector(selectCurrentlySelectedLayerError, 'Failed');
    store.refreshState();
    selectFeature(feature('POINT (3 4)'));
    expect(mapMock.mapService.panToPointIfOutsideViewport).toHaveBeenCalledTimes(1);
    store.overrideSelector(selectCurrentlySelectedLayerError, null);
    store.refreshState();
    expect(mapMock.mapService.panToPointIfOutsideViewport).toHaveBeenLastCalledWith('POINT (3 4)');
  });

  test('rejects temporary IDs and non-point or missing geometries', () => {
    for (const value of [ null, feature('POINT EMPTY'), feature('LINESTRING (1 2, 3 4)'),
      { ...feature(), __fid: 'wms-get-feature-info-1' }]) {
      selectFeature(value);
      expect(service.canFollow()).toBe(false);
      service.toggle();
      expect(service.isFollowing()).toBe(false);
    }
    expect(mapMock.mapService.panToPointIfOutsideViewport).not.toHaveBeenCalled();
  });
});
