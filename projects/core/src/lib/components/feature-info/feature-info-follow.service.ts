import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MapFollowHelper, MapService } from '@tailormap-viewer/map';
import { MapFollowService } from '../../services/map-follow.service';
import {
  selectCurrentlySelectedFeature, selectCurrentlySelectedLayerError, selectFeatureInfoDialogVisible,
} from './state/feature-info.selectors';
import { selectIn3dView } from '../../map/state/map.selectors';

@Injectable({ providedIn: 'root' })
export class FeatureInfoFollowService {
  private store$ = inject(Store);
  private mapService = inject(MapService);
  private mapFollow = inject(MapFollowService);
  private feature = this.store$.selectSignal(selectCurrentlySelectedFeature);
  private target: { layerId: string; featureId: string } | null = null;

  public canFollow = signal(false);
  public isFollowing = computed(() => this.mapFollow.owner() === 'feature-info');

  constructor() {
    combineLatest([
      this.store$.select(selectCurrentlySelectedFeature),
      this.store$.select(selectFeatureInfoDialogVisible),
      this.store$.select(selectIn3dView),
      this.store$.select(selectCurrentlySelectedLayerError),
      this.mapFollow.owner$,
    ]).pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(([ feature, visible, in3d, error, owner ]) => {
        const valid = !!feature && visible && !in3d && feature.layer.hasAttributes
          && !feature.__fid.startsWith('wms-get-feature-info-') && !!MapFollowHelper.getPointCoordinates(feature.geometry);
        this.canFollow.set(valid);
        if (owner !== 'feature-info') {
          return;
        }
        if (!valid || !feature || this.target?.layerId !== feature.layer.id || this.target.featureId !== feature.__fid) {
          this.mapFollow.stop('feature-info');
          return;
        }
        if (!error && feature.geometry) {
          this.mapService.panToPointIfOutsideViewport(feature.geometry);
        }
      });
  }

  public toggle(): void {
    if (this.isFollowing()) {
      this.mapFollow.stop('feature-info');
      return;
    }
    const feature = this.feature();
    if (this.canFollow() && feature) {
      this.target = { layerId: feature.layer.id, featureId: feature.__fid };
      this.mapFollow.start('feature-info');
    }
  }
}
