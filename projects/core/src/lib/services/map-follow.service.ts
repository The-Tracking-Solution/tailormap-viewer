import { DestroyRef, inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MapService } from '@tailormap-viewer/map';

export type MapFollowOwner = 'geolocation' | 'feature-info';

/** Coordinates mutually exclusive followers without changing their position sources or refresh intervals. */
@Injectable({ providedIn: 'root' })
export class MapFollowService {
  private ownerSubject = new BehaviorSubject<MapFollowOwner | null>(null);
  public owner$ = this.ownerSubject.asObservable();
  public owner = toSignal(this.owner$, { requireSync: true });

  constructor() {
    inject(MapService).getPointerDrag$().pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.ownerSubject.next(null));
  }

  public start(owner: MapFollowOwner): void {
    this.ownerSubject.next(owner);
  }

  public stop(owner: MapFollowOwner): void {
    if (this.owner() === owner) {
      this.ownerSubject.next(null);
    }
  }
}
