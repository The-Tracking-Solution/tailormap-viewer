import { afterEach, describe, expect, test, vi } from 'vitest';
import { ImageWMS, TileWMS } from 'ol/source.js';
import { WmsLoadMonitor } from './wms-load-monitor';
import { LayerLoadStatusModel } from '../models/layer-load-status.model';

function setup(tiled = false) {
  const source = tiled ? new TileWMS({ params: {} }) : new ImageWMS({});
  const statuses: LayerLoadStatusModel[] = [];
  const monitor = new WmsLoadMonitor(source, status => statuses.push(status));
  let requestNumber = 0;
  const event = (phase: 'start' | 'end' | 'error', request: object) => {
    if (tiled && !('key' in request)) {
      Object.assign(request, { key: (source as TileWMS).getKey() });
    }
    if (tiled && !('getKey' in request)) {
      const tileKey = (request as { key: string }).key;
      const coordinate = ++requestNumber;
      Object.assign(request, { getKey: () => `${tileKey}/${coordinate}` });
    }
    source.dispatchEvent({ type: `${tiled ? 'tile' : 'image'}load${phase}`, tile: request, image: request } as any);
  };
  return { source, monitor, statuses, event, latest: () => statuses.at(-1) };
}

afterEach(() => vi.useRealTimers());

