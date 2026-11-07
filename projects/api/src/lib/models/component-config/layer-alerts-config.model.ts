import { ComponentBaseConfigModel } from '../component-base-config.model';

export type LayerAlertMatchMode = 'any-change' | 'transition';

export interface LayerAlertsConfigModel extends ComponentBaseConfigModel {
  rule?: {
    layerId: string;
    idAttribute: string;
    statusAttribute: string;
    labelAttribute?: string;
  } & (
    { mode: 'any-change' }
    | { mode?: 'transition'; from: string | number; to: string | number }
  );
}
