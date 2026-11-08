import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BaseComponentTypeEnum, TAILORMAP_API_V1_SERVICE } from '@tailormap-viewer/api';
import { MapService } from '@tailormap-viewer/map';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';
import { selectLayers } from '../../map/state/map.selectors';
import { selectComponentsConfig, selectViewerId } from '../../state/core.selectors';
import { LayerAlertsComponent } from './layer-alerts.component';

vi.unmock('jsts/org/locationtech/jts/io');

afterEach(() => vi.useRealTimers());

test('expires each alert one hour after observation without a new source response', () => {
  vi.useFakeTimers({ toFake: [ 'Date', 'setInterval', 'clearInterval' ] });
  const fixture = TestBed.configureTestingModule({
    providers: [
      provideMockStore({ selectors: [
        { selector: selectLayers, value: [] },
        { selector: selectComponentsConfig, value: [] },
        { selector: selectViewerId, value: null },
      ] }),
      { provide: TAILORMAP_API_V1_SERVICE, useValue: {} },
      { provide: MapService, useValue: {} },
    ],
  }).createComponent(LayerAlertsComponent);
  fixture.detectChanges();

  const first = { sequence: 1, observedAt: Date.now() - 2000, label: 'First', from: '1', to: '2', feature: { __fid: '1', attributes: {} } };
  const second = { ...first, sequence: 2, observedAt: Date.now(), label: 'Second' };
  fixture.componentInstance.alerts.set([ second, first ]);
  TestBed.tick();

  vi.advanceTimersByTime(3_600_000 - 2001);
  expect(fixture.componentInstance.alerts()).toEqual([ second, first ]);
  vi.advanceTimersByTime(1);
  expect(fixture.componentInstance.alerts()).toEqual([second]);

  TestBed.tick();
  vi.advanceTimersByTime(2000);
  expect(fixture.componentInstance.alerts()).toEqual([]);
  fixture.destroy();
});

test('moving the map reclassifies the same warnings without creating new alerts', () => {
  const view = new BehaviorSubject({ extent: [ 100000, 400000, 110000, 410000 ] });
  const fixture = TestBed.configureTestingModule({
    providers: [
      provideMockStore({ selectors: [
        { selector: selectLayers, value: [{ id: 'warnings', hasAttributes: true }] },
        { selector: selectComponentsConfig, value: [{
          type: BaseComponentTypeEnum.LAYER_ALERTS,
          config: { enabled: true, rule: { mode: 'new-object', layerId: 'warnings', idAttribute: 'id', bufferKm: 10 } },
        }] },
        { selector: selectViewerId, value: 'app/test' },
      ] }),
      { provide: TAILORMAP_API_V1_SERVICE, useValue: { getFeatures$: () => EMPTY } },
      { provide: MapService, useValue: { getMapViewDetails$: () => view, getProjectionCode$: () => of('EPSG:28992') } },
    ],
  }).createComponent(LayerAlertsComponent);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const warning = (id: string, x: number) => ({
    sequence: x, observedAt: Date.now(), objectId: id, label: id,
    feature: { __fid: id, attributes: {}, geometry: `POINT (${x} 405000)` },
  });
  component.alerts.set([ warning('inside', 105000), warning('nearby', 118000), warning('far', 140000) ]);
  TestBed.tick();

  expect(component.visibleAlerts().map(alert => [ alert.objectId, alert.outsideView ])).toEqual([
    [ 'inside', false ], [ 'nearby', true ],
  ]);
  view.next({ extent: [ 115000, 400000, 125000, 410000 ] });
  expect(component.visibleAlerts().map(alert => [ alert.objectId, alert.outsideView ])).toEqual([
    [ 'inside', true ], [ 'nearby', false ],
  ]);
  expect(component.alerts()).toHaveLength(3);
  fixture.destroy();
});
