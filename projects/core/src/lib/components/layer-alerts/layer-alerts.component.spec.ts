import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BaseComponentTypeEnum, FeaturesResponseModel, TAILORMAP_API_V1_SERVICE } from '@tailormap-viewer/api';
import { MapService } from '@tailormap-viewer/map';
import { BehaviorSubject, EMPTY, of, throwError } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';
import { selectLayers } from '../../map/state/map.selectors';
import { selectComponentsConfig, selectViewerId } from '../../state/core.selectors';
import { LayerAlertsComponent } from './layer-alerts.component';

vi.unmock('jsts/org/locationtech/jts/io');

afterEach(() => vi.useRealTimers());

test('requests geometry and detects new objects inside and just outside the map after an empty baseline', () => {
  vi.useFakeTimers({ toFake: [ 'Date', 'setInterval', 'clearInterval' ] });
  let added = false;
  const getFeatures = vi.fn((params: { geometryInAttributes?: boolean }) => {
    const positions = [ 105000, 118000, 140000 ];
    const response: FeaturesResponseModel = {
      page: 1, pageSize: 500, total: added ? positions.length : 0, template: null, columnMetadata: [],
      features: added ? positions.map((x, index) => ({
        __fid: String(index),
        attributes: { id: index, name: `Danger ${index}` },
        geometry: params.geometryInAttributes ? `POINT (${x} 405000)` : undefined,
      })) : [],
    };
    return of(response);
  });
  const fixture = TestBed.configureTestingModule({
    providers: [
      provideMockStore({ selectors: [
        { selector: selectLayers, value: [{ id: 'warnings', hasAttributes: true }] },
        { selector: selectComponentsConfig, value: [{
          type: BaseComponentTypeEnum.LAYER_ALERTS,
          config: { enabled: true, rule: {
            mode: 'new-object', layerId: 'warnings', idAttribute: 'id', labelAttribute: 'name', bufferKm: 10,
          } },
        }] },
        { selector: selectViewerId, value: 'app/test' },
      ] }),
      { provide: TAILORMAP_API_V1_SERVICE, useValue: { getFeatures$: getFeatures } },
      { provide: MapService, useValue: {
        getMapViewDetails$: () => of({ extent: [ 100000, 400000, 110000, 410000 ] }),
        getProjectionCode$: () => of('EPSG:28992'),
      } },
    ],
  }).createComponent(LayerAlertsComponent);
  fixture.detectChanges();
  vi.advanceTimersByTime(0);
  expect(fixture.componentInstance.sourceState()).toBe('ready');
  expect(fixture.componentInstance.visibleAlerts()).toEqual([]);

  added = true;
  vi.advanceTimersByTime(60_000);
  expect(getFeatures).toHaveBeenLastCalledWith(expect.objectContaining({ geometryInAttributes: true }));
  expect(fixture.componentInstance.visibleAlerts().map(alert => [ alert.label, alert.outsideView ])).toEqual([
    [ 'Danger 0', false ], [ 'Danger 1', true ],
  ]);
  vi.advanceTimersByTime(60_000);
  expect(fixture.componentInstance.visibleAlerts()).toHaveLength(2);
  fixture.destroy();
});

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

  const first = {
    ruleId: '0:legacy-rule', ruleLabel: 'Test rule', sequence: 1, observedAt: Date.now() - 2000,
    label: 'First', from: '1', to: '2', feature: { __fid: '1', attributes: {} },
  };
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
    ruleId: '0:legacy-rule', ruleLabel: 'Test rule', sequence: x, observedAt: Date.now(), objectId: id, label: id,
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

