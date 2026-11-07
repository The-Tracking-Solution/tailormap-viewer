import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MapResponseModel } from '@tailormap-viewer/api';
import { Map as OlMap, Feature } from 'ol';
import { Draw } from 'ol/interaction.js';
import { fromExtent } from 'ol/geom/Polygon.js';
import { StartPositionMapComponent } from './start-position-map.component';

const data = { crs: { code: 'EPSG:3857', definition: '' },
  initialExtent: { minx: -1000, miny: -500, maxx: 1000, maxy: 500 },
  maxExtent: { minx: -1000000, miny: -1000000, maxx: 1000000, maxy: 1000000 },
  appLayers: [], services: [], baseLayerTreeNodes: [], layerTreeNodes: [], terrainLayerTreeNodes: [],
} as MapResponseModel;
const setup = () => {
  TestBed.configureTestingModule({ imports: [StartPositionMapComponent], providers: [provideHttpClient()] });
  const fixture = TestBed.createComponent(StartPositionMapComponent);
  const component = fixture.componentInstance;
  component.mapData = data;
  fixture.detectChanges();
  const map = (component as unknown as { map: OlMap }).map;
  map.setSize([ 640, 320 ]); component.reset();
  const selected = vi.fn(); component.positionSelected.subscribe(selected);
  return { component, map, fixture, selected };
};

describe('Mini map start position selection', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // Prevent canvas painting in JSDOM; use the actual map/view/interactions for selection tests.
    vi.spyOn(OlMap.prototype, 'render').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test('starts at the application default and emits the chosen center and fractional zoom', () => {
    const { component, map, fixture, selected } = setup();
    expect(map.getView().getCenter()).toEqual([ 0, 0 ]);
    map.getView().setCenter([ 100, 200 ]); map.getView().setZoom(12.5); component.useView();
    expect(selected).toHaveBeenCalledWith({ center: [ 100, 200 ], zoom: 12.5, extent: null });
    fixture.destroy();
  });

  test('drawing a rectangle emits extent mode without a guessed zoom', () => {
    const { component, map, fixture, selected } = setup();
    component.drawRectangle();
    const draw = map.getInteractions().getArray().find(i => i instanceof Draw) as Draw;
    draw.dispatchEvent({ type: 'drawend', feature: new Feature(fromExtent([ 10, 20, 30, 40 ])) } as never);
    expect(selected).toHaveBeenCalledWith({ center: null, zoom: null, extent: [ 10, 20, 30, 40 ] });
    expect(component.drawing()).toBe(false); fixture.destroy();
  });

  test('saved rectangles are shown and Escape cancels drawing without changing the selection', () => {
    const { component, map, fixture, selected } = setup();
    component.position = { extent: [ 10, 20, 30, 40 ] };
    expect(map.getView().getCenter()).toEqual([ 20, 30 ]);
    component.drawRectangle();
    map.getViewport()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.drawing()).toBe(false); expect(selected).not.toHaveBeenCalled(); fixture.destroy();
  });

  test('disabled selection cannot emit a position and switching applications clears old drawing state', () => {
    const { component, fixture, selected } = setup();
    component.disabled = true; component.useView(); component.drawRectangle();
    expect(selected).not.toHaveBeenCalled(); expect(component.drawing()).toBe(false); fixture.destroy();
  });
});
