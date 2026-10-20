import { describe, test, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/angular';
import { FeatureInfoContentComponent } from './feature-info-content.component';
import { LoadingStateEnum } from '@tailormap-viewer/shared';
import { FeatureInfoModel } from '../models';
import { getAppLayerModel } from '@tailormap-viewer/api';
import { AttachmentService } from '../../../services';
import { of } from 'rxjs';
import { FeatureSelectionBookmarkService } from '../../../services/application-bookmark/feature-selection-bookmark.service';
import { provideMockStore } from '@ngrx/store/testing';
import { selectFeatureInfoMetadata } from '../state/feature-info.selectors';
import { selectActiveFilterGroups, selectAllFilterGroupsForLayerId, selectAllFiltersForAttribute } from '../../../state';
import { SimpleAttributeFilterService } from '../../../filter/services/simple-attribute-filter.service';

const getFeatureInfo = (updated?: boolean): FeatureInfoModel => {
  return {
    __fid: '1',
    geometry: null,
    layer: getAppLayerModel(),
    sortedAttachmentsByAttribute: [],
    attachmentCount: 0,
    sortedAttributes: [
      { key: 'prop', attributeValue: 'test', label: 'Property' },
      { key: 'prop2', attributeValue: 'another test', label: 'Property 2' },
      { key: 'fid', attributeValue: updated ? '6' : '1', label: 'fid' },
    ],
  };
};

const setup = async (feature = getFeatureInfo(), showEmbeddedVideos = false) => {
    const mockAttachmentService = {
      getAttachmentUrl: () => '',
      getAttachmentTooltip: () => '',
    };
    const mockFeatureSelectionBookmarkService = { getFidSelectionUrl$: () => of(null) };
    const mockSimpleAttributeFilterService = { setFilter: vi.fn(), removeFilterById: vi.fn() };
    return await render(FeatureInfoContentComponent, {
      imports: [
        ],
      providers: [
        { provide: AttachmentService, useValue: mockAttachmentService },
        { provide: FeatureSelectionBookmarkService, useValue: mockFeatureSelectionBookmarkService },
        { provide: SimpleAttributeFilterService, useValue: mockSimpleAttributeFilterService },
        provideMockStore({
          selectors: [
            { selector: selectFeatureInfoMetadata, value: { columnMetadata: [], attachmentMetadata: [] } },
            { selector: selectAllFilterGroupsForLayerId('1'), value: [] },
            { selector: selectAllFiltersForAttribute('1', 'prop'), value: [] },
            { selector: selectAllFiltersForAttribute('1', 'prop2'), value: [] },
            { selector: selectAllFiltersForAttribute('1', 'fid'), value: [] },
            { selector: selectActiveFilterGroups, value: [] },
          ],
        }),
      ],
      inputs: {
        selectedLayer: { id: '1', title: 'Layer1', loading: LoadingStateEnum.LOADED },
        currentFeature: feature,
        showEmbeddedVideos,
        isPrevButtonDisabled: false,
        isNextButtonDisabled: false,
        isEditPossible: true,
      },
    });
};

describe('FeatureInfoContentComponent', () => {
  test('should render', async () => {
    await setup();
    expect((await screen.findByText(/fid/)).nextSibling?.textContent?.trim()).toEqual('1');
    expect((await screen.findByText(/Property 2/)).nextSibling?.textContent?.trim()).toEqual('another test');
  });

  test('preserves playback across refreshed attributes and stops when hidden or selecting another feature', async () => {
    const feature = getFeatureInfo();
    feature.sortedAttributes[0].attributeValue = 'https://www.youtube.com/embed/EH6GNSEvmQE';
    feature.sortedAttributes[0].displayType = 'video';
    const { fixture, container, getByRole } = await setup(feature);
    expect(container.querySelector('tm-feature-info-video')).toBeNull();
    fixture.componentRef.setInput('showEmbeddedVideos', true);
    fixture.detectChanges();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();

    // A refresh creates new attribute objects, but the existing player must survive.
    const refreshed = { ...feature, sortedAttributes: feature.sortedAttributes.map(att => ({ ...att })) };
    refreshed.sortedAttributes[1].attributeValue = 'Updated name';
    fixture.componentRef.setInput('currentFeature', refreshed);
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBe(frame);
    expect(container.textContent).toContain('Updated name');

    fixture.componentRef.setInput('mediaVisible', false);
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    expect(frame?.isConnected).toBe(false);
    fixture.componentRef.setInput('mediaVisible', true);
    fixture.detectChanges();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    expect(container.querySelector('iframe')).not.toBeNull();
    fixture.componentRef.setInput('currentFeature', { ...refreshed, __fid: 'another-feature' });
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    fixture.componentRef.setInput('showEmbeddedVideos', false);
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('https://www.youtube.com/embed/EH6GNSEvmQE');
  });
  test('does not treat unconfigured links as video and responds to presentation changes', async () => {
    const feature = getFeatureInfo();
    feature.sortedAttributes[0].attributeValue = 'https://www.youtube.com/watch?v=EH6GNSEvmQE';
    const { fixture, container, getByRole } = await setup(feature, true);
    expect(container.querySelector('tm-feature-info-video')).toBeNull();
    expect(container.textContent).toContain('https://www.youtube.com/watch?v=EH6GNSEvmQE');
    const configured = { ...feature, sortedAttributes: feature.sortedAttributes.map(att => ({ ...att, displayType: 'video' as const })) };
    fixture.componentRef.setInput('currentFeature', configured);
    fixture.detectChanges();
    fireEvent.click(getByRole('button', { name: 'Play video' }));
    fixture.detectChanges();
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    fixture.componentRef.setInput('currentFeature', { ...feature, sortedAttributes: feature.sortedAttributes.map(att => ({ ...att, displayType: 'text' as const })) });
    fixture.detectChanges();
    expect(container.querySelector('iframe')).toBeNull();
    expect(frame?.isConnected).toBe(false);
    expect(container.textContent).toContain('https://www.youtube.com/watch?v=EH6GNSEvmQE');
  });

});
