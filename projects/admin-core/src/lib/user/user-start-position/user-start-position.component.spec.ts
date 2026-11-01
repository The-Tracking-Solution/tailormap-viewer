import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ConfirmDialogService } from '@tailormap-viewer/shared';
import { UserModel } from '@tailormap-admin/admin-api';
import { UserStartPositionComponent } from './user-start-position.component';

const app = { id: '7', name: 'coast', title: 'Coast', crs: 'EPSG:3857', enabled: true };
const url = '/api/admin/applications/7/user-start-position/alice';
const mapUrl = '/api/app/coast/map';
const base = '/api/admin/users/alice/start-position-applications';
const position = { crs: app.crs, center: [ 100, 200 ], zoom: 12.5, mayEdit: false };
const user = { username: 'alice', groupNames: ['customer'] } as UserModel;
const setup = () => {
  TestBed.configureTestingModule({ imports: [UserStartPositionComponent], providers: [ provideHttpClient(), provideHttpClientTesting() ] });
  const fixture = TestBed.createComponent(UserStartPositionComponent);
  const component = fixture.componentInstance;
  const http = TestBed.inject(HttpTestingController);
  component.user = user;
  http.expectOne(base).flush([app]);
  return { component, http, fixture };
};
const finishLoad = (http: HttpTestingController, p = position) => {
  http.expectOne(url).flush(p); http.expectOne(mapUrl).flush(null);
};

describe('Start positions in user administration', () => {
  beforeEach(() => TestBed.resetTestingModule());

  test('uses only the server-filtered application list and restores an existing center/zoom', () => {
    const { component, http } = setup(); finishLoad(http);
    expect(component.applications()).toEqual([app]);
    expect(component.form.getRawValue()).toEqual({ x: 100, y: 200, zoom: 12.5, mayEdit: false });
    expect(component.dirty()).toBe(false); http.verify();
  });

  test('enables the primary save button only for valid unsaved changes and disables it after saving', () => {
    const { component, http, fixture } = setup(); finishLoad(http); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('color')).toBe('primary');
    component.save(); http.expectNone(url);
    component.form.patchValue({ zoom: 13 }); fixture.detectChanges();
    expect(button.disabled).toBe(false);
    component.save(); fixture.detectChanges();
    expect(button.disabled).toBe(true);
    http.expectOne(url).flush(null); fixture.detectChanges();
    expect(button.disabled).toBe(true); http.verify();
  });

  test('saves a rectangle separately from center/zoom with the same per-app edit permission', () => {
    const { component, http } = setup(); finishLoad(http);
    component.form.patchValue({ mayEdit: true });
    component.choosePosition({ center: null, zoom: null, extent: [ 1, 2, 3, 4 ] });
    component.save();
    const r = http.expectOne(url);
    expect(r.request.body).toEqual({ crs: app.crs, center: null, zoom: null, extent: [ 1, 2, 3, 4 ], mayEdit: true });
    r.flush(null); expect(component.dirty()).toBe(false); http.verify();
  });

  test('can clear the position without revoking permission', () => {
    const { component, http } = setup(); finishLoad(http);
    component.form.patchValue({ mayEdit: true }); component.clearPosition(); component.save();
    const r = http.expectOne(url);
    expect(r.request.body).toEqual({ crs: app.crs, center: null, zoom: null, extent: null, mayEdit: true });
    r.flush(null); http.verify();
  });

  test('a user profile update without group changes does not discard unsaved start input', () => {
    const { component, http } = setup(); finishLoad(http);
    component.choosePosition({ center: [ 300, 400 ], zoom: 14 });
    component.user = { ...user, email: 'new@example.org' };
    expect(component.form.controls.x.value).toBe(300); expect(component.dirty()).toBe(true);
    http.expectNone(base); http.verify();
  });

  test('a late response for the old user never overwrites the new user selection', () => {
    const { component, http } = setup();
    const alice = http.expectOne(url); const map = http.expectOne(mapUrl);
    component.user = { ...user, username: 'bob' };
    http.expectOne('/api/admin/users/bob/start-position-applications').flush([]);
    alice.flush(position); map.flush(null);
    expect(component.loaded()).toBe(false); expect(component.applications()).toEqual([]); http.verify();
  });

  test('cancelling an application switch preserves the unsaved draft', () => {
    const { component, http } = setup(); finishLoad(http);
    component.choosePosition({ center: [ 300, 400 ], zoom: 14 });
    vi.spyOn(TestBed.inject(ConfirmDialogService), 'confirm$').mockReturnValue(of(false));
    component.applicationId.setValue('other');
    expect(component.applicationId.value).toBe('7');
    expect(component.form.controls.x.value).toBe(300); expect(component.dirty()).toBe(true);
    http.verify();
  });

  test('failed saves preserve the edited fields and allow retry', () => {
    const { component, http } = setup(); finishLoad(http);
    component.choosePosition({ center: [ 300, 400 ], zoom: 14 }); component.save();
    http.expectOne(url).flush({}, { status: 400, statusText: 'Bad Request' });
    expect(component.form.controls.x.value).toBe(300); expect(component.dirty()).toBe(true);
    expect(component.form.enabled).toBe(true); http.verify();
  });
});
