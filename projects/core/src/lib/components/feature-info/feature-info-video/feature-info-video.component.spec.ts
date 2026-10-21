import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/angular';
import { FeatureInfoVideoComponent } from './feature-info-video.component';

const source = 'https://www.youtube.com/embed/EH6GNSEvmQE?si=tracking&autoplay=0&origin=https://other.example';

describe('FeatureInfoVideoComponent', () => {
  test('contacts YouTube only after play and constructs its own player URL', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source, featureKey: 'layer:13' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/EH6GNSEvmQE?autoplay=1&playsinline=1');
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(getByRole('link', { name: 'Open in YouTube' }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=EH6GNSEvmQE');

    // Refreshed query parameters for the same source do not reload the player.
    fixture.componentRef.setInput('source', 'https://www.youtube.com/watch?v=EH6GNSEvmQE&si=changed');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('ends playback on feature/source changes, removal and destruction', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source, featureKey: 'layer:13' },
    });
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      expect(container.querySelector('iframe')).not.toBeNull();
    };
    start();
    fixture.componentRef.setInput('featureKey', 'another-layer:13');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    start();
    fixture.componentRef.setInput('source', 'https://www.youtube.com/embed/M7lc1UVf-VE');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    start();
    fixture.componentRef.setInput('source', null);
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    start();
    const frame = container.querySelector('iframe');
    fixture.destroy();
    expect(frame?.getAttribute('src')).toBe('about:blank');
  });

  test('loads NetcamViewer only after play and preserves the iframe during an equivalent refresh', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://live.netcamviewer.nl/de-blanke-top/777.html?autoplay=1', featureKey: 'webcams:24' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in NetcamViewer' }).getAttribute('href'))
      .toBe('https://live.netcamviewer.nl/de-blanke-top/777.html');
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://live.netcamviewer.nl/de-blanke-top/777.html');
    expect(frame?.getAttribute('title')).toBe('Video player');
    expect(frame?.getAttribute('allow')).toContain('fullscreen');
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    fixture.componentRef.setInput('source', 'https://live.netcamviewer.nl/de-blanke-top/777?tracking=changed');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    expect(frame?.getAttribute('src')).toBe('https://live.netcamviewer.nl/de-blanke-top/777.html');
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('stops NetcamViewer for another camera, feature or provider, and on destruction', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://live.netcamviewer.nl/beachcam-cadzand/1069', featureKey: 'webcams:25' },
    });
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      expect(container.querySelector('iframe')).not.toBeNull();
      return container.querySelector('iframe');
    };
    let frame = start();
    fixture.componentRef.setInput('source', 'https://live.netcamviewer.nl/Camera-Timboektoe/1404');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('featureKey', 'another-layer:25');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in YouTube' })).toBeDefined();
    start();
    fixture.componentRef.setInput('source', 'https://live.netcamviewer.nl/beachcam-cadzand/1069');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.destroy();
    expect(frame?.getAttribute('src')).toBe('about:blank');
  });

  test.each([
    'https://live.netcamviewer.nl.evil.example/camera/777',
    'https://live.netcamviewer.nl/camera/777.php',
    'http://live.netcamviewer.nl/camera/777',
  ])('does not render playback controls for an unsupported URL: %s', async unsafeSource => {
    const { container } = await render(FeatureInfoVideoComponent, {
      inputs: { source: unsafeSource, featureKey: 'webcams:24' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });


  test('plays IPCamLive after a click and preserves the iframe for an equivalent public/player link', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://www.ipcamlive.com/strandhotelburen', featureKey: 'webcams:78' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in IPCamLive' }).getAttribute('href'))
      .toBe('https://www.ipcamlive.com/strandhotelburen');
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src'))
      .toBe('https://g0.ipcamlive.com/player/player.php?alias=strandhotelburen&autoplay=1');
    fixture.componentRef.setInput('source', 'https://g0.ipcamlive.com/player/player.php?alias=strandhotelburen&controls=0');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('stops IPCamLive when changing camera, feature or provider and on destruction', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://www.ipcamlive.com/strandhotelburen', featureKey: 'webcams:78' },
    });
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      expect(container.querySelector('iframe')).not.toBeNull();
      return container.querySelector('iframe');
    };
    let frame = start();
    fixture.componentRef.setInput('source', 'https://g0.ipcamlive.com/player/player.php?alias=detokowebcam&controls=0');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('featureKey', 'webcams:28');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in YouTube' })).toBeDefined();
    frame = start();
    fixture.componentRef.setInput('source', 'https://live.netcamviewer.nl/de-blanke-top/777.html');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in NetcamViewer' })).toBeDefined();
    frame = start();
    fixture.componentRef.setInput('source', 'https://www.ipcamlive.com/strandhotelburen');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.destroy();
    expect(frame?.getAttribute('src')).toBe('about:blank');
  });

  test('rtsp.me starts on click, preserves refresh and stops on changes and destruction', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://rtsp.me/embed/tkkGYA72/', featureKey: 'webcams:26' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in rtsp.me' }).getAttribute('href')).toBe('https://rtsp.me/embed/tkkGYA72/');
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      const frame = container.querySelector('iframe');
      expect(frame).not.toBeNull();
      return frame;
    };
    let frame = start();
    expect(frame?.getAttribute('src')).toBe('https://rtsp.me/embed/tkkGYA72/');
    fixture.componentRef.setInput('source', 'https://rtsp.me/embed/tkkGYA72/?tracking=changed');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('featureKey', 'other-layer:21');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', 'https://rtsp.me/embed/474NtQT5/');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in YouTube' })).toBeDefined();
    frame = start();
    fixture.destroy();
    expect(frame?.getAttribute('src')).toBe('about:blank');
  });

  test('StreamPartner starts on click, preserves refresh and stops on changes and destruction', async () => {
    const { container, getByRole, fixture } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz', featureKey: 'webcams:21' },
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in StreamPartner' }).getAttribute('href')).toBe('https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz');
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      const frame = container.querySelector('iframe');
      expect(frame).not.toBeNull();
      return frame;
    };
    let frame = start();
    expect(frame?.getAttribute('src')).toBe('https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz');
    fixture.componentRef.setInput('source', 'https://ssl.streampartner.nl/player.php?url=rwj3wllrsipkvysnuozz&tracking=changed');
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('featureKey', 'other-layer:21');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', 'https://ssl.streampartner.nl/player.php?url=9579fb17b6b118ec5063');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    frame = start();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByRole('link', { name: 'Open in YouTube' })).toBeDefined();
    frame = start();
    fixture.destroy();
    expect(frame?.getAttribute('src')).toBe('about:blank');
  });

});


