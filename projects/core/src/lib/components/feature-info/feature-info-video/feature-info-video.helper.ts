import { YoutubeVideoHelper } from './youtube-video.helper';

export interface FeatureInfoVideoSource {
  provider: 'youtube' | 'netcamviewer';
  key: string;
  playerUrl: string;
  watchUrl: string;
}

/** Resolve only known HTTPS player routes; never trust arbitrary iframe URLs. */
export class FeatureInfoVideoHelper {

  public static getVideo(value: unknown): FeatureInfoVideoSource | null {
    const youtubeId = YoutubeVideoHelper.getVideoId(value);
    if (youtubeId) {
      return {
        provider: 'youtube',
        key: `youtube:${youtubeId}`,
        playerUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1`,
        watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      };
    }
    return this.getNetcamviewerVideo(value);
  }

  private static getNetcamviewerVideo(value: unknown): FeatureInfoVideoSource | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.hostname !== 'live.netcamviewer.nl'
        || url.username || url.password || url.port) {
        return null;
      }
      const match = /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,199})\/([1-9][0-9]{0,9})(\.html)?\/?$/.exec(url.pathname);
      if (!match) {
        return null;
      }
      const [ , slug, cameraId, extension ] = match;
      // Keep the supplied route style; do not forward query parameters, fragments or tokens.
      const playerUrl = `https://live.netcamviewer.nl/${slug}/${cameraId}${extension ?? ''}`;
      return {
        provider: 'netcamviewer',
        key: `netcamviewer:${slug}/${cameraId}`,
        playerUrl,
        watchUrl: playerUrl,
      };
    } catch {
      return null;
    }
  }

}
