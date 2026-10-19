# Realtime WMS fetch status — internal DEV preview 3

Tracking: The-Tracking-Solution/tailormap-ideas#4. Not submitted upstream.

## Baseline and scope

Source baseline: `1d953639a5e76b2c1647ca3d386e7686acdafc2f`.
LT3 DEV currently serves `/var/tailormap/candidates/12.9.4-tts-1d953639-branded`.
The package version in this source baseline is 12.9.3; the candidate directory
name alone must not be used to infer a different source version.

This preview observes foreground ImageWMS and TileWMS sources in the 2D map,
only while their layer IDs have automatic refresh enabled. Other layers have
no status listeners attached.
It shows waiting, fetching, successful fetch, failed/partially failed fetch,
and potentially stale display. Details include last successful fetch and the
next scheduled refresh. Hover or keyboard-focus the indicator for details.
Symbols and accessible text convey status without relying on color.
No API, database, Solr or upstream PR1938 change is required.

The indicator observes existing source events and per-layer completion; it
never invokes an extra refresh. The existing `layerRefreshed$` event retains
its meaning and timing for FeatureInfo refresh. Refresh timer replacement when
an interval changes prevents the displayed schedule from disagreeing with the
actual timer. One shared clock updates all indicators.

## Provisional decisions

- Show status for layers already configured with a positive finite refresh interval.
- Fixed allowed misses: **2**. The warning threshold is **(2 + 1) × interval**
  since the last successful fetch: 15 seconds → 45 seconds; 300 seconds → 900
  seconds. There is no separate minimum duration.
- Before a first success, use the start of monitoring. Re-enabling a hidden
  layer starts a fresh warning window while preserving its previous success.
- A failed request is visible in details immediately, but the exclamation icon
  is delayed until the same elapsed-time threshold. Recovery clears the warning.
- Preserve the last success through subsequent failures, pauses and attempts.
- Invalidation alone does not confirm success. ImageWMS confirms when its own
  current image request finishes successfully. TileWMS additionally waits for
  its own renderer to confirm all current viewport tiles have finished.
  Neither waits for completion of unrelated layers.
- A partial failure is an error; a later completed successful batch recovers.
- Automatic refresh retains in-flight results: a genuinely completed image can
  advance the last successful fetch even when a later refresh has already begun.
- A superseded tiled batch can confirm fetching only with complete evidence:
  every tile in its captured wanted-tile viewport must have succeeded; neither a
  partial success nor an old queued tile without viewport evidence can confirm it.
- A filter/style/source change clears old pending observations because the
  old query no longer describes the new layer content.
- Hidden layers have no automatic refresh timer. Out-of-scale layers can still
  have timer ticks but need not fetch images. Their details explain this.
- 3D, WMTS, XYZ and vector status are explicitly unsupported in this preview.
- Successful fetching does not establish that source data are current. Server
  timestamps, upstream ingestion health and cache freshness are outside scope.
- The next timestamp is a browser timer schedule, not a delivery guarantee.

## Known limits for DEV acceptance

- TileWMS confirmation uses the OpenLayers canvas tile renderer's per-layer
  `renderComplete` flag at layer `postrender`, rather than map `rendercomplete`.
  This is specific to the currently used OpenLayers renderer and needs renewed
  verification when upgrading OpenLayers or introducing another renderer.
- Continuous navigation or cancellations within a tiled layer can still delay
  its own confirmation; unrelated layers no longer block it.
- A canceled request without an end/error event can remain pending. It must
  not create a false success. Old in-flight batches are bounded to 32 per layer;
  older observations are dropped without canceling actual network requests.
- Reprojected or otherwise unmatched tile keys cannot prove that an older
  batch is complete; they retain conservative per-layer renderer confirmation.
- WMS history is in memory for the lifetime of the map manager, not persisted.
- If the browser/server cancels requests before they complete, no success may
  be invented. Overlap tracking preserves completed evidence but does not force
  a source to provide complete images faster or alter the actual refresh cadence.
- Source replacement, viewport/cache behavior and browser/tab suspension still
  require acceptance against actual LT3 WMS layers.

## Local verification

Node 24, `npm ci` against unchanged package-lock.json:

```bash
npx ng lint core
npx ng lint map
npx ng test map --no-watch
npx ng test core --no-watch \
  --include='**/layer-refresh-status.component.spec.ts' \
  --include='**/application-layer-refresh.service.spec.ts' \
  --include='**/toc-node-layer.component.spec.ts' \
  --include='**/feature-info/**/*.spec.ts'
npm run build -- --app app
```

The build tool flattens `dist/app/browser` into `dist/app`; localized results
are `dist/app/{nl,en,de}`. Copy from the actual final output, not a presumed
`browser` directory. Keep candidate names and build manifests tied to the code
commit and preview revision. Do not overwrite the active candidate.

