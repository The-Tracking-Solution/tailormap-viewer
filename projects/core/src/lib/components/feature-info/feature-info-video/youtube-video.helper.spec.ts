import { describe, expect, test } from 'vitest';
import { YoutubeVideoHelper } from './youtube-video.helper';

describe('YoutubeVideoHelper', () => {
  test.each([
    'https://www.youtube.com/embed/EH6GNSEvmQE?si=kWfiDQFORwpEKjBh',
    'https://youtube.com/embed/EH6GNSEvmQE',
    'https://www.youtube-nocookie.com/embed/EH6GNSEvmQE',
    '  https://youtube-nocookie.com/embed/EH6GNSEvmQE  ',
  ])('recognizes an explicit embed link: %s', url => {
    expect(YoutubeVideoHelper.getVideoId(url)).toBe('EH6GNSEvmQE');
  });

  test.each([
    null, undefined, 13, {}, '', 'not a URL',
    'http://www.youtube.com/embed/EH6GNSEvmQE',
    '//www.youtube.com/embed/EH6GNSEvmQE',
    'javascript:alert(1)',
    'https://www.youtube.com.evil.example/embed/EH6GNSEvmQE',
    'https://www.youtube.com@evil.example/embed/EH6GNSEvmQE',
    'https://user:password@www.youtube.com/embed/EH6GNSEvmQE',
    'https://www.youtube.com:8443/embed/EH6GNSEvmQE',
    'https://www.youtube.com/embed/too-short',
    'https://www.youtube.com/embed/EH6GNSEvmQE/other',
    'https://www.youtube.com/watch?v=EH6GNSEvmQE',
    'https://youtu.be/EH6GNSEvmQE',
    'https://camera.example/live',
    '<iframe src="https://www.youtube.com/embed/EH6GNSEvmQE"></iframe>',
  ])('leaves unsupported or unsafe values as ordinary attributes: %s', value => {
    expect(YoutubeVideoHelper.getVideoId(value)).toBeNull();
  });
});
