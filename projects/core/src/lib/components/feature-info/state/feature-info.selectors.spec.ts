import { describe, test, expect } from 'vitest';
import { AttributeType, getAppLayerModel } from '@tailormap-viewer/api';
import { selectFeatureInfoList } from './feature-info.selectors';

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
