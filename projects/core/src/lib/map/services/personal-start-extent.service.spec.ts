import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { inject } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthenticatedUserService, MapResponseModel, SecurityModel, SKIP_FORBIDDEN_LOGIN_REDIRECT, TAILORMAP_SECURITY_API_V1_SERVICE } from '@tailormap-viewer/api';
import { MapService } from '@tailormap-viewer/map';
import { BehaviorSubject, of, ReplaySubject, Subject } from 'rxjs';
import { PersonalStartExtentService } from './personal-start-extent.service';

const response = {
  crs: { code: 'EPSG:3857', definition: '' },
  initialExtent: { minx: 0, miny: 0, maxx: 100, maxy: 100 },
  maxExtent: { minx: -1000, miny: -1000, maxx: 1000, maxy: 1000 },
  services: [], appLayers: [], baseLayerTreeNodes: [], layerTreeNodes: [], terrainLayerTreeNodes: [],
} as MapResponseModel;
const preference = { crs: 'EPSG:3857', center: [ 20, 30 ], zoom: 12, mayEdit: true };
const url = '/api/app/test/user/start-extent';

const setup = (users: Subject<SecurityModel> = new BehaviorSubject<SecurityModel>({ isAuthenticated: true, username: 'alice' })) => {
  const mapService = { getMapViewDetails$: () => of({ center: [ 2, 3 ], zoomLevel: 11.5 }), setInitialPosition: vi.fn(), setInitialExtent: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(), provideHttpClientTesting(),
    { provide: AuthenticatedUserService, useValue: { getUserDetails$: () => users } },
    { provide: MapService, useValue: mapService },
  ] });
  const service = TestBed.inject(PersonalStartExtentService);
  const http = TestBed.inject(HttpTestingController);
  return { service, http, mapService, users };
};

