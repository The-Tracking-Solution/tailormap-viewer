import { describe, test, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { HttpXsrfTokenExtractor } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OpenLayersMap } from './openlayers-map';

const options = { projection: 'EPSG:3857', projectionDefinition: '', maxExtent: [ -1000000, -1000000, 1000000, 1000000 ],
  initialExtent: [ -10000, -10000, 10000, 10000 ], initialCenter: [ 1000, 2000 ], initialZoom: 12.5 };

const setup = () => {
  TestBed.configureTestingModule({ providers: [{ provide: NgZone, useFactory: () => new NgZone({}) }] });
  return new OpenLayersMap(TestBed.inject(NgZone), {} as HttpXsrfTokenExtractor);
};

describe('Personal start position and Home', () => {
  test('opens at the configured center and fractional zoom', async () => {
    const map = setup();
    map.initMap(options);
    const olMap = await firstValueFrom(map.getMap$());
    expect(olMap.getView().getCenter()).toEqual([ 1000, 2000 ]);
    expect(olMap.getView().getZoom()).toBeCloseTo(12.5);
    olMap.dispose();
  });

  test('an explicit location link overrides opening but Home retains the personal position', async () => {
    const map = setup();
    map.initMap(options, { initialCenter: [ 3000, 4000 ], initialZoom: 10 });
    const olMap = await firstValueFrom(map.getMap$());
    expect(olMap.getView().getCenter()).toEqual([ 3000, 4000 ]);
    expect(olMap.getView().getZoom()).toBeCloseTo(10);
    map.zoomToInitialExtent();
    expect(olMap.getView().getCenter()).toEqual([ 1000, 2000 ]);
    expect(olMap.getView().getZoom()).toBeCloseTo(12.5);
    olMap.dispose();
  });

  test('an application without an initial extent falls back to its maximum extent after switching', async () => {
    const map = setup();
    map.initMap(options);
    const olMap = await firstValueFrom(map.getMap$());
    olMap.setSize([ 800, 600 ]);
    map.initMap({ ...options, initialCenter: undefined, initialZoom: undefined, initialExtent: [] });
    expect(olMap.getView().getCenter()).toEqual([ 0, 0 ]);
    olMap.dispose();
  });

  test('saving a new Home position does not move the current map', async () => {
    const map = setup();
    map.initMap(options);
    const olMap = await firstValueFrom(map.getMap$());
    map.setInitialPosition([ 3000, 4000 ], 14);
    expect(olMap.getView().getCenter()).toEqual([ 1000, 2000 ]);
    map.zoomToInitialExtent();
    expect(olMap.getView().getCenter()).toEqual([ 3000, 4000 ]);
    expect(olMap.getView().getZoom()).toBeCloseTo(14);
    olMap.dispose();
  });

  test('changing to an application without a preference clears the previous Home position', async () => {
    const map = setup();
    map.initMap(options);
    const olMap = await firstValueFrom(map.getMap$());
    olMap.setSize([ 800, 600 ]);
    map.initMap({ ...options, initialCenter: undefined, initialZoom: undefined, initialExtent: [ -100, -100, 100, 100 ] });
    map.zoomToInitialExtent();
    expect(olMap.getView().getCenter()).toEqual([ 0, 0 ]);
    expect(olMap.getView().getZoom()).not.toBeCloseTo(12.5);
    olMap.dispose();
  });
});
