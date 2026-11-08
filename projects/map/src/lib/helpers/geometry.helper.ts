import { Circle, Polygon } from 'ol/geom.js';
import { fromCircle, fromExtent } from 'ol/geom/Polygon.js';
import { WKT } from 'ol/format.js';
import { WKTReader, WKTWriter } from 'jsts/org/locationtech/jts/io.js';
import { BufferOp } from 'jsts/org/locationtech/jts/operation/buffer.js';

import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance.js';
import { get as getProjection } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import { MapViewDetailsModel, ProjectionCodesEnum } from '../models';
import { Proj4Helper } from './proj4.helper';
import { ProjectionsHelper } from './projections.helper';

export class GeometryHelper {

  /** Use RD metres for distances around the viewport in the Netherlands pilot. */
  public static createViewportClassifier(
    view: Pick<MapViewDetailsModel, 'extent' | 'viewport'>,
    projection: string,
    bufferMeters: number,
  ): ((wkt: string, sourceProjection?: string) => 'inside' | 'nearby' | undefined) | undefined {
    if (!view.extent?.every(Number.isFinite)) {
      return undefined;
    }
    const metric = ProjectionCodesEnum.RD;
    if (!getProjection(metric)) {
      ProjectionsHelper.ensureProjection(metric);
      register(Proj4Helper.proj4);
    }
    const wktFormat = new WKT();
    const reader = new WKTReader();
    const viewport = view.viewport;
    const polygon = viewport?.length === 4 ? new Polygon([[ ...viewport, viewport[0] ]]) : fromExtent(view.extent);
    let boundary;
    try {
      polygon.transform(projection, metric);
      if (!polygon.getExtent().every(Number.isFinite)) {
        return undefined;
      }
      boundary = reader.read(wktFormat.writeGeometry(polygon));
    } catch {
      return undefined;
    }
    return (wkt, sourceProjection) => {
      try {
        const geometry = wktFormat.readGeometry(wkt);
        geometry.transform(sourceProjection || projection, metric);
        if (!geometry.getExtent().every(Number.isFinite)) {
          return undefined;
        }
        const distance = DistanceOp.distance(boundary, reader.read(wktFormat.writeGeometry(geometry)));
        return distance === 0 ? 'inside' : distance <= bufferMeters ? 'nearby' : undefined;
      } catch {
        return undefined;
      }
    };
  }

  public static bufferWktGeometry(wktGeom: string, bufferDistance: number): string {
    const parsedGeom = new WKTReader().read(wktGeom);
    const bufferedGeom = BufferOp.bufferOp(parsedGeom, bufferDistance);
    return new WKTWriter().write(bufferedGeom);
  }

  /**
   *
   * @param circle in the internal format "CIRCLE(127845.9 459695.36 351.01)"
   * @param buffer distance
   */
  public static getCircleQueryWKT(circle: string, buffer?: number): string {
    const geom = circle.substring(7, circle.length - 1);
    const [ x, y, radius ] = geom.split(/\s+/);
    const bufferedRadius = parseFloat(radius) + (buffer || 0);
    const olCircle = new Circle([ parseFloat(x), parseFloat(y) ], bufferedRadius);
    const circlePolygon = fromCircle(olCircle);
    return new WKT().writeGeometry(circlePolygon);
  }
}
