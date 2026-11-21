import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BaseComponentTypeEnum, LayerAlertsConfigModel } from '@tailormap-viewer/api';
import { describe, expect, test, vi } from 'vitest';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { selectExtendedAppLayerNodesForSelectedApplication } from '../../state/application.selectors';
import { LayerAlertsConfigComponent } from './layer-alerts-config.component';

function setup(config?: LayerAlertsConfigModel) {
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
  if (config) {
    fixture.componentRef.setInput('config', config);
  }
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, updateConfig };
}

describe('LayerAlertsConfigComponent', () => {
  test('saves a new-object rule with the default buffer and without a status field', () => {
    const { component, updateConfig } = setup();
    component.form.controls.enabled.setValue(true);
    component.form.controls.rules.at(0).patchValue({ layerId: 'layer-1', idAttribute: 'message-id', mode: 'new-object' });
    component.apply();
    expect(updateConfig).toHaveBeenCalledWith(BaseComponentTypeEnum.LAYER_ALERTS, {
      enabled: true, rule: expect.objectContaining({ mode: 'new-object', idAttribute: 'message-id' }),
      rules: [{
        id: expect.any(String), enabled: true, name: undefined,
        layerId: 'layer-1', idAttribute: 'message-id', labelAttribute: undefined, mode: 'new-object', bufferKm: 10,
      }],
    });

    component.form.controls.rules.at(0).controls.bufferKm.setValue(null);
    component.apply();
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  test('applies every change by default without requiring transition values', () => {
    const { component, updateConfig } = setup();
    component.form.controls.enabled.setValue(true);
    component.form.controls.rules.at(0).patchValue({ layerId: 'layer-1', idAttribute: ' id ', statusAttribute: 'status' });
    component.apply();
    expect(updateConfig.mock.calls[0][1].rules[0]).toMatchObject({
      layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', mode: 'any-change',
    });
  });

  test('rejects an enabled rule with identical transition values', () => {
    const { component, updateConfig } = setup();
    component.form.controls.enabled.setValue(true);
    component.form.controls.rules.at(0).patchValue({
      layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', mode: 'transition', from: 'red', to: ' red ',
    });
    component.apply();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  test('loads a legacy rule and preserves it as the first rule when disabling alerts', () => {
    const rule = { layerId: 'layer-1', idAttribute: 'id', statusAttribute: 'status', from: 1, to: 2 };
    const { component, updateConfig } = setup({ enabled: true, rule });
    expect(component.form.controls.rules.at(0).controls.mode.value).toBe('transition');
    expect(component.form.controls.rules.at(0).controls.from.value).toBe('1');
    component.form.controls.enabled.setValue(false);
    component.apply();
    expect(updateConfig.mock.calls[0][1]).toMatchObject({
      enabled: false, rule: expect.objectContaining({ id: 'legacy-rule', from: '1', to: '2' }), rules: [{ ...rule, id: 'legacy-rule', from: '1', to: '2', enabled: true }],
    });
  });

  test('adds, edits, disables and removes independent rules on the same layer', () => {
    const { component, updateConfig } = setup({ enabled: true, rules: [
      { id: 'status', name: 'Flags', layerId: 'layer-1', idAttribute: 'id', mode: 'any-change', statusAttribute: 'flag' },
      { id: 'new', name: 'Dangers', layerId: 'layer-1', idAttribute: 'id', mode: 'new-object', bufferKm: 10 },
    ] });
    component.form.controls.rules.at(0).patchValue({ enabled: false, name: 'Flags paused' });
    component.removeRule(1);
    component.addRule();
    component.form.controls.rules.at(1).patchValue({
      name: 'New dangers', mode: 'new-object', layerId: 'layer-1', idAttribute: 'danger_id', bufferKm: 5,
    });
    component.apply();
    const saved = updateConfig.mock.calls[0][1].rules;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: 'status', enabled: false, name: 'Flags paused', statusAttribute: 'flag' });
    expect(saved[1]).toMatchObject({ name: 'New dangers', mode: 'new-object', idAttribute: 'danger_id', bufferKm: 5 });
    expect(saved[1].id).not.toBe('status');
    expect(saved[1].id).not.toBe('new');
    expect(updateConfig.mock.calls[0][1].rule).toEqual(saved[1]);
  });

  test('keeps an explicitly empty rule list empty instead of restoring the legacy rule', () => {
    const { component, updateConfig } = setup({ enabled: true, rules: [], rule: {
      layerId: 'layer-1', idAttribute: 'id', mode: 'any-change', statusAttribute: 'flag',
    } });
    expect(component.form.controls.rules.length).toBe(0);
    component.apply();
    expect(updateConfig).toHaveBeenCalledWith(BaseComponentTypeEnum.LAYER_ALERTS, { enabled: true, rule: undefined, rules: [] });
  });
});
