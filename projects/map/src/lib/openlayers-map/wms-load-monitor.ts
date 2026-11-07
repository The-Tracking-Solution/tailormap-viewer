import { ImageWMS, TileWMS } from 'ol/source.js';
import { EventsKey } from 'ol/events.js';
import { unByKey } from 'ol/Observable.js';
import { LayerLoadStatusModel } from '../models/layer-load-status.model';

interface LoadBatch {
  sourceKey?: string;
  pending: Set<object>;
  completedKeys: Set<string>;
  expectedKeys?: Set<string>;
  failed: boolean;
  received: boolean;
  finished: boolean;
  lastCompletion?: number;
}

/** Observes existing requests. Automatic invalidation does not discard in-flight results. */
export class WmsLoadMonitor {

  private listeners: EventsKey[];
  private requests = new Map<object, { batch: LoadBatch; key?: string }>();
  private batches: LoadBatch[] = [];
  private current!: LoadBatch;
  private lastSuccessfulLoad?: number;
  private lastFailure?: number;
  private monitoringStartedAt = Date.now();
  private tiled: boolean;

  constructor(
    private source: ImageWMS | TileWMS,
    private publish: (status: LayerLoadStatusModel) => void,
    previousSuccess?: number,
  ) {
    this.lastSuccessfulLoad = previousSuccess;
    this.tiled = source instanceof TileWMS;
    if (source instanceof ImageWMS) {
      this.listeners = [
        source.on('imageloadstart', event => this.start(event.image)),
        source.on('imageloadend', event => this.end(event.image, false)),
        source.on('imageloaderror', event => this.end(event.image, true)),
      ];
    } else {
      this.listeners = [
        source.on('tileloadstart', event => {
          const tile = event.tile;
          const key = tile.getKey();
          const batch = this.batches.findLast(b => b.sourceKey === tile.key);
          // A queued old tile is useful only if its batch had a known viewport.
          if (batch && (batch === this.current || batch.expectedKeys?.has(key))) {
            this.start(tile, key, batch);
          }
        }),
        source.on('tileloadend', event => this.end(event.tile, false)),
        source.on('tileloaderror', event => this.end(event.tile, true)),
      ];
    }
    this.reset();
  }

  /** A different filter/style/source invalidates old requests' meaning. */
  public reset() {
    this.requests.clear();
    this.batches = [];
    this.lastFailure = undefined;
    this.monitoringStartedAt = Date.now();
    this.newBatch();
    this.emit();
  }

  /** Called after automatic CACHE invalidation; keep still-running batches observable. */
  public beginRefresh() {
    const previous = this.current;
    this.newBatch();
    this.confirmRetiredBatch(previous);
    this.emit();
  }

  private newBatch() {
    this.current = {
      sourceKey: this.source instanceof TileWMS ? this.source.getKey() : undefined,
      pending: new Set(), completedKeys: new Set(),
      failed: false, received: false, finished: false,
    };
    this.batches.push(this.current);
    // A canceled/hung request must not retain memory for the map's entire lifetime.
    while (this.batches.length > 32) {
      const expired = this.batches.shift()!;
      expired.pending.forEach(request => this.requests.delete(request));
    }
  }

  private start(request: object, key?: string, batch = this.current) {
    if (batch === this.current && batch.finished) {
      this.newBatch();
      batch = this.current;
    }
    if (this.requests.has(request)) {
      return;
    }
    batch.pending.add(request);
    this.requests.set(request, { batch, key });
    this.emit();
  }

  private end(request: object, failed: boolean) {
    const tracked = this.requests.get(request);
    if (!tracked) {
      return;
    }
    this.requests.delete(request);
    const { batch, key } = tracked;
    batch.pending.delete(request);
    batch.failed ||= failed;
    batch.received = true;
    batch.lastCompletion = Date.now();
    if (failed) {
      this.lastFailure = batch.lastCompletion;
    } else if (key !== undefined) {
      batch.completedKeys.add(key);
    }
    if (!this.tiled) {
      // Every completed ImageWMS image is a real fetch, even after a newer timer tick.
      if (!failed) {
        this.confirm(batch.lastCompletion);
      }
      batch.finished = batch.pending.size === 0;
    } else if (batch !== this.current) {
      this.confirmRetiredBatch(batch);
    }
    this.emit();
  }

  private confirm(timestamp: number) {
    this.lastSuccessfulLoad = Math.max(this.lastSuccessfulLoad ?? 0, timestamp);
    if (this.lastFailure !== undefined && this.lastFailure <= this.lastSuccessfulLoad) {
      this.lastFailure = undefined;
    }
  }

  /** Save the renderer's actual wanted tile keys before this batch can be superseded. */
  public observeRender(expectedKeys: string[], complete: boolean) {
    if (expectedKeys.length > 0) {
      this.current.expectedKeys = new Set(expectedKeys);
    }
    if (complete) {
      this.completeRender();
    }
  }

  private confirmRetiredBatch(batch: LoadBatch) {
    if (batch.finished || batch.failed || batch.pending.size > 0
      || !batch.expectedKeys?.size || batch.lastCompletion === undefined) {
      return;
    }
    // No success for a partial set: queued as well as started tiles must have loaded.
    if (Array.from(batch.expectedKeys).every(key => batch.completedKeys.has(key))) {
      batch.finished = true;
      this.confirm(batch.lastCompletion);
    }
  }

  /** Confirmation of the current tiled batch still requires its own completed render. */
  public completeRender() {
    const batch = this.current;
    if (batch.pending.size > 0 || !batch.received || batch.finished) {
      return;
    }
    batch.finished = true;
    if (!batch.failed && batch.lastCompletion !== undefined) {
      this.confirm(batch.lastCompletion);
    }
    this.emit();
  }

  private emit() {
    let state: LayerLoadStatusModel['state'] = 'waiting';
    if (this.requests.size > 0) {
      state = 'loading';
    } else if (this.current.finished && !this.current.failed) {
      state = 'success';
    }
    if (this.current.failed || this.lastFailure !== undefined) {
      state = 'error';
    }
    this.publish({
      state,
      lastSuccessfulLoad: this.lastSuccessfulLoad,
      lastFailure: this.lastFailure,
      pendingRequests: this.requests.size,
      monitoringStartedAt: this.monitoringStartedAt,
    });
  }

  public destroy() {
    unByKey(this.listeners);
    this.requests.clear();
    this.batches = [];
  }

}
