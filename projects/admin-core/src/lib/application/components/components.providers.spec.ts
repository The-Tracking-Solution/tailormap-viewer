import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { expect, test } from 'vitest';
import { BaseComponentTypeEnum } from '@tailormap-viewer/api';
import { provideConfigurationComponents } from './components.providers';
import { ConfigurationComponentRegistryService } from '../services/configuration-component-registry.service';
import { CoordinatePickerConfigComponent } from './coordinate-picker-config/coordinate-picker-config.component';

test('keeps coordinate picker settings available after the component module is replaced by providers', async () => {
  TestBed.configureTestingModule({ providers: provideConfigurationComponents() });
  const registry = TestBed.inject(ConfigurationComponentRegistryService);
  const components = await firstValueFrom(registry.getRegisteredConfigurationComponents$());
  expect(components.get(BaseComponentTypeEnum.COORDINATE_PICKER)?.component).toBe(CoordinatePickerConfigComponent);
});
