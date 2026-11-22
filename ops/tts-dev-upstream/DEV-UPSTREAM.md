## Installed refresh-policy compatibility correction — 22 November

The actual LT3 policy has SHA256 fc31f9950f5d21df8f21ebcbfb00fe943a1e783811e2a3726ae05e9670164fbb.
The supplied script was reconstructed exactly and differs from the older repository
revision by a bounded FEATURE_INFO video mapping/default/verification fix. Preserve
that fix; do not overwrite it with the older helper. Both reviewed inputs converge
to policy SHA256 24d48c0cf484ca83412137e9927cb3d76bebe73eb96859ec0cc38865e7978848.
The previous activation stopped before interruption or database changes.

Video and alert overlays allocate separate append positions even when both source
components are absent. Tested: actual supplied-file installation, backup and
idempotence; 34 refresh tests, 10 activation/installer tests, PostgreSQL 18.1 JSON
append and subsequent V38–V40 fixture, transactional database swap and rollback.
Actual LT3 activation remains pending. Use the updated pinned bootstrap.

# DEV upstream release — 22 November 2026

The prepared release is /srv/tailormap-releases/dev-upstream-20261121/prepare-lxywtiz8/prepared.json.
It contains viewer ca468d9dcd93728efc3346b3191c319175cfb021 (tree 7743dee7f968f9e3005a28bd150af8a1331a79aa)
and API image sha256:f3be426220f455468af15df91fe607ce0ee91485ba6f16529b62e48b100888e4,
built from API 00a319f6c58eea8830a4d4584812863d05dcb505.

`python3 activate-dev-release.py --activate /srv/tailormap-releases/dev-upstream-20261121/prepare-lxywtiz8/prepared.json`
activates only LT3 DEV. This interrupts tailormap-dev on port 8085 during backup,
copy/restore/migration and application startup. No production/staging/replica container is stopped.

The runner verifies the prepared runtime/configuration, upgrades only the known installed
refresh-policy helper, takes the release and datarefresh locks, and creates a private backup
with a rollback script before stopping DEV. After DEV stops, it takes a fresh full configuration-
database dump, restores a new database, archives only the exactly verified obsolete private
public V39/V40/V41 markers and empty old tables, and runs the already accepted Flyway helper.
The original database is never migrated. The old and new database names are switched in one
PostgreSQL transaction. Database OIDs identify both databases throughout recovery.

The original database is retained as tailormap_before_upstream_<time>_<token> with connections
disabled. The original image, static directory, configuration files and image pin remain
available. The new runtime uses the existing base Compose file plus the new prepared pin;
the obsolete pin is not included. The static symlink changes only after the fresh migration.

On an activation failure, the runner attempts to restore the original database name, old
viewer and old API image. SIGTERM/KeyboardInterrupt also enter this recovery path. A hard
kill/power failure requires running the saved rollback script. Failed/new databases are
retained; no database is dropped by this runner. If identity/configuration guards fail,
recovery stops rather than replacing an unrelated later environment. Keep all backup and
release directories until acceptance. Manual rollback after new edits retains those edits in
the inactive attempt database; it does not merge them into the restored old environment.

The checksum-guarded refresh-policy update preserves optional layer-alert rules by application
name/component type and identical layer identity. Existing source components are kept; only
the alert configuration/component is overlaid. Known localhost JDBC sources for django_db and
geodata_fresh retain port 5433 when source database/schema identity matches. Unknown fields,
missing/remapped layers and unknown installed helper versions stop before data replacement.
The old shell orchestrator is unchanged: source restore is verified, overlays are applied, and
the selected API runs its own migrations. No schema version of an optional feature is required
by the new overlay code. The updated helper also supports the old runtime after rollback.

Validation includes seven activation/recovery simulations, three guarded policy-install tests,
31 existing/new refresh tests, and a separate PostgreSQL 18 fixture proving transactional forward/
reverse name changes, retention of new data after rollback, overlays on a V37-shaped database,
and subsequent official V38/V39/V40 DDL with form-history conversion. These fixtures are not a
claim that a full real replica-to-DEV refresh or actual release activation has already run.
