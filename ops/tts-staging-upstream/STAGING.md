# LT3 staging: promote the accepted DEV upstream release

This promotes the already built and functionally accepted DEV viewer/API artifacts,
not a configuration/database copy from DEV. Existing staging application switches,
alert rules, JDBC sources, users/preferences, branding and uploads remain staging's.
The viewer code therefore also makes the new DEV features available in staging;
configuration controls whether they are enabled. No compilation of viewer/API.

Confirmed baseline: tailormap-stage, project tailormap-staging/service tailormap,
/srv/tailormap-staging/docker-compose.yml, host network, UID 1002:1001, port 8185.
Old API sha256:82f9d7f4cebd599cbf042e6fde642bdad78fabc377804f054726b4c0cd73e523,
old viewer 2980c7700ce346eeeb39d6eea6e5c4b4ce0d02cd. Static symlink:
/var/tailormap/staging/static; uploads/log mounts retain their existing paths.
Database: postgis18-dev:5432/tailormap_stage_129. Public V37 only, existing
tts_start V1 checksum 1761125400, no public legacy tables. No history archiving,
repair or renumbering is needed or performed.

Accepted artifacts: DEV prepared.json under prepare-lxywtiz8, ACTIVE state;
viewer ca468d9dcd93728efc3346b3191c319175cfb021 (tree
7743dee7f968f9e3005a28bd150af8a1331a79aa), API
00a319f6c58eea8830a4d4584812863d05dcb505, image
sha256:f3be426220f455468af15df91fe607ce0ee91485ba6f16529b62e48b100888e4.
The earlier staging-only integration branch is not used here: this is promotion
of the complete accepted DEV code, while preserving staging configuration.

Run deploy-staging.py --deploy as root on LT3 from the pinned ops branch. First it
copies the existing viewer to a separate staging candidate, transfers staging logos,
favicons/title/manifest and bounded CSS overrides using the existing branding parser.
It compiles only StageMigrations.java against the accepted, checksum-verified API jar
and cached dependencies. This helper runs Flyway only, without Spring/Quartz/jobs.
Java options and Compose rendering are checked before any interruption. The new
Compose adds a persistent image pin and otherwise must equal the existing rendering.
Logs are private under /srv/tailormap-releases/staging-upstream-20261122/promote-*.

Only staging is then stopped. A full current staging database dump is retained and
restored into a fresh tts_stage_probe_* database. The helper applies official
V38/V39/V40 in public, validates existing checksums, requires private V1 to be a no-op,
repeats migrations as a no-op, and compares exact old histories, application settings,
components/content trees and private preference rows. No SQL writes to the replica.
Only the named staging databases are eligible for renaming/connection termination.

The old database is renamed to tts_stage_before_* and retained with connections
disabled; the new copy takes the original tailormap_stage_129 name. The two renames
are transactional. Then staging static/image switch and anonymous API/viewer checks
run. Shared data-refresh locking excludes concurrent refreshes. The compatible
refresh-policy 24d48c0cf484ca83412137e9927cb3d76bebe73eb96859ec0cc38865e7978848
was already deployed during the accepted DEV upgrade and is required, not rewritten.
This supports the older source schema followed by target-specific startup migrations;
optional target features remain bounded overlays. No complete data refresh is run here.

The script prints rollback.sh before stopping staging. Errors and catchable signals
automatically restore old staging database/API/viewer. A saved copy of the runner and
its support files permits manual rollback after a disconnected shell or hard kill.
No database is dropped. Later new data remains in a retained attempt database on
rollback and is not automatically merged into the old database. Original Compose and
.env files are backed up and not edited. DEV, production and replica are not stopped,
recreated, or modified.

Validation: ten targeted Python tests cover success, migration failure, health failure,
interruption recovery, cross-environment SQL refusal, OID guards, transactional staging
rename and isolated helper compilation. Python compilation passes. The Java helper
only changes the already tested DEV migration helper's target and clean-history guard,
and strengthens application/preferences comparisons. It is compiled on LT3 before
interruption. Prior DEV migration/build/database-switch tests are reused; actual
staging Flyway execution and browser acceptance are pending until server output.