describe('WmsLoadMonitor', () => {
  test('does not treat invalidating a source or finishing an empty render as a successful fetch', () => {
    const { monitor, latest } = setup();
    monitor.reset();
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'waiting', lastSuccessfulLoad: undefined });
    monitor.destroy();
  });

  test('confirms an image after its own load without waiting for the rest of the map', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { monitor, event, latest } = setup();
    const image = {};
    event('start', image);
    expect(latest()?.state).toBe('loading');
    event('end', image);
    expect(latest()).toMatchObject({ state: 'success', lastSuccessfulLoad: 1000 });
    vi.setSystemTime(2000);
    monitor.completeRender();
    expect(latest()?.lastSuccessfulLoad).toBe(1000);
    monitor.destroy();
  });

  test('waits for every tile and preserves the last success after a partial failure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { monitor, event, latest } = setup(true);
    const first = {};
    event('start', first);
    event('end', first);
    monitor.completeRender();
    monitor.reset();
    const tiles = [{}, {}];
    tiles.forEach(tile => event('start', tile));
    event('end', tiles[0]);
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'loading', lastSuccessfulLoad: 1000 });
    event('error', tiles[1]);
    vi.setSystemTime(2000);
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'error', lastSuccessfulLoad: 1000 });
    monitor.reset();
    const retry = {};
    event('start', retry);
    event('end', retry);
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'success', lastSuccessfulLoad: 2000 });
    monitor.destroy();
  });

  test('ignores late results from requests before the latest automatic refresh', () => {
    const { monitor, event, latest } = setup();
    const oldImage = {};
    event('start', oldImage);
    monitor.reset();
    event('end', oldImage);
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'waiting', lastSuccessfulLoad: undefined });
    const currentImage = {};
    event('start', currentImage);
    event('error', oldImage);
    event('end', currentImage);
    monitor.completeRender();
    expect(latest()?.state).toBe('success');
    monitor.destroy();
  });

  test('detaches listeners when the layer is removed', () => {
    const { source, monitor, event, statuses } = setup();
    monitor.destroy();
    event('start', {});
    expect(statuses).toHaveLength(1);
    expect(source.hasListener('imageloadstart')).toBe(false);
  });
  test('ignores queued tiles whose cache key belongs to an older refresh', () => {
    const { source, monitor, event, latest } = setup(true);
    const oldTile = { key: (source as TileWMS).getKey() };
    monitor.reset();
    (source as TileWMS).updateParams({ CACHE: 1234 });
    monitor.beginRefresh();
    event('start', oldTile);
    event('end', oldTile);
    monitor.completeRender();
    expect(latest()).toMatchObject({ state: 'waiting', lastSuccessfulLoad: undefined });
    monitor.destroy();
  });

  test('confirms independent image layers while another layer is continually loading', () => {
    const first = setup();
    const second = setup();
    const busy = setup();
    busy.event('start', {});
    for (let cycle = 0; cycle < 3; cycle++) {
      first.monitor.reset();
      second.monitor.reset();
      const imageOne = {};
      const imageTwo = {};
      first.event('start', imageOne);
      second.event('start', imageTwo);
      first.event('end', imageOne);
      expect(first.latest()?.state).toBe('success');
      expect(second.latest()?.state).toBe('loading');
      second.event('end', imageTwo);
      expect(second.latest()?.state).toBe('success');
      expect(busy.latest()?.state).toBe('loading');
    }
    first.monitor.destroy();
    second.monitor.destroy();
    busy.monitor.destroy();
  });

  test('keeps successful slow image responses across repeated automatic refresh ticks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { monitor, event, latest } = setup();
    const slow = {};
    event('start', slow);
    vi.setSystemTime(6000);
    monitor.beginRefresh();
    const newer = {};
    event('start', newer);
    vi.setSystemTime(7000);
    event('end', slow);
    expect(latest()).toMatchObject({ state: 'loading', lastSuccessfulLoad: 7000 });
    vi.setSystemTime(11000);
    monitor.beginRefresh();
    vi.setSystemTime(12000);
    event('end', newer);
    expect(latest()?.lastSuccessfulLoad).toBe(12000);
    expect(latest()?.monitoringStartedAt).toBe(1000);
    monitor.destroy();
  });

  test('confirms an older tiled viewport only when all of its expected tiles succeed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { source, monitor, event, latest } = setup(true);
    const oldKey = (source as TileWMS).getKey();
    const first = { key: oldKey, getKey: () => `${oldKey}/0/0/0` };
    const second = { key: oldKey, getKey: () => `${oldKey}/0/0/1` };
    monitor.observeRender([ first.getKey(), second.getKey() ], false);
    event('start', first);
    (source as TileWMS).updateParams({ CACHE: 2 });
    monitor.beginRefresh();
    const current = {};
    event('start', current);
    vi.setSystemTime(6000);
    event('end', first);
    expect(latest()?.lastSuccessfulLoad).toBeUndefined();
    // A queued tile from the old viewport may start after the new CACHE value.
    event('start', second);
    event('end', second);
    expect(latest()).toMatchObject({ state: 'loading', lastSuccessfulLoad: 6000 });
    monitor.destroy();
  });

  test('does not confirm a partly failed older tiled viewport', () => {
    const { source, monitor, event, latest } = setup(true);
    const oldKey = (source as TileWMS).getKey();
    const first = { key: oldKey, getKey: () => `${oldKey}/0/0/0` };
    const second = { key: oldKey, getKey: () => `${oldKey}/0/0/1` };
    monitor.observeRender([ first.getKey(), second.getKey() ], false);
    event('start', first);
    event('start', second);
    (source as TileWMS).updateParams({ CACHE: 2 });
    monitor.beginRefresh();
    event('end', first);
    event('error', second);
    expect(latest()?.lastSuccessfulLoad).toBeUndefined();
    expect(latest()?.lastFailure).toBeDefined();
    monitor.destroy();
  });

  test('does not retain an unlimited number of hung request batches', () => {
    const { source, monitor, event, latest } = setup(true);
    const old = {};
    event('start', old);
    for (let cycle = 0; cycle < 40; cycle++) {
      (source as TileWMS).updateParams({ CACHE: cycle });
      monitor.beginRefresh();
    }
    event('end', old);
    expect(latest()?.lastSuccessfulLoad).toBeUndefined();
    const current = {};
    event('start', current);
    event('end', current);
    monitor.completeRender();
    expect(latest()?.state).toBe('success');
    monitor.destroy();
  });

  test('preserves a fully fetched tiled viewport if invalidation occurs before its render finishes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { source, monitor, event, latest } = setup(true);
    const key = (source as TileWMS).getKey();
    const tile = { key, getKey: () => `${key}/0/0/0` };
    monitor.observeRender([tile.getKey()], false);
    event('start', tile);
    vi.setSystemTime(4000);
    event('end', tile);
    expect(latest()?.lastSuccessfulLoad).toBeUndefined();
    vi.setSystemTime(6000);
    (source as TileWMS).updateParams({ CACHE: 2 });
    monitor.beginRefresh();
    expect(latest()).toMatchObject({ state: 'waiting', lastSuccessfulLoad: 4000 });
    monitor.destroy();
  });

});
