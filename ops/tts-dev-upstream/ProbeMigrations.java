import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;
import org.tailormap.api.configuration.TtsStartPositionMigrations;

/** Runs migration code only: no Spring context, Quartz jobs, indexing or application endpoints. */
public class ProbeMigrations {
  private static String scalar(Connection c, String sql) throws Exception {
    try (var statement = c.createStatement(); var rows = statement.executeQuery(sql)) {
      if (!rows.next()) throw new IllegalStateException("Missing verification result");
      return rows.getString(1);
    }
  }
  private static void require(boolean valid, String message) {
    if (!valid) throw new IllegalStateException(message);
  }
  public static void main(String[] args) throws Exception {
    String database = System.getenv("TTS_PROBE_DATABASE");
    require(database != null && database.matches("tts_upstream_probe_[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}"), "Only a named upgrade probe is allowed");
    var ds = new PGSimpleDataSource();
    ds.setServerNames(new String[]{"127.0.0.1"}); ds.setPortNumbers(new int[]{5432});
    ds.setDatabaseName(database); ds.setUser(System.getenv("TTS_PROBE_USER"));
    ds.setPassword(System.getenv("TTS_PROBE_PASSWORD"));
    String privateHistorySql = "SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]')::text FROM tts_start.flyway_schema_history h";
    String officialHistorySql = "SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]')::text FROM public.flyway_schema_history h WHERE version IS NULL OR version::numeric<=37";
    String componentsSql = "SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id,components) ORDER BY id)::text,'[]')) FROM public.application";
    String privateBefore, officialBefore, componentsBefore, preferencesBefore;
    try (var c = ds.getConnection()) {
      require(database.equals(scalar(c,"SELECT current_database()")),"Wrong database");
      require("5432".equals(scalar(c,"SHOW port")) && "false".equals(scalar(c,"SELECT pg_is_in_recovery()::text")),"Wrong PostgreSQL instance");
      require("3".equals(scalar(c,"SELECT count(*) FROM tts_legacy_dev.legacy_migration_history WHERE (version,script,checksum,success) IN (('39','V39__personal_start_extent.sql',844470457,true),('40','V40__admin_personal_start_position.sql',1089278426,true),('41','V41__user_start_position_extent.sql',1614070661,true))")),"Missing verified legacy archive");
      require("1".equals(scalar(c,"SELECT count(*) FROM tts_start.flyway_schema_history WHERE version='1' AND script='V1__personal_start_position.sql' AND checksum=1761125400 AND success")),"Unexpected private V1");
      privateBefore=scalar(c,privateHistorySql); officialBefore=scalar(c,officialHistorySql);
      componentsBefore=scalar(c,componentsSql);
      preferencesBefore=scalar(c,"SELECT count(*) FROM tts_start.user_start_position");
    }
    var official = Flyway.configure().dataSource(ds).locations("classpath:db/migration")
        .defaultSchema("public").schemas("public").cleanDisabled(true).baselineOnMigrate(false).load();
    // migrate validates the existing history while allowing the three pending migrations.
    int applied = official.migrate().migrationsExecuted;
    require(applied == 3,"Expected exactly the official V38/V39/V40 on the untouched probe");
    require(TtsStartPositionMigrations.migrate(ds).migrationsExecuted == 0,"Private V1 must not run again");
    official.validate();
    require(official.migrate().migrationsExecuted == 0,"Second official migration must be a no-op");
    require(TtsStartPositionMigrations.migrate(ds).migrationsExecuted == 0,"Second private migration must be a no-op");
    try (var c = ds.getConnection()) {
      require(privateBefore.equals(scalar(c,privateHistorySql)),"Private history changed");
      require(officialBefore.equals(scalar(c,officialHistorySql)),"Existing official history changed");
      require(componentsBefore.equals(scalar(c,componentsSql)),"Application components or alert rules changed");
      require(preferencesBefore.equals(scalar(c,"SELECT count(*) FROM tts_start.user_start_position")),"Preference count changed");
      require("3".equals(scalar(c,"SELECT count(*) FROM public.flyway_schema_history WHERE version IN ('38','39','40') AND success")),"Official migrations incomplete");
    }
    Files.writeString(Path.of("/probe/migration-result.json"),"{\"official_migrations\":3,\"private_migrations\":0,\"repeat_migrations\":0,\"components_preserved\":true,\"private_history_preserved\":true,\"application_started\":false}\n");
    System.out.println("PROBE_MIGRATIONS_OK");
  }
}
