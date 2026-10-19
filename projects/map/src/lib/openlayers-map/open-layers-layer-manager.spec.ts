import { describe, test, expect, vi } from 'vitest';
import { OpenLayersLayerManager } from './open-layers-layer-manager';
import { LayerTypesEnum, WMSLayerModel } from '../models';
import { ServerType } from '@tailormap-viewer/api';

const mockNgZone = { run: (cb: () => void) => cb(), runOutsideAngular: (cb: () => void) => cb() } as any;
const mockHttpXsrfTokenExtractor = { getToken: () => null } as any;

function createMockOlMap() {
  return {
    getView: () => ({ getProjection: () => 'EPSG:3857' }),
    on: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
  } as any;
}

function createWmsLayer(overrides: Partial<WMSLayerModel> = {}): WMSLayerModel {
  return {
    id: 'layer-1',
    name: 'test-layer',
    layerType: LayerTypesEnum.WMS,
    visible: true,
    url: 'https://example.com/wms',
    layers: 'test-layer',
    serverType: ServerType.GEOSERVER,
    filter: undefined,
    selectedStyleName: undefined,
    styles: undefined,
    tilingDisabled: true,
    ...overrides,
  };
}

function createLayerManagerWithLayer(layer: WMSLayerModel): { manager: OpenLayersLayerManager; olLayer: any; olSource: any } {
  const olMap = createMockOlMap();
  const manager = new OpenLayersLayerManager(olMap, mockNgZone, mockHttpXsrfTokenExtractor);
  manager.init();
  manager.setLayerLoadStatusIds([layer.id]);
  manager.setLayers([layer]);
  const olLayer = manager.getLayer(layer.id);
  const olSource: any = olLayer?.getSource();
  return { manager, olLayer, olSource };
}

