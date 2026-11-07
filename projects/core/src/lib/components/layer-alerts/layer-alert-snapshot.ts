import type { FeatureModel, FeaturesResponseModel } from '@tailormap-viewer/api';

export const LAYER_ALERT_PAGE_SIZE = 500;

export type LayerAlertRule = {
  layerId: string;
  idAttribute: string;
  statusAttribute: string;
  labelAttribute?: string;
} & (
  { mode: 'any-change' }
  | { mode?: 'transition'; from: string; to: string }
);

interface LayerAlertObject {
  status: string | undefined;
  label: string;
  feature: FeatureModel;
}

export interface LayerAlert {
  label: string;
  from: string;
  to: string;
  feature: FeatureModel;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function parseLayerAlertRule(input: unknown): LayerAlertRule | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const fields = input as Record<string, unknown>;
  const layerId = asText(fields['layerId']);
  const idAttribute = asText(fields['idAttribute']);
  const statusAttribute = asText(fields['statusAttribute']);
  if (!layerId || !idAttribute || !statusAttribute || idAttribute === statusAttribute) {
    return undefined;
  }
  const baseRule = { layerId, idAttribute, statusAttribute, labelAttribute: asText(fields['labelAttribute']) };
  const mode = fields['mode'];
  if (mode === 'any-change') {
    return { ...baseRule, mode };
  }
  const from = asText(fields['from']);
  const to = asText(fields['to']);
  if ((mode !== undefined && mode !== 'transition') || !from || !to || from === to) {
    return undefined;
  }
  return { ...baseRule, from, to };
}

/** A single page is the baseline only when the API confirms it contains the whole layer. */
export function readLayerAlertSnapshot(response: FeaturesResponseModel, rule: LayerAlertRule): Map<string, LayerAlertObject> | undefined {
  const { features, total, page, pageSize, columnMetadata } = response;
  if (page !== 1 || !pageSize || !Number.isInteger(pageSize) || !Array.isArray(features) || features.length === 0
    || total !== features.length || total > Math.min(pageSize, LAYER_ALERT_PAGE_SIZE)
    || !columnMetadata?.some(column => column.name === rule.statusAttribute)) {
    return undefined;
  }

  const snapshot = new Map<string, LayerAlertObject>();
  for (const feature of features) {
    const id = asText(feature.attributes?.[rule.idAttribute]);
    if (!id && rule.mode === 'any-change') {
      continue;
    }
    if (!id || snapshot.has(id)) {
      return undefined;
    }
    const label = rule.labelAttribute ? asText(feature.attributes[rule.labelAttribute]) : undefined;
    snapshot.set(id, { feature, label: label ?? id, status: asText(feature.attributes[rule.statusAttribute]) });
  }
  return snapshot.size ? snapshot : undefined;
}

export function compareLayerAlertSnapshots(
  previous: ReadonlyMap<string, LayerAlertObject>,
  current: ReadonlyMap<string, LayerAlertObject>,
  rule: LayerAlertRule,
): LayerAlert[] {
  const alerts: LayerAlert[] = [];
  for (const [ id, object ] of current) {
    const before = previous.get(id);
    if (!before) {
      continue;
    }
    const matches = rule.mode === 'any-change'
      ? before.status !== object.status
      : before.status === rule.from && object.status === rule.to;
    if (matches) {
      alerts.push({ feature: object.feature, label: object.label, from: before.status ?? '—', to: object.status ?? '—' });
    }
  }
  return alerts;
}
