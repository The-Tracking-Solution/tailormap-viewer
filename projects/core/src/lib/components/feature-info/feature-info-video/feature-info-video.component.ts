import { ChangeDetectionStrategy, Component, ElementRef, inject, Input, OnChanges, OnDestroy, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButton } from '@angular/material/button';
import { YoutubeVideoHelper } from './youtube-video.helper';

@Component({
  selector: 'tm-feature-info-video',
  templateUrl: './feature-info-video.component.html',
  styleUrls: ['./feature-info-video.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
})
export class FeatureInfoVideoComponent implements OnChanges, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private playerFrame = viewChild<ElementRef<HTMLIFrameElement>>('player');
  private previousFeatureKey = '';

  @Input()
  public source: unknown;

  @Input()
  public featureKey = '';

  public videoId: string | null = null;
  public playerUrl = signal<SafeResourceUrl | null>(null);
  public watchUrl = '';

  public ngOnChanges() {
    const videoId = YoutubeVideoHelper.getVideoId(this.source);
    if (videoId === this.videoId && this.featureKey === this.previousFeatureKey) {
      return;
    }
    this.videoId = videoId;
    this.previousFeatureKey = this.featureKey;
    this.watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
    this.stopVideo();
  }

  public playVideo() {
    if (!this.videoId) {
      return;
    }
    // Construct the resource URL from a validated ID, never trust a source URL or its query parameters.
    this.playerUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${this.videoId}?autoplay=1&playsinline=1`,
    ));
  }

  public stopVideo() {
    // Removing the iframe ends playback; no player is retained for another feature.
    this.playerUrl.set(null);
  }

  public ngOnDestroy() {
    const frame = this.playerFrame()?.nativeElement;
    if (frame) {
      frame.src = 'about:blank';
    }
  }

}
