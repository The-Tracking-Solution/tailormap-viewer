/** Recognize supported HTTPS YouTube video links without trusting arbitrary player URLs. */
export class YoutubeVideoHelper {

  public static getVideoId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      const allowedHosts = [ 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be' ];
      if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.username || url.password || url.port) {
        return null;
      }
      let videoId: string | null;
      if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
        videoId = /^\/([a-zA-Z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
      } else if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v');
      } else {
        videoId = /^\/(?:embed|live|shorts)\/([a-zA-Z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
      }
      return videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
    } catch {
      return null;
    }
  }

}
