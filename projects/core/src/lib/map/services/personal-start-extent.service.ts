import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { AuthenticatedUserService, BoundsModel, MapResponseModel, TailormapApiConstants, SKIP_FORBIDDEN_LOGIN_REDIRECT } from '@tailormap-viewer/api';
import { MapService } from '@tailormap-viewer/map';
import { catchError, distinctUntilChanged, finalize, map, Observable, of, switchMap, take, timeout } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface PersonalStartExtentModel {
  crs: string;
  center?: number[] | null;
  zoom?: number | null;
  mayEdit?: boolean;
  extent?: number[] | null;
}

interface ExtentContext {
  id: string;
  crs: string;
  defaultExtent: number[];
}

@Injectable({ providedIn: 'root' })
export class PersonalStartExtentService {
  private http = inject(HttpClient);
  private mapService = inject(MapService);
  private userService = inject(AuthenticatedUserService);
  private destroyRef = inject(DestroyRef);
  private context: ExtentContext | null = null;
  private generation = 0;
  private userIdentity: string | undefined;

  public readonly available = signal(false);
  public readonly hasPreference = signal(false);
  public readonly busy = signal(false);

  constructor() {
    this.userService.getUserDetails$().pipe(
      map(user => JSON.stringify([ user.isAuthenticated, user.username, user.organisation ])),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(identity => {
      if (this.userIdentity === undefined) {
        this.userIdentity = identity;
        return;
      }
      this.userIdentity = identity;
      if (this.context) {
        this.mapService.setInitialExtent(this.context.defaultExtent);
      }
      this.generation++;
      this.context = null;
      this.available.set(false);
      this.hasPreference.set(false);
      this.busy.set(false);
    });
  }

  public load$(id: string, response: MapResponseModel): Observable<MapResponseModel> {
    const generation = ++this.generation;
    this.context = null;
    this.available.set(false);
    this.hasPreference.set(false);
    this.busy.set(false);
    return this.userService.getUserDetails$().pipe(
      take(1),
      switchMap(user => {
        if (!user.isAuthenticated || !id.startsWith('app/')) {
          return of(response);
        }
        const context: ExtentContext = {
          id,
          crs: response.crs.code,
          defaultExtent: this.toArray(response.initialExtent ?? response.maxExtent),
        };
        return this.http.get<PersonalStartExtentModel | null>(this.url(id), this.requestOptions()).pipe(
          timeout(5000),
          map(preference => {
            if (generation !== this.generation) {
              return response;
            }
            const rectangle = this.hasValidExtent(preference, context.crs);
            const center = this.isValid(preference, context.crs);
            const valid = rectangle || center;
            if (generation === this.generation) {
              this.context = context;
              this.available.set(preference?.mayEdit === true);
              this.hasPreference.set(valid);
            }
            if (rectangle) {
              return { ...response, initialExtent: { minx: preference.extent[0], miny: preference.extent[1],
                maxx: preference.extent[2], maxy: preference.extent[3] } };
            }
            return center ? { ...response, personalStartPosition: { center: preference.center, zoom: preference.zoom } } : response;
          }),
          // An older API, a timeout or a source failure must not prevent the map opening.
          catchError(() => of(response)),
        );
      }),
    );
  }

  public save$(): Observable<boolean> {
    const context = this.context;
    const generation = this.generation;
    if (!context || !this.available() || this.busy()) {
      return of(false);
    }
    this.busy.set(true);
    return this.mapService.getMapViewDetails$().pipe(
      take(1),
      map(view => ({ crs: context.crs, center: view.center, zoom: view.zoomLevel })),
      switchMap(preference => {
        if (!this.isValid(preference, context.crs)) {
          return of(false);
        }
        return this.http.put<void>(this.url(context.id), preference, this.requestOptions()).pipe(
          timeout(10000),
          map(() => {
            if (generation !== this.generation) {
              return false;
            }
            this.hasPreference.set(true);
            this.mapService.setInitialPosition(preference.center, preference.zoom);
            return true;
          }),
        );
      }),
      catchError(() => of(false)),
      finalize(() => {
        if (generation === this.generation) {
          this.busy.set(false);
        }
      }),
    );
  }

  public clear$(): Observable<boolean> {
    const context = this.context;
    const generation = this.generation;
    if (!context || !this.available() || this.busy()) {
      return of(false);
    }
    this.busy.set(true);
    return this.http.delete<void>(this.url(context.id), this.requestOptions()).pipe(
      timeout(10000),
      map(() => {
        if (generation !== this.generation) {
          return false;
        }
        this.hasPreference.set(false);
        this.mapService.setInitialExtent(context.defaultExtent);
        return true;
      }),
      catchError(() => of(false)),
      finalize(() => {
        if (generation === this.generation) {
          this.busy.set(false);
        }
      }),
    );
  }

  private requestOptions() {
    return { context: new HttpContext().set(SKIP_FORBIDDEN_LOGIN_REDIRECT, true) };
  }

  private url(id: string) {
    return `${TailormapApiConstants.BASE_URL}/${id}/user/start-extent`;
  }

  private hasValidExtent(preference: PersonalStartExtentModel | null, crs: string):
    preference is PersonalStartExtentModel & { extent: number[] } {
    const e = preference?.extent;
    return preference?.crs === crs && Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)
      && e[0] < e[2] && e[1] < e[3] && preference.center == null && preference.zoom == null;
  }

  private isValid(preference: PersonalStartExtentModel | null, crs: string):
    preference is PersonalStartExtentModel & { center: number[]; zoom: number } {
    const center = preference?.center;
    const zoom = preference?.zoom;
    return preference?.crs === crs && preference.extent == null && Array.isArray(center) && center.length === 2
      && center.every(value => typeof value === 'number' && Number.isFinite(value))
      && typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 0 && zoom <= 28;
  }

  private toArray(bounds: BoundsModel | null): number[] {
    return bounds ? [ bounds.minx, bounds.miny, bounds.maxx, bounds.maxy ] : [];
  }
}
