# LT3 DEV: selected-feature following

Prepared 1 November 2026; not yet executed on LT3.

The source candidate adds the independently maintained feature/follow-selected-feature
change to the exact accepted DEV preview-14 source tree
b2b81f9b1d31ef6455172e32d3498fba3ca9cfbf. It retains the personal-start UI,
all six video provider families/HLS, realtime refresh status and coordinate tools.
The generic upstream-based feature branches remain separate; this integration does
not upgrade the running API or apply all newer upstream viewer changes.

The source commit is pinned in deploy-dev.py and has passed full lint,
1208 tests and production builds for English, Dutch and German. The unchanged
global stylesheet is styles-YU6ZJSX5.css. Nine deployment tests cover targeting,
image pinning, atomic switch, branding, stale rollback guards, activation failure
and missing-container recovery. A real server deployment is still required.

Run deploy-dev.py --deploy as root on LT3. It validates the observed DEV container,
uses a private release workspace, fetches the immutable integration source,
then installs/tests/builds inside a Node 24.22.1 container capped at 5 GiB / 2 CPU.
The build log and progress messages identify the current phase. While building,
DEV remains available. The candidate keeps the current branding files, CSS and
titles, records the retained features and new source identity in version.json,
and establishes a guarded rollback. At activation only the tailormap service in
the existing tailormap-dev Compose project is recreated, with exactly the current
API image. HTTP checks verify the new viewer and existing API.

No SQL, migration edits, database restore, data refresh, cleanup of other workspaces,
STAGING or LT4 operations are performed. A failed activation restores the old viewer
and recreates the same DEV service with the pinned old API image. The printed
rollback.sh can also be invoked manually; later viewer/configuration/image changes
block that rollback. Source/build/log directories and both viewer candidates are
retained. A failed preparation leaves its files for diagnosis and does not switch
the viewer; do not delete or overwrite them blindly before reviewing the error.

After successful activation, hard-refresh DEV. Select a moving point with a stable
feature ID and choose Object volgen. Confirm that the selection and attributes
refresh, the map remains stationary away from its edges, and pans before the point
leaves the unobscured view. Confirm manual drag pauses, resume works, selection or
window close stops following, and GPS following takes over cleanly. Check desktop
and mobile, branding, personal start position, video playback and layer status.
