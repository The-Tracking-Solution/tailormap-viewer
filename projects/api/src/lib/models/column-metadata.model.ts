import { AttributeDisplayType } from './attribute-display-type.model';
import { AttributeType } from './attribute-type.enum';

export interface ColumnMetadataModel {
  name: string;
  type: AttributeType;
  alias?: string;
  displayType?: AttributeDisplayType;
}
