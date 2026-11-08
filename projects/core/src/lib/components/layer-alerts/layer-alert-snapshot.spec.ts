import { assert, describe, expect, test } from 'vitest';
import { AttributeType } from '@tailormap-viewer/api';
import type { FeatureModel, FeaturesResponseModel } from '@tailormap-viewer/api';
import { compareLayerAlertSnapshots, detectNewLayerAlerts, parseLayerAlertRule, readLayerAlertSnapshot } from './layer-alert-snapshot';

const rule = {
  layerId: 'strand-flags',
  idAttribute: 'svid',
  statusAttribute: 'svflag',
  labelAttribute: 'name',
  from: 'yellow',
  to: 'red',
};

function feature(id: string, status: string | number | null): FeatureModel {
  return {
    __fid: 'source.' + id,
    attributes: { svid: id, svflag: status, name: 'Post ' + id },
  };
}

function response(...features: FeatureModel[]): FeaturesResponseModel {
  return {
    features,
    total: features.length,
    page: 1,
    pageSize: 500,
    columnMetadata: [{ name: 'svflag', type: AttributeType.STRING }],
    template: null,
  };
}

describe('layer alert snapshots', () => {
  test('accepts a complete empty baseline and reports a new ID only once per session', () => {
    const newRule = parseLayerAlertRule({ layerId: 'warnings', idAttribute: 'svid', mode: 'new-object', bufferKm: 10 })!;
    const seen = new Set<string>();
    const empty = readLayerAlertSnapshot(response(), newRule)!;
    const warning = feature('a', null);
    const populated = readLayerAlertSnapshot(response(warning), newRule)!;

    expect(detectNewLayerAlerts(empty, seen, false)).toEqual([]);
    expect(detectNewLayerAlerts(populated, seen, true)).toEqual([{ objectId: 'a', label: 'a', feature: warning }]);
    expect(detectNewLayerAlerts(empty, seen, true)).toEqual([]);
    expect(detectNewLayerAlerts(populated, seen, true)).toEqual([]);
    expect(readLayerAlertSnapshot({ ...response(), total: 1 }, newRule)).toBeUndefined();
  });

  test('uses existing warnings as baseline without emitting new alerts', () => {
    const newRule = parseLayerAlertRule({ layerId: 'warnings', idAttribute: 'svid', mode: 'new-object', bufferKm: 0 })!;
    const seen = new Set<string>();
    const snapshot = readLayerAlertSnapshot(response(feature('existing', null)), newRule)!;
    expect(detectNewLayerAlerts(snapshot, seen, false)).toEqual([]);
    expect(detectNewLayerAlerts(snapshot, seen, true)).toEqual([]);
  });

  test('emits one alert for the configured transition on the same object', () => {
    const red = feature('a', 'red');
    const previous = readLayerAlertSnapshot(response(feature('a', 'yellow'), feature('b', 'green')), rule)!;
    const current = readLayerAlertSnapshot(response(red, feature('b', 'red'), feature('c', 'red')), rule)!;

    expect(compareLayerAlertSnapshots(previous, current, rule)).toEqual([
      { feature: red, label: 'Post a', from: 'yellow', to: 'red' },
    ]);
    expect(compareLayerAlertSnapshots(current, current, rule)).toEqual([]);
  });

  test('emits one alert for each observed value change and ignores unchanged or newly seen objects', () => {
    const anyRule = parseLayerAlertRule({ ...rule, mode: 'any-change', from: undefined, to: undefined })!;
    assert(anyRule.mode !== 'new-object');
    const purple = feature('a', 'purple');
    const cleared = feature('b', null);
    const raised = feature('c', 'yellow');
    const previous = readLayerAlertSnapshot(response(
      feature('a', 'yellow'), feature('b', 'red'), feature('c', null), feature('d', 'purple'), feature('removed', 'yellow'),
    ), anyRule)!;
    const current = readLayerAlertSnapshot(response(
      purple, cleared, raised, feature('d', 'purple'), feature('new', 'yellow'),
    ), anyRule)!;

    expect(compareLayerAlertSnapshots(previous, current, anyRule)).toEqual([
      { feature: purple, label: 'Post a', from: 'yellow', to: 'purple' },
      { feature: cleared, label: 'Post b', from: 'red', to: '—' },
      { feature: raised, label: 'Post c', from: '—', to: 'yellow' },
    ]);
    expect(compareLayerAlertSnapshots(current, current, anyRule)).toEqual([]);
  });

  test('skips unidentifiable objects in any-change mode and still rejects duplicate IDs', () => {
    const anyRule = parseLayerAlertRule({ ...rule, mode: 'any-change' })!;
    assert(anyRule.mode !== 'new-object');
    const before = readLayerAlertSnapshot(response(feature('', 'red'), feature('a', 'yellow')), anyRule)!;
    const after = readLayerAlertSnapshot(response(feature('', 'yellow'), feature('a', 'red')), anyRule)!;
    expect(compareLayerAlertSnapshots(before, after, anyRule)).toHaveLength(1);
    expect(readLayerAlertSnapshot(response(feature('', 'red')), anyRule)).toBeUndefined();
    expect(readLayerAlertSnapshot(response(feature('a', 'red'), feature('a', 'yellow')), anyRule)).toBeUndefined();
  });

  test('does not compare across a missing status or a removed object', () => {
    const previous = readLayerAlertSnapshot(response(feature('a', 'yellow'), feature('b', null)), rule)!;
    const current = readLayerAlertSnapshot(response(feature('b', 'red')), rule)!;

    expect(compareLayerAlertSnapshots(previous, current, rule)).toEqual([]);
  });

  test('rejects partial, uncounted and empty responses', () => {
    const complete = response(feature('a', 'yellow'));
    expect(readLayerAlertSnapshot({ ...complete, total: 2 }, rule)).toBeUndefined();
    expect(readLayerAlertSnapshot({ ...complete, total: -1 }, rule)).toBeUndefined();
    expect(readLayerAlertSnapshot({ ...complete, page: 2 }, rule)).toBeUndefined();
    expect(readLayerAlertSnapshot({ ...complete, columnMetadata: [] }, rule)).toBeUndefined();
    expect(readLayerAlertSnapshot(response(), rule)).toBeUndefined();
  });

  test('rejects missing or duplicate object keys', () => {
    expect(readLayerAlertSnapshot(response(feature('', 'yellow')), rule)).toBeUndefined();
    expect(readLayerAlertSnapshot(response(feature('a', 'yellow'), feature('a', 'red')), rule)).toBeUndefined();
  });

  test('normalizes numeric flag values and rejects rules without a distinct transition', () => {
    const numericRule = parseLayerAlertRule({ ...rule, from: 1, to: 2 })!;
    assert(numericRule.mode !== 'new-object');
    const previous = readLayerAlertSnapshot(response(feature('a', 1)), numericRule)!;
    const current = readLayerAlertSnapshot(response(feature('a', 2)), numericRule)!;

    expect(compareLayerAlertSnapshots(previous, current, numericRule)).toHaveLength(1);
    expect(parseLayerAlertRule({ ...rule, from: ' red ', to: 'red' })).toBeUndefined();
    expect(parseLayerAlertRule({ ...rule, idAttribute: '' })).toBeUndefined();
    expect(parseLayerAlertRule(null)).toBeUndefined();
  });
});
