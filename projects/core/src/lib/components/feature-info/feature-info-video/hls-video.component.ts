import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, InjectionToken, Input, OnChanges, OnDestroy, signal, viewChild,
} from '@angular/core';
import type Hls from 'hls.js';

// Kept behind a loader so iframe-only users do not download the HLS library.
export const HLS_LIBRARY_LOADER = new InjectionToken<() => Promise<typeof Hls>>('HLS_LIBRARY_LOADER', {
  providedIn: 'root',
  factory: () => () => import('hls.js').then(module => module.default),
});

@Component({
  selector: 'tm-hls-video',
  templateUrl: './hls-video.component.html',
  styleUrls: ['./hls-video.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HlsVideoComponent implements AfterViewInit, OnChanges, OnDestroy {
  private loadLibrary = inject(HLS_LIBRARY_LOADER);
  private videoElement = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private hls: Hls | null = null;
  private initialized = false;
  private generation = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  @Input({ required: true })
  public source = '';

  public status = signal<'loading' | 'playing' | 'paused' | 'error' | 'unsupported'>('loading');

  public ngAfterViewInit() {
    this.initialized = true;
    void this.start();
  }

  public ngOnChanges() {
    if (this.initialized) {
      void this.start();
    }
  }

  private async start() {
    this.release();
    const generation = this.generation;
    const video = this.videoElement().nativeElement;
    this.status.set('loading');
    video.muted = true;
    this.armTimeout();
    try {
      // Prefer native HLS on Safari/iOS; use MSE/HLS.js elsewhere.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = this.source;
        this.requestPlay(video, generation);
        return;
      }
      const library = await this.loadLibrary();
      if (generation !== this.generation) {
        return;
      }
      if (!library.isSupported()) {
        this.fail('unsupported');
        return;
      }
      const hls = new library({ backBufferLength: 30, maxBufferLength: 20 });
      this.hls = hls;
      hls.on(library.Events.ERROR, (_event, data) => {
        if (generation === this.generation && data.fatal) {
          this.fail('error');
        }
      });
      hls.on(library.Events.MANIFEST_PARSED, () => {
        if (generation === this.generation) {
          this.requestPlay(video, generation);
        }
      });
      hls.loadSource(this.source);
      hls.attachMedia(video);
    } catch {
      if (generation === this.generation) {
        this.fail('error');
      }
    }
  }

  private requestPlay(video: HTMLVideoElement, generation: number) {
    void video.play()?.catch(error => {
      if (generation !== this.generation) {
        return;
      }
      if (error?.name === 'NotAllowedError') {
        this.clearTimeout();
        this.status.set('paused');
      } else {
        this.fail('error');
      }
    });
  }

  public onPlaying() {
    if (this.status() === 'error' || this.status() === 'unsupported') {
      return;
    }
    this.clearTimeout();
    this.status.set('playing');
  }

  public onWaiting() {
    if (this.status() === 'error' || this.status() === 'unsupported') {
      return;
    }
    this.status.set('loading');
    this.armTimeout();
  }

  public onError() {
    this.fail('error');
  }

  private armTimeout() {
    if (this.timeout !== null) {
      return;
    }
    this.timeout = setTimeout(() => this.fail('error'), 20000);
  }

  private clearTimeout() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private fail(status: 'error' | 'unsupported') {
    this.release();
    this.status.set(status);
  }

  private release() {
    this.generation++;
    this.clearTimeout();
    this.hls?.destroy();
    this.hls = null;
    if (this.initialized) {
      const video = this.videoElement().nativeElement;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  public ngOnDestroy() {
    this.release();
    this.initialized = false;
  }
}
