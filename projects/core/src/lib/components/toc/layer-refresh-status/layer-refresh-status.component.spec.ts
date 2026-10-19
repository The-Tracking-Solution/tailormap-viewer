import { beforeEach, describe, expect, test } from 'vitest';
import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { getAppLayerModel } from '@tailormap-viewer/api';
import { LayerLoadStatusModel } from '@tailormap-viewer/map';
import { ApplicationLayerRefreshService } from '../../../map/services/application-layer-refresh.service';
import { LayerRefreshStatusComponent } from './layer-refresh-status.component';

const loadStatuses = signal<ReadonlyMap<string, LayerLoadStatusModel>>(new Map());
const now = signal(20000);
const nextRefreshAt = signal<ReadonlyMap<string, number>>(new Map());

async function setup(options: { visible?: boolean; inScale?: boolean; in3D?: boolean } = {}, interval = 5) {
  return render(LayerRefreshStatusComponent, {
    inputs: {
      layer: getAppLayerModel({ id: 'live', title: 'Live vehicles', autoRefreshInSeconds: interval }),
      visible: true,
      ...options,
    },
    providers: [{ provide: ApplicationLayerRefreshService, useValue: { loadStatuses, now, nextRefreshAt } }],
  });
}

beforeEach(() => {
  loadStatuses.set(new Map());
  nextRefreshAt.set(new Map([[ 'live', 25000 ]]));
  now.set(20000);
});

describe('LayerRefreshStatusComponent', () => {
  test('exposes last fetch and schedule to keyboard and screen reader users', async () => {
    loadStatuses.set(new Map([[ 'live', { state: 'success', lastSuccessfulLoad: 19000 }]]));
    await setup();
    const indicator = screen.getByRole('img');
    expect(indicator).toHaveTextContent('✓');
    expect(indicator).toHaveAttribute('tabindex', '0');
    expect(indicator.getAttribute('aria-label')).toContain('Last successful fetch');
    expect(indicator.getAttribute('aria-label')).toContain('Next scheduled refresh');
    expect(indicator.getAttribute('aria-label')).toContain('does not confirm the age');
  });

  test('warns after three intervals and recovers after a successful fetch', async () => {
    loadStatuses.set(new Map([[ 'live', { state: 'success', lastSuccessfulLoad: 1000 }]]));
    const result = await setup();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Display may be outdated/);
    loadStatuses.set(new Map([[ 'live', { state: 'success', lastSuccessfulLoad: 20000 }]]));
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveTextContent('✓');
  });

  test('shows a recent partial failure in the tooltip without an early warning icon', async () => {
    loadStatuses.set(new Map([[ 'live', { state: 'error', lastSuccessfulLoad: 19000 }]]));
    await setup();
    expect(screen.getByRole('img')).toHaveAccessibleName(/partially failed/);
    expect(screen.getByRole('img')).toHaveTextContent('…');
    expect(screen.getByRole('img')).not.toHaveClass('refresh-warning');
  });

  test('does not claim a planned image fetch for hidden or out-of-scale layers', async () => {
    const result = await setup({ visible: false });
    expect(screen.getByRole('img')).toHaveAccessibleName(/Layer hidden/);
    expect(screen.getByRole('img')).toHaveAccessibleName(/No refresh scheduled/);
    result.fixture.componentRef.setInput('visible', true);
    result.fixture.componentRef.setInput('inScale', false);
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Outside scale range/);
  });

  test('does not report unsupported sources or 3D as healthy', async () => {
    const result = await setup();
    expect(screen.getByRole('img')).toHaveTextContent('?');
    result.fixture.componentRef.setInput('in3D', true);
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveAccessibleName(/not supported in 3D/);
  });

  test('labels an overdue schedule after inactivity without inventing a new fetch', async () => {
    now.set(30000);
    await setup();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Refresh overdue/);
  });
  test.each([ 15, 300 ])('warns exactly after three intervals for a %s-second layer', async interval => {
    loadStatuses.set(new Map([[ 'live', {
      state: 'error', lastSuccessfulLoad: 1000, monitoringStartedAt: 0,
    }]]));
    const deadline = 1000 + 3 * interval * 1000;
    now.set(deadline - 1);
    const result = await setup({}, interval);
    expect(screen.getByRole('img')).not.toHaveClass('refresh-warning');
    expect(screen.getByRole('img')).toHaveAccessibleName(/partially failed/);
    now.set(deadline);
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveTextContent('!');
    expect(screen.getByRole('img')).toHaveClass('refresh-warning');
    loadStatuses.set(new Map([[ 'live', {
      state: 'success', lastSuccessfulLoad: deadline, monitoringStartedAt: 0,
    }]]));
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveTextContent('✓');
    expect(screen.getByRole('img')).not.toHaveClass('refresh-warning');
  });

  test('warns from activation when no request has ever succeeded', async () => {
    loadStatuses.set(new Map([[ 'live', { state: 'loading', monitoringStartedAt: 1000 }]]));
    now.set(45999);
    const result = await setup({}, 15);
    expect(screen.getByRole('img')).toHaveTextContent('↻');
    now.set(46000);
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveTextContent('!');
    expect(screen.getByRole('img')).toHaveAccessibleName(/Not yet confirmed/);
  });

  test('starts a fresh warning window after a hidden layer is activated again', async () => {
    loadStatuses.set(new Map([[ 'live', {
      state: 'waiting', lastSuccessfulLoad: 1000, monitoringStartedAt: 100000,
    }]]));
    now.set(100001);
    await setup({}, 15);
    expect(screen.getByRole('img')).not.toHaveClass('refresh-warning');
  });

  test('keeps fetching visible with a recent failure but delays the exclamation until the deadline', async () => {
    loadStatuses.set(new Map([[ 'live', {
      state: 'error', lastSuccessfulLoad: 1000, lastFailure: 2000,
      pendingRequests: 1, monitoringStartedAt: 0,
    }]]));
    now.set(2000);
    const result = await setup({}, 15);
    expect(screen.getByRole('img')).toHaveTextContent('↻');
    expect(screen.getByRole('img')).toHaveAccessibleName(/Fetching WMS image/);
    expect(screen.getByRole('img')).toHaveAccessibleName(/partially failed/);
    now.set(46000);
    result.fixture.detectChanges();
    expect(screen.getByRole('img')).toHaveTextContent('!');
  });

});
