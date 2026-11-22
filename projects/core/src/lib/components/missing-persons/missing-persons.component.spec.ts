import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AuthenticatedUserService, MissingCase, MissingPersonsApiService } from '@tailormap-viewer/api';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { expect, test, vi } from 'vitest';
import { MenubarService } from '../menubar';
import { selectViewerId } from '../../state/core.selectors';
import { getMapServiceMock } from '../../test-helpers/map-service.mock';
import { MissingPersonsComponent } from './missing-persons.component';

function setup() {
  const visible = new BehaviorSubject(false);
  const user = new BehaviorSubject({ isAuthenticated: true, username: 'test' });
  const config = { organisations: [{ id: 'a', label: 'Alpha', member: true }, { id: 'b', label: 'Bravo', member: false }],
    retainExactLocations: true, statisticsRetentionDays: 14 };
  const api = {
    configuration$: vi.fn(() => of(config)), cases$: vi.fn(() => of([])), statistics$: vi.fn(() => of([])),
    case$: vi.fn(), save$: vi.fn(), close$: vi.fn(), photo$: vi.fn(),
  };
  const menu = { isComponentVisible$: () => visible, registerComponent: vi.fn(), deregisterComponent: vi.fn(), setMobilePanelHeight: vi.fn() };
  const fixture = TestBed.configureTestingModule({ providers: [
    provideMockStore({ selectors: [{ selector: selectViewerId, value: 'app/test' }] }),
    { provide: AuthenticatedUserService, useValue: { getUserDetails$: () => user } },
    { provide: MissingPersonsApiService, useValue: api }, { provide: MenubarService, useValue: menu }, getMapServiceMock().provider,
  ] }).createComponent(MissingPersonsComponent);
  fixture.detectChanges(); visible.next(true); fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api, user, visible };
}

test('starts with the own organisation, permits unknown age and never invents a walking speed', () => {
  const { component, fixture } = setup();
  component.create(); fixture.detectChanges();
  expect(component.form.controls.organisations.value).toEqual(['a']);
  expect(component.form.controls.speedKmh.value).toBeNull();
  expect(component.form.controls.age.value).toBeNull();
  expect(fixture.nativeElement.querySelector('input[type="datetime-local"]')).toBeTruthy();
});

test('cancels an earlier case request and clears personal data when switching or logging out', () => {
  const { component, api, user } = setup();
  const pending = new Subject<MissingCase>(); api.case$.mockReturnValue(pending);
  component.open('old'); component.create();
  pending.next({ id: 'old' } as MissingCase);
  expect(component.selected()).toBeNull();
  component.form.controls.name.setValue('Private name');
  user.next({ isAuthenticated: false, username: '' });
  expect(component.form.controls.name.value).toBe('');
  expect(component.editing()).toBe(false);
  expect(component.cases()).toEqual([]);
});

test('changing a walking speed invalidates the previous confirmation', () => {
  const { component } = setup();
  component.create(); component.form.controls.speedConfirmed.setValue(true);
  component.form.controls.speedKmh.setValue(3);
  expect(component.form.controls.speedConfirmed.value).toBe(false);
});
