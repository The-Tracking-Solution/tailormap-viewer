# Follow a selected feature

## Branches and upstream contribution

The base is `feature/refresh-selected-feature-info-20261101`, updated onto upstream
`33833ea35143368967de6ed121e037a6e9263197` (1 November 2026). It contains only the
existing automatic Feature Info refresh and layer/feature identity fixes.

`feature/follow-selected-feature` adds following on top of that base. Review and
contribute the refresh first, then following; once the refresh is merged upstream,
rebase the following change onto that upstream version. Neither branch includes
TTS branding, video providers, realtime layer status or personal start preferences.
Older published refresh branches remain available unchanged. No upstream PR has
been opened as part of this work.

## Behaviour

Select a point with attributes and a stable feature ID, then choose **Follow
feature** in Object Information. The same control appears in desktop and mobile
layouts. Its pressed state is accessible to assistive technology.

The current selection/highlight and geometry continue to refresh through the
existing layer refresh mechanism. Following adds no timer or feature request.
After an update, the viewport check uses screen pixels, the current map size and
the existing top/right/bottom/left UI padding. As long as the point stays in the
inner 60% of the unobscured area, the map does not move. At a boundary or outside
that area, a short pan moves the point to the middle of the unobscured area,
leaving zoom and rotation unchanged. No route, interpolation or position prediction
is performed. The map's existing extent constraints still apply.

Dragging pauses following; choose **Follow feature** to resume. Closing the window,
changing the selected layer/feature pair, losing a usable point geometry, or
switching to 3D stops following. A failed update does not move the map. Temporary
WMS GetFeatureInfo IDs cannot be followed. First scope is 2D point features.

A shared ownership service ensures that GPS and Feature Info never control the
map simultaneously. Activating feature following stops GPS recentering but keeps
the GPS marker/watch subject to its existing timeout. Activating GPS takes over
from feature following. Neither the follow state nor the chosen target is stored
as a user preference.

## Validation and rollout

Unit coverage includes all four boundaries and off-screen jumps, asymmetric and
mobile padding, preservation of view properties, invalid geometries, selected
layer/feature identity, failure/recovery, manual pause/resume, GPS ownership,
window close/3D and the rendered button's accessible state. The updated refresh
base passed all 920 existing tests and full lint before publication.

No API or database schema changes are required. The replica-to-DEV/staging refresh
script does not need changing for this viewer-only addition. Browser acceptance
with actual moving features, current branding, a mobile panel and the existing
TTS integration remains a deployment step on LT3 DEV. These branches do not change
any server, database or active viewer. Production rollout requires a separate
explicit decision and an appropriate rollback.
