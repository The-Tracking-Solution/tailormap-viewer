import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/angular';
import { BaseComponentTypeEnum } from '@tailormap-viewer/api';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { FeatureInfoComponentConfigComponent } from './feature-info-component-config.component';

describe('FeatureInfoComponentConfigComponent video setting', () => {
  test('defaults to disabled, loads existing configuration and saves the opt-in', async () => {
    const updateConfigForKey = vi.fn();
    const { fixture } = await render(FeatureInfoComponentConfigComponent, {
      providers: [{ provide: ComponentConfigurationService, useValue: { updateConfigForKey } }],
      inputs: { type: BaseComponentTypeEnum.FEATURE_INFO },
    });
    expect(fixture.componentInstance.formGroup.controls.showEmbeddedVideos.value).toBe(false);
    fixture.componentRef.setInput('config', { enabled: true, defaultShowDropdown: false, showEmbeddedVideos: true });
    fixture.detectChanges();
    expect(fixture.componentInstance.formGroup.controls.showEmbeddedVideos.value).toBe(true);
    expect(updateConfigForKey).not.toHaveBeenCalled();
    fixture.componentInstance.formGroup.controls.showEmbeddedVideos.setValue(false);
    await vi.waitFor(() => {
      expect(updateConfigForKey).toHaveBeenCalledWith(BaseComponentTypeEnum.FEATURE_INFO, 'showEmbeddedVideos', false);
    });
  });
});
