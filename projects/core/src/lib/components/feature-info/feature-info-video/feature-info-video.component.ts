import { ChangeDetectionStrategy, Component, ElementRef, inject, Input, OnChanges, OnDestroy, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButton } from '@angular/material/button';
import { FeatureInfoVideoHelper, FeatureInfoVideoSource } from './feature-info-video.helper';

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

  public video: FeatureInfoVideoSource | null = null;
  public playerUrl = signal<SafeResourceUrl | null>(null);
  public watchUrl = '';

  public ngOnChanges() {
    const video = FeatureInfoVideoHelper.getVideo(this.source);
    if (video?.key === this.video?.key && this.featureKey === this.previousFeatureKey) {
      return;
    }
    this.video = video;
    this.previousFeatureKey = this.featureKey;
    this.watchUrl = video?.watchUrl ?? '';
    this.stopVideo();
  }

  public playVideo() {
    if (!this.video) {
      return;
    }
    // The resolver constructs a player address only after exact host and route validation.
    this.playerUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.video.playerUrl));
  }

  public stopVideo() {
    const frame = this.playerFrame()?.nativeElement;
    if (frame) {
      frame.src = 'about:blank';
    }
    this.playerUrl.set(null);
  }

  public ngOnDestroy() {
    this.stopVideo();
  }

}
