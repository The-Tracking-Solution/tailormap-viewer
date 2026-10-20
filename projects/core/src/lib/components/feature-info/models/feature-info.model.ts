import { AttributeDisplayType, AppLayerModel, AttachmentMetadataModel } from '@tailormap-viewer/api';

export interface FeatureInfoModel {
  __fid: string;
  layer: AppLayerModel;
  sortedAttributes: Array<{ label: string; attributeValue: any; key: string; displayType?: AttributeDisplayType }>;
  sortedAttachmentsByAttribute: Array<{ attributeName: string; attachments: AttachmentMetadataModel[] }>;
  attachmentCount: number;
  geometry: string | null;
}
