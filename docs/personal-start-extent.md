# Personal start positions controlled by administrators

For local Tailormap accounts only. Application → Settings has an Allow personal start positions switch (default off). Below the application form, select a local user and enter center X/Y in the application's CRS and a zoom level from 0 to 28, including fractional levels. Independently grant/revoke permission to change that position. User settings have their own Save button; the application switch uses the existing application Save button. Settings may be prepared while disabled.

Both application permission and user permission are required for viewer save/clear controls and API writes. A viewer request cannot grant its own mayEdit permission. Without a position, use the application default. Clearing a position retains permission. New accounts have no permission. Administrative routes require admin authority; existing application ACL and CSRF checks remain in force.

Center + zoom is independent of viewport size. Explicit location links override startup, while Home retains the personal position. Saving/clearing changes Home without moving the current map. Account/application changes invalidate pending responses. Anonymous users, external OIDC identities, unavailable APIs and obsolete-CRS positions fall back to the application default.

## Storage and API

V39 is already deployed and remains unchanged. V40 creates user_start_position, scoped by application and local username, with cascading foreign keys. Deleting/recreating an account cannot inherit its old preference. The legacy user_start_extent table and data remain for rollback and are not converted: a rectangle does not encode a viewport-independent zoom. Applications remain disabled until explicitly enabled.

Viewer GET/PUT/DELETE: /api/app/{viewerName}/user/start-extent. GET now returns crs, center, zoom and mayEdit, with null center/zoom if unset. Admin GET/PUT: /api/admin/applications/{applicationId}/user-start-position/{username}. Reads use Cache-Control: no-store. Admin PUT with null center/zoom clears the position while preserving the submitted edit permission.

Start zoom and search-result zoom remain separate improvements. This change does not change search zoom or impose a new application maximum zoom.

## DEV acceptance

1. Initially the feature is off everywhere; user controls are hidden.
2. Admin sets a user's center/zoom with permission off, enables and saves the application. Reopen a clean viewer URL: check startup and Home; user controls remain hidden.
3. Grant edit permission: user may save current center/zoom and clear it to the application default.
4. Revoke permission or disable the application: reload and check viewer/API enforcement.
5. Check another user/application, an explicit location link, a CRS change and existing HLS/refresh-status behavior.

Full PostgreSQL/Spring integration scenarios are supplied in API tests; execution requires the project's PostgreSQL fixture environment. Validation and rollout status are recorded in private issue #1.

## Login regression correction

Reading a disabled feature returns a successful empty position with mayEdit=false. Optional viewer preference requests handle 403 locally and do not activate the global login/access-denied redirect. This includes write permission revoked after opening the viewer. Session expiry (401) and all ordinary API requests retain normal authentication behavior. Tests exercise the real interceptor together with the preference service.
