import { AttributeType, getAppLayerModel } from '@tailormap-viewer/api';
import { describe, expect, test } from 'vitest';
import { FeatureInfoLayerModel } from '../models/feature-info-layer.model';
import { FeatureInfoModel } from '../models/feature-info.model';
import { selectCurrentlySelectedFeature, selectFeatureInfoList } from './feature-info.selectors';

describe('FeatureInfoSelectors', () => {

  describe('selectCurrentlySelectedFeature', () => {
    const projector = selectCurrentlySelectedFeature.projector;

    test('selects the feature from the selected layer when feature IDs are equal across layers', () => {
      const layerOneFeature = {
        __fid: 'same-id',
        layer: { id: 'layer-1' },
      } as unknown as FeatureInfoModel;
      const layerTwoFeature = {
        __fid: 'same-id',
        layer: { id: 'layer-2' },
      } as unknown as FeatureInfoModel;
      const selectedLayer = {
        id: 'layer-2',
        selectedFeatureId: 'same-id',
      } as FeatureInfoLayerModel;

      expect(projector([ layerOneFeature, layerTwoFeature ], selectedLayer)).toBe(layerTwoFeature);
    });
  });

});

describe('feature info attribute presentation', () => {
  test('uses the effective metadata for each layer without inferring video from URLs', () => {
    const layers = [ getAppLayerModel({ id: 'one' }), getAppLayerModel({ id: 'two' }) ];
    const features = [ 'one', 'two' ].map(layerId => ({
      layerId, __fid: '1',
      attributes: { camera: 'https://www.youtube.com/watch?v=EH6GNSEvmQE', ordinary: 'https://www.youtube.com/watch?v=EH6GNSEvmQE' },
    }));
    const result = selectFeatureInfoList.projector(features, {
      columnMetadata: [
        { name: 'camera', alias: 'Camera', layerId: 'one', type: AttributeType.STRING, displayType: 'video' },
        { name: 'camera', layerId: 'two', type: AttributeType.STRING, displayType: 'text' },
      ], attachmentMetadata: [],
    }, layers);
    expect(result[0].sortedAttributes[0]).toMatchObject({ key: 'camera', label: 'Camera', displayType: 'video' });
    expect(result[1].sortedAttributes[0]).toMatchObject({ key: 'camera', displayType: 'text' });
    expect(result[0].sortedAttributes[1].displayType).toBeUndefined();
  });
});
