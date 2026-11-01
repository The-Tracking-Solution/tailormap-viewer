import { describe, expect, test } from 'vitest';
import { FeatureInfoLayerModel } from '../models/feature-info-layer.model';
import { FeatureInfoModel } from '../models/feature-info.model';
import { selectCurrentlySelectedFeature } from './feature-info.selectors';

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
