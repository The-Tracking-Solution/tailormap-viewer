import { describe, expect, test } from 'vitest';
import { AttributeType } from '@tailormap-viewer/api';
import type { FeatureModel, FeaturesResponseModel } from '@tailormap-viewer/api';
import { compareLayerAlertSnapshots, parseLayerAlertRule, readLayerAlertSnapshot } from './layer-alert-snapshot';

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
  test('emits one alert for the configured transition on the same object', () => {
    const red = feature('a', 'red');
    const previous = readLayerAlertSnapshot(response(feature('a', 'yellow'), feature('b', 'green')), rule)!;
    const current = readLayerAlertSnapshot(response(red, feature('b', 'red'), feature('c', 'red')), rule)!;

    expect(compareLayerAlertSnapshots(previous, current, rule)).toEqual([
      { feature: red, label: 'Post a', from: 'yellow', to: 'red' },
    ]);
    expect(compareLayerAlertSnapshots(current, current, rule)).toEqual([]);
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
    const previous = readLayerAlertSnapshot(response(feature('a', 1)), numericRule)!;
    const current = readLayerAlertSnapshot(response(feature('a', 2)), numericRule)!;

    expect(compareLayerAlertSnapshots(previous, current, numericRule)).toHaveLength(1);
    expect(parseLayerAlertRule({ ...rule, from: ' red ', to: 'red' })).toBeUndefined();
    expect(parseLayerAlertRule({ ...rule, idAttribute: '' })).toBeUndefined();
    expect(parseLayerAlertRule(null)).toBeUndefined();
  });
});
