import { circular } from 'ol/geom/Polygon.js';
import { getTransform, get as getProjection } from 'ol/proj.js';
import { FeatureHelper } from './feature.helper';
import { Proj4Helper } from './proj4.helper';
import { ProjectionsHelper } from './projections.helper';

export type CoordinateDisplayFormat = 'xy' | 'decimal-degrees' | 'degrees-decimal-minutes';

export class CoordinateHelper {
  public static projectCoordinates(coords: [number, number], fromProjection: string, toProjection: string): [number, number] {
    ProjectionsHelper.ensureProjection(fromProjection);
    ProjectionsHelper.ensureProjection(toProjection);
    return Proj4Helper.proj4(fromProjection, toProjection, coords);
  }

  public static formatCoordinates(
    coordinates: [number, number],
    projection: string,
    format: CoordinateDisplayFormat,
  ): [string, string] {
    switch (format) {
      case 'decimal-degrees':
        return [
          CoordinateHelper.formatDecimalDegrees(coordinates[1], true),
          CoordinateHelper.formatDecimalDegrees(coordinates[0], false),
        ];
      case 'degrees-decimal-minutes':
        return [
          CoordinateHelper.formatDegreesDecimalMinutes(coordinates[1], true),
          CoordinateHelper.formatDegreesDecimalMinutes(coordinates[0], false),
        ];
      default: {
        const precision = projection === 'EPSG:4326' ? 6 : 2;
        return [ coordinates[0].toFixed(precision), coordinates[1].toFixed(precision) ];
      }
    }
  }

  public static parseCoordinates(
    coordinates: [string, string],
    projection: string,
    format: CoordinateDisplayFormat,
  ): [number, number] | null {
    switch (format) {
      case 'decimal-degrees': {
        const latitude = CoordinateHelper.parseDecimalDegrees(coordinates[0], true);
        const longitude = CoordinateHelper.parseDecimalDegrees(coordinates[1], false);
        return latitude === null || longitude === null ? null : [ longitude, latitude ];
      }
      case 'degrees-decimal-minutes': {
        const latitude = CoordinateHelper.parseDegreesDecimalMinutes(coordinates[0], true);
        const longitude = CoordinateHelper.parseDegreesDecimalMinutes(coordinates[1], false);
        return latitude === null || longitude === null ? null : [ longitude, latitude ];
      }
      default: {
        const x = Number(coordinates[0].trim().replace(',', '.'));
        const y = Number(coordinates[1].trim().replace(',', '.'));
        return Number.isFinite(x) && Number.isFinite(y) ? [ x, y ] : null;
      }
    }
  }

  private static formatDecimalDegrees(value: number, latitude: boolean): string {
    const hemisphere = latitude
      ? (value < 0 ? 'S' : 'N')
      : (value < 0 ? 'W' : 'E');
    return `${Math.abs(value).toFixed(6)}° ${hemisphere}`;
  }

  private static formatDegreesDecimalMinutes(value: number, latitude: boolean): string {
    const hemisphere = latitude
      ? (value < 0 ? 'S' : 'N')
      : (value < 0 ? 'W' : 'E');

    const absoluteValue = Math.abs(value);
    let degrees = Math.floor(absoluteValue);
    let minutes = Number(((absoluteValue - degrees) * 60).toFixed(3));
    if (minutes >= 60) {
      degrees += 1;
      minutes = 0;
    }

    const degreeWidth = latitude ? 2 : 3;
    const degreesText = degrees.toString().padStart(degreeWidth, '0');
    const minutesText = minutes.toFixed(3).padStart(6, '0');
    return `${degreesText}° ${minutesText}' ${hemisphere}`;
  }

  private static parseDecimalDegrees(value: string, latitude: boolean): number | null {
    const match = value.trim().toUpperCase().match(/^([+-]?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?$/);
    if (!match) {
      return null;
    }

    const numericValue = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const hemisphere = match[2];
    if (hemisphere && ((latitude && ![ 'N', 'S' ].includes(hemisphere)) || (!latitude && ![ 'E', 'W' ].includes(hemisphere)))) {
      return null;
    }

    const absoluteValue = Math.abs(numericValue);
    const signedValue = hemisphere
      ? ([ 'S', 'W' ].includes(hemisphere) ? -absoluteValue : absoluteValue)
      : numericValue;
    const maxValue = latitude ? 90 : 180;
    return Math.abs(signedValue) <= maxValue ? signedValue : null;
  }

  private static parseDegreesDecimalMinutes(value: string, latitude: boolean): number | null {
    const match = value.trim().toUpperCase().match(/^(\d{1,3})\s*°\s*(\d{1,2}(?:[.,]\d+)?)\s*['′]?\s*([NSEW])$/);
    if (!match) {
      return null;
    }

    const degrees = Number(match[1]);
    const minutes = Number(match[2].replace(',', '.'));
    const hemisphere = match[3];

    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
      return null;
    }
    if ((latitude && ![ 'N', 'S' ].includes(hemisphere)) || (!latitude && ![ 'E', 'W' ].includes(hemisphere))) {
      return null;
    }

    const maxDegrees = latitude ? 90 : 180;
    if (degrees > maxDegrees || (degrees === maxDegrees && minutes > 0)) {
      return null;
    }

    const decimal = degrees + minutes / 60;
    return [ 'S', 'W' ].includes(hemisphere) ? -decimal : decimal;
  }

  /**
   * Calculates a WKT approximation of a circle on Earth using the WGS84 ellipsoid.
   *
   * @param coords       the coordinates (longitude, latitude) in degrees.
   * @param radius       the radius of the circle in meters.
   * @param toProjection the projection to use for WKT output.
   * @returns a WKT representation of the circle.
   */
  public static circleFromWGS84CoordinatesAndRadius(coords: number[], radius: number, toProjection: string): string {
      const polygon = circular(coords, radius, 128);
      const projection = getProjection(toProjection);
      if (projection === null) {
          return '';
      }
      const transformFn = getTransform('EPSG:4326', toProjection);
      if (transformFn === null) {
          return '';
      }
      polygon.applyTransform(transformFn);
      return FeatureHelper.getWKT(polygon, projection);
  }
}
