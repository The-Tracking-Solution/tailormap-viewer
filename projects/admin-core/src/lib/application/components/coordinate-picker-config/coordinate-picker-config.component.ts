import { ChangeDetectionStrategy, Component, DestroyRef, Input, inject } from '@angular/core';
import {
  BaseComponentTypeEnum,
  COORDINATE_DISPLAY_MAP_PROJECTION,
  CoordinateDisplayFormat,
  CoordinatePickerConfigModel,
} from '@tailormap-viewer/api';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { ComponentConfigurationService } from '../../services/component-configuration.service';
import { ConfigurationComponentModel } from '../configuration-component.model';
import { AdminProjectionsHelper } from '../../helpers/admin-projections-helper';
import { BaseComponentConfigComponent } from '../base-component-config/base-component-config.component';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { InfoMessageComponent } from '@tailormap-viewer/shared';

@Component({
  selector: 'tm-admin-coordinate-picker-config',
  templateUrl: './coordinate-picker-config.component.html',
  styleUrls: ['./coordinate-picker-config.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BaseComponentConfigComponent,
    InfoMessageComponent,
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
  ],
})
export class CoordinatePickerConfigComponent implements ConfigurationComponentModel<CoordinatePickerConfigModel> {
  private componentConfigService = inject(ComponentConfigurationService);
  private destroyRef = inject(DestroyRef);

  @Input()
  public type: BaseComponentTypeEnum | undefined;

  @Input()
  public label: string | undefined;

  @Input()
  public set config(config: CoordinatePickerConfigModel | undefined) {
    this._config = config;
    this.formGroup.patchValue({
      projection: config?.projection || COORDINATE_DISPLAY_MAP_PROJECTION,
      format: config?.format || 'xy',
    }, { emitEvent: false });
  }

  public get config() {
    return this._config;
  }

  private _config: CoordinatePickerConfigModel | undefined;

  public formGroup = new FormGroup({
    projection: new FormControl<string>(COORDINATE_DISPLAY_MAP_PROJECTION, { nonNullable: true }),
    format: new FormControl<CoordinateDisplayFormat>('xy', { nonNullable: true }),
  });

  public projections = [
    {
      code: COORDINATE_DISPLAY_MAP_PROJECTION,
      label: $localize `:@@admin-core.components.mouse-coordinates-map-crs:Map CRS`,
    },
    { code: 'EPSG:4326', label: 'EPSG:4326 (WGS84)' },
    ...AdminProjectionsHelper.projections,
  ];

  constructor() {
    this.formGroup.controls.projection.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(projection => {
        if (projection !== 'EPSG:4326' && this.formGroup.controls.format.value !== 'xy') {
          this.formGroup.controls.format.setValue('xy', { emitEvent: false });
        }
      });

    this.formGroup.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(250))
      .subscribe(() => this.saveConfig());
  }

  private saveConfig() {
    const values = this.formGroup.getRawValue();
    const format: CoordinateDisplayFormat = values.projection === 'EPSG:4326' ? values.format : 'xy';
    this.componentConfigService.updateConfig<CoordinatePickerConfigModel>(this.type, {
      projection: values.projection,
      format,
    });
  }
}
