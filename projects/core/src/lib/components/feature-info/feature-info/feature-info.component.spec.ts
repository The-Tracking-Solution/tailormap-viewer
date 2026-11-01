import { describe, beforeEach, afterEach, test, expect, vi } from 'vitest';
import { render } from '@testing-library/angular';
import { FeatureInfoComponent } from './feature-info.component';
import { Store } from '@ngrx/store';
import { EMPTY, of, Subject } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { getMapServiceMock } from '../../../test-helpers/map-service.mock';
import { FeatureInfoService } from '../feature-info.service';
import { AuthenticatedUserTestHelper } from '../../../test-helpers/authenticated-user-test.helper';
import { getAppLayerModel, TAILORMAP_API_V1_SERVICE, TailormapApiV1MockService } from '@tailormap-viewer/api';
import { ApplicationLayerRefreshService } from '../../../map/services/application-layer-refresh.service';
import { FeatureUpdatedService } from '../../../services';
import { selectCurrentlySelectedFeature, selectFeatureInfoDialogVisible } from '../state/feature-info.selectors';
import { FeatureInfoModel } from '../models';

const setup = async (options?: {
  selectedFeature?: FeatureInfoModel | null;
  dialogVisible?: boolean;
  returnError?: boolean;
}) => {
  const mapServiceMock = getMapServiceMock(tool => ({
    id: tool,
    mapClick$: EMPTY,
  }));
  const mockDispatch = vi.fn();
  const layerRefreshed = new Subject<string>();
  const updateSingleFeature = vi.fn();
  const selectedFeature = options?.selectedFeature ?? null;
  const dialogVisible = options?.dialogVisible ?? false;
  const mockSelect = vi.fn(selector => {
    if (selector === selectCurrentlySelectedFeature) {
      return of(selectedFeature);
    }
    if (selector === selectFeatureInfoDialogVisible) {
      return of(dialogVisible);
    }
    return of('POINT(1 2)');
  });
  await render(FeatureInfoComponent, {
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [
      AuthenticatedUserTestHelper.provideAuthenticatedUserService(false, []),
      { provide: TAILORMAP_API_V1_SERVICE, useClass: TailormapApiV1MockService },
    ],
    componentProviders: [
      mapServiceMock.provider,
      {
        provide: Store,
        useValue: {
          select: mockSelect,
          selectSignal: () => () => false,
          dispatch: mockDispatch,
          pipe: () => options?.returnError
            ? of({ error: 'error', errorMessage: 'Test error' })
            : of(null),
        },
      },
      {
        provide: FeatureInfoService,
        useValue: {
          fetchFeatures$: vi.fn(() => of(null)),
          getFeatureInfoFromApi$: vi.fn(() => []),
          getWmsGetFeatureInfo$: vi.fn(() => []),
          updateSingleFeature,
        },
      },
      {
        provide: FeatureUpdatedService,
        useValue: {
          featureUpdated$: EMPTY,
        },
      },
      {
        provide: ApplicationLayerRefreshService,
        useValue: {
          layerRefreshed$: layerRefreshed.asObservable(),
        },
      },
    ],
  });
  return { mapServiceMock, mockDispatch, mockSelect, layerRefreshed, updateSingleFeature };
};

describe('FeatureInfoComponent', () => {

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('should render', async () => {
    const { mapServiceMock, mockSelect } = await setup();
    expect(mapServiceMock.mapService.createTool$).toHaveBeenCalled();
    const highlightArgs = Array.from(mapServiceMock.mapService.renderFeatures$.mock.calls[0]);
    expect(highlightArgs.length).toEqual(3);
    expect(highlightArgs[0]).toEqual('feature-info-highlight-layer');
    expect(mockSelect).toHaveBeenCalled();
  });

  test('should refresh the selected feature when its layer auto refreshes', async () => {
    const selectedFeature: FeatureInfoModel = {
      __fid: 'vehicles.1',
      layer: getAppLayerModel({ id: 'vehicles', hasAttributes: true }),
      sortedAttributes: [],
      sortedAttachmentsByAttribute: [],
      attachmentCount: 0,
      geometry: 'POINT(1 2)',
    };
    const { layerRefreshed, updateSingleFeature } = await setup({
      selectedFeature,
      dialogVisible: true,
    });

    layerRefreshed.next('vehicles');

    expect(updateSingleFeature).toHaveBeenCalledWith('vehicles.1', 'vehicles');
  });

  test('should not refresh selected feature info for another layer', async () => {
    const selectedFeature: FeatureInfoModel = {
      __fid: 'vehicles.1',
      layer: getAppLayerModel({ id: 'vehicles', hasAttributes: true }),
      sortedAttributes: [],
      sortedAttachmentsByAttribute: [],
      attachmentCount: 0,
      geometry: 'POINT(1 2)',
    };
    const { layerRefreshed, updateSingleFeature } = await setup({
      selectedFeature,
      dialogVisible: true,
    });

    layerRefreshed.next('stations');

    expect(updateSingleFeature).not.toHaveBeenCalled();
  });

  test('should not refresh selected feature info when the dialog is closed', async () => {
    const selectedFeature: FeatureInfoModel = {
      __fid: 'vehicles.1',
      layer: getAppLayerModel({ id: 'vehicles', hasAttributes: true }),
      sortedAttributes: [],
      sortedAttachmentsByAttribute: [],
      attachmentCount: 0,
      geometry: 'POINT(1 2)',
    };
    const { layerRefreshed, updateSingleFeature } = await setup({
      selectedFeature,
      dialogVisible: false,
    });

    layerRefreshed.next('vehicles');

    expect(updateSingleFeature).not.toHaveBeenCalled();
  });

  test('should not refresh WMS-only feature info through the features API', async () => {
    const selectedFeature: FeatureInfoModel = {
      __fid: 'vehicles.1',
      layer: getAppLayerModel({ id: 'vehicles', hasAttributes: false }),
      sortedAttributes: [],
      sortedAttachmentsByAttribute: [],
      attachmentCount: 0,
      geometry: 'POINT(1 2)',
    };
    const { layerRefreshed, updateSingleFeature } = await setup({
      selectedFeature,
      dialogVisible: true,
    });

    layerRefreshed.next('vehicles');

    expect(updateSingleFeature).not.toHaveBeenCalled();
  });

});
