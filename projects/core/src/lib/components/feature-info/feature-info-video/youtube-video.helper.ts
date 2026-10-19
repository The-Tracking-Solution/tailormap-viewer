/** Only explicit HTTPS embed links opt an attribute into video presentation. */
export class YoutubeVideoHelper {

  public static getVideoId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      const url = new URL(value.trim());
      const allowedHosts = [ 'youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com' ];
      if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.username || url.password || url.port) {
        return null;
      }
      return /^\/embed\/([a-zA-Z0-9_-]{11})$/.exec(url.pathname)?.[1] ?? null;
    } catch {
      return null;
    }
  }

}
