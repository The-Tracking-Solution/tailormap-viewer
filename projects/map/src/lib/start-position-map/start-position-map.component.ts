import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, inject, Input, NgZone, OnDestroy, Output, signal, ViewChild } from '@angular/core';
import { HttpClient, HttpParams, HttpXsrfTokenExtractor } from '@angular/common/http';
import { MatButton } from '@angular/material/button';
import { Map as OlMap, View, Feature } from 'ol';
import { Draw, defaults as defaultInteractions } from 'ol/interaction.js';
import { createBox } from 'ol/interaction/Draw.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import { Vector as VectorSource } from 'ol/source.js';
import { Point } from 'ol/geom.js';
import { fromExtent } from 'ol/geom/Polygon.js';
import { take, Subject, takeUntil } from 'rxjs';
import { AppLayerModel, MapResponseModel, ServiceProtocol } from '@tailormap-viewer/api';
import { WMSLayerModel, XyzLayerModel, WMTSLayerModel, LayerTypesEnum } from '../models';
import { OpenLayersLayerManager } from '../openlayers-map/open-layers-layer-manager';
import { ProjectionsHelper } from '../helpers/projections.helper';

export interface StartPositionSelection {
  center?: number[] | null;
  zoom?: number | null;
  extent?: number[] | null;
}

