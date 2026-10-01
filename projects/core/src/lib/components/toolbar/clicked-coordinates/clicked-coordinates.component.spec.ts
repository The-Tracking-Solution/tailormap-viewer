import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/angular';
import { ClickedCoordinatesComponent } from './clicked-coordinates.component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { provideMockStore } from '@ngrx/store/testing';
import { getMapServiceMock } from '../../../test-helpers/map-service.mock';
import { selectMapSettings } from '../../../map/state/map.selectors';
import { getFullInitialAppState } from '../../../test-helpers/full-app-state.mock';
import { BehaviorSubject } from 'rxjs';
import { BaseComponentTypeEnum } from '@tailormap-viewer/api';
import { selectComponentsConfig, selectViewerLoadingState } from '../../../state/core.selectors';
import { LoadingStateEnum } from '@tailormap-viewer/shared';

const rdMapSettings = {
  crs: {
    code: 'EPSG:28992',
    bounds: { minx: 482, miny: 306602, maxx: 284182, maxy: 637049 },
  },
  maxExtent: { minx: 482, miny: 306602, maxx: 284182, maxy: 637049 },
};

describe('ClickedCoordinatesComponent', () => {
  test('should render button', async () => {
    const mapServiceMock = getMapServiceMock();
    await render(ClickedCoordinatesComponent, {
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      imports: [],
      providers: [
        mapServiceMock.provider,
        provideMockStore({
          initialState: getFullInitialAppState(),
          selectors: [
            { selector: selectMapSettings, value: { crs: { code: 'EPSG:4326' }, maxExtent: { minx: -180, miny: -90, maxx: 180, maxy: 90 } } },
            { selector: selectComponentsConfig, value: [] },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
    });
    expect(mapServiceMock.createTool$).toHaveBeenCalled();
    expect(screen.getByLabelText('Coordinate picker')).toBeInTheDocument();
  });

  test('keeps legacy rounded map coordinates when no display configuration exists', async () => {
    const mapClick$ = new BehaviorSubject<any>(null);
    const mapServiceMock = getMapServiceMock(
      () => ({ id: 'map-click', mapClick$ }),
      'EPSG:28992',
      { getRoundedCoordinates$: (coordinates: [number, number]) => new BehaviorSubject([ coordinates[0].toFixed(1), coordinates[1].toFixed(1) ]) },
    );

    await render(ClickedCoordinatesComponent, {
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        mapServiceMock.provider,
        provideMockStore({
          initialState: getFullInitialAppState(),
          selectors: [
            { selector: selectMapSettings, value: rdMapSettings },
            { selector: selectComponentsConfig, value: [] },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
    });

    mapClick$.next({ mapCoordinates: [ 155000, 463000 ] });
    expect((screen.getByLabelText('X-coordinate') as HTMLInputElement).value).toBe('155000.0');
    expect((screen.getByLabelText('Y-coordinate') as HTMLInputElement).value).toBe('463000.0');
  });

  test('shows a clicked RD point as configured WGS84 decimal degrees', async () => {
    const mapClick$ = new BehaviorSubject<any>(null);
    const mapServiceMock = getMapServiceMock(
      () => ({ id: 'map-click', mapClick$ }),
      'EPSG:28992',
    );

    await render(ClickedCoordinatesComponent, {
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        mapServiceMock.provider,
        provideMockStore({
          initialState: getFullInitialAppState(),
          selectors: [
            { selector: selectMapSettings, value: rdMapSettings },
            {
              selector: selectComponentsConfig,
              value: [{
                type: BaseComponentTypeEnum.COORDINATE_PICKER,
                config: { enabled: true, projection: 'EPSG:4326', format: 'decimal-degrees' },
              }],
            },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
    });

    mapClick$.next({ mapCoordinates: [ 155000, 463000 ] });
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('52.155174° N');
    expect((screen.getByLabelText('Longitude') as HTMLInputElement).value).toBe('5.387206° E');
  });

  test('transforms configured WGS84 DDM input back to the map CRS before zooming', async () => {
    const mapServiceMock = getMapServiceMock(undefined, 'EPSG:28992');
    const rendered = await render(ClickedCoordinatesComponent, {
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        mapServiceMock.provider,
        provideMockStore({
          initialState: getFullInitialAppState(),
          selectors: [
            { selector: selectMapSettings, value: rdMapSettings },
            {
              selector: selectComponentsConfig,
              value: [{
                type: BaseComponentTypeEnum.COORDINATE_PICKER,
                config: { enabled: true, projection: 'EPSG:4326', format: 'degrees-decimal-minutes' },
              }],
            },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
    });

    const component = rendered.fixture.componentInstance;
    component.coordinatesForm.patchValue({ x: "52° 09.310' N", y: "005° 23.232' E" });
    component.goTo();

    expect(mapServiceMock.mapService.zoomTo).toHaveBeenCalledTimes(1);
    const [ wkt, crs ] = mapServiceMock.mapService.zoomTo.mock.calls[0];
    expect(crs).toBe('EPSG:28992');
    const match = wkt.match(/^POINT\(([-0-9.]+) ([-0-9.]+)\)$/);
    expect(match).not.toBeNull();
    expect(Math.abs(Number(match?.[1]) - 155000)).toBeLessThan(2);
    expect(Math.abs(Number(match?.[2]) - 463000)).toBeLessThan(2);
  });

  test('rejects configured coordinates outside the application bounds', async () => {
    const mapServiceMock = getMapServiceMock(undefined, 'EPSG:28992');
    const rendered = await render(ClickedCoordinatesComponent, {
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        mapServiceMock.provider,
        provideMockStore({
          initialState: getFullInitialAppState(),
          selectors: [
            { selector: selectMapSettings, value: rdMapSettings },
            {
              selector: selectComponentsConfig,
              value: [{
                type: BaseComponentTypeEnum.COORDINATE_PICKER,
                config: { enabled: true, projection: 'EPSG:4326', format: 'decimal-degrees' },
              }],
            },
            { selector: selectViewerLoadingState, value: LoadingStateEnum.LOADED },
          ],
        }),
      ],
    });

    const component = rendered.fixture.componentInstance;
    component.coordinatesForm.patchValue({ x: '0° N', y: '0° E' });
    expect(component.coordinatesForm.invalid).toBe(true);
    component.goTo();
    expect(mapServiceMock.mapService.zoomTo).not.toHaveBeenCalled();
  });
});
