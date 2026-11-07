import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TAILORMAP_API_V1_SERVICE } from '@tailormap-viewer/api';
import { MapService } from '@tailormap-viewer/map';
import { afterEach, expect, test, vi } from 'vitest';
import { selectLayers } from '../../map/state/map.selectors';
import { selectComponentsConfig, selectViewerId } from '../../state/core.selectors';
import { LayerAlertsComponent } from './layer-alerts.component';

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
