import { YoutubeVideoHelper } from './youtube-video.helper';

export interface FeatureInfoVideoSource {
  provider: 'youtube' | 'netcamviewer' | 'ipcamlive' | 'rtspme' | 'streampartner';
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
    return this.getNetcamviewerVideo(value) ?? this.getIpcamliveVideo(value)
      ?? this.getRtspmeVideo(value) ?? this.getStreampartnerVideo(value);
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

  private static getIpcamliveVideo(value: unknown): FeatureInfoVideoSource | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      const publicHosts = [ 'ipcamlive.com', 'www.ipcamlive.com' ];
      const playerHosts = [ ...publicHosts, 'g0.ipcamlive.com' ];
      if (url.protocol !== 'https:' || !playerHosts.includes(url.hostname)
        || url.username || url.password || url.port) {
        return null;
      }
      let alias: string | null;
      if (url.pathname === '/player/player.php') {
        const aliases = url.searchParams.getAll('alias');
        if (aliases.length !== 1) {
          return null;
        }
        alias = aliases[0] ?? null;
      } else if (publicHosts.includes(url.hostname)) {
        alias = /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\/?$/.exec(url.pathname)?.[1] ?? null;
      } else {
        return null;
      }
      if (!alias || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(alias)) {
        return null;
      }
      // Build the known embed route ourselves; ignore caller-supplied player parameters and tokens.
      return {
        provider: 'ipcamlive',
        key: `ipcamlive:${alias}`,
        playerUrl: `https://g0.ipcamlive.com/player/player.php?alias=${alias}&autoplay=1`,
        watchUrl: `https://www.ipcamlive.com/${alias}`,
      };
    } catch {
      return null;
    }
  }

  private static getRtspmeVideo(value: unknown): FeatureInfoVideoSource | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.hostname !== 'rtsp.me'
        || url.username || url.password || url.port) {
        return null;
      }
      const id = /^\/embed\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/?$/.exec(url.pathname)?.[1];
      if (!id) {
        return null;
      }
      const playerUrl = `https://rtsp.me/embed/${id}/`;
      return { provider: 'rtspme', key: `rtspme:${id}`, playerUrl, watchUrl: playerUrl };
    } catch {
      return null;
    }
  }

  private static getStreampartnerVideo(value: unknown): FeatureInfoVideoSource | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.hostname !== 'ssl.streampartner.nl'
        || url.username || url.password || url.port || url.pathname !== '/player.php') {
        return null;
      }
      const ids = url.searchParams.getAll('url');
      const id = ids[0];
      // The url parameter is an opaque source ID, never an arbitrary media URL.
      if (ids.length !== 1 || !id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
        return null;
      }
      const playerUrl = `https://ssl.streampartner.nl/player.php?url=${id}`;
      return { provider: 'streampartner', key: `streampartner:${id}`, playerUrl, watchUrl: playerUrl };
    } catch {
      return null;
    }
  }

}
