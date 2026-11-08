import { Component, effect, inject, input } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Store } from '@ngrx/store';
import { BaseComponentTypeEnum, DEFAULT_LAYER_ALERT_BUFFER_KM, LayerAlertMatchMode, LayerAlertsConfigModel } from '@tailormap-viewer/api';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { selectExtendedAppLayerNodesForSelectedApplication } from '../../state/application.selectors';

@Component({
  selector: 'tm-admin-layer-alerts-config',
  templateUrl: './layer-alerts-config.component.html',
  imports: [ ReactiveFormsModule, MatButton, MatCheckbox, MatFormField, MatLabel, MatInput, MatOption, MatSelect ],
})
export class LayerAlertsConfigComponent {
  private readonly componentConfiguration = inject(ComponentConfigurationService);
  private readonly store = inject(Store);

  public readonly type = input<BaseComponentTypeEnum>();
  public readonly label = input<string>();
  public readonly config = input<LayerAlertsConfigModel>();
  public readonly layers = this.store.selectSignal(selectExtendedAppLayerNodesForSelectedApplication);
  public readonly form = inject(FormBuilder).nonNullable.group({
    enabled: false,
    layerId: '',
    idAttribute: '',
    statusAttribute: '',
    labelAttribute: '',
    mode: 'any-change' as LayerAlertMatchMode,
    bufferKm: new FormControl<number | null>(DEFAULT_LAYER_ALERT_BUFFER_KM),
    from: '',
    to: '',
  });

  constructor() {
    effect(() => {
      const config = this.config();
      const rule = config?.rule;
      this.form.reset({
        enabled: config?.enabled ?? false,
        layerId: rule?.layerId ?? '',
        idAttribute: rule?.idAttribute ?? '',
        statusAttribute: rule?.mode === 'new-object' ? '' : rule?.statusAttribute ?? '',
        labelAttribute: rule?.labelAttribute ?? '',
        mode: rule ? rule.mode ?? 'transition' : 'any-change',
        bufferKm: rule?.mode === 'new-object' ? rule.bufferKm : DEFAULT_LAYER_ALERT_BUFFER_KM,
        from: rule?.mode === 'transition' || rule?.mode === undefined ? String(rule?.from ?? '') : '',
        to: rule?.mode === 'transition' || rule?.mode === undefined ? String(rule?.to ?? '') : '',
      });
    });
  }

  public canApply(): boolean {
    const { enabled, layerId, idAttribute, statusAttribute, mode, from, to, bufferKm } = this.form.getRawValue();
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
  }

  public apply(): void {
    if (!this.canApply()) {
      return;
    }
    const { enabled, layerId, idAttribute, statusAttribute, labelAttribute, mode, from, to, bufferKm } = this.form.getRawValue();
    const fields = { layerId, idAttribute: idAttribute.trim(), labelAttribute: labelAttribute.trim() || undefined };
    let rule: LayerAlertsConfigModel['rule'];
    switch (mode) {
      case 'new-object':
        rule = { ...fields, mode, bufferKm: bufferKm ?? DEFAULT_LAYER_ALERT_BUFFER_KM };
        break;
      case 'any-change':
        rule = { ...fields, mode, statusAttribute: statusAttribute.trim() };
        break;
      case 'transition':
        rule = { ...fields, mode, statusAttribute: statusAttribute.trim(), from: from.trim(), to: to.trim() };
        break;
    }
    this.componentConfiguration.updateConfig<LayerAlertsConfigModel>(this.type(), {
      enabled,
      rule: enabled ? rule : this.config()?.rule,
    });
  }
}
