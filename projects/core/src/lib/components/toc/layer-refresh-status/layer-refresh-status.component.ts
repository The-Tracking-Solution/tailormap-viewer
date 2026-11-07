import { Component, computed, inject, input, LOCALE_ID } from '@angular/core';
import { TooltipDirective } from '@tailormap-viewer/shared';
import { AppLayerModel } from '@tailormap-viewer/api';
import { ApplicationLayerRefreshService } from '../../../map/services/application-layer-refresh.service';

@Component({
  selector: 'tm-layer-refresh-status',
  imports: [TooltipDirective],
  template: `
    @if (summary(); as summary) {
      <span class="refresh-status" tabindex="0" role="img"
            [class.refresh-warning]="summary.warning"
            [attr.aria-label]="summary.detail"
            [tmTooltip]="summary.detail"
            (click)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()">{{summary.symbol}}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; }
    .refresh-status { display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; margin-right: 8px; font-size: 18px; }
    .refresh-status:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .refresh-warning { font-weight: bold; }
  `,
})
export class LayerRefreshStatusComponent {

  private readonly allowedMissedRefreshes = 2;

  private refresh = inject(ApplicationLayerRefreshService);
  private locale = inject(LOCALE_ID);
  private dateFormatter = new Intl.DateTimeFormat(this.locale, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  public layer = input.required<AppLayerModel>();
  public visible = input(false);
  public inScale = input(true);
  public in3D = input(false);

  protected summary = computed(() => {
    const layer = this.layer();
    const interval = layer.autoRefreshInSeconds;
    if (!interval || !Number.isFinite(interval) || interval <= 0) {
      return null;
    }
    const load = this.refresh.loadStatuses().get(layer.id);
    const next = this.refresh.nextRefreshAt().get(layer.id);
    const now = this.refresh.now();
    const loading = load?.state === 'loading' || (load?.pendingRequests ?? 0) > 0;
    // Two missed opportunities plus one interval to complete: 15 s => 45 s; 300 s => 900 s.
    // Hiding/re-enabling a layer starts a new monitoring window, preserving its history.
    const startedAt = load?.monitoringStartedAt;
    const reference = Math.max(load?.lastSuccessfulLoad ?? startedAt ?? now, startedAt ?? 0);
    const stale = !!load && now - reference >= (this.allowedMissedRefreshes + 1) * interval * 1000;
    let symbol = '…';
    let message = $localize`:@@core.refresh.waiting:Waiting for a completed WMS fetch`;
    let warning = false;
    if (!this.visible()) {
      symbol = 'Ⅱ';
      message = $localize`:@@core.refresh.hidden:Layer hidden; automatic refresh paused`;
    } else if (this.in3D()) {
      symbol = '?';
      message = $localize`:@@core.refresh.no-3d:Fetch status is not supported in 3D yet`;
    } else if (!this.inScale()) {
      symbol = 'Ⅱ';
      message = $localize`:@@core.refresh.out-of-scale:Outside scale range; no image fetch expected`;
    } else if (!load) {
      symbol = '?';
      message = $localize`:@@core.refresh.unavailable:Fetch status unavailable; this preview supports WMS only`;
    } else if (stale) {
      symbol = '!';
      warning = true;
      message = $localize`:@@core.refresh.stale:Display may be outdated; no recent successful fetch`;
    } else if (load.state === 'error') {
      symbol = loading ? '↻' : '…';
      message = $localize`:@@core.refresh.error:WMS fetch failed or partially failed`;
      if (loading) {
        message = `${$localize`:@@core.refresh.loading:Fetching WMS image`}. ${message}`;
      }
    } else if (load.state === 'loading') {
      symbol = '↻';
      message = $localize`:@@core.refresh.loading:Fetching WMS image`;
    } else if (load.state === 'success') {
      symbol = '✓';
      message = $localize`:@@core.refresh.success:WMS fetch completed`;
    }
    if (stale && loading && this.visible() && this.inScale() && !this.in3D()) {
      message = `${$localize`:@@core.refresh.loading:Fetching WMS image`}. ${message}`;
    }
    const failedFetch = load?.lastFailure !== undefined || load?.state === 'error';
    if (failedFetch && (stale || load?.state !== 'error')) {
      message += `. ${$localize`:@@core.refresh.error:WMS fetch failed or partially failed`}`;
    }
    const last = $localize`:@@core.refresh.last:Last successful fetch`;
    const never = $localize`:@@core.refresh.never:Not yet confirmed`;
    const scheduled = $localize`:@@core.refresh.next:Next scheduled refresh`;
    const noSchedule = $localize`:@@core.refresh.no-schedule:No refresh scheduled`;
    const delayed = $localize`:@@core.refresh.delayed:Refresh overdue; browser scheduling may be delayed`;
    const disclaimer = $localize`:@@core.refresh.disclaimer:Fetch status does not confirm the age of the source data`;
    const showSchedule = this.visible() && !this.in3D() && next !== undefined;
    const schedule = showSchedule
      ? (next < now ? delayed : `${scheduled}: ${this.formatTime(next)}`)
      : noSchedule;
    const detail = `${layer.title}: ${message}. ${last}: ${load?.lastSuccessfulLoad !== undefined
      ? this.formatTime(load.lastSuccessfulLoad) : never}. ${schedule}. ${disclaimer}.`;
    return { symbol, warning, detail };
  });

  private formatTime(timestamp: number) {
    return this.dateFormatter.format(timestamp);
  }

}
