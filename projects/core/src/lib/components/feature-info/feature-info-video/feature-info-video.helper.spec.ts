import { describe, expect, test } from 'vitest';
import { FeatureInfoVideoHelper } from './feature-info-video.helper';

describe('FeatureInfoVideoHelper', () => {
  test.each([
    'https://live.netcamviewer.nl/de-blanke-top/777.html',
    'https://live.netcamviewer.nl/beachcam-cadzand/1069',
    'https://live.netcamviewer.nl/Camera-Timboektoe/1404',
    'https://live.netcamviewer.nl/Port-of-Amsterdam-Zeesluis/566',
    'https://live.netcamviewer.nl/Webcam-Domburg/530',
    'https://live.netcamviewer.nl/Vaarschool-Albatros/873',
    'https://live.netcamviewer.nl/Zeeuwse-Riviera/719',
    'https://live.netcamviewer.nl/Port-of-Amsterdam-Havenkantoor/480',
  ])('recognizes an inventoried NetcamViewer player: %s', url => {
    const video = FeatureInfoVideoHelper.getVideo(url);
    expect(video?.provider).toBe('netcamviewer');
    expect(video?.playerUrl).toBe(url);
    expect(video?.watchUrl).toBe(url);
  });

  test('normalizes only harmless notation, not caller-supplied player parameters', () => {
    const plain = FeatureInfoVideoHelper.getVideo('https://live.netcamviewer.nl/de-blanke-top/777');
    const html = FeatureInfoVideoHelper.getVideo(
      '  https://LIVE.NETCAMVIEWER.NL/de-blanke-top/777.html/?autoplay=1&redirect=https://evil.example#fragment  ',
    );
    expect(html?.key).toBe(plain?.key);
    expect(html?.playerUrl).toBe('https://live.netcamviewer.nl/de-blanke-top/777.html');
    expect(html?.watchUrl).toBe(html?.playerUrl);
    expect(FeatureInfoVideoHelper.getVideo('https://live.netcamviewer.nl/another-camera/777')?.key).not.toBe(plain?.key);
  });

  test('keeps YouTube canonicalization and provider identity', () => {
    expect(FeatureInfoVideoHelper.getVideo('https://youtu.be/EH6GNSEvmQE?si=share')).toEqual({
      provider: 'youtube',
      key: 'youtube:EH6GNSEvmQE',
      playerUrl: 'https://www.youtube-nocookie.com/embed/EH6GNSEvmQE?autoplay=1&playsinline=1',
      watchUrl: 'https://www.youtube.com/watch?v=EH6GNSEvmQE',
    });
  });

  test.each([
    null, undefined, 13, {}, '', 'not a URL',
    'http://live.netcamviewer.nl/camera/777',
    '//live.netcamviewer.nl/camera/777',
    'javascript:alert(1)',
    'https://live.netcamviewer.nl.evil.example/camera/777',
    'https://live.netcamviewer.nl@evil.example/camera/777',
    'https://user:password@live.netcamviewer.nl/camera/777',
    'https://live.netcamviewer.nl:8443/camera/777',
    'https://other.netcamviewer.nl/camera/777',
    'https://netcamviewer.nl/camera/777',
    'https://live.netcamviewer.nl/',
    'https://live.netcamviewer.nl/camera',
    'https://live.netcamviewer.nl/camera/not-an-id',
    'https://live.netcamviewer.nl/camera/0',
    'https://live.netcamviewer.nl/camera/777/other',
    'https://live.netcamviewer.nl/camera/777.php',
    'https://live.netcamviewer.nl/camera/777.html/other',
    'https://live.netcamviewer.nl/camera/777.html.html',
    'https://live.netcamviewer.nl/camera/777%2Fother',
    'https://live.netcamviewer.nl/camera%2Fother/777',
    'https://live.netcamviewer.nl/camera/777%3Fredirect=other',
    '<iframe src="https://live.netcamviewer.nl/camera/777"></iframe>',
    'https://camera.example/stream.mp4',
    'rtsp://camera.example/live',
  ])(
    'does not enable arbitrary or unsafe sources: %s', value => {
      expect(FeatureInfoVideoHelper.getVideo(value)).toBeNull();
    },
  );

  test.each([
    [ 'https://g0.ipcamlive.com/player/player.php?alias=detokowebcam&autoplay=1&controls=0', 'detokowebcam' ],
    [ 'https://www.ipcamlive.com/strandhotelburen', 'strandhotelburen' ],
    [ 'https://ipcamlive.com/strandhotelburen/', 'strandhotelburen' ],
    [ 'https://www.ipcamlive.com/player/player.php?alias=strandhotelburen', 'strandhotelburen' ],
    [ 'https://ipcamlive.com/player/player.php?alias=strandhotelburen', 'strandhotelburen' ],
  ])('recognizes an IPCamLive camera from %s', (url, alias) => {
    expect(FeatureInfoVideoHelper.getVideo(url)).toEqual({
      provider: 'ipcamlive',
      key: `ipcamlive:${alias}`,
      playerUrl: `https://g0.ipcamlive.com/player/player.php?alias=${alias}&autoplay=1`,
      watchUrl: `https://www.ipcamlive.com/${alias}`,
    });
  });

  test('keeps one IPCamLive identity across public and player links and discards untrusted options', () => {
    const publicVideo = FeatureInfoVideoHelper.getVideo('https://www.ipcamlive.com/strandhotelburen');
    const playerVideo = FeatureInfoVideoHelper.getVideo(
      '  https://G0.IPCAMLIVE.COM/player/player.php?alias=strandhotelburen&autoplay=0&controls=0&token=discard&redirect=https://evil.example#fragment  ',
    );
    expect(playerVideo).toEqual(publicVideo);
    expect(FeatureInfoVideoHelper.getVideo('https://www.ipcamlive.com/strandhotelburen?alias=detokowebcam'))
      .toEqual(publicVideo);
    expect(FeatureInfoVideoHelper.getVideo('https://www.ipcamlive.com/detokowebcam')?.key).not.toBe(publicVideo?.key);
  });

  test.each([
    'http://www.ipcamlive.com/strandhotelburen',
    '//www.ipcamlive.com/strandhotelburen',
    'https://www.ipcamlive.com.evil.example/strandhotelburen',
    'https://g0.ipcamlive.com.evil.example/player/player.php?alias=detokowebcam',
    'https://www.ipcamlive.com@evil.example/strandhotelburen',
    'https://user:password@g0.ipcamlive.com/player/player.php?alias=detokowebcam',
    'https://www.ipcamlive.com:8443/strandhotelburen',
    'https://g1.ipcamlive.com/player/player.php?alias=detokowebcam',
    'https://other.ipcamlive.com/player/player.php?alias=detokowebcam',
    'https://g0.ipcamlive.com/strandhotelburen',
    'https://www.ipcamlive.com/',
    'https://www.ipcamlive.com/camera/strandhotelburen',
    'https://www.ipcamlive.com/strandhotelburen/extra',
    'https://www.ipcamlive.com/strandhotelburen.php',
    'https://www.ipcamlive.com/player/player.php',
    'https://www.ipcamlive.com/player/player.php?alias=',
    'https://www.ipcamlive.com/player/player.php?alias=one&alias=two',
    'https://www.ipcamlive.com/player/player.php?alias=one&alias=one',
    'https://www.ipcamlive.com/player/player.php?alias=%3Cscript%3E',
    'https://www.ipcamlive.com/player/player.php?alias=one%2Ftwo',
    'https://www.ipcamlive.com/player/player.php?alias=one%26autoplay%3D0',
    'https://www.ipcamlive.com/player/player.php?alias=one%20two',
    'https://www.ipcamlive.com/player/player.php?alias=' + 'a'.repeat(101),
    'https://www.ipcamlive.com/player/snapshot.php?alias=detokowebcam',
    'https://www.ipcamlive.com/player/getcamerastreamstate.php?alias=detokowebcam',
    '<iframe src="https://g0.ipcamlive.com/player/player.php?alias=detokowebcam"></iframe>',
  ])('does not treat unsafe or unsupported IPCamLive routes as players: %s', url => {
    expect(FeatureInfoVideoHelper.getVideo(url)).toBeNull();
  });

  test('recognizes the supplied rtsp.me camera and strips unrelated options', () => {
    const expected = {
      provider: 'rtspme',
      key: 'rtspme:tkkGYA72',
      playerUrl: 'https://rtsp.me/embed/tkkGYA72/',
      watchUrl: 'https://rtsp.me/embed/tkkGYA72/',
    };
    expect(FeatureInfoVideoHelper.getVideo('https://rtsp.me/embed/tkkGYA72/')).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo('  https://rtsp.me/embed/tkkGYA72/?redirect=https://evil.example&token=discard#fragment  '))
      .toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo('https://rtsp.me/embed/474NtQT5/')?.key).not.toBe(expected.key);
  });

  test('recognizes the supplied StreamPartner camera and strips unrelated options', () => {
    const expected = {
      provider: 'streampartner',
      key: 'streampartner:rwj3wllrsipkvysnuozz',
      playerUrl: 'https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz',
      watchUrl: 'https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz',
    };
    expect(FeatureInfoVideoHelper.getVideo('https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz')).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo('  https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz&redirect=https://evil.example&token=discard#fragment  '))
      .toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo('https://ssl.streampartner.nl/player.php?url=9579fb17b6b118ec5063')?.key).not.toBe(expected.key);
  });

  test('accepts the longer ID format documented by rtsp.me and canonicalizes its trailing slash', () => {
    expect(FeatureInfoVideoHelper.getVideo('https://rtsp.me/embed/WKZb7jUsUw5T9N4f')?.playerUrl)
      .toBe('https://rtsp.me/embed/WKZb7jUsUw5T9N4f/');
  });

  test.each([
    'http://rtsp.me/embed/tkkGYA72/',
    '//rtsp.me/embed/tkkGYA72/',
    'https://rtsp.me.evil.example/embed/tkkGYA72/',
    'https://rtsp.me@evil.example/embed/tkkGYA72/',
    'https://user:password@rtsp.me/embed/tkkGYA72/',
    'https://rtsp.me:8443/embed/tkkGYA72/',
    'https://www.rtsp.me/embed/tkkGYA72/',
    'https://rtsp.me/tkkGYA72/',
    'https://rtsp.me/embed/',
    'https://rtsp.me/embed/tkkGYA72/extra',
    'https://rtsp.me/embed/tkkGYA72%2Fextra/',
    'https://rtsp.me/embed/' + 'a'.repeat(129),
    'http://ssl.streampartner.nl/player.php?url=abc',
    '//ssl.streampartner.nl/player.php?url=abc',
    'https://ssl.streampartner.nl.evil.example/player.php?url=abc',
    'https://ssl.streampartner.nl@evil.example/player.php?url=abc',
    'https://user:password@ssl.streampartner.nl/player.php?url=abc',
    'https://ssl.streampartner.nl:8443/player.php?url=abc',
    'https://www.streampartner.nl/player.php?url=abc',
    'https://ssl.streampartner.nl/player.php/extra?url=abc',
    'https://ssl.streampartner.nl/player.php',
    'https://ssl.streampartner.nl/player.php?url=',
    'https://ssl.streampartner.nl/player.php?url=abc&url=abc',
    'https://ssl.streampartner.nl/player.php?url=abc&url=def',
    'https://ssl.streampartner.nl/player.php?url=https%3A%2F%2Fevil.example',
    'https://ssl.streampartner.nl/player.php?url=javascript%3Aalert(1)',
    'https://ssl.streampartner.nl/player.php?url=abc%2Fdef',
    'https://ssl.streampartner.nl/player.php?url=abc%26redirect%3Devil',
    'https://ssl.streampartner.nl/player.php?url=abc%20def',
    'https://ssl.streampartner.nl/player.php?url=' + 'a'.repeat(129),
  ])('rejects unsupported or unsafe rtsp.me/StreamPartner routes: %s', url => {
    expect(FeatureInfoVideoHelper.getVideo(url)).toBeNull();
  });

  test.each([
    [ 'https://dehangout.nl/webcam-wijk-aan-zee/', 'https://webcam.dehangout.nl/stream.m3u8' ],
    [ 'https://webcam-marinaseaport.nl/', 'https://wowza01.crossmediaventures.com/crossmedia/seaport.smil/playlist.m3u8' ],
  ])('resolves the HLS pilot page %s and preserves an external viewing page', (page, stream) => {
    const video = FeatureInfoVideoHelper.getVideo(page);
    expect(video).toEqual({ provider: 'hls', key: `hls:${stream}`, playerUrl: stream, watchUrl: page });
    expect(FeatureInfoVideoHelper.getVideo(stream)).toEqual(video);
    expect(FeatureInfoVideoHelper.getVideo(page + '?tracking=changed#fragment')).toEqual(video);
  });

  test('accepts direct HTTPS HLS media without trusting it as an iframe or discarding signed parameters', () => {
    const url = 'https://camera.example/live/index.m3u8?token=one&expires=123';
    const video = FeatureInfoVideoHelper.getVideo(url + '#fragment');
    expect(video).toEqual({ provider: 'hls', key: `hls:${url}`, playerUrl: url, watchUrl: url });
    expect(FeatureInfoVideoHelper.getVideo(url.replace('one', 'two'))?.key).not.toBe(video?.key);
  });

  test.each([
    'http://camera.example/live.m3u8',
    '//camera.example/live.m3u8',
    'https://user:password@camera.example/live.m3u8',
    'https://camera.example:8443/live.m3u8',
    'https://camera.example/live.m3u8/extra',
    'https://camera.example/live.m3u8.html',
    'https://camera.example/?url=live.m3u8',
    'https://dehangout.nl.evil.example/webcam-wijk-aan-zee/',
    'https://webcam-marinaseaport.nl/another-page',
    'https://camera.example/' + 'a'.repeat(4096) + '.m3u8',
  ])('rejects unsupported or unsafe HLS sources: %s', url => {
    expect(FeatureInfoVideoHelper.getVideo(url)).toBeNull();
  });

  test.each([
    [ 'https://webcam-marken.nl/', 'https://565c3c746b763.streamlock.net/live/marken.stream/playlist.m3u8' ],
    [ 'https://webcams-vlissingen.nl/pages/cameras/strand.php', 'https://565c3c746b763.streamlock.net/live/vlissingen5.stream/playlist.m3u8' ],
    [ 'https://webcams-ameland.nl/pages/cameras/waddenhaven-nes.php', 'https://5b8d2cbe62ad6.streamlock.net/live/nes-waddenhaven.stream/playlist.m3u8' ],
    [ 'https://webcam-lauwersoog.nl/', 'https://6162417352ffd.streamlock.net/live/lauwersoog-haven.stream/playlist.m3u8' ],
    [ 'https://webcam-hindeloopen.nl/', 'https://5b8d2cbe62ad6.streamlock.net/live/hindeloopen.stream/playlist.m3u8' ],
    [ 'https://www.markermeerzicht.nl/', 'https://www.benlankamp.nl/webcam/index.m3u8' ],
  ])('keeps the viewing page and stable HLS identity for the next camera group: %s', (page, stream) => {
    const expected = { provider: 'hls', key: `hls:${stream}`, playerUrl: stream, watchUrl: page };
    expect(FeatureInfoVideoHelper.getVideo(page)).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo(page + '?tracking=changed#fragment')).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo(stream)).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo(stream + '?token=signed')?.playerUrl).toBe(stream + '?token=signed');
    expect(FeatureInfoVideoHelper.getVideo(page.replace('https://', 'http://'))).toBeNull();
    expect(FeatureInfoVideoHelper.getVideo(page.replace('.nl/', '.nl.evil.example/'))).toBeNull();
    expect(FeatureInfoVideoHelper.getVideo(page + 'unsupported')).toBeNull();
  });

  test('recognizes Bloemendaal with a stable HLS source and a full-page external viewing link', () => {
    const page = 'https://reddingsbrigade-bloemendaal.nl/beachcam/';
    const stream = 'https://wowza01.crossmediaventures.com/beachcam/beachcam.smil/playlist.m3u8';
    const expected = { provider: 'hls', key: `hls:${stream}`, playerUrl: stream, watchUrl: page };
    expect(FeatureInfoVideoHelper.getVideo(page)).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo(page + '?tracking=changed#fragment')).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo(stream)).toEqual(expected);
    expect(FeatureInfoVideoHelper.getVideo('https://reddingsbrigade-bloemendaal.nl.evil.example/beachcam/')).toBeNull();
    expect(FeatureInfoVideoHelper.getVideo(page + 'other')).toBeNull();
  });

});
