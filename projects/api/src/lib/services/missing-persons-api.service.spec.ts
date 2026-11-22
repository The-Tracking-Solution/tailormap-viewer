import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { expect, test } from 'vitest';
import { MissingPersonsApiService } from './missing-persons-api.service';
import { SKIP_FORBIDDEN_LOGIN_REDIRECT } from './authenticated-user.service';

test('uses the Tailormap composite viewer id once and handles forbidden access locally', () => {
  TestBed.configureTestingModule({ providers: [ provideHttpClient(), provideHttpClientTesting() ] });
  const api = TestBed.inject(MissingPersonsApiService);
  const http = TestBed.inject(HttpTestingController);
  api.configuration$('app/test').subscribe();
  const request = http.expectOne('/api/app/test/missing-persons/configuration');
  expect(request.request.context.get(SKIP_FORBIDDEN_LOGIN_REDIRECT)).toBe(true);
  request.flush({ organisations: [], retainExactLocations: false, statisticsRetentionDays: 14 });
  http.verify();
});

test('puts private event text in the body and only opaque case IDs in the URL', () => {
  TestBed.configureTestingModule({ providers: [ provideHttpClient(), provideHttpClientTesting() ] });
  const api = TestBed.inject(MissingPersonsApiService);
  const http = TestBed.inject(HttpTestingController);
  api.event$('app/test', 'case-1', 4, 'police', 'Private contact').subscribe();
  const request = http.expectOne('/api/app/test/missing-persons/cases/case-1/events');
  expect(request.request.body).toEqual({ version: 4, kind: 'police', body: 'Private contact' });
  expect(request.request.method).toBe('POST');
  request.flush(null); http.verify();
});
