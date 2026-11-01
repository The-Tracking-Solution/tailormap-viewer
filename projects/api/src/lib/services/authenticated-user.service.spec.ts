import { describe, test, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpContext, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { throwError } from 'rxjs';
import { AuthenticatedUserService, SKIP_FORBIDDEN_LOGIN_REDIRECT } from './authenticated-user.service';
import { TAILORMAP_SECURITY_API_V1_SERVICE } from './tailormap-security-api-v1.service.injection-token';

const check = (status: number, optional: boolean) => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: TAILORMAP_SECURITY_API_V1_SERVICE, useValue: {} }] });
  const service = TestBed.inject(AuthenticatedUserService);
  service.setUserDetails({ isAuthenticated: true, username: 'alice' });
  const login = vi.fn();
  const context = new HttpContext().set(SKIP_FORBIDDEN_LOGIN_REDIRECT, optional);
  const request = new HttpRequest('GET', '/api/app/test/user/start-extent', { context });
  service.createSecurityInterceptor(login)(request, {
    handle: () => throwError(() => new HttpErrorResponse({ status })),
  }).subscribe({ error: () => {} });
  return login;
};

describe('Optional feature errors and authentication redirects', () => {
  test('a forbidden optional preference never sends an authenticated user to login', () => {
    expect(check(403, true)).not.toHaveBeenCalled();
  });
  test('normal forbidden application requests still show the login/access screen', () => {
    expect(check(403, false)).toHaveBeenCalledOnce();
  });
  test('an expired session still requires login even on an optional preference request', () => {
    expect(check(401, true)).toHaveBeenCalledOnce();
  });
});
