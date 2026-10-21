# Video presentation in feature info

This optional feature renders supported video links in selected feature-info
attributes. The data source still supplies an ordinary string attribute; its
name and layer name have no special meaning. The existing source link and
filtering remain available.

## Configure

1. In **Catalog → feature type → Attributes**, set **Feature info display** to
   **Video** for the string attribute containing the URL. The default is
   **Text / link**. Read-only data sources/attributes can also display video.
2. In **Application → Components → Feature info**, enable **Allow video players
   for configured attributes**. This master switch defaults to disabled.
3. Optionally open the application's **layer attribute settings** and select
   **Inherit**, **Text / link** or **Video** for an attribute. Inherit is the
   default and follows future catalog changes. Text explicitly suppresses a
   catalog video setting; Video explicitly enables it for this application
   layer, even if the catalog uses text.

The application master switch always wins. Hidden attributes remain hidden;
only string attributes are eligible for video presentation. The settings do not
change the source data type, permissions, editing, filtering, attachments or
attribute aliases. Geometry and numeric attributes cannot become video URLs.

The first renderer supports HTTPS YouTube `/embed/VIDEO_ID`, `/watch?v=VIDEO_ID`,
`/live/VIDEO_ID`, `/shorts/VIDEO_ID` and `youtu.be/VIDEO_ID` links. It validates
exact hosts and 11-character IDs and constructs a canonical youtube-nocookie.com
player address. NetcamViewer Live is also recognized, strictly on the exact host
`live.netcamviewer.nl` and routes `/CAMERA-SLUG/NUMERIC-ID`, optionally ending
in `.html` or a trailing slash. Only HTTPS without credentials or a non-default
port is accepted. The player address is rebuilt from validated path segments;
source query parameters and fragments are discarded. The existing provider
page is used as the iframe player, without scraping temporary media URLs.
The original numeric route style (with or without `.html`) is retained.

Direct HTTPS HLS playlists are also supported as described below.
Other providers, direct MP4 and arbitrary website frames are not supported.
Selecting Video is not permission to embed any URL.

## Playback

The player loads only after **Play video** is clicked. **Stop video**, selecting
another feature/video, closing or collapsing the dialog, hiding the attributes
behind a template, or disabling video presentation destroys the player.
A refresh of the same feature with the same provider/source identity preserves
it. For YouTube this is the video ID; for NetcamViewer it is the validated
camera slug and numeric ID, independently of the optional `.html` suffix.
Changes of feature, camera or provider stop the current player. Desktop and mobile share this lifecycle.

Videos render in the attribute list. This does not permit iframe HTML inside
Markdown templates or change the template sanitizer. No remote requests are
made by the API to inspect or proxy a media URL.

The source link remains usable when the URL is unsupported. A recognized video
may still be unavailable or disallow embedding; the provider may display its own error, an offline snapshot or an access restriction.
Iframe loading does not prove playback and there is no general automatic
cross-origin playback health check.

## API contract and compatibility

Requires the matching API attribute-presentation extension. The optional
`AttributeDisplayType` is `text` or `video`:

- Catalog: `FeatureTypeSettings.attributeSettings[attribute].displayType`.
- Layer: `AppLayerSettings.attributeDisplayOverrides[attribute]`.
- Feature response: `columnMetadata[].displayType`, resolved by the API after
  visibility filtering. Missing configuration resolves to `text`.
- Application: existing `FeatureInfoConfigModel.showEmbeddedVideos` boolean.

Removing an override key restores inheritance; storing `text` is an explicit
opt-out. The API never mutates catalog settings while resolving a layer.
Settings live in existing JSONB columns; there is no Flyway schema migration
and no PostGIS/GeoServer/source-table migration.

This is an intentional change from the earlier TTS POC, which recognized every
visible YouTube URL when the master switch was enabled. The new viewer requires
explicit metadata: an older API or missing settings leave links as text. No
legacy auto-detection fallback is used. Configure the camera URL attribute as
Video when accepting this version. Build and deploy the matching API and viewer
as a pair; do not reuse the previous viewer-only activation script that pins
the old API image. The existing deployed POC remains unaffected until replaced.

## Development and acceptance