describe('FeatureInfoVideoComponent HLS lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  test.each([
    [ 'https://dehangout.nl/webcam-wijk-aan-zee/', 'https://webcam.dehangout.nl/stream.m3u8' ],
    [ 'https://reddingsbrigade-bloemendaal.nl/beachcam/',
      'https://wowza01.crossmediaventures.com/beachcam/beachcam.smil/playlist.m3u8' ],
  ])('loads HLS only after Play, preserves refresh and keeps the external viewing page: %s', async (page, stream) => {
    const { fixture, container, getByRole } = await render(FeatureInfoVideoComponent, {
      inputs: { source: page, featureKey: 'webcams:1' },
    });
    expect(container.querySelector('video')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(getByRole('link', { name: 'Open video source' }).getAttribute('href')).toBe(page);
    expect(getByRole('link', { name: 'Open video source' }).getAttribute('target')).toBe('_blank');
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(stream);
    expect(container.querySelector('iframe')).toBeNull();
    fixture.componentRef.setInput('source', stream);
    fixture.detectChanges();
    expect(container.querySelector('video')).toBe(video);
    fireEvent.click(getByRole('button', { name: 'Stop video' }));
    fixture.detectChanges();
    expect(container.querySelector('video')).toBeNull();
    expect(video?.hasAttribute('src')).toBe(false);
    fixture.destroy();
  });

  test('releases HLS on feature, source, token and provider changes and destruction', async () => {
    const { fixture, container, getByRole } = await render(FeatureInfoVideoComponent, {
      inputs: { source: 'https://camera.example/live.m3u8', featureKey: 'webcams:1' },
    });
    const start = () => {
      fireEvent.click(getByRole('button', { name: 'Play video' }));
      fixture.detectChanges();
      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      return video;
    };
    let video = start();
    fixture.componentRef.setInput('featureKey', 'other-layer:1');
    fixture.detectChanges();
    expect(video?.hasAttribute('src')).toBe(false);
    expect(container.querySelector('video')).toBeNull();
    video = start();
    fixture.componentRef.setInput('source', 'https://camera.example/live.m3u8?token=new');
    fixture.detectChanges();
    expect(video?.hasAttribute('src')).toBe(false);
    expect(container.querySelector('video')).toBeNull();
    video = start();
    fixture.componentRef.setInput('source', 'https://webcam-marinaseaport.nl/');
    fixture.detectChanges();
    expect(video?.hasAttribute('src')).toBe(false);
    video = start();
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    expect(video?.hasAttribute('src')).toBe(false);
    expect(container.querySelector('video')).toBeNull();
    expect(getByRole('link', { name: 'Open in YouTube' })).toBeDefined();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    fixture.componentRef.setInput('source', 'https://dehangout.nl/webcam-wijk-aan-zee/');
    fixture.detectChanges();
    expect(frame?.getAttribute('src')).toBe('about:blank');
    expect(container.querySelector('iframe')).toBeNull();
    video = start();
    fixture.destroy();
    expect(video?.hasAttribute('src')).toBe(false);
  });
});
