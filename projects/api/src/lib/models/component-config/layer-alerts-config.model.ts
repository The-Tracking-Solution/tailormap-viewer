import { ComponentBaseConfigModel } from '../component-base-config.model';

export type LayerAlertMatchMode = 'any-change' | 'transition' | 'new-object';

export interface LayerAlertsConfigModel extends ComponentBaseConfigModel {
  rule?: {
    layerId: string;
    idAttribute: string;
    labelAttribute?: string;
  } & (
    { mode: 'new-object'; bufferKm: number }
    | ({ statusAttribute: string } & (
      { mode: 'any-change' }
      | { mode?: 'transition'; from: string | number; to: string | number }
    ))
  );
}

export const DEFAULT_LAYER_ALERT_BUFFER_KM = 10;
