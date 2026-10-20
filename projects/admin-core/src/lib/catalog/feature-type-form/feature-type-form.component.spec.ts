import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import { FeatureTypeFormComponent } from './feature-type-form.component';
import { of } from 'rxjs';
import { FeatureTypeModel } from '@tailormap-admin/admin-api';
import { FeatureSourceService } from '../services/feature-source.service';
import { createMockStore } from '@ngrx/store/testing';
import { catalogStateKey, initialCatalogState } from '../state/catalog.state';
import { Store } from '@ngrx/store';
import { provideHttpClient } from '@angular/common/http';

const setup = async () => {
  const featureSourceService = { updateFeatureType$: vi.fn(() => of({})) };
  const featureTypeModel: FeatureTypeModel = {
    attributes: [],
    defaultGeometryAttribute: null,
    primaryKeyAttribute: null,
    settings: {
      attributeSettings: {},
    },
    id: '1_ft_1',
    name: 'ft_1',
    title: 'some table',
  };
  const mockStore = createMockStore({
    initialState: { [catalogStateKey]: { ...initialCatalogState } },
  });
  const { fixture } = await render(FeatureTypeFormComponent, {
    imports: [],
    inputs: {
      featureType: featureTypeModel,
    },
    providers: [
      { provide: FeatureSourceService, useValue: featureSourceService },
      { provide: Store, useValue: mockStore },
      provideHttpClient(),
    ],
  });
  return { featureSourceService, featureTypeModel, fixture };
};

describe('FeatureTypeFormComponent', () => {

  test('should render', async () => {
    await setup();
    expect(await screen.findByText('Details for feature type some table')).toBeInTheDocument();
  });

  test('saves presentation and aliases together without losing other catalog settings', async () => {
    const { fixture, featureTypeModel, featureSourceService } = await setup();
    featureTypeModel.settings.attributeSettings = { camera: { title: 'Original', displayType: 'video' } };
    const component = fixture.componentInstance;
    component.attributeDisplayChanged(featureTypeModel.settings, { attribute: 'camera', displayType: 'text' });
    component.aliasesChanged(featureTypeModel.settings, [{ attribute: 'camera', alias: 'Renamed' }]);
    component.save(featureTypeModel);
    expect(featureSourceService.updateFeatureType$).toHaveBeenLastCalledWith('1_ft_1', expect.objectContaining({
      settings: expect.objectContaining({ attributeSettings: { camera: { title: 'Renamed', displayType: 'text' } } }),
    }));
    expect(featureTypeModel.settings.attributeSettings['camera']).toEqual({ title: 'Original', displayType: 'video' });
  });

});
