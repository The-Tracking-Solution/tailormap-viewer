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
    'https://camera.example/stream.m3u8',
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

});
