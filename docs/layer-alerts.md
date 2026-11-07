# Map alerts pilot

The desktop 2D viewer checks one configured layer every 60 seconds while the application is open. Each open viewer makes its own requests. There is no background service or saved alert history.

## Configure in Tailormap Admin

Open **Applications → Components → Map alerts**. Select one application layer and fill in its object ID and status attributes. **Every change** is the default. Existing specific transitions can still be edited and kept. The optional label attribute falls back to the object ID. Check **Enabled**, apply the rule and save the application.

For the strand flags example, choose the warning-flags layer, enter `svid` for the object ID, `svflag` for the status, `svname` for the label and select **Every change**. Text and numeric values are compared per object, including when the status is set or cleared.

The layer must expose attributes through the existing feature API. Use a small layer with stable, unique object keys and an exact feature count of at most 500. The optional label falls back to the object key. The rule covers the entire application layer, regardless of viewport and temporary viewer filters. It respects the existing application access and layer settings for feature info and the attribute list.

The first complete response establishes the comparison baseline. An incomplete, empty or unsuccessful response produces no alerts. A later complete response compares against the last valid baseline. Newly observed and removed objects do not produce alerts. In **Every change** mode, rows without a usable object key are skipped. Duplicate keys prevent the response from becoming a baseline. The last 20 alerts remain in the open viewer session. Selecting **Show on map** zooms to and briefly highlights the geometry from the check.

## DEV acceptance

1. Open the test application and check that the first complete response produces zero alerts.
2. Change the configured status on one object in the writable test source. The next check should show one alert with the expected object and transition. Use **Show on map** and verify the highlight disappears.
3. Leave the status unchanged for another check. Verify the count stays at one.
4. Interrupt the test source for a check. Verify the unavailable message appears and the count stays at one. Restore the source without changing the flags and verify no duplicate appears.
5. Reopen the viewer and verify it takes a new baseline. Verify an application without the component entry makes no alert polling requests.

Unit tests: `npx ng test core --no-watch --include lib/components/layer-alerts/layer-alert-snapshot.spec.ts`.
