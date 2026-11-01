import { describe, test, expect } from 'vitest';
import * as FeatureInfoActions from './feature-info.actions';
import { featureInfoReducer } from './feature-info.reducer';
import { FeatureInfoState, initialFeatureInfoState } from './feature-info.state';
import { FeatureInfoResponseModel } from '../models/feature-info-response.model';
import { getColumnMetadataModel, getFeatureModel } from '@tailormap-viewer/api';
import { LoadingStateEnum } from '@tailormap-viewer/shared';

describe('FeatureInfoReducer', () => {

  test('handles LoadFeatureInfo', () => {
    const state = { ...initialFeatureInfoState };
    const action = FeatureInfoActions.loadFeatureInfo({ mouseCoordinates: [ 1, 2 ], mapCoordinates: [ 2, 3 ], layers: [] });
    const updatedState = featureInfoReducer(state, action);
    expect(updatedState.mapCoordinates).toEqual([ 2, 3 ]);
    expect(updatedState.mouseCoordinates).toEqual([ 1, 2 ]);
    expect(updatedState.layers).toEqual([]);
  });

  test('handles LoadFeatureInfoSuccess', () => {
    const state: FeatureInfoState = { ...initialFeatureInfoState, layers: [{ id: '1', title: 'Layer', loading: LoadingStateEnum.LOADED }] };
    const featureInfo: FeatureInfoResponseModel = {
      features: [{ ...getFeatureModel(), layerId: '1' }],
      columnMetadata: [{ ...getColumnMetadataModel(), layerId: '1' }],
      attachmentMetadata: [],
      layerId: '1',
    };
    const action = FeatureInfoActions.featureInfoLoaded({ featureInfo });
    const updatedState = featureInfoReducer(state, action);
    expect(updatedState.features).toEqual(featureInfo.features);
    expect(updatedState.columnMetadata).toEqual(featureInfo.columnMetadata);
  });

  test('handles HideFeatureInfoDialog', () => {
    const state = { ...initialFeatureInfoState };
    const action = FeatureInfoActions.hideFeatureInfoDialog();
    const updatedState = featureInfoReducer(state, action);
    expect(updatedState.dialogVisible).toEqual(false);
  });

  test('handles expandCollapseFeatureInfoDialog', () => {
    const state: FeatureInfoState = { ...initialFeatureInfoState, dialogCollapsed: false };
    const action = FeatureInfoActions.expandCollapseFeatureInfoDialog();
    const updatedState = featureInfoReducer(state, action);
    expect(updatedState.dialogCollapsed).toEqual(true);
    const updatedState2 = featureInfoReducer(updatedState, action);
    expect(updatedState2.dialogCollapsed).toEqual(false);
  });

  test('updates feature only in matching layer when feature IDs are equal', () => {
    const layerOneFeature = {
      ...getFeatureModel({
        __fid: 'same-id',
        attributes: { prop1: 'layer-one' },
      }),
      layerId: 'layer-1',
    };
    const layerTwoFeature = {
      ...getFeatureModel({
        __fid: 'same-id',
        attributes: { prop1: 'layer-two' },
      }),
      layerId: 'layer-2',
    };
    const updatedFeature = {
      ...getFeatureModel({
        __fid: 'same-id',
        attributes: { prop1: 'updated-layer-two' },
      }),
      layerId: 'layer-2',
    };

    const state: FeatureInfoState = {
      ...initialFeatureInfoState,
      features: [ layerOneFeature, layerTwoFeature ],
    };

    const action = FeatureInfoActions.updateFeatureInFeatureInfo({
      feature: updatedFeature,
    });

    const updatedState = featureInfoReducer(state, action);

    expect(updatedState.features[0]).toEqual(layerOneFeature);
    expect(updatedState.features[1]).toEqual(updatedFeature);
  });

});
