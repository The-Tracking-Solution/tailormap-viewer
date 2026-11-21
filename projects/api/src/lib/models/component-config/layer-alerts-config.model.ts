import { ComponentBaseConfigModel } from '../component-base-config.model';

export type LayerAlertMatchMode = 'any-change' | 'transition' | 'new-object';

export type LayerAlertRuleConfigModel = {
  id?: string;
  enabled?: boolean;
  name?: string;
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

export interface LayerAlertsConfigModel extends ComponentBaseConfigModel {
  /** First enabled rule, retained for compatibility with single-rule viewers. */
  rule?: LayerAlertRuleConfigModel;
  rules?: LayerAlertRuleConfigModel[];
}

export const DEFAULT_LAYER_ALERT_BUFFER_KM = 10;
