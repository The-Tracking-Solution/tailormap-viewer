import { Component, effect, inject, input } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Store } from '@ngrx/store';
import { BaseComponentTypeEnum, LayerAlertsConfigModel } from '@tailormap-viewer/api';
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
        statusAttribute: rule?.statusAttribute ?? '',
        labelAttribute: rule?.labelAttribute ?? '',
        from: String(rule?.from ?? ''),
        to: String(rule?.to ?? ''),
      });
    });
  }

  public canApply(): boolean {
    const { enabled, layerId, idAttribute, statusAttribute, from, to } = this.form.getRawValue();
    return !enabled || (
      this.layers().some(layer => layer.id === layerId)
      && !!idAttribute.trim() && !!statusAttribute.trim() && idAttribute.trim() !== statusAttribute.trim()
      && !!from.trim() && !!to.trim() && from.trim() !== to.trim()
    );
  }

  public apply(): void {
    if (!this.canApply()) {
      return;
    }
    const { enabled, layerId, idAttribute, statusAttribute, labelAttribute, from, to } = this.form.getRawValue();
    this.componentConfiguration.updateConfig<LayerAlertsConfigModel>(this.type(), {
      enabled,
      rule: enabled
        ? {
          layerId,
          idAttribute: idAttribute.trim(),
          statusAttribute: statusAttribute.trim(),
          labelAttribute: labelAttribute.trim() || undefined,
          from: from.trim(),
          to: to.trim(),
        }
        : this.config()?.rule,
    });
  }
}
