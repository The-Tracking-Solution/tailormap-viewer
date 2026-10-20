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
});