describe('OpenLayersLayerManager - updatePropertiesIfChanged', () => {

  test('does not call updateParams when WMS params have not changed', () => {
    const layer = createWmsLayer({ filter: 'prop=1', opacity: 100 });
    const { manager, olLayer, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');
    const updateOpacitySpy = vi.spyOn(olLayer, 'setOpacity');

    // Change only opacity so the layer identifier differs, but WMS params stay the same
    manager.setLayers([{ ...layer, opacity: 50 }]);

    expect(updateOpacitySpy).toHaveBeenCalledTimes(1);
    expect(updateOpacitySpy).toHaveBeenCalledWith(0.5);
    expect(updateParamsSpy).not.toHaveBeenCalled();
  });

  test('calls updateParams exactly once with all changed WMS params batched together', () => {
    const layer = createWmsLayer({ filter: 'prop=1', selectedStyleName: 'style1', styles: [{ name: 'style1', title: 'Style 1' }] });
    const { manager, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');

    const newLayer: WMSLayerModel = { ...layer, name: 'new-layer', layers: 'new-layer', filter: 'prop=2', selectedStyleName: 'style2' };
    manager.setLayers([newLayer]);

    expect(updateParamsSpy).toHaveBeenCalledTimes(1);
    expect(updateParamsSpy).toHaveBeenCalledWith(expect.objectContaining({ LAYERS: 'new-layer', STYLES: 'style2', CQL_FILTER: 'prop=2' }));
  });

  test('clears STYLES param when selectedStyleName is removed', () => {
    const layer = createWmsLayer({ selectedStyleName: 'style1', styles: [{ name: 'style1', title: 'Style 1' }] });
    const { manager, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');

    const newLayer: WMSLayerModel = { ...layer, selectedStyleName: undefined };
    manager.setLayers([newLayer]);

    expect(updateParamsSpy).toHaveBeenCalledTimes(1);
    expect(updateParamsSpy).toHaveBeenCalledWith(expect.objectContaining({ STYLES: '' }));
  });

  test('clears CQL_FILTER param when filter is removed for GeoServer', () => {
    const layer = createWmsLayer({ filter: 'prop=1' });
    const { manager, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');

    const newLayer: WMSLayerModel = { ...layer, filter: undefined, opacity: 50 };
    manager.setLayers([newLayer]);

    expect(updateParamsSpy).toHaveBeenCalledTimes(1);
    expect(updateParamsSpy).toHaveBeenCalledWith(expect.objectContaining({ CQL_FILTER: '' }));
  });

  test('does not update CQL_FILTER for non-GeoServer layers when filter changes', () => {
    const layer = createWmsLayer({ serverType: ServerType.GENERIC, filter: undefined });
    const { manager, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');

    const newLayer: WMSLayerModel = { ...layer, filter: 'prop=1', opacity: 50 };
    manager.setLayers([newLayer]);

    expect(updateParamsSpy).not.toHaveBeenCalled();
  });

  test('updates CQL_FILTER param when filter changes for GeoServer', () => {
    const layer = createWmsLayer({ filter: 'prop=1' });
    const { manager, olSource } = createLayerManagerWithLayer(layer);
    const updateParamsSpy = vi.spyOn(olSource, 'updateParams');

    const newLayer = { ...layer, filter: 'prop=2' };
    manager.setLayers([newLayer]);

    expect(updateParamsSpy).toHaveBeenCalledTimes(1);
    expect(updateParamsSpy).toHaveBeenCalledWith(expect.objectContaining({ CQL_FILTER: 'prop=2' }));
  });

});

describe('OpenLayersLayerManager - WMS load observation', () => {

  test('observing loads issues no extra requests and cache invalidation alone is not a success', () => {
    const { manager, olSource } = createLayerManagerWithLayer(createWmsLayer());
    const updateParams = vi.spyOn(olSource, 'updateParams');
    let statuses: ReadonlyMap<string, import('../models').LayerLoadStatusModel> = new Map();
    manager.layerLoadStatus$.subscribe(value => statuses = value);
    expect(updateParams).not.toHaveBeenCalled();
    manager.refreshLayer('layer-1');
    expect(updateParams).toHaveBeenCalledTimes(1);
    expect(statuses.get('layer-1')).toMatchObject({ state: 'waiting', lastSuccessfulLoad: undefined });
    manager.destroy();
  });

  test('detaches an old source when its layer is removed and observes the replacement', () => {
    const { manager, olSource } = createLayerManagerWithLayer(createWmsLayer());
    const publish = vi.fn();
    manager.layerLoadStatus$.subscribe(publish);
    manager.removeLayer('layer-1');
    publish.mockClear();
    olSource.dispatchEvent({ type: 'imageloadstart', image: {} });
    expect(publish).not.toHaveBeenCalled();
    expect(olSource.hasListener('imageloadstart')).toBe(false);
    const replacement = manager.addLayer(createWmsLayer());
    expect(replacement?.getSource()?.hasListener('imageloadstart')).toBe(true);
    manager.destroy();
    expect(replacement?.getSource()?.hasListener('imageloadstart')).toBe(false);
  });

  test('invalidates old in-flight results after a WMS filter change', () => {
    const model = createWmsLayer({ filter: 'prop=1' });
    const { manager, olSource } = createLayerManagerWithLayer(model);
    let statuses: ReadonlyMap<string, import('../models').LayerLoadStatusModel> = new Map();
    manager.layerLoadStatus$.subscribe(value => statuses = value);
    const image = {};
    olSource.dispatchEvent({ type: 'imageloadstart', image });
    const changedModel: WMSLayerModel = { ...model, filter: 'prop=2' };
    manager.setLayers([changedModel]);
    olSource.dispatchEvent({ type: 'imageloaderror', image });
    expect(statuses.get(model.id)?.state).toBe('waiting');
    manager.destroy();
  });
});

describe('OpenLayersLayerManager - observation scope', () => {
  test('leaves ordinary WMS layers unobserved and detaches when automatic refresh is disabled', () => {
    const manager = new OpenLayersLayerManager(createMockOlMap(), mockNgZone, mockHttpXsrfTokenExtractor);
    manager.init();
    const layer = manager.addLayer(createWmsLayer());
    const source = layer?.getSource();
    expect(source?.hasListener('imageloadstart')).toBe(false);
    manager.setLayerLoadStatusIds(['layer-1']);
    expect(source?.hasListener('imageloadstart')).toBe(true);
    manager.setLayerLoadStatusIds([]);
    expect(source?.hasListener('imageloadstart')).toBe(false);
    manager.destroy();
  });
});

describe('OpenLayersLayerManager - independent WMS completion', () => {
  test('confirms a tiled layer only when its own render finishes, even if another layer is still loading', () => {
    const { manager, olLayer, olSource } = createLayerManagerWithLayer(createWmsLayer({ tilingDisabled: false }));
    const busy = manager.addLayer(createWmsLayer({ id: 'busy' }));
    manager.setLayerLoadStatusIds([ 'layer-1', 'busy' ]);
    let statuses: ReadonlyMap<string, import('../models').LayerLoadStatusModel> = new Map();
    manager.layerLoadStatus$.subscribe(value => statuses = value);
    busy?.getSource()?.dispatchEvent({ type: 'imageloadstart', image: {} } as any);
    const first = { key: olSource.getKey(), getKey() { return `${this.key}/0/0/0`; } };
    const second = { key: olSource.getKey(), getKey() { return `${this.key}/0/0/1`; } };
    const renderer = olLayer.getRenderer();
    olSource.dispatchEvent({ type: 'tileloadstart', tile: first });
    olSource.dispatchEvent({ type: 'tileloadstart', tile: second });
    olSource.dispatchEvent({ type: 'tileloadend', tile: first });
    renderer.renderComplete = true;
    olLayer.dispatchEvent('postrender');
    expect(statuses.get('layer-1')?.state).toBe('loading');
    olSource.dispatchEvent({ type: 'tileloadend', tile: second });
    renderer.renderComplete = false;
    olLayer.dispatchEvent('postrender');
    expect(statuses.get('layer-1')?.lastSuccessfulLoad).toBeUndefined();
    renderer.renderComplete = true;
    olLayer.dispatchEvent('postrender');
    expect(statuses.get('layer-1')?.state).toBe('success');
    expect(statuses.get('busy')?.state).toBe('loading');
    manager.removeLayer('layer-1');
    expect(olLayer.hasListener('postrender')).toBe(false);
    manager.destroy();
  });

  test('never confirms a partially failed tiled batch as successful', () => {
    const { manager, olLayer, olSource } = createLayerManagerWithLayer(createWmsLayer({ tilingDisabled: false }));
    let statuses: ReadonlyMap<string, import('../models').LayerLoadStatusModel> = new Map();
    manager.layerLoadStatus$.subscribe(value => statuses = value);
    const tile = { key: olSource.getKey(), getKey() { return `${this.key}/0/0/0`; } };
    olSource.dispatchEvent({ type: 'tileloadstart', tile });
    olSource.dispatchEvent({ type: 'tileloaderror', tile });
    olLayer.getRenderer().renderComplete = true;
    olLayer.dispatchEvent('postrender');
    expect(statuses.get('layer-1')?.state).toBe('error');
    expect(statuses.get('layer-1')?.lastSuccessfulLoad).toBeUndefined();
    manager.destroy();
  });
});