test('monitors mixed rules independently across layers, buffers, duplicate object IDs and source failures', () => {
  vi.useFakeTimers({ toFake: [ 'Date', 'setInterval', 'clearInterval' ] });
  let step = 0;
  const getFeatures = vi.fn((params: { layerId: string }) => {
    if (params.layerId === 'broken' || (params.layerId === 'flags' && step === 3)) {
      return throwError(() => new HttpErrorResponse({ status: params.layerId === 'flags' ? 401 : 500 }));
    }
    const features = params.layerId === 'flags'
      ? [{ __fid: '1', attributes: { id: 1, flag: step === 0 ? 'none' : 'red' } }]
      : (step === 0 ? [] : [
        { __fid: '1', attributes: { id: 1 }, geometry: 'POINT (105000 405000)' },
        ...(step === 1 ? [{ __fid: '2', attributes: { id: 2 }, geometry: 'POINT (118000 405000)' }] : []),
      ]);
    return of({ page: 1, pageSize: 500, total: features.length, template: null, columnMetadata: [{ name: 'flag' }], features });
  });
  const fixture = TestBed.configureTestingModule({
    providers: [
      provideMockStore({ selectors: [
        { selector: selectLayers, value: [ 'flags', 'warnings', 'broken', 'disabled' ].map(id => ({ id, hasAttributes: true })) },
        { selector: selectComponentsConfig, value: [{
          type: BaseComponentTypeEnum.LAYER_ALERTS,
          config: { enabled: true, rules: [
            { id: 'flags', name: 'Flags', mode: 'any-change', layerId: 'flags', idAttribute: 'id', statusAttribute: 'flag' },
            { id: 'wide', name: 'Nearby dangers', mode: 'new-object', layerId: 'warnings', idAttribute: 'id', bufferKm: 10 },
            { id: 'local', name: 'Local dangers', mode: 'new-object', layerId: 'warnings', idAttribute: 'id', bufferKm: 0 },
            { id: 'broken', name: 'Broken source', mode: 'new-object', layerId: 'broken', idAttribute: 'id', bufferKm: 10 },
            { id: 'invalid', name: 'Invalid rule', mode: 'any-change', layerId: 'flags', idAttribute: '', statusAttribute: 'flag' },
            { id: 'disabled', enabled: false, mode: 'new-object', layerId: 'disabled', idAttribute: 'id', bufferKm: 10 },
          ] },
        }] },
        { selector: selectViewerId, value: 'app/test' },
      ] }),
      { provide: TAILORMAP_API_V1_SERVICE, useValue: { getFeatures$: getFeatures } },
      { provide: MapService, useValue: {
        getMapViewDetails$: () => of({ extent: [ 100000, 400000, 110000, 410000 ] }),
        getProjectionCode$: () => of('EPSG:28992'),
      } },
    ],
  }).createComponent(LayerAlertsComponent);
  fixture.detectChanges();
  vi.advanceTimersByTime(0);
  expect(fixture.componentInstance.visibleAlerts()).toEqual([]);
  expect(fixture.componentInstance.sourceState()).toBe('ready');
  expect(fixture.componentInstance.sourceProblems().map(rule => rule.label)).toEqual([ 'Broken source', 'Invalid rule' ]);
  expect(getFeatures.mock.calls.some(([params]) => params.layerId === 'disabled')).toBe(false);

  step = 1;
  vi.advanceTimersByTime(60_000);
  const visible = fixture.componentInstance.visibleAlerts();
  expect(visible).toHaveLength(4);
  expect(visible.filter(alert => alert.ruleLabel === 'Flags')).toHaveLength(1);
  expect(visible.filter(alert => alert.ruleLabel === 'Nearby dangers').map(alert => alert.outsideView)).toEqual([ false, true ]);
  expect(visible.filter(alert => alert.ruleLabel === 'Local dangers').map(alert => alert.outsideView)).toEqual([false]);

  const requests = getFeatures.mock.calls.length;
  const store = TestBed.inject(MockStore);
  store.overrideSelector(selectLayers, [ 'flags', 'warnings', 'broken', 'disabled', 'unrelated' ].map(id => ({
    id, hasAttributes: true,
  })) as ReturnType<typeof selectLayers>);
  store.refreshState();
  TestBed.tick();
  vi.advanceTimersByTime(0);
  expect(getFeatures).toHaveBeenCalledTimes(requests);
  expect(fixture.componentInstance.visibleAlerts()).toHaveLength(4);

  step = 2;
  vi.advanceTimersByTime(60_000);
  expect(fixture.componentInstance.visibleAlerts()).toHaveLength(3);
  expect(fixture.componentInstance.visibleAlerts().filter(alert => alert.ruleLabel === 'Flags')).toHaveLength(1);

  step = 3;
  vi.advanceTimersByTime(60_000);
  expect(fixture.componentInstance.visibleAlerts().map(alert => alert.ruleLabel).sort()).toEqual([ 'Local dangers', 'Nearby dangers' ]);
  expect(fixture.componentInstance.sourceState()).toBe('ready');
  fixture.destroy();
});
