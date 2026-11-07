import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BaseComponentTypeEnum } from '@tailormap-viewer/api';
import { describe, expect, test, vi } from 'vitest';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { selectExtendedAppLayerNodesForSelectedApplication } from '../../state/application.selectors';
import { LayerAlertsConfigComponent } from './layer-alerts-config.component';

function setup() {
  const updateConfig = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideMockStore({
        selectors: [{ selector: selectExtendedAppLayerNodesForSelectedApplication, value: [{ id: 'layer-1', label: 'Layer 1' }] }],
      }),
      { provide: ComponentConfigurationService, useValue: { updateConfig } },
    ],
  });
  const fixture = TestBed.createComponent(LayerAlertsConfigComponent);
  fixture.componentRef.setInput('type', BaseComponentTypeEnum.LAYER_ALERTS);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, updateConfig };
}

describe('LayerAlertsConfigComponent', () => {
  test('applies the enabled rule to the application draft', () => {
    const { component, updateConfig } = setup();
    component.form.setValue({
      enabled: true, layerId: 'layer-1', idAttribute: ' id ', statusAttribute: 'status',
      labelAttribute: '', from: ' yellow ', to: 'red',
    });
    component.apply();

    expect(updateConfig).toHaveBeenCalledWith(BaseComponentTypeEnum.LAYER_ALERTS, {
      enabled: true,
      rule: { layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', labelAttribute: undefined, from: 'yellow', to: 'red' },
    });
  });

  test('rejects an enabled rule with identical transition values', () => {
    const { component, updateConfig } = setup();
    component.form.patchValue({
      enabled: true, layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', from: 'red', to: ' red ',
    });
    component.apply();

    expect(updateConfig).not.toHaveBeenCalled();
  });

  test('loads a saved rule and keeps it when disabling alerts', () => {
    const { fixture, component, updateConfig } = setup();
    const rule = { layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', from: 1, to: 2 };
    fixture.componentRef.setInput('config', { enabled: true, rule });
    fixture.detectChanges();
    expect(component.form.controls.from.value).toBe('1');

    component.form.controls.enabled.setValue(false);
    component.apply();
    expect(updateConfig).toHaveBeenCalledWith(BaseComponentTypeEnum.LAYER_ALERTS, { enabled: false, rule });
  });
});
