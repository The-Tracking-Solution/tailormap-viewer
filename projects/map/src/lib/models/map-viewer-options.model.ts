import { OpenlayersExtent } from './extent.type';

export interface MapViewerControlOptionsModel {
  attributionPosition?: 'left' | 'right';
}

export interface MapViewerOptionsModel {
  initialCenter?: number[];
  initialZoom?: number;
  projection: string;
  projectionAliases?: string[];
  projectionDefinition: string;
  maxExtent: OpenlayersExtent;
  initialExtent?: OpenlayersExtent;
  controlOptions?: MapViewerControlOptionsModel;
}
