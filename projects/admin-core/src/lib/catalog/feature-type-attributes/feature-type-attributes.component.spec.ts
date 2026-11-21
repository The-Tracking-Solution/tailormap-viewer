import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { AttributeType } from '@tailormap-viewer/api';
import { of } from 'rxjs';
import { AttributeDescriptorModel, FeatureTypeSettingsModel, TailormapAdminApiV1Service } from '@tailormap-admin/admin-api';
import { FeatureTypeAttributesComponent } from './feature-type-attributes.component';

const attributes: AttributeDescriptorModel[] = [
  { id: '1', name: 'id', type: AttributeType.INTEGER },
  { id: '2', name: 'soort', type: AttributeType.STRING },
  { id: '3', name: 'datum', type: AttributeType.DATE },
];

const setup = async (editableAttributes: string[]) => {
  const attributeEditableChanged = vi.fn();
  const featureTypeSettings: FeatureTypeSettingsModel = { editableAttributes };
  await render(FeatureTypeAttributesComponent, {
    inputs: { attributes, primaryKeyAttributeName: 'id', featureTypeSettings, writable: true },
    on: { attributeEditableChanged },
    providers: [
      // Used by the attachment attributes card
      { provide: TailormapAdminApiV1Service, useValue: { getServerConfig$: () => of({ multipart: { maxFileSize: 0 } }) } },
    ],
  });
  // The first row of checkboxes is the header: "enabled" and "editable"
  const editableHeaderCheckbox = screen.getAllByRole('checkbox')[1];
  return { attributeEditableChanged, editableHeaderCheckbox };
};

describe('FeatureTypeAttributesComponent', () => {

  test('checking all attributes as editable leaves out the primary key', async () => {
    const { attributeEditableChanged, editableHeaderCheckbox } = await setup([]);
    await userEvent.click(editableHeaderCheckbox);
    expect(attributeEditableChanged).toHaveBeenCalledWith([
      { attribute: 'soort', checked: true },
      { attribute: 'datum', checked: true },
    ]);
  });

  test('all attributes except the primary key editable shows as all checked', async () => {
    const { editableHeaderCheckbox } = await setup([ 'soort', 'datum' ]);
    expect(editableHeaderCheckbox).toBeChecked();
    expect(editableHeaderCheckbox).not.toBePartiallyChecked();
  });

  test('unchecking all attributes as editable includes the primary key', async () => {
    const { attributeEditableChanged, editableHeaderCheckbox } = await setup([ 'id', 'soort', 'datum' ]);
    await userEvent.click(editableHeaderCheckbox);
    expect(attributeEditableChanged).toHaveBeenCalledWith([
      { attribute: 'id', checked: false },
      { attribute: 'soort', checked: false },
      { attribute: 'datum', checked: false },
    ]);
  });

});


const videoAttributes = [
  { id: 'camera', name: 'camera', type: AttributeType.STRING },
  { id: 'count', name: 'count', type: AttributeType.INTEGER },
];

describe('attribute video presentation settings', () => {
  test('allows video for read-only string attributes in the catalog', async () => {
    const changed = vi.fn();
    const { fixture } = await render(FeatureTypeAttributesComponent, {
      inputs: { attributes: videoAttributes, showFullSettings: true, writable: false, featureTypeSettings: {} },
      on: { attributeDisplayChanged: changed },
    });
    expect(screen.queryByRole('combobox', { name: 'count' })).toBeNull();
    await userEvent.click(await screen.findByRole('combobox', { name: 'camera' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Video' }));
    fixture.detectChanges();
    expect(changed).toHaveBeenCalledWith({ attribute: 'camera', displayType: 'video' });
  });

  test('shows inherited catalog presentation and offers an explicit text override', async () => {
    const changed = vi.fn();
    await render(FeatureTypeAttributesComponent, {
      inputs: {
        attributes: videoAttributes, showFullSettings: false, featureTypeSettings: {},
        catalogFeatureTypeSettings: { attributeSettings: { camera: { displayType: 'video' } } },
      },
      on: { attributeDisplayChanged: changed },
    });
    await userEvent.click(await screen.findByRole('combobox', { name: 'camera' }));
    expect(await screen.findByRole('option', { name: 'Inherit (Video)' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: 'Text / link' }));
    expect(changed).toHaveBeenCalledWith({ attribute: 'camera', displayType: 'text' });
  });
});
