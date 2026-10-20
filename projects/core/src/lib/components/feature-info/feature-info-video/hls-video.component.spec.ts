import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/angular';
import type Hls from 'hls.js';
import { TestBed } from '@angular/core/testing';
import { HLS_LIBRARY_LOADER, HlsVideoComponent } from './hls-video.component';

const source = 'https://camera.example/live.m3u8';

class FakeHls {
  // Match the third-party Hls.Events API in the test double.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  public static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
  public static isSupported = vi.fn(() => true);
  public static instances: FakeHls[] = [];
  public handlers = new Map<string, (event: string, data: any) => void>();
  public loadSource = vi.fn();
  public attachMedia = vi.fn();
  public destroy = vi.fn();

  constructor() {
    FakeHls.instances.push(this);
  }

  public on(event: string, handler: (event: string, data: any) => void) {
    this.handlers.set(event, handler);
  }

  public emit(event: string, data = {}) {
    this.handlers.get(event)?.(event, data);
  }
}

describe('HlsVideoComponent', () => {
  beforeEach(() => {
    FakeHls.instances = [];
    FakeHls.isSupported.mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const setup = (loader = vi.fn().mockResolvedValue(FakeHls)) => render(HlsVideoComponent, {
    inputs: { source },
    providers: [{ provide: HLS_LIBRARY_LOADER, useValue: loader }],
  });

  test('uses native HLS without loading the library and releases its source on destruction', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably');
    const loader = vi.fn();
    const { container, fixture } = await setup(loader);
    const video = container.querySelector('video');
    expect(loader).not.toHaveBeenCalled();
    expect(video?.getAttribute('src')).toBe(source);
    expect(video?.controls).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    fireEvent.playing(video as HTMLVideoElement);
    fixture.detectChanges();
    expect(fixture.componentInstance.status()).toBe('playing');
    fixture.destroy();
    expect(video?.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  test('attaches HLS.js, ignores recoverable errors and releases fatal errors for retry', async () => {
    const { container, fixture } = await setup();
    await vi.waitFor(() => expect(FakeHls.instances).toHaveLength(1));
    const instance = FakeHls.instances[0];
    expect(instance.loadSource).toHaveBeenCalledWith(source);
    expect(instance.attachMedia).toHaveBeenCalledWith(container.querySelector('video'));
    instance.emit('manifest');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    instance.emit('error', { fatal: false });
    expect(instance.destroy).not.toHaveBeenCalled();
    instance.emit('error', { fatal: true });
    fixture.detectChanges();
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be played');
    fixture.componentRef.setInput('source', source + '?token=new');
    fixture.detectChanges();
    await vi.waitFor(() => expect(FakeHls.instances).toHaveLength(2));
    expect(FakeHls.instances[1].loadSource).toHaveBeenCalledWith(source + '?token=new');
    fixture.destroy();
    expect(FakeHls.instances[1].destroy).toHaveBeenCalledOnce();
  });

  test('ignores an obsolete library import when the source changes or the component closes', async () => {
    const completions: Array<(value: typeof Hls) => void> = [];
    const loader = () => new Promise<typeof Hls>(resolve => completions.push(resolve));
    const { fixture } = await setup(vi.fn(loader));
    fixture.componentRef.setInput('source', source + '?new=1');
    fixture.detectChanges();
    completions[0](FakeHls as unknown as typeof Hls);
    await Promise.resolve();
    expect(FakeHls.instances).toHaveLength(0);
    fixture.destroy();
    completions[1](FakeHls as unknown as typeof Hls);
    await Promise.resolve();
    expect(FakeHls.instances).toHaveLength(0);
  });

  test('reports unsupported browsers and a failed lazy import', async () => {
    FakeHls.isSupported.mockReturnValue(false);
    const unsupported = await setup();
    await vi.waitFor(() => expect(unsupported.fixture.componentInstance.status()).toBe('unsupported'));
    expect(FakeHls.instances).toHaveLength(0);
    unsupported.fixture.destroy();
    TestBed.resetTestingModule();
    const failed = await setup(vi.fn().mockRejectedValue(new Error('chunk unavailable')));
    await vi.waitFor(() => expect(failed.fixture.componentInstance.status()).toBe('error'));
    failed.fixture.destroy();
  });

  test('keeps native controls available when autoplay is denied', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably');
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const { fixture, container } = await setup();
    await vi.waitFor(() => expect(fixture.componentInstance.status()).toBe('paused'));
    expect(container.querySelector('video')?.getAttribute('src')).toBe(source);
    fixture.destroy();
  });

  test('reports native media errors and playback promise failures', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably');
    const native = await setup();
    fireEvent.error(native.container.querySelector('video') as HTMLVideoElement);
    expect(native.fixture.componentInstance.status()).toBe('error');
    expect(native.container.querySelector('video')?.hasAttribute('src')).toBe(false);
    native.fixture.destroy();
    TestBed.resetTestingModule();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('Unsupported', 'NotSupportedError'));
    const failed = await setup();
    await vi.waitFor(() => expect(failed.fixture.componentInstance.status()).toBe('error'));
    failed.fixture.destroy();
  });

  test('bounds startup and stalled playback waits and clears the timer when playback resumes', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably');
    const { fixture, container } = await setup();
    const video = container.querySelector('video') as HTMLVideoElement;
    vi.useFakeTimers();
    fireEvent.playing(video);
    fireEvent.waiting(video);
    await vi.advanceTimersByTimeAsync(19000);
    expect(fixture.componentInstance.status()).toBe('loading');
    fireEvent.waiting(video);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.componentInstance.status()).toBe('error');
    fixture.componentRef.setInput('source', source + '?retry=1');
    fixture.detectChanges();
    fireEvent.playing(video);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.componentInstance.status()).toBe('playing');
    fireEvent.waiting(video);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fixture.componentInstance.status()).toBe('error');
    fixture.destroy();
    expect(video.hasAttribute('src')).toBe(false);
  });
});
