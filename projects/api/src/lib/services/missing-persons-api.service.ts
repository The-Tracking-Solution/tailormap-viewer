import { inject, Service } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { TailormapApiConstants } from './tailormap-api.constants';
import { SKIP_FORBIDDEN_LOGIN_REDIRECT } from './authenticated-user.service';
import {
  MissingCase, MissingCaseInput, MissingCloseInput, MissingConfiguration, MissingSearchArea, MissingStatistic,
} from '../models/missing-persons.model';

/** No application or personal case data is cached in this client. */
@Service()
export class MissingPersonsApiService {
  private readonly http = inject(HttpClient);
  private readonly options = { context: new HttpContext().set(SKIP_FORBIDDEN_LOGIN_REDIRECT, true) };

  private url(app: string, suffix: string): string {
    const name = app.startsWith('app/') ? app.slice(4) : app;
    return `${TailormapApiConstants.BASE_URL}/app/${encodeURIComponent(name)}/missing-persons/${suffix}`;
  }

  public configuration$(app: string) { return this.http.get<MissingConfiguration>(this.url(app, 'configuration'), this.options); }
  public cases$(app: string) { return this.http.get<MissingCase[]>(this.url(app, 'cases'), this.options); }
  public statistics$(app: string) { return this.http.get<MissingStatistic[]>(this.url(app, 'statistics'), this.options); }
  public case$(app: string, id: string) { return this.http.get<MissingCase>(this.url(app, `cases/${encodeURIComponent(id)}`), this.options); }
  public save$(app: string, body: MissingCaseInput, id?: string) {
    return id
      ? this.http.put<MissingCase>(this.url(app, `cases/${encodeURIComponent(id)}`), body, this.options)
      : this.http.post<MissingCase>(this.url(app, 'cases'), body, this.options);
  }
  public area$(app: string, id: string) { return this.http.get<MissingSearchArea>(this.url(app, `cases/${encodeURIComponent(id)}/search-area`), this.options); }
  public photo$(app: string, id: string) {
    return this.http.get(this.url(app, `cases/${encodeURIComponent(id)}/photo`), { ...this.options, responseType: 'blob' });
  }
  public upload$(app: string, id: string, version: number, file: File) {
    const body = new FormData();
    body.append('photo', file);
    return this.http.post<void>(this.url(app, `cases/${encodeURIComponent(id)}/photo`), body, {
      ...this.options, params: { version },
    });
  }
  public event$(app: string, id: string, version: number, kind: string, body: string) {
    return this.http.post<void>(this.url(app, `cases/${encodeURIComponent(id)}/events`), { version, kind, body }, this.options);
  }
  public close$(app: string, id: string, body: MissingCloseInput) {
    return this.http.post<{ closed: boolean; privacyCompleted: boolean }>(this.url(app, `cases/${encodeURIComponent(id)}/close`), body, this.options);
  }
}
