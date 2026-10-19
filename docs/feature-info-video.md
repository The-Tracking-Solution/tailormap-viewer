# YouTube video in feature info

This feature is independent of the TTS realtime layer status and selected-feature
refresh features. It needs no API, PostGIS, GeoServer or streaming-server change.

## Enable

In Admin, application components → Feature info, enable **Show a video player for
YouTube links in attributes**. Existing applications default to disabled.
The API's existing component config stores the optional `showEmbeddedVideos`
boolean; no schema migration is required.

Supported HTTPS links include YouTube `/embed/VIDEO_ID`, `/watch?v=VIDEO_ID`,
`/live/VIDEO_ID`, `/shorts/VIDEO_ID` and `youtu.be/VIDEO_ID` shortlinks. Only exact
YouTube hosts and valid 11-character video IDs are accepted. Other providers
remain ordinary attribute values. Recognition is independent of attribute or
layer names; it works for the webcams layer's `url` attribute without
domain-specific code. Per-layer/attribute configuration and other stream types
are possible future work, not supported by this version. Recognizing a URL does
not establish that the video exists, is live, or permits embedding.

The original attribute and filtering remain available. A player is loaded only
when the user clicks **Play video**, using a canonical youtube-nocookie.com URL
constructed from the validated ID. Arbitrary source query parameters are not
forwarded. YouTube handles playback, audio, fullscreen and source restrictions.
The **Open in YouTube** link is always available. No load event is treated as proof
of a healthy/live video; YouTube may display its own error or require another
play click. This component does not independently verify live status or latency.

Attributes are tracked by key so refreshing the same feature does not replace
its iframe. Source ID changes and selection changes (layer + feature ID) reset
the player. Stopping, disabling, closing or collapsing the desktop dialog removes
the player. Collapsing a template's attribute list also removes its players.
Reopening requires another play click. On mobile, closing the feature-info panel
destroys its content. Destroying a video component also navigates its frame to
about:blank. One player per supported attribute is possible; there is no global
single-player limit.

## Dev acceptance (not a production deployment)

Test object: Openbare ruimte → webcams → 13 / Zuid-Zuid-West, attribute `url`:
`https://www.youtube.com/embed/EH6GNSEvmQE?si=kWfiDQFORwpEKjBh`.

1. Disabled: original attributes and links behave as before.
2. Enable and select the object: Play video / Open in YouTube appear.
3. Play, audio and fullscreen work in the target browsers; size is at least
   YouTube's 200 × 200 minimum. Check narrow desktop and mobile layouts.
4. Refresh attributes/position for the same selected object without iframe
   recreation or playback interruption.
5. Select another object/layer, change/clear the URL, stop, collapse or close:
   previous playback ends. Reopen without automatic playback.
6. A blocked/unavailable YouTube video retains the external-open fallback.
7. On the combined TTS build also check #4 status/last successful fetch, selected
   feature refresh/highlight, coordinate functions and search-result location.

Browser acceptance is separate from unit tests: jsdom does not play YouTube.
No PR to Tailormap/B3Partners is part of this implementation.
