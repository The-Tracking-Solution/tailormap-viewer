import { Map as OlMap } from 'ol';
import { Point } from 'ol/geom.js';
import { FeatureHelper } from './feature.helper';

export class MapFollowHelper {
  public static getPointCoordinates(wkt: string | null): number[] | null {
    if (!wkt) {
      return null;
    }
    try {
      const geometry = FeatureHelper.fromWKT(wkt);
      const coordinates = geometry instanceof Point ? geometry.getCoordinates() : null;
      return coordinates && coordinates.length >= 2 && coordinates.every(Number.isFinite) ? coordinates : null;
    } catch {
      return null;
    }
  }

  /** Use screen pixels so the safe area also works on rotated maps and with asymmetric UI padding. */
  public static getTargetPixel(pixel: number[], size: number[], padding: number[] = [ 0, 0, 0, 0 ]): number[] | null {
    const [ top, right, bottom, left ] = padding;
    if (![ ...pixel, ...size, ...padding ].every(Number.isFinite)) {
      return null;
    }
    const width = size[0] - left - right;
    const height = size[1] - top - bottom;
    if (width <= 0 || height <= 0) {
      return null;
    }
    if (pixel[0] > left + width * 0.2 && pixel[0] < left + width * 0.8
      && pixel[1] > top + height * 0.2 && pixel[1] < top + height * 0.8) {
      return null;
    }
    return [ left + width / 2, top + height / 2 ];
  }

  public static panToPointIfOutsideViewport(olMap: OlMap, wkt: string, padding?: number[]): void {
    const coordinates = MapFollowHelper.getPointCoordinates(wkt);
    const size = olMap.getSize();
    const view = olMap.getView();
    if (!coordinates || !size || view.getAnimating() || view.getInteracting()) {
      return;
    }
    const pixel = olMap.getPixelFromCoordinate(coordinates);
    const center = view.getCenter();
    const targetPixel = pixel ? MapFollowHelper.getTargetPixel(pixel, size, padding) : null;
    const targetCoordinate = targetPixel ? olMap.getCoordinateFromPixel(targetPixel) : null;
    if (!center || !targetCoordinate) {
      return;
    }
    // Translate in map coordinates, preserving resolution and rotation. Never fit/zoom the feature.
    view.animate({
      center: [ center[0] + coordinates[0] - targetCoordinate[0], center[1] + coordinates[1] - targetCoordinate[1] ],
      duration: 300,
    });
  }
}
