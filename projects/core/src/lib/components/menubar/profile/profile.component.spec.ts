import { describe, beforeAll, afterAll, test, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/angular';
import { ProfileComponent } from './profile.component';
import { provideMockStore } from '@ngrx/store/testing';
import { selectShowLanguageSwitcher, selectShowLoginButton } from '../../../state/core.selectors';
import { Router } from '@angular/router';
import { AuthenticatedUserService } from '@tailormap-viewer/api';
import { APP_BASE_HREF } from '@angular/common';
import { AuthenticatedUserTestHelper } from '../../../test-helpers/authenticated-user-test.helper';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { PersonalStartExtentService } from '../../../map/services/personal-start-extent.service';
import { MobileLayoutService } from '../../../services/viewer-layout/mobile-layout.service';

const setup = async (loggedIn: boolean, showLoginButton = true, personalExtentAvailable = false) => {
  const navigateFn = vi.fn();
  const store = provideMockStore({
    selectors: [
      { selector: selectShowLoginButton, value: showLoginButton },
      { selector: selectShowLanguageSwitcher, value: false },
    ],
  });
  const userService = AuthenticatedUserTestHelper.getAuthenticatedUserService(loggedIn, [], loggedIn ? 'testusername' : undefined);
  const mockMobileLayoutService = { isMobileLayoutEnabled$: of(false) };
  const extentService = {
    available: signal(personalExtentAvailable), hasPreference: signal(true), busy: signal(false),
    save$: vi.fn(() => of(true)), clear$: vi.fn(() => of(true)),
  };
  await render(ProfileComponent, {
    providers: [
      { provide: PersonalStartExtentService, useValue: extentService },
      { provide: APP_BASE_HREF, useValue: '' },
      store,
      { provide: AuthenticatedUserService, useValue: userService },
      { provide: Router, useValue: { navigateByUrl: navigateFn } },
      { provide: MobileLayoutService, useValue: mockMobileLayoutService },
    ],
    imports: [
      ],
  });
  return { navigateFn, userService, extentService };
};

describe('ProfileComponent', () => {

  const { location } = window;

  beforeAll(() => {
    // @ts-expect-error deleting location is allowed in testing env, restored after tests
    delete window.location;
    // @ts-expect-error overwriting location is allowed in testing env, restored after tests
    window.location = { reload: vi.fn() };
  });

  afterAll(() => {
    // @ts-expect-error restoring the original location, allowed in testing env
    window.location = location;
  });

  test('should render without login', async () => {
    const { navigateFn } = await setup(false);
    const button = await screen.getByRole('button');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    const menuItem = await screen.findByText(/Login/);
    fireEvent.click(menuItem);
    expect(navigateFn).toHaveBeenCalledWith('/login', { 'state': { 'routeBeforeLogin': undefined } });
  });

  test('should render when logged in', async () => {
    const { userService } = await setup(true);
    vi.spyOn(window.location, 'reload');
    const button = await screen.getByRole('button');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText('Logged in as')).toBeInTheDocument();
    expect(await screen.findByText(/testusername/)).toBeInTheDocument();
    const menuItem = await screen.findByText(/Logout/);
    fireEvent.click(menuItem);
    expect(userService.logout$).toHaveBeenCalled();
    expect(window.location.reload).toHaveBeenCalled();
    userService.getUserDetailsMock.next({ isAuthenticated: false, roles: [], username: undefined });
    fireEvent.click(button);
    expect(await screen.findByText('Login')).toBeInTheDocument();
  });

  test('saves and clears the personal extent from the profile menu', async () => {
    const { extentService } = await setup(true, true, true);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(await screen.findByText('Use current map as personal start position'));
    expect(extentService.save$).toHaveBeenCalledOnce();
    const savedMessage = await screen.findByText('Personal start position saved');
    expect(savedMessage.closest('.mat-mdc-snack-bar-container')).toHaveClass('snack-bar-message-panel');
    fireEvent.click(button);
    fireEvent.click(await screen.findByText('Clear personal start position'));
    expect(extentService.clear$).toHaveBeenCalledOnce();
    const clearedMessage = await screen.findByText('Application start position restored');
    expect(clearedMessage.closest('.mat-mdc-snack-bar-container')).toHaveClass('snack-bar-message-panel');
  });

  test('does not show preference controls to anonymous users', async () => {
    await setup(false, true, true);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Use current map as personal start position')).not.toBeInTheDocument();
  });

  test('should render without login button if configured to hide login button', async () => {
    await setup(false, false);
    expect(screen.queryByText(/Login/)).not.toBeInTheDocument();
  });

});
