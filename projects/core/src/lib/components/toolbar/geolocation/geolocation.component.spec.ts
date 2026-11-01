import { TestBed } from '@angular/core/testing';
import { MapFollowService } from '../../../services/map-follow.service';
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import { GeolocationComponent } from './geolocation.component';
import { LoadingStateEnum } from '@tailormap-viewer/shared';
import userEvent from '@testing-library/user-event';
import { getMapServiceMock } from '../../../test-helpers/map-service.mock';
import { provideMockStore } from '@ngrx/store/testing';
import { selectComponentsConfig, selectViewerLoadingState } from '../../../state/core.selectors';

describe('GeolocationComponent', () => {
  test('renders and properly zooms to coordinates', async () => {
    const mapService = getMapServiceMock();
    const watchPosition = vi.fn((success: PositionCallback, error: PositionErrorCallback | null | undefined) => {
        queueMicrotask(() => success({
            coords: {
                accuracy: 120,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                latitude: 52.1189998,
                longitude: 5.0429566,
                speed: null,
                toJSON() { return this; },
            },
            timestamp: 1,
            toJSON() { return this; },
        }));

        return 1;
    });

    Object.defineProperty(global.navigator, 'geolocation', { value: { watchPosition, clearWatch: vi.fn() }, configurable: true });

    await render(GeolocationComponent, {
      providers: [
        mapService.provider,
        provideMockStore({
          selectors: [
            { selector: selectComponentsConfig, value: [] },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
      imports: [],
    });
    const zoomToLocationBtn = screen.getByLabelText('Zoom to location');
    expect(zoomToLocationBtn).toBeInTheDocument();
    await userEvent.click(zoomToLocationBtn);
    expect(mapService.mapService.zoomTo).toHaveBeenCalled();
  });
});


describe('Geolocation following ownership', () => {
  test('yields to feature following, keeps GPS updates from recentering and can reclaim following', async () => {
    const mapService = getMapServiceMock(null, null, { zoomToXY: vi.fn() });
    let positionSuccess: PositionCallback | undefined;
    Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: {
      watchPosition: vi.fn((callback: PositionCallback) => { positionSuccess = callback; return 1; }),
      clearWatch: vi.fn(),
    } });
    const { fixture } = await render(GeolocationComponent, { providers: [
      mapService.provider,
      provideMockStore({ selectors: [
        { selector: selectComponentsConfig, value: [] },
        { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
      ] }),
    ] });
    const component = fixture.componentInstance;
    const follow = TestBed.inject(MapFollowService);
    const position = {
      coords: { longitude: 5, latitude: 52, accuracy: 10 }, timestamp: 1,
    } as GeolocationPosition;
    component.onClick();
    positionSuccess?.(position);
    component.onClick();
    expect(component.isFollowing()).toBe(true);
    follow.start('feature-info');
    expect(component.isFollowing()).toBe(false);
    positionSuccess?.(position);
    expect(mapService.mapService.zoomToXY).not.toHaveBeenCalled();
    component.onClick();
    expect(follow.owner()).toBe('geolocation');
    positionSuccess?.(position);
    expect(mapService.mapService.zoomToXY).toHaveBeenCalled();
    fixture.destroy();
    expect(follow.owner()).toBeNull();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(1);
  });
});
