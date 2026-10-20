import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { AttributeType } from '@tailormap-viewer/api';
import { FeatureTypeAttributesComponent } from './feature-type-attributes.component';

const attributes = [
  { id: 'camera', name: 'camera', type: AttributeType.STRING },
  { id: 'count', name: 'count', type: AttributeType.INTEGER },
];

describe('attribute video presentation settings', () => {
  test('allows video for read-only string attributes in the catalog', async () => {
    const changed = vi.fn();
    const { fixture } = await render(FeatureTypeAttributesComponent, {
      inputs: { attributes, showFullSettings: true, writable: false, featureTypeSettings: {} },
      on: { attributeDisplayChanged: changed },
    });
    expect(screen.queryByRole('combobox', { name: 'count' })).toBeNull();
    await userEvent.click(await screen.findByRole('combobox', { name: 'camera' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Video' }));
    fixture.detectChanges();
    expect(changed).toHaveBeenCalledWith({ attribute: 'camera', displayType: 'video' });
  });

  test('shows inherited catalog presentation and offers an explicit text override', async () => {
    const changed = vi.fn();
    await render(FeatureTypeAttributesComponent, {
      inputs: {
        attributes, showFullSettings: false, featureTypeSettings: {},
        catalogFeatureTypeSettings: { attributeSettings: { camera: { displayType: 'video' } } },
      },
      on: { attributeDisplayChanged: changed },
    });
    await userEvent.click(await screen.findByRole('combobox', { name: 'camera' }));
    expect(await screen.findByRole('option', { name: 'Inherit (Video)' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: 'Text / link' }));
    expect(changed).toHaveBeenCalledWith({ attribute: 'camera', displayType: 'text' });
  });
});
