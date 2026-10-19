import { describe, expect, test } from 'vitest';
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
    fixture.componentRef.setInput('source', 'https://www.youtube.com/embed/EH6GNSEvmQE?si=changed');
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
});
