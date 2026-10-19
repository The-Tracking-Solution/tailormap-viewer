import { describe, expect, test } from 'vitest';
import { YoutubeVideoHelper } from './youtube-video.helper';

describe('YoutubeVideoHelper', () => {
  test.each([
    'https://www.youtube.com/embed/EH6GNSEvmQE?si=kWfiDQFORwpEKjBh',
    'https://youtube.com/embed/EH6GNSEvmQE',
    'https://www.youtube-nocookie.com/embed/EH6GNSEvmQE',
    '  https://youtube-nocookie.com/embed/EH6GNSEvmQE  ',
    'https://www.youtube.com/watch?v=EH6GNSEvmQE',
    'https://m.youtube.com/watch?v=EH6GNSEvmQE',
    'https://www.youtube.com/watch?list=playlist&v=EH6GNSEvmQE&t=20',
    'https://youtu.be/EH6GNSEvmQE?si=share',
    'https://www.youtu.be/EH6GNSEvmQE/',
    'https://www.youtube.com/live/EH6GNSEvmQE?si=share',
    'https://www.youtube.com/shorts/EH6GNSEvmQE',
  ])('recognizes a supported video link: %s', url => {
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
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=too-short',
    'https://www.youtube.com/watch?v=EH6GNSEvmQEextra',
    'https://www.youtube.com/watch?v=%3Cscript%3E',
    'https://www.youtube.com/live/EH6GNSEvmQE/other',
    'https://youtu.be.evil.example/EH6GNSEvmQE',
    'https://youtu.be/EH6GNSEvmQE/other',
    'https://www.youtube.com/channel/EH6GNSEvmQE',
    'https://camera.example/live',
    '<iframe src="https://www.youtube.com/embed/EH6GNSEvmQE"></iframe>',
  ])('leaves unsupported or unsafe values as ordinary attributes: %s', value => {
    expect(YoutubeVideoHelper.getVideoId(value)).toBeNull();
  });
});
