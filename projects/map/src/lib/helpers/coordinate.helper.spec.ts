import { describe, expect, test } from 'vitest';
import { CoordinateHelper } from './coordinate.helper';

describe('CoordinateHelper', () => {

  test('projects to a known target projection that is not the map projection', () => {
    const rdCoordinates = CoordinateHelper.projectCoordinates(
      [ 5.38720621, 52.1551744 ],
      'EPSG:4326',
      'EPSG:28992',
    );

    expect(Math.abs(rdCoordinates[0] - 155000)).toBeLessThan(1);
    expect(Math.abs(rdCoordinates[1] - 463000)).toBeLessThan(1);
  });

  test('formats WGS84 coordinates as decimal degrees in latitude-longitude display order', () => {
    expect(CoordinateHelper.formatCoordinates(
      [ 5, 52 ],
      'EPSG:4326',
      'decimal-degrees',
    )).toEqual([ '52.000000° N', '5.000000° E' ]);
  });

  test('formats WGS84 coordinates as degrees and decimal minutes', () => {
    expect(CoordinateHelper.formatCoordinates(
      [ 5, 52 ],
      'EPSG:4326',
      'degrees-decimal-minutes',
    )).toEqual([ "52° 00.000' N", "005° 00.000' E" ]);
  });

  test('formats negative WGS84 coordinates with southern and western hemispheres', () => {
    expect(CoordinateHelper.formatCoordinates(
      [ -4.25, -33.5 ],
      'EPSG:4326',
      'decimal-degrees',
    )).toEqual([ '33.500000° S', '4.250000° W' ]);
  });

  test('rounds degree decimal minutes without producing 60 minutes', () => {
    expect(CoordinateHelper.formatCoordinates(
      [ 4.9999999, 51.9999999 ],
      'EPSG:4326',
      'degrees-decimal-minutes',
    )).toEqual([ "52° 00.000' N", "005° 00.000' E" ]);
  });

  test('parses decimal degree display values back to longitude-latitude order', () => {
    expect(CoordinateHelper.parseCoordinates(
      [ '52.000000° N', '5.000000° E' ],
      'decimal-degrees',
    )).toEqual([ 5, 52 ]);
  });

  test('parses degree decimal minute display values back to longitude-latitude order', () => {
    expect(CoordinateHelper.parseCoordinates(
      [ "52° 09.310' N", "005° 23.232' E" ],
      'degrees-decimal-minutes',
    )).toEqual([
      expect.closeTo(5.3872, 10),
      expect.closeTo(52.15516666666667, 10),
    ]);
  });

  test('rejects invalid degree decimal minute values', () => {
    expect(CoordinateHelper.parseCoordinates(
      [ "52° 60.000' N", "005° 23.232' E" ],
      'degrees-decimal-minutes',
    )).toBeNull();
  });

  test('parses XY values with either dot or comma as decimal separator', () => {
    expect(CoordinateHelper.parseCoordinates(
      [ '155000,25', '463000.50' ],
      'xy',
    )).toEqual([ 155000.25, 463000.5 ]);
  });

});
