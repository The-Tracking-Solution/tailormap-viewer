import { describe, test, expect, vi } from 'vitest';
import { Map as OlMap } from 'ol';
import { MapFollowHelper } from './map-follow.helper';

describe('MapFollowHelper', () => {
  test('accepts finite points, including Z, and ignores invalid or non-point geometries', () => {
    expect(MapFollowHelper.getPointCoordinates('POINT Z (1 2 3)')).toEqual([ 1, 2, 3 ]);
    for (const wkt of [ null, '', 'bad WKT', 'POINT EMPTY', 'LINESTRING (1 2, 3 4)', 'POINT (NaN 2)' ]) {
      expect(MapFollowHelper.getPointCoordinates(wkt)).toBeNull();
    }
  });

  test('leaves the map stationary inside the safe area', () => {
    expect(MapFollowHelper.getTargetPixel([ 500, 400 ], [ 1000, 800 ])).toBeNull();
  });

  test.each([[ 0, 400 ], [ 1000, 400 ], [ 500, 0 ], [ 500, 800 ], [ -500, 400 ], [ 500, 2000 ]])(
    'moves edge or off-screen point %j to the middle of the visible area', (x, y) => {
      expect(MapFollowHelper.getTargetPixel([ x, y ], [ 1000, 800 ])).toEqual([ 500, 400 ]);
    },
  );

  test('uses asymmetric side and mobile bottom padding', () => {
    expect(MapFollowHelper.getTargetPixel([ 700, 400 ], [ 1000, 800 ], [ 0, 400, 400, 100 ])).toEqual([ 350, 200 ]);
    expect(MapFollowHelper.getTargetPixel([ 350, 200 ], [ 1000, 800 ], [ 0, 400, 400, 100 ])).toBeNull();
    expect(MapFollowHelper.getTargetPixel([ 1, 1 ], [ 400, 300 ], [ 0, 500, 0, 0 ])).toBeNull();
  });

  test('translates using pixel-to-coordinate conversion without changing zoom or rotation', () => {
    const animate = vi.fn();
    const view = { getCenter: () => [ 100, 200 ], getAnimating: () => false, getInteracting: () => false, animate };
    const map = {
      getSize: () => [ 1000, 800 ], getView: () => view,
      getPixelFromCoordinate: () => [ 950, 400 ], getCoordinateFromPixel: vi.fn(() => [ 300, 400 ]),
    };
    MapFollowHelper.panToPointIfOutsideViewport(map as unknown as OlMap, 'POINT (500 600)');
    expect(map.getCoordinateFromPixel).toHaveBeenCalledWith([ 500, 400 ]);
    expect(animate).toHaveBeenCalledWith({ center: [ 300, 400 ], duration: 300 });
  });

  test('does not pan during a user interaction or another animation', () => {
    for (const animating of [ true, false ]) {
      const animate = vi.fn();
      const map = {
        getSize: () => [ 1000, 800 ],
        getView: () => ({ getAnimating: () => animating, getInteracting: () => !animating, animate }),
      };
      MapFollowHelper.panToPointIfOutsideViewport(map as unknown as OlMap, 'POINT (1 2)');
      expect(animate).not.toHaveBeenCalled();
    }
  });
});
