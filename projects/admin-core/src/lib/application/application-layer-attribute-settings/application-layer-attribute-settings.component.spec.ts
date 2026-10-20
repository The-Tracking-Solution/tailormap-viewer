import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/angular';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AttributeType } from '@tailormap-viewer/api';
import { ApplicationLayerAttributeSettingsComponent } from './application-layer-attribute-settings.component';

const setup = async () => {
  const close = vi.fn();
  const data = {
    featureType: {
      id: '1', name: 'cameras', title: 'Cameras',
      attributes: [
        { id: 'url', name: 'url', type: AttributeType.STRING },
        { id: 'secret', name: 'secret', type: AttributeType.STRING },
      ],
      settings: { attributeSettings: { url: { title: 'Camera', displayType: 'video' } }, hideAttributes: ['secret'] },
    },
    appLayerSettings: { hideAttributes: [], readOnlyAttributes: ['url'], attributeDisplayOverrides: { url: 'text' } },
  };
  const { fixture } = await render(ApplicationLayerAttributeSettingsComponent, {
    providers: [{ provide: MAT_DIALOG_DATA, useValue: data }, { provide: MatDialogRef, useValue: { close } }],
  });
  return { component: fixture.componentInstance, close, data };
};

describe('application-layer attribute presentation', () => {
  test('saves an explicit override without changing aliases, visibility or editability', async () => {
    const { component, close, data } = await setup();
    expect(component.attributes.map(a => a.name)).toEqual(['url']);
    component.attributeDisplayChanged({ attribute: 'url', displayType: 'video' });
    component.save();
    expect(close).toHaveBeenCalledWith({ hideAttributes: [], readOnlyAttributes: ['url'], attributeDisplayOverrides: { url: 'video' } });
    expect(data.appLayerSettings.attributeDisplayOverrides.url).toBe('text');
    expect(data.featureType.settings.attributeSettings.url.title).toBe('Camera');
  });

  test('removes an override when inherit is selected and preserves that removal when saved', async () => {
    const { component, close } = await setup();
    component.attributeDisplayChanged({ attribute: 'url', displayType: undefined });
    component.save();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ attributeDisplayOverrides: {} }));
    expect(component.catalogFeatureTypeSettings.attributeSettings?.['url']?.displayType).toBe('video');
  });
});
