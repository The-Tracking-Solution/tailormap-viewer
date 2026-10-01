import { ComponentBaseConfigModel } from '../component-base-config.model';
import { CoordinateDisplayFormat } from './mouse-coordinates-config.model';

export interface CoordinatePickerConfigModel extends ComponentBaseConfigModel {
  projection?: string;
  format?: CoordinateDisplayFormat;
}
