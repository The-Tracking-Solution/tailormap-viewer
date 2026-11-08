import type { FeatureModel, FeaturesResponseModel } from '@tailormap-viewer/api';

export const LAYER_ALERT_PAGE_SIZE = 500;

export type LayerAlertRule = {
  layerId: string;
  idAttribute: string;
  labelAttribute?: string;
} & (
  { mode: 'new-object'; bufferKm: number }
  | ({ statusAttribute: string } & (
    { mode: 'any-change' }
    | { mode?: 'transition'; from: string; to: string }
  ))
);

interface LayerAlertObject {
  status: string | undefined;
  label: string;
  feature: FeatureModel;
}

export type LayerAlert = { label: string; feature: FeatureModel } & (
  { objectId: string; from?: undefined; to?: undefined }
  | { objectId?: undefined; from: string; to: string }
);

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
  if (!layerId || !idAttribute) {
    return undefined;
  }
  const baseRule = { layerId, idAttribute, labelAttribute: asText(fields['labelAttribute']) };
  const mode = fields['mode'];
  if (mode === 'new-object') {
    const bufferKm = fields['bufferKm'];
    return typeof bufferKm === 'number' && Number.isFinite(bufferKm * 1000) && bufferKm >= 0
      ? { ...baseRule, mode, bufferKm }
      : undefined;
  }
  const statusAttribute = asText(fields['statusAttribute']);
  if (!statusAttribute || idAttribute === statusAttribute) {
    return undefined;
  }
  if (mode === 'any-change') {
    return { ...baseRule, statusAttribute, mode };
  }
  const from = asText(fields['from']);
  const to = asText(fields['to']);
  if ((mode !== undefined && mode !== 'transition') || !from || !to || from === to) {
    return undefined;
  }
  return { ...baseRule, statusAttribute, from, to };
}

/** A single page is the baseline only when the API confirms it contains the whole layer. */
export function readLayerAlertSnapshot(response: FeaturesResponseModel, rule: LayerAlertRule): Map<string, LayerAlertObject> | undefined {
  const { features, total, page, pageSize, columnMetadata } = response;
  const newObjects = rule.mode === 'new-object';
  if (page !== 1 || !pageSize || !Number.isInteger(pageSize) || !Array.isArray(features)
    || total !== features.length || total > Math.min(pageSize, LAYER_ALERT_PAGE_SIZE)
    || (!newObjects && (features.length === 0 || !columnMetadata?.some(column => column.name === rule.statusAttribute)))) {
    return undefined;
  }

  const snapshot = new Map<string, LayerAlertObject>();
  for (const feature of features) {
    const id = asText(feature.attributes?.[rule.idAttribute]);
    if (!id && (newObjects || rule.mode === 'any-change')) {
      continue;
    }
    if (!id || snapshot.has(id)) {
      return undefined;
    }
    const label = rule.labelAttribute ? asText(feature.attributes[rule.labelAttribute]) : undefined;
    const status = newObjects ? undefined : asText(feature.attributes[rule.statusAttribute]);
    snapshot.set(id, { feature, label: label ?? id, status });
  }
  return snapshot.size || (newObjects && features.length === 0) ? snapshot : undefined;
}

export function compareLayerAlertSnapshots(
  previous: ReadonlyMap<string, LayerAlertObject>,
  current: ReadonlyMap<string, LayerAlertObject>,
  rule: Exclude<LayerAlertRule, { mode: 'new-object' }>,
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

/** Track IDs for the entire viewer session, including objects outside the viewport. */
export function detectNewLayerAlerts(
  current: ReadonlyMap<string, LayerAlertObject>,
  seen: Set<string>,
  hasBaseline: boolean,
): LayerAlert[] {
  const alerts: LayerAlert[] = [];
  for (const [ objectId, object ] of current) {
    if (hasBaseline && !seen.has(objectId)) {
      alerts.push({ objectId, label: object.label, feature: object.feature });
    }
    seen.add(objectId);
  }
  return alerts;
}