@Component({
  selector: 'tm-start-position-map',
  template: `
    <div #canvas class="mini-map" tabindex="0" role="region" aria-label="Start position map" i18n-aria-label="@@map.start-position.label"></div>
    <div class="map-actions">
      <button mat-button type="button" [disabled]="disabled" (click)="useView()" i18n="@@map.start-position.use-view">Use map center and zoom</button>
      <button mat-button type="button" [disabled]="disabled" [attr.aria-pressed]="drawing()" (click)="drawRectangle()" i18n="@@map.start-position.draw">Draw rectangle</button>
      <button mat-button type="button" [disabled]="disabled" (click)="reset()" i18n="@@map.start-position.reset">Show application start</button>
    </div>
    @if (drawing()) {
      <p role="status" i18n="@@map.start-position.draw-hint">Select two opposite corners of the rectangle. Press Escape to cancel.</p>
    }
    @if (layerError()) {
      <p role="status" i18n="@@map.start-position.layer-error">Some map layers could not be loaded.</p>
    }
  `,
  styles: ['.mini-map { height: 320px; width: 100%; min-width: 240px; background: #eef1f4; border: 1px solid #aaa; } .map-actions { display: flex; flex-wrap: wrap; gap: 4px; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
})
export class StartPositionMapComponent implements AfterViewInit, OnDestroy {
  private zone = inject(NgZone);
  private http = inject(HttpClient);
  private xsrf = inject(HttpXsrfTokenExtractor);
  private map?: OlMap;
  private manager?: OpenLayersLayerManager;
  private draw?: Draw;
  private observer?: ResizeObserver;
  private source = new VectorSource();
  private destroyed = new Subject<void>();
  private data: MapResponseModel | null = null;
  private selected: StartPositionSelection | null = null;
  private layerGeneration = 0;
  public drawing = signal(false);
  public layerError = signal(false);
  @Input() public disabled = false;
  @Output() public positionSelected = new EventEmitter<StartPositionSelection>();
  @ViewChild('canvas') private canvas?: ElementRef<HTMLElement>;

  @Input() public set mapData(value: MapResponseModel | null) {
    if (this.data === value) { return; }
    this.data = value;
    this.initialize();
  }
  @Input() public set position(value: StartPositionSelection | null) {
    this.selected = value;
    this.showPosition();
  }

  public ngAfterViewInit() { this.initialize(); }

  private initialize() {
    if (!this.canvas || !this.data) { return; }
    this.disposeMap();
    const data = this.data;
    const generation = ++this.layerGeneration;
    ProjectionsHelper.initProjection(data.crs.code, data.crs.definition);
    this.map = new OlMap({ target: this.canvas.nativeElement,
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
      view: new View({ projection: data.crs.code, extent: this.bounds(data.maxExtent), showFullExtent: true }),
    });
    this.manager = new OpenLayersLayerManager(this.map, this.zone, this.xsrf);
    this.manager.init();
    const backgroundIds = new Set(data.baseLayerTreeNodes.flatMap(n => n.appLayerId ? [n.appLayerId] : []));
    // The application's first visible background layer is the initial basemap.
    const backgrounds = data.appLayers.filter(l => backgroundIds.has(l.id));
    const activeBackground = backgrounds.find(l => l.visible) ?? backgrounds[0];
    const visible = [ ...(activeBackground ? [activeBackground] : []),
      ...data.appLayers.filter(l => !backgroundIds.has(l.id) && l.visible) ];
    this.layerError.set(false);
    visible.forEach((layer, index) => this.addLayer(layer, index, generation));
    this.map.addLayer(new VectorLayer({ source: this.source, zIndex: 100000 }));
    this.map.getViewport()?.addEventListener('keydown', this.cancelOnEscape);
    this.observer = new ResizeObserver(() => this.map?.updateSize());
    this.observer.observe(this.canvas.nativeElement);
    this.reset();
    this.showPosition();
  }

  private addLayer(layer: AppLayerModel, index: number, generation: number) {
    const service = this.data?.services.find(s => s.id === layer.serviceId);
    if (!service) { return; }
    const base = { id: layer.id, name: layer.layerName, url: layer.url || service.url, visible: true,
      opacity: layer.opacity, attribution: layer.attribution, crossOrigin: 'anonymous' as const,
      minScale: layer.minScale, maxScale: layer.maxScale, hiDpiDisabled: layer.hiDpiDisabled };
    let model: WMSLayerModel | XyzLayerModel;
    if (service.protocol === ServiceProtocol.WMS) {
      model = { ...base, layerType: LayerTypesEnum.WMS, layers: layer.layerName, serverType: service.serverType,
        tilingDisabled: layer.tilingDisabled, tilingGutter: layer.tilingGutter,
        styles: layer.styles, selectedStyleName: layer.selectedStyleName };
    } else if (service.protocol === ServiceProtocol.XYZ) {
      model = { ...base, layerType: LayerTypesEnum.XYZ, minZoom: layer.minZoom, maxZoom: layer.maxZoom,
        tileSize: layer.tileSize, tileGridExtent: layer.tileGridExtent };
    } else if (service.protocol === ServiceProtocol.WMTS) {
      const addWmts = (capabilities: string) => {
        if (generation !== this.layerGeneration) { return; }
        const wmts: WMTSLayerModel = { ...base, layerType: LayerTypesEnum.WMTS, layers: layer.layerName, capabilities };
        this.manager?.addLayer(wmts, index);
      };
      if (service.capabilities) { addWmts(service.capabilities); }
      else {
        this.http.get(service.url, { responseType: 'text', params: new HttpParams().set('SERVICE', 'WMTS').set('REQUEST', 'GetCapabilities') })
          .pipe(take(1), takeUntil(this.destroyed)).subscribe({ next: addWmts,
            error: () => { if (generation === this.layerGeneration) { this.layerError.set(true); } } });
      }
      return;
    } else { return; }
    this.manager?.addLayer(model, index);
  }

  private bounds(value: MapResponseModel['maxExtent']) {
    return value ? [ value.minx, value.miny, value.maxx, value.maxy ] : undefined;
  }

  public useView() {
    if (this.disabled || !this.map) { return; }
    this.cancelDrawing();
    const center = this.map.getView().getCenter();
    const zoom = this.map.getView().getZoom();
    if (center && zoom !== undefined) {
      this.positionSelected.emit({ center: [...center], zoom, extent: null });
    }
  }

  public drawRectangle() {
    if (this.disabled || !this.map) { return; }
    if (this.draw) { this.cancelDrawing(); return; }
    this.draw = new Draw({ type: 'Circle', geometryFunction: createBox() });
    this.draw.on('drawend', event => {
      const extent = event.feature.getGeometry()?.getExtent();
      this.cancelDrawing();
      if (!this.disabled && extent && extent[0] < extent[2] && extent[1] < extent[3]) {
        this.zone.run(() => this.positionSelected.emit({ center: null, zoom: null, extent: [...extent] }));
      }
    });
    this.map.addInteraction(this.draw);
    this.drawing.set(true);
  }

  private cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { this.zone.run(() => this.cancelDrawing()); }
  };
  private cancelDrawing() {
    if (this.draw) { this.map?.removeInteraction(this.draw); this.draw = undefined; }
    this.drawing.set(false);
  }
  public reset() {
    if (!this.map || !this.data) { return; }
    this.cancelDrawing();
    const extent = this.bounds(this.data.initialExtent ?? this.data.maxExtent);
    if (extent) { this.map.getView().fit(extent, { size: this.map.getSize(), padding: [ 12, 12, 12, 12 ] }); }
  }
  private showPosition() {
    if (!this.map) { return; }
    this.source.clear();
    const p = this.selected;
    if (p?.extent?.length === 4) {
      this.source.addFeature(new Feature(fromExtent(p.extent)));
    }
    if (p?.extent?.length === 4) {
      this.map.getView().fit(p.extent, { padding: [ 16, 16, 16, 16 ] });
    } else if (p?.center?.length === 2 && typeof p.zoom === 'number') {
      this.source.addFeature(new Feature(new Point(p.center)));
      this.map.getView().setCenter(p.center);
      this.map.getView().setZoom(p.zoom);
    } else { this.reset(); }
  }
  private disposeMap() {
    this.layerGeneration++;
    this.cancelDrawing();
    this.observer?.disconnect();
    this.manager?.destroy();
    this.map?.getViewport()?.removeEventListener('keydown', this.cancelOnEscape);
    this.map?.setTarget(undefined);
    this.map?.dispose();
    this.map = undefined;
    this.source.clear();
  }
  public ngOnDestroy() {
    this.destroyed.next(); this.destroyed.complete();
    this.disposeMap();
  }
}