The standalone video branch must not depend on realtime refresh status (issue
#4). Combine it with TTS custom features only on an integration branch. Before
an upstream proposal, review the API contract and Admin UX with maintainers.
No upstream acceptance is assumed.

Targeted automated checks cover URL validation, lifecycle, application opt-in,
explicit attribute selection, refreshed metadata, catalog save/alias preservation,
layer overrides/inheritance removal, hidden/non-string fields and JSON round trips.

Dev acceptance with the matching API:

1. Verify an unconfigured YouTube link remains an ordinary link.
2. Configure the catalog URL attribute as Video; save/reload and verify it persists.
3. Keep the application switch off: no player. Enable it and play a supported URL.
4. Set this application's layer override to Text; save/reload: no player.
5. Restore Inherit; save/reload: the catalog setting is followed again.
6. Change the catalog to Text: inherited layers follow; explicit Video layers do not.
7. Test two layers/applications sharing one feature type with different overrides.
8. Verify hidden fields stay hidden, aliases/read-only state persist and normal
   filtering/attachments still work. Test closing, collapsing, mobile and feature
   changes, and check that unmodified automatic refresh does not restart playback.
9. Verify the combined candidate still passes the issue #4 acceptance scenarios.

No production deployment or upstream PR is part of this change.

## NetcamViewer dev acceptance

This is a viewer-only addition on top of the configured-video API contract.
No API rebuild, source-table change or attachment-storage fix is required.
The standalone branch remains independent of realtime layer status (issue #4).

The supplied inventory contains eight candidate NetcamViewer links: Blanke Top
(777.html), Cadzand (1069), Timboektoe (1404), Zeesluis (566), Domburg (530),
Vaarschool Albatros (873), Zeeuwse Riviera (719) and Havenkantoor (480).
URL recognition is covered by tests; it is not proof of live playback or
permission to embed. Provider page availability, frame restrictions and actual
playback must be checked on dev. Do not bypass provider access restrictions.

With the existing video configuration enabled, verify YouTube still works and
check NetcamViewer starting, external source link, stop, feature/camera/provider
switching, closing/collapsing and unchanged automatic refresh. Check fullscreen
and mobile sizing. A provider snapshot must not be accepted as confirmed live
video. Domain/referrer restrictions may prevent a camera from playing even
when the URL is recognized. Meekijken remains a separate follow-up.

## IPCamLive provider

IPCamLive public camera links on `ipcamlive.com` and `www.ipcamlive.com` with
one alias path segment are recognized, together with
`/player/player.php?alias=CAMERA_ALIAS` on those hosts and `g0.ipcamlive.com`.
Only HTTPS, exact hosts and no credentials or non-default ports are accepted.
The alias is limited to 1–100 ASCII letters/digits/underscores/hyphens, starting
with a letter or digit. Duplicate or empty alias parameters are rejected.

Both forms resolve to a single canonical player:
`https://g0.ipcamlive.com/player/player.php?alias=CAMERA_ALIAS&autoplay=1`.
It is loaded only after the user presses Play. Other caller-supplied query options,
fragments, stream addresses, tokens and domain overrides are not forwarded. In particular,
`controls=0` from a source link is not retained: the provider's default control settings
are used. The external link points to the canonical public camera page;
the original source attribute link also remains available.

Player identity is the validated alias, independently of the supplied supported
host or public/embed notation. A refresh with the same alias does not restart
the iframe; camera, feature and provider changes stop the previous player.

The supplied acceptance candidates are De Toko (feature 28, alias
`detokowebcam`) and Strandhotel Buren aan Zee (feature 78, alias
`strandhotelburen`). Verify both in the browser after the LT3 build/tests, and
repeat a YouTube and NetcamViewer check. URL recognition is not confirmation of
a working stream or embedding permission. Provider domain restrictions, disabled
public pages and camera availability can still prevent playback; do not bypass
these restrictions or copy temporary underlying media tokens.

This remains a viewer-only change with the existing video API/settings. The
attachment-storage candidate remains excluded. Local Angular lint/tests/build
must not be claimed when no execution environment is available; the LT3 script
runs those checks before activation. Official provider references:
https://www.ipcamlive.com/faqs and
https://www.ipcamlive.com/examples/embed-iframe2.html .

## rtsp.me and StreamPartner providers

Recognize HTTPS `rtsp.me/embed/SOURCE_ID/` (optional trailing slash) and
`ssl.streampartner.nl/player.php?url=SOURCE_ID`. Hosts and routes are exact;
credentials and non-default ports are rejected. IDs contain 1–128 ASCII
letters/digits/underscores/hyphens and start with a letter or digit.
StreamPartner's `url` parameter must occur exactly once and contain an opaque
ID, never a media URL. Other query parameters and fragments are discarded.
Both player and external source links are rebuilt from the validated ID.

The HTTPS rtsp.me service provides the embedded player; this does not add native
RTSP protocol support. Player identity is provider plus source ID. Loading starts
on Play, equivalent refreshes preserve playback, and Stop, feature/source/provider
changes and destruction end playback, as for the existing providers.

Acceptance candidates: Vuurtoren Breskens (feature 21, StreamPartner,
`rwj3wllrsipkvysnuozz`) and De Zeebries (feature 26, rtsp.me, `tkkGYA72`).
Browser playback still needs acceptance on LT3; URL recognition alone does not
prove playback. Repeat YouTube, NetcamViewer and IPCamLive checks. This is a
viewer-only addition; the API and attachment-storage behavior are unchanged.

Official rtsp.me embed documentation: https://rtsp.me/en/how-to-embed-stream-on-website.html .

## Direct HLS video

Configured attributes can contain a direct HTTPS URL whose path ends in `.m3u8`
(case-insensitive). Credentials, non-default ports and URLs longer than 4096
characters are rejected. Fragments are removed; query parameters are retained
because signed HLS URLs may require them. The whole canonical media URL forms
the playback identity: a changed token restarts playback; an identical feature
refresh does not. These URLs are media sources, never trusted iframe documents.
No server-side fetching, proxying, transcoding or access-control bypass is added.
Only the existing configured, visible string attributes and application opt-in
can enable the player. Arbitrary HTML pages are not inspected at runtime.

The browser uses native HLS when available (Safari/iOS) or a lazily imported,
locally bundled HLS.js 1.7.3 player when Media Source Extensions are available.
HLS.js is MIT-licensed, installed as a pinned root dependency and declared as a
core peer dependency. No external script/CDN is loaded. Media and the optional
HLS.js chunk are requested only after Play. Controls include fullscreen where
supported by the browser; playback starts muted and inline. A denied autoplay
request leaves the native Play control available.

The pilot includes two exact website aliases, so existing source data needs no
change: `https://dehangout.nl/webcam-wijk-aan-zee/` resolves to
`https://webcam.dehangout.nl/stream.m3u8`, and
`https://webcam-marinaseaport.nl/` resolves to
`https://wowza01.crossmediaventures.com/crossmedia/seaport.smil/playlist.m3u8`.
Their direct media URLs resolve to the same identity. Both retain the original
website as the external viewing link, which opens a full-page player. Other
direct HLS URLs keep the media URL as their external source link; desktop
browsers may download that playlist instead of playing it. Use the embedded
player's fullscreen control for those generic sources.

Every Stop, object/source/provider change or component destruction destroys the
HLS.js instance, pauses the media element, removes its source, calls load() to
release connections and cancels pending startup work. Late imports and playback
promise completions are ignored after cancellation. Fatal player/media errors
and unsupported browsers show localized fallback text. Initial loading or a
buffering stall is bounded to 20 seconds; stop/restart permits retry. Browser
controls, codec support, CORS on playlists/segments/keys, HTTPS and camera
availability still determine whether a source actually plays. A reachable
playlist alone is not proof of live video. HLS generally has more latency than
WebRTC; this does not yet implement Meekijken or alter LT4.

Acceptance on LT3: De HangOut (feature 1) and Marina Seaport (feature 51), plus
one existing iframe provider. Verify moving video, fullscreen, source link in a
new tab, stop/restart, feature/provider switches, close/collapse, unchanged
refresh and mobile sizing. Simulate a failed playlist and a stalled stream;
verify that error feedback and retry remain usable. Deployment is viewer-only
with the existing API and existing branding. No database change is required.

### Additional HLS viewing-page aliases

The same player also recognizes the existing exact HTTPS source pages for
Vuurtoren Marken (50), Strand Vlissingen (62), Waddenhaven Nes (80), Jachthaven
Lauwersoog (82), Jachthaven Hindeloopen (83) and Lelystad/Markermeerzicht (85).
Each resolves to its checked unsigned master playlist and keeps its original
page as the external viewing link. No source database change is required.
Sub-playlists, media segment names and generated session IDs are never stored
as permanent source URLs. The alias routes are exact; arbitrary websites are
not scraped or embedded. Direct signed media links retain their query parameters.

Playlist and sample segment availability/CORS were checked during preparation;
actual browser playback still requires acceptance on LT3. The initial two HLS
cameras were confirmed working by the user. Hoek van Holland (temporary tokens)
and Harlingen (camera selection) remain separate follow-ups.

### Bloemendaal HLS camera

The existing `https://reddingsbrigade-bloemendaal.nl/beachcam/` attribute URL
(feature 16) resolves to the verified unsigned master playlist
`https://wowza01.crossmediaventures.com/beachcam/beachcam.smil/playlist.m3u8`.
The original beachcam page remains the external viewing link in a new tab;
no source database or schema change is needed. Direct media and page notation
share one playback identity, so unchanged refreshes preserve the player.
Recognition and the parent component's opt-in/start/refresh/stop behavior are
covered by tests. Real moving video, fullscreen and the external viewing page
still require browser acceptance on LT3. The API and HLS engine are unchanged.
