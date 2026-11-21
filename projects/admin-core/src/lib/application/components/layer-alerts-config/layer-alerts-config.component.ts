import { Component, effect, inject, input } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Store } from '@ngrx/store';
import {
  BaseComponentTypeEnum, DEFAULT_LAYER_ALERT_BUFFER_KM, LayerAlertMatchMode, LayerAlertRuleConfigModel, LayerAlertsConfigModel,
} from '@tailormap-viewer/api';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { selectExtendedAppLayerNodesForSelectedApplication } from '../../state/application.selectors';

@Component({
  selector: 'tm-admin-layer-alerts-config',
  templateUrl: './layer-alerts-config.component.html',
  styleUrls: ['./layer-alerts-config.component.css'],
  imports: [ ReactiveFormsModule, MatButton, MatCheckbox, MatFormField, MatLabel, MatInput, MatOption, MatSelect ],
})
export class LayerAlertsConfigComponent {
  private readonly componentConfiguration = inject(ComponentConfigurationService);
  private readonly store = inject(Store);
  private readonly formBuilder = inject(FormBuilder).nonNullable;

  public readonly type = input<BaseComponentTypeEnum>();
  public readonly label = input<string>();
  public readonly config = input<LayerAlertsConfigModel>();
  public readonly layers = this.store.selectSignal(selectExtendedAppLayerNodesForSelectedApplication);
  public readonly form = this.formBuilder.group({
    enabled: false,
    rules: this.formBuilder.array([this.createRuleForm()]),
  });

  constructor() {
    effect(() => {
      const config = this.config();
      const rules = config?.rules ?? (config?.rule ? [{ ...config.rule, id: 'legacy-rule' }] : []);
      this.form.controls.enabled.setValue(config?.enabled ?? false);
      this.form.controls.rules.clear();
      rules.forEach(rule => this.form.controls.rules.push(this.createRuleForm(rule)));
      if (!config) {
        this.addRule();
      }
    });
  }

  private createRuleForm(rule?: LayerAlertRuleConfigModel) {
    return this.formBuilder.group({
      id: rule?.id || crypto.randomUUID(),
      enabled: rule?.enabled ?? true,
      name: rule?.name ?? '',
      layerId: rule?.layerId ?? '',
      idAttribute: rule?.idAttribute ?? '',
      statusAttribute: rule?.mode === 'new-object' ? '' : rule?.statusAttribute ?? '',
      labelAttribute: rule?.labelAttribute ?? '',
      mode: (rule ? rule.mode ?? 'transition' : 'any-change') as LayerAlertMatchMode,
      bufferKm: new FormControl<number | null>(rule?.mode === 'new-object' ? rule.bufferKm : DEFAULT_LAYER_ALERT_BUFFER_KM),
      from: rule?.mode === 'transition' || rule?.mode === undefined ? String(rule?.from ?? '') : '',
      to: rule?.mode === 'transition' || rule?.mode === undefined ? String(rule?.to ?? '') : '',
    });
  }

  public addRule(): void {
    this.form.controls.rules.push(this.createRuleForm());
  }

  public removeRule(index: number): void {
    this.form.controls.rules.removeAt(index);
  }

  public canApply(): boolean {
    if (!this.form.controls.enabled.value) {
      return true;
    }
    return this.form.controls.rules.getRawValue().every(rule => {
      const { enabled, layerId, idAttribute, statusAttribute, mode, from, to, bufferKm } = rule;
      if (!enabled) {
        return true;
      }
      if (!idAttribute.trim() || !this.layers().some(layer => layer.id === layerId)) {
        return false;
      }
      if (mode === 'new-object') {
        return bufferKm !== null && Number.isFinite(bufferKm * 1000) && bufferKm >= 0;
      }
      return !!statusAttribute.trim() && idAttribute.trim() !== statusAttribute.trim()
        && (mode === 'any-change' || (!!from.trim() && !!to.trim() && from.trim() !== to.trim()));
    });
  }

  public apply(): void {
    if (!this.canApply()) {
      return;
    }
    const { enabled, rules } = this.form.getRawValue();
    const savedRules = rules.map<LayerAlertRuleConfigModel>(rule => {
      const { id, name, layerId, idAttribute, statusAttribute, labelAttribute, mode, from, to, bufferKm } = rule;
      const fields = {
        id, enabled: rule.enabled, name: name.trim() || undefined,
        layerId, idAttribute: idAttribute.trim(), labelAttribute: labelAttribute.trim() || undefined,
      };
      switch (mode) {
        case 'new-object':
          return { ...fields, mode, bufferKm: bufferKm ?? DEFAULT_LAYER_ALERT_BUFFER_KM };
        case 'any-change':
          return { ...fields, mode, statusAttribute: statusAttribute.trim() };
        case 'transition':
          return { ...fields, mode, statusAttribute: statusAttribute.trim(), from: from.trim(), to: to.trim() };
      }
    });
    this.componentConfiguration.updateConfig<LayerAlertsConfigModel>(this.type(), {
      enabled,
      rule: savedRules.find(rule => rule.enabled !== false),
      rules: savedRules,
    });
  }
}
