import { YoutubeVideoHelper } from './youtube-video.helper';

export interface FeatureInfoVideoSource {
  provider: 'youtube' | 'netcamviewer' | 'ipcamlive' | 'rtspme' | 'streampartner' | 'hls';
  key: string;
  playerUrl: string;
  watchUrl: string;
}

/** Resolve supported iframe routes or HTTPS HLS media; never trust arbitrary iframe URLs. */
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
      ?? this.getRtspmeVideo(value) ?? this.getStreampartnerVideo(value) ?? this.getHlsVideo(value);
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

  private static getHlsVideo(value: unknown): FeatureInfoVideoSource | null {
    if (typeof value !== 'string' || value.length > 4096) {
      return null;
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        return null;
      }
      const cameras = [
        {
          page: 'https://dehangout.nl/webcam-wijk-aan-zee/',
          stream: 'https://webcam.dehangout.nl/stream.m3u8',
        },
        {
          page: 'https://webcam-marinaseaport.nl/',
          stream: 'https://wowza01.crossmediaventures.com/crossmedia/seaport.smil/playlist.m3u8',
        },
        {
          page: 'https://webcam-marken.nl/',
          stream: 'https://565c3c746b763.streamlock.net/live/marken.stream/playlist.m3u8',
        },
        {
          page: 'https://webcams-vlissingen.nl/pages/cameras/strand.php',
          stream: 'https://565c3c746b763.streamlock.net/live/vlissingen5.stream/playlist.m3u8',
        },
        {
          page: 'https://webcams-ameland.nl/pages/cameras/waddenhaven-nes.php',
          stream: 'https://5b8d2cbe62ad6.streamlock.net/live/nes-waddenhaven.stream/playlist.m3u8',
        },
        {
          page: 'https://webcam-lauwersoog.nl/',
          stream: 'https://6162417352ffd.streamlock.net/live/lauwersoog-haven.stream/playlist.m3u8',
        },
        {
          page: 'https://webcam-hindeloopen.nl/',
          stream: 'https://5b8d2cbe62ad6.streamlock.net/live/hindeloopen.stream/playlist.m3u8',
        },
        {
          page: 'https://www.markermeerzicht.nl/',
          stream: 'https://www.benlankamp.nl/webcam/index.m3u8',
        },
        {
          page: 'https://reddingsbrigade-bloemendaal.nl/beachcam/',
          stream: 'https://wowza01.crossmediaventures.com/beachcam/beachcam.smil/playlist.m3u8',
        },
      ];
      url.hash = '';
      const camera = cameras.find(c => c.page === `${url.origin}${url.pathname}` || c.stream === url.href);
      const playerUrl = camera?.stream ?? url.href;
      if (!camera && !/\.m3u8$/i.test(url.pathname)) {
        return null;
      }
      // Media URLs are bound to <video>, never trusted as iframe documents.
      // Preserve signed query parameters: changing one must restart playback.
      return { provider: 'hls', key: `hls:${playerUrl}`, playerUrl, watchUrl: camera?.page ?? playerUrl };
    } catch {
      return null;
    }
  }

}
