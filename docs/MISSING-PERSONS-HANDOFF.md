# Overdracht aan Cris — vermissingenmodule

22 november 2026. Status: **draftimplementatie voor verdere review en DEV-acceptatie; niet uitgerold**.

## Waar verder

- Idee en centrale voortgang: [tailormap-ideas #20](https://github.com/The-Tracking-Solution/tailormap-ideas/issues/20).
- Viewer: [feature/missing-persons-20261122](https://github.com/The-Tracking-Solution/tailormap-viewer/tree/feature/missing-persons-20261122), gebaseerd op `ca468d9dcd93728efc3346b3191c319175cfb021`.
- API: [feature/missing-persons-20261122](https://github.com/The-Tracking-Solution/tailormap-api/tree/feature/missing-persons-20261122), gebaseerd op `00a319f6c58eea8830a4d4584812863d05dcb505`.
- [Bouwplan en functionele keuzes](missing-persons.md).
- API: `docs/missing-persons.md` en `docs/missing-persons.properties.example` op de API-featurebranch.

De featurebranches horen bij elkaar. De bijbehorende draft-PR's richten op de bestaande DEV-integratiebranches, niet op upstream/main. Er zijn geen bestaande integratiebranches of runtimebestanden veranderd.

## Bevestigde keuzes van Bas

Eigen ontwikkeling volgens camende/Cris' werkwijze. Eigen organisatie standaard geselecteerd; andere organisaties per casus kiezen. Alle geselecteerde organisaties zien en bewerken samen; eigenaar beheert de deelnemerslijst. Tijd/locatie laatste waarneming zijn het vertrekpunt. Foto en persoonsgegevens verdwijnen bij afsluiten. Leeftijd, geslacht, tijdstippen en exacte vermist-/vindlocaties blijven afgeschermd. Bewaartermijn minimaal één kalenderjaar, eerste instelling 365 dagen en instelbaar langer.

Internetonderzoek leverde geen universeel bruikbare Nederlandse leeftijd→loopsnelheidstabel op. De pilot vraagt daarom expliciet om een beoordeelde snelheid. De cirkel is indicatief; watergevaar blokkeert het gebruik als landzoekmodel. ORS en weer/water zijn vervolgstappen; ontbrekende omgevingsdata is `unknown`.

## Testresultaat op deze overdracht

| Controle | Resultaat |
|---|---|
| API compilatie, Java 25 | Geslaagd |
| Nieuwe API-tests | 14 geslaagd; 0 overgeslagen |
| Daarvan echte PostgreSQL 17.12/PostGIS 3.5.2-workflowtests | 8 geslaagd |
| Volledige viewerlint | Geslaagd |
| Productiebuild EN/NL/DE | Geslaagd; pilotteksten zelf zijn Nederlands |
| Nieuwe viewercomponent-/tijdtests | 5 geslaagd |
| Nieuwe API-clienttests | 2 geslaagd |
| Gerichte gezamenlijke run kaartmeldingscomponent + vermissingen | 9 geslaagd |
| Volledige viewer-unittestrun | **1403 geslaagd, 3 gefaald** |
| Echte browser-/DEV-acceptatie | Niet uitgevoerd; Chromium-start geblokkeerd door Unix-socketbeperking |

De drie fouten in de volledige run zitten in `projects/core/src/lib/components/layer-alerts/layer-alerts.component.spec.ts`:
1. `requests geometry and detects new objects inside and just outside the map after an empty baseline`
2. `moving the map reclassifies the same warnings without creating new alerts`
3. `monitors mixed rules independently across layers, buffers, duplicate object IDs and source failures`

Dezelfde kaartmeldingsspec slaagt samen met alle nieuwe vermissingenspecs in de gerichte run (9/9). **Een volgorde-/mockinteractie wordt vermoed, maar is niet bewezen of opgelost.** De gedeelde Vitest-modulegraph en bestaande JSTS-mocks zijn aanknopingspunten. Voor merge/uitrol eerst de volledige run groen krijgen; geen productiefix voor kaartmeldingen op basis van deze testfout aannemen.

De PostGIS-proeven bevestigen: geen toegang voor een derde organisatie of andere applicatie, eigenaarcontrole bij delen, intrekken van toegang, versieconflict, bufferberekening, watermodelweigering, atomaire fotopurge, terugdraaien van een mislukte afsluiting, twee gelijktijdige afsluitingen, minimaal een kalenderjaar retentie en het verwijderen van verlopen statistiek.

## Eerstvolgende stappen

1. Bekijk de beide draft-PR's en los bovenstaande volledige-testsuite-interactie op. Nieuwe code is nog niet als operationeel geaccepteerd gemarkeerd.
2. Controleer welke upstream-/DEV-release werkelijk actief is op LT3. De bronbasis van deze feature komt uit de voorbereide integratie, niet uit een opnieuw gecontroleerde runtime.
3. Koppel de echte organisatiegroepsnamen en een expliciete schrijfverbinding naar DEV-geodata. Geen credentials in issues/commits opnemen. De propertiesvoorbeelden staan uitgeschakeld.
4. Controleer geodataschema-/backup-/rollenbeleid en de gewone replica→DEV/staging-refresh: `vermissingen` mag niet blind worden gekopieerd of overschreven. Die runner is nog niet aangepast.
5. Bouw nieuwe candidates met de bestaande branding-/rollbackwerkwijze. Accepteer met fictieve gegevens op desktop én mobiel, twee samenwerkende organisaties en een derde zonder toegang.
6. Pas daarna beoordelen of een operationele pilot kan starten. STAGING/productie niet gewijzigd; geen database-upgrade of serverherstart uitgevoerd.

Niet inbegrepen in deze checkpoint: migratie van oude casussen, ORS/strand-duinnetwerk, werkelijke weersnapshot, formeel toegangs-auditbeheer, exports, heropening of samenwerking over meerdere verschillende Tailormap-applicaties.