## LT3 acceptance and rollback

Only after code checks/build pass:

1. Create a new immutable candidate, e.g.
   `/var/tailormap/candidates/tts-refresh-status-dev3-<commit>`.
2. Apply existing TTS branding to the new candidate, retaining each locale's
   `apple-touch-icon.png`, `favicon.ico`, `favicon.svg`, `icons/logo.svg` and
   `icons/logo.svg.gz`. Ensure compressed assets match uncompressed assets.
3. Save the current DEV symlink target and running API image ID. Current
   rollback viewer is `/var/tailormap/candidates/12.9.4-tts-1d953639-branded`;
   current API image ID is
   `sha256:fde64ac48b0db3a1d1da5ed9ae8f063e927064685a71bc74ea0e7c8ef18f4b17`.
4. Preserve `/srv/tailormap-dev/.env`, the centralized Compose arrangement and
   the active `/var/backups/tailormap/dev/compose-1294.override.yml`. No API-image
   upgrade, database migration, reindexing or other service restart is needed.
5. Switch only `/var/tailormap/dev/static` to the new candidate. Docker resolves
   the bind source when creating the container: recreate only the DEV Tailormap
   service with the existing environment/override and pinned current API image.
   A symlink change or container restart alone is not reliable remounting.
6. Check served code in a fresh browser tab. Test ImageWMS, TileWMS, successful
   cycles, one failed tile, recovery, hide/show, scale changes, long requests,
   paused tabs, multiple layers and keyboard details. Confirm no extra fetches
   beyond the original map/FeatureInfo behavior.
7. Recheck coordinate picker, mouse coordinates, search result location,
   FeatureInfo attributes, moving geometry/highlight, static FeatureInfo and
   WMS-only FeatureInfo.
8. Exercise rollback: return the DEV symlink to the saved current branded
   candidate and recreate that same DEV service with the same API image and
   Compose inputs. Verify the old viewer is served and normal operation returns.

STAGING static target remains `/var/tailormap/candidates/12.9.3-tts-c1b7ed8a`.
LT4 production, PR1938 containers and their test databases/collections are not
part of this preview deployment. Do not infer current LT4 images from LT3.

## Preview 2 correction — 18 October 2026

DEV acceptance of preview 1 showed continuously fetching/warning indicators,
without reliable successful-fetch confirmation on a map with many refreshing
layers. The global map render-completion dependency was too broad. Preview 2
confirms ImageWMS directly from that image's own successful request and TileWMS
from that layer's completed tile render plus its tracked request results.
Regression coverage includes repeated successful fetches on independent layers
while another layer never finishes, and per-layer tiled render completion.
The existing preview 1 candidate and original pre-feature rollback remain intact.

## Preview 3 — fixed miss tolerance and overlap tracking

User decision: keep a fixed value of two allowed misses for now. This denotes
an elapsed-time policy with the agreed three-interval completion window, not
an exact count of HTTP errors. A successful fetch restarts the window.

A layer at 30 seconds was observed to alternate between success and fetching
on LT3 preview 2. Other layers at 5 seconds remained fetching. This establishes
that per-layer completion works for the tested 30-second layer; it does not
establish the duration or cause of every outstanding 5-second request.

Preview 3 preserves slow overlapping image requests and retains complete older
tile batches using their actual wanted-tile keys. It does not add requests or
change the map or FeatureInfo refresh cadence. Acceptance on the real LT3 map
at 5/15/30 seconds is still needed before claiming that overlap is fully accepted.

Later, separately scoped: expose per-layer administration controls for showing
the icon and the number of allowed misses, with calculated warning time shown
in the admin. The current value 2 could become the default. The visibility
migration/default, supported layer types and precise API/configuration design
remain to be decided. Do not implement admin/API fields in this preview.

## DEV-acceptatie — 19 oktober 2026

Gebruiker bevestigt goede werking bij verversintervallen van 15–300 seconden.
Uitval en herstel zijn getest. De regressiecontrole is volledig akkoord:
verbergen/heractiveren, schaalbereik waar van toepassing, tabblad hervatten,
bewegende FeatureInfo inclusief geometrie/highlight, statische FeatureInfo,
muiscoördinaten, coördinatenmenu en zoeken naar een bekend object.

Geaccepteerde candidate:
/var/tailormap/candidates/tts-refresh-status-dev3-d328dd32-branded

Dit bevestigt geen afzonderlijke volledige acceptatie voor iedere bron op
5 seconden of alle herprojectiegevallen. De gerapporteerde DEV-controles
hoeven zonder relevante wijziging of nieuwe fout niet herhaald te worden.

Volgende stap: hetzelfde geteste viewerartifact naar STAGING promoveren,
met eigen rollback. Admininstelbaarheid blijft uitgesteld.