describe('PersonalStartExtentService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  test('loads a personal extent without changing the shared map response', () => {
    const { service, http } = setup();
    let result: MapResponseModel | undefined;
    service.load$('app/test', response).subscribe(value => result = value);
    const request = http.expectOne(url);
    expect(request.request.context.get(SKIP_FORBIDDEN_LOGIN_REDIRECT)).toBe(true);
    request.flush(preference);
    expect(result?.personalStartPosition).toEqual({ center: [ 20, 30 ], zoom: 12 });
    expect(response.initialExtent?.minx).toBe(0);
    expect(service.hasPreference()).toBe(true);
    http.verify();
  });

  test('a locked admin position is applied but user mutations make no HTTP request', () => {
    const { service, http } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush({ ...preference, mayEdit: false });
    expect(received).toHaveBeenCalledWith({ ...response, personalStartPosition: { center: [ 20, 30 ], zoom: 12 } });
    expect(service.available()).toBe(false);
    const saved = vi.fn();
    service.save$().subscribe(saved);
    service.clear$().subscribe(saved);
    expect(saved).toHaveBeenCalledWith(false);
    http.expectNone(url);
    http.verify();
  });

  test('a saved rectangle becomes the initial extent instead of a center/zoom override', () => {
    const { service, http } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush({ crs: 'EPSG:3857', extent: [ 10, 20, 30, 40 ], mayEdit: false });
    expect(received).toHaveBeenCalledWith({ ...response, initialExtent: { minx: 10, miny: 20, maxx: 30, maxy: 40 } });
    expect(service.hasPreference()).toBe(true);
    expect(service.available()).toBe(false);
    http.verify();
  });

  test('an absent preference preserves the application default and enables saving', () => {
    const { service, http } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush({ crs: 'EPSG:3857', mayEdit: true });
    expect(received).toHaveBeenCalledWith(response);
    expect(service.available()).toBe(true);
    expect(service.hasPreference()).toBe(false);
    http.verify();
  });

  test.each([ 403, 404, 500 ])('a failing API (%s) falls back to the default', status => {
    const { service, http } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush({}, { status, statusText: 'Unavailable' });
    expect(received).toHaveBeenCalledWith(response);
    expect(service.available()).toBe(false);
    http.verify();
  });

  test.each([
    { crs: 'EPSG:28992', center: [ 20, 30 ], zoom: 12 },
    { crs: 'EPSG:3857', center: [ 20, 30 ], zoom: 29 },
    { crs: 'EPSG:3857', center: [ 10, 20, 30 ], zoom: 12 },
  ])('ignores incompatible or malformed preferences: %j', value => {
    const { service, http } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush(value);
    expect(received).toHaveBeenCalledWith(response);
    expect(service.hasPreference()).toBe(false);
    http.verify();
  });

  test('anonymous users and service previews never request personal preferences', () => {
    const { service, http, users } = setup();
    service.load$('service/123', response).subscribe();
    users.next({ isAuthenticated: false });
    service.load$('app/test', response).subscribe();
    http.expectNone(url);
    expect(service.available()).toBe(false);
    http.verify();
  });

  test('saves the current extent and updates Home only after a successful write', () => {
    const { service, http, mapService } = setup();
    service.load$('app/test', response).subscribe();
    http.expectOne(url).flush({ crs: 'EPSG:3857', mayEdit: true });
    const saved = vi.fn();
    service.save$().subscribe(saved);
    expect(mapService.setInitialPosition).not.toHaveBeenCalled();
    const write = http.expectOne(url);
    expect(write.request.method).toBe('PUT');
    expect(write.request.body).toEqual({ crs: 'EPSG:3857', center: [ 2, 3 ], zoom: 11.5 });
    write.flush(null, { status: 204, statusText: 'No Content' });
    expect(mapService.setInitialPosition).toHaveBeenCalledWith([ 2, 3 ], 11.5);
    expect(service.hasPreference()).toBe(true);
    expect(saved).toHaveBeenCalledWith(true);
    http.verify();
  });

  test('deleting restores the original Home extent, not the loaded personal extent', () => {
    const { service, http, mapService } = setup();
    service.load$('app/test', response).subscribe();
    http.expectOne(url).flush(preference);
    service.clear$().subscribe();
    const request = http.expectOne(url);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(mapService.setInitialExtent).toHaveBeenCalledWith([ 0, 0, 100, 100 ]);
    expect(service.hasPreference()).toBe(false);
    http.verify();
  });

  test('failed writes preserve the existing Home extent', () => {
    const { service, http, mapService } = setup();
    service.load$('app/test', response).subscribe();
    http.expectOne(url).flush(preference);
    const saved = vi.fn();
    service.save$().subscribe(saved);
    http.expectOne(url).flush({}, { status: 500, statusText: 'Error' });
    expect(saved).toHaveBeenCalledWith(false);
    expect(mapService.setInitialPosition).not.toHaveBeenCalled();
    expect(service.hasPreference()).toBe(true);
    expect(service.busy()).toBe(false);
    http.verify();
  });

  test('a late response from a previous account cannot apply its preference', () => {
    const { service, http, users } = setup();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    users.next({ isAuthenticated: true, username: 'bob' });
    http.expectOne(url).flush(preference);
    expect(received).toHaveBeenCalledWith(response);
    expect(service.hasPreference()).toBe(false);
    expect(service.available()).toBe(false);
    http.verify();
  });

  test('a late save from a previous application cannot update Home', () => {
    const { service, http, mapService } = setup();
    service.load$('app/test', response).subscribe();
    http.expectOne(url).flush(preference);
    service.save$().subscribe();
    const write = http.expectOne(url);
    service.load$('app/other', response).subscribe();
    http.expectOne('/api/app/other/user/start-extent').flush({ crs: 'EPSG:3857', mayEdit: true });
    write.flush(null, { status: 204, statusText: 'No Content' });
    expect(mapService.setInitialPosition).not.toHaveBeenCalled();
    expect(service.hasPreference()).toBe(false);
    http.verify();
  });

  test('works when the initial account is only known after loading starts', () => {
    const users = new ReplaySubject<SecurityModel>(1);
    const { service, http } = setup(users);
    service.load$('app/test', response).subscribe();
    users.next({ isAuthenticated: true, username: 'alice' });
    http.expectOne(url).flush(preference);
    expect(service.available()).toBe(true);
    expect(service.hasPreference()).toBe(true);
    http.verify();
  });
});

describe('Personal preference with the real authentication interceptor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const setupRealInterceptor = () => {
    const login = vi.fn();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([(req, next) =>
        inject(AuthenticatedUserService).createSecurityInterceptor(login)(req, { handle: next })])),
      provideHttpClientTesting(),
      { provide: TAILORMAP_SECURITY_API_V1_SERVICE, useValue: {} },
      { provide: MapService, useValue: { getMapViewDetails$: () => of({ center: [ 2, 3 ], zoomLevel: 11.5 }),
        setInitialPosition: vi.fn(), setInitialExtent: vi.fn() } },
    ] });
    TestBed.inject(AuthenticatedUserService).setUserDetails({ isAuthenticated: true, username: 'alice' });
    return { login, service: TestBed.inject(PersonalStartExtentService), http: TestBed.inject(HttpTestingController) };
  };

  test('an optional preference 403 cannot interrupt application startup with a login redirect', () => {
    const { login, service, http } = setupRealInterceptor();
    const received = vi.fn();
    service.load$('app/test', response).subscribe(received);
    http.expectOne(url).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(received).toHaveBeenCalledWith(response);
    expect(login).not.toHaveBeenCalled();
    expect(service.available()).toBe(false);
    http.verify();
  });

  test('revoked edit permission produces a local failure without opening login', () => {
    const { login, service, http } = setupRealInterceptor();
    service.load$('app/test', response).subscribe();
    http.expectOne(url).flush(preference);
    const saved = vi.fn();
    service.save$().subscribe(saved);
    http.expectOne(url).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(saved).toHaveBeenCalledWith(false);
    expect(login).not.toHaveBeenCalled();
    http.verify();
  });
});
