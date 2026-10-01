import { ComponentBaseConfigModel } from '../component-base-config.model';

export const COORDINATE_DISPLAY_MAP_PROJECTION = 'map';
export const MOUSE_COORDINATES_MAP_PROJECTION = COORDINATE_DISPLAY_MAP_PROJECTION;

export type CoordinateDisplayFormat = 'xy' | 'decimal-degrees' | 'degrees-decimal-minutes';
export type MouseCoordinatesFormat = CoordinateDisplayFormat;

export interface MouseCoordinatesDisplayConfigModel {
  id: string;
  label?: string;
  projection: string;
  format: MouseCoordinatesFormat;
}

export interface MouseCoordinatesConfigModel extends ComponentBaseConfigModel {
  displays?: MouseCoordinatesDisplayConfigModel[];
}
