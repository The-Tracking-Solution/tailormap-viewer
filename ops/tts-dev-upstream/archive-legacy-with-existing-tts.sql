-- Clone only. Caller must wrap this file in one transaction.
DO $identity$
BEGIN
  IF current_database() !~ '^tts_upstream_probe_[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}$'
     OR current_setting('port') <> '5432' OR pg_is_in_recovery() THEN
    RAISE EXCEPTION 'Alleen een schrijfbare DEV-proefkopie op poort 5432 toegestaan';
  END IF;
END $identity$;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.flyway_schema_history IN ACCESS EXCLUSIVE MODE;
LOCK TABLE tts_start.flyway_schema_history IN SHARE MODE;
LOCK TABLE public.user_start_position, public.user_start_extent IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.flyway_schema_history
      WHERE (version,script,checksum,success) IN (
        ('39','V39__personal_start_extent.sql',844470457,true),
        ('40','V40__admin_personal_start_position.sql',1089278426,true),
        ('41','V41__user_start_position_extent.sql',1614070661,true))) <> 3
     OR (SELECT count(*) FROM public.flyway_schema_history WHERE version IN ('39','40','41')) <> 3
     OR EXISTS (SELECT 1 FROM public.flyway_schema_history
                WHERE NOT success OR (version::numeric > 37 AND version NOT IN ('39','40','41'))) THEN
    RAISE EXCEPTION 'Onverwachte public-migratiehistorie';
  END IF;
  IF (SELECT count(*) FROM tts_start.flyway_schema_history
      WHERE version='1' AND script='V1__personal_start_position.sql'
        AND checksum=1761125400 AND success) <> 1
     OR EXISTS (SELECT 1 FROM tts_start.flyway_schema_history
                WHERE NOT success OR (version IS NOT NULL AND version <> '1')) THEN
    RAISE EXCEPTION 'Onverwachte tts_start-migratiehistorie';
  END IF;
  IF to_regclass('tts_start.user_start_position') IS NULL
     OR to_regnamespace('tts_legacy_dev') IS NOT NULL THEN
    RAISE EXCEPTION 'Startpositietabel ontbreekt of archiefschema bestaat al';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_start_position)
     OR EXISTS (SELECT 1 FROM public.user_start_extent) THEN
    RAISE EXCEPTION 'Oude public-voorkeuren zijn niet leeg; geen automatische archivering';
  END IF;
END $guard$;
CREATE SCHEMA tts_legacy_dev;
CREATE TABLE tts_legacy_dev.legacy_migration_history AS
 SELECT * FROM public.flyway_schema_history WHERE version IN ('39','40','41');
COMMENT ON TABLE tts_legacy_dev.legacy_migration_history IS
 'Verified obsolete private DEV V39/V40/V41 archived on an upstream upgrade probe; tts_start V1 retained';
ALTER TABLE public.user_start_position SET SCHEMA tts_legacy_dev;
ALTER TABLE public.user_start_extent SET SCHEMA tts_legacy_dev;
DELETE FROM public.flyway_schema_history WHERE version IN ('39','40','41');
