import { expect, test, vi } from 'vitest';
import { GeometryHelper } from './geometry.helper';

vi.unmock('jsts/org/locationtech/jts/io');

test('classifies points and polygon edges by their distance to the map in metres', () => {
  const classify = GeometryHelper.createViewportClassifier(
    { extent: [ 100000, 400000, 110000, 410000 ] },
    'EPSG:28992',
    10000,
  )!;
  expect(classify('POINT (105000 405000)')).toBe('inside');
  expect(classify('POINT (118000 405000)')).toBe('nearby');
  expect(classify('POINT (120000 405000)')).toBe('nearby');
  expect(classify('POINT (122000 405000)')).toBeUndefined();
  expect(classify('POINT (119000 419000)')).toBeUndefined();
  expect(classify('POLYGON ((109000 401000, 140000 401000, 140000 402000, 109000 402000, 109000 401000))')).toBe('inside');
  expect(classify('POLYGON ((119000 401000, 140000 401000, 140000 402000, 119000 402000, 119000 401000))')).toBe('nearby');
  expect(classify('POINT EMPTY')).toBeUndefined();
});

test('classifies against the visible corners of a rotated map', () => {
  const classify = GeometryHelper.createViewportClassifier({
    extent: [ 100000, 400000, 110000, 410000 ],
    viewport: [[ 105000, 400000 ], [ 110000, 405000 ], [ 105000, 410000 ], [ 100000, 405000 ]],
  }, 'EPSG:28992', 0)!;
  expect(classify('POINT (105000 405000)')).toBe('inside');
  expect(classify('POINT (109000 409000)')).toBeUndefined();
});

test('reprojects Web Mercator and WGS84 before measuring the buffer', () => {
  const classify = GeometryHelper.createViewportClassifier(
    { extent: [ 556000, 6800000, 558000, 6802000 ] },
    'EPSG:3857',
    10000,
  )!;
  expect(classify('POINT (570000 6801000)', 'EPSG:3857')).toBe('nearby');
  expect(classify('POINT (5.12 52.02)', 'EPSG:4326')).toBe('nearby');
});
