import { ComponentBaseConfigModel } from '../component-base-config.model';

export interface LayerAlertsConfigModel extends ComponentBaseConfigModel {
  rule?: {
    layerId: string;
    idAttribute: string;
    statusAttribute: string;
    labelAttribute?: string;
    from: string | number;
    to: string | number;
  };
}
