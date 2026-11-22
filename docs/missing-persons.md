# Vermissingenmodule — eerste TTS-versie

Datum: 22 november 2026. Eigen ontwikkeling voor [idee #20](https://github.com/The-Tracking-Solution/tailormap-ideas/issues/20).

## Besloten met Bas

- Bouwplan én eerste werkende versie, volgens de feature-/integratiewerkwijze van camende/Cris.
- Bij aanmaken staat de eigen organisatie geselecteerd. Andere organisaties kunnen per casus worden toegevoegd; zij mogen samen zien en bewerken.
- Alleen een gebruiker van de eigenaarorganisatie mag de deelnemerslijst wijzigen. De eigenaar blijft bij dezelfde organisatie.
- Actieve persoonsgegevens en foto's verwijderen bij afsluiting. Leeftijd, geslacht, tijdstippen en exacte vermist-/vindlocaties afgeschermd behouden.
- Statistiek ten minste één kalenderjaar bewaren; eerste instelling 365 dagen, met een kalenderjaar als ondergrens bij de berekening. Instelbaar tot 3650 dagen.

## Wat de eerste versie doet

Een eigen, standaard uitgeschakelde component `missing-persons` in het zijpaneel en mobiele menu. Een bevoegde medewerker start een casus met het tijdstip en de locatie van de laatste waarneming. Leeftijd mag onbekend blijven. Geslacht kent ook onbekend/niet opgegeven. Een korte omschrijving, watercheck en urgentiecheck helpen de intake.

Locaties kunnen als WGS84-lengte-/breedtegraad worden ingevuld of op de bestaande kaart worden geprikt. De kaart toont vermistpunt, eventueel vindpunt en de berekende indicatieve zoekcirkel. Kaartinteractie loopt via `MapService`; de component importeert geen OpenLayers.

De uitgebreide intake bevat roepnaam, kleding/signalement, melder, telefoon en bijzonderheden. Een JPEG/PNG-foto is optioneel en kan tegelijk met de casus worden opgeslagen. Updates, politiecontact en overdracht kunnen in de tijdelijke tijdlijn worden opgenomen. De 30/60-minutenindicaties rekenen vanaf de laatste waarneming; zij blokkeren eerder opschalen niet.

Afsluiten vraagt een uitkomst en expliciete verwijderbevestiging. Bij gevonden: vindlocatie, vindtijd en persoonsverificatie. Politieterugmelding en hulpverlening worden gecontroleerd. Statistiek wordt gestructureerd bewaard; daarna verdwijnen actieve casus, organisatiesamenwerking, foto en notities in dezelfde databasetransactie. Heropenen is niet beschikbaar.

## Zoekgebied en bronnenonderzoek

De operator kiest en bevestigt een aangenomen loopsnelheid. De backend berekent:

`straal_m = snelheid_km_per_uur × 1000 × verstreken_seconden / 3600`

De buffer wordt geodetisch met PostGIS berekend, niet in graden. De peiltijd komt van de server; een cirkel blijft op het scherm voorzien van berekentijd en wordt expliciet opnieuw berekend. Bij mogelijke watervermissing weigert de server een landbuffer. Boven 200 km wordt herbeoordeling gevraagd; de uitkomst wordt niet stil afgekapt tot een kleinere cirkel.

Onderzocht: [AMSA NATSAR Manual 2026](https://www.amsa.gov.au/national-search-and-rescue-council/manuals-and-publications/national-search-and-rescue-manual), volume 2 §3.14 en §3.16, en de bijlagen over leeftijdsgroepen. Het handboek onderscheidt theoretische afstand en gedrags-/vindplaatsstatistiek. Het geeft voorbeelden met 5 km/u en een lagere, casusafhankelijke 1,5 km/u; dit vormt geen universele leeftijdstabel voor Nederland. De snelheidskeuzes 1,5/3/5 km/u in de interface zijn expliciete scenario-aannames, geen gevalideerde zoeknormen. Er is geen automatische omzetting van leeftijd naar snelheid ingebouwd.

Een cirkel is geen kansgebied, volledige zoekgrens of vervanging van leiding en terreinbeoordeling. ORS, strand-/duinpaden, handmatige zoekvlakken en statistische afstandspercentielen vragen een volgende gevalideerde stap.

## Architectuur

Viewerbasis: `ca468d9dcd93728efc3346b3191c319175cfb021` op `integration/tts-dev-upstream-20261121`.
API-basis: `00a319f6c58eea8830a4d4584812863d05dcb505` op `integration/tts-dev-api-upstream-20261121`.
Featurebranches: beide `feature/missing-persons-20261122`.

Dit zijn bronbasissen. Zij bewijzen niet dat de voorbereide upstream-release op LT3 al is geactiveerd. Niet rechtstreeks over een oudere draaiende DEV-viewer leggen.

De bestaande Spring-API bewaakt applicatietoegang, inlog/CSRF en organisatie-/casustoegang. Organisaties worden expliciet gekoppeld aan bestaande Tailormap-groepen; `anonymous`, `authenticated` en `admin` worden niet als organisatiegroep geaccepteerd. Een beheeraccount krijgt zonder organisatiegroep geen persoonlijke casussen. De frontend krijgt organisatienamen en eigen lidmaatschap van de server, geen eigen beslisrecht over toegang.

Een aparte geodataverbinding gaat naar de bestaande geodata-PostgreSQL/PostGIS-database, schema `vermissingen`. Er is geen terugval naar de configuratiedatabase. De privépool is bewust geen Spring `DataSource`-bean, zodat de gewone Tailormap-datasource intact blijft. Eigen Flyway-historie, geen wijzigingen aan officiële V38/V39/V40 of `tts_start`.

Alle mutaties vergrendelen de casus en controleren een versienummer. Dat voorkomt overschrijven door een collega, dubbele afsluiting en foto's die na afsluiting opnieuw worden toegevoegd. Toegang wordt ook na het verkrijgen van de vergrendeling opnieuw gecontroleerd.

## Foto en privacy

- Alleen JPEG/PNG, maximaal 10 MB en 16 megapixels. De server decodeert, verkleint tot maximaal 1600 pixels aan de langste zijde en maakt een nieuwe JPEG zonder oorspronkelijke metadata/bestandsnaam. Uploadbytes worden niet opgeslagen.
- Eén foto in een aparte `bytea`-tabel; geen losse bestanden, thumbnails of objectstorage. Daardoor is de afsluitverwijdering atomair met het statistiekrecord.
- Foto en casus worden uitsluitend via een beveiligde API met `Cache-Control: no-store` opgehaald. Geen WMS/WFS-publicatie, browseropslag, exports of externe locatieverzoeken.
- De client wist geselecteerde gegevens en blob-URL's bij wisselen, uitloggen en sluiten van het paneel. Zichtbare casuslijsten worden elke 30 seconden ververst; verdwenen toegang/casussen worden gewist. Reeds getoonde informatie kan niet op afstand uit screenshots of het geheugen van mensen worden teruggehaald.
- Het statistiek-ID is nieuw en heeft geen FK of origineel casus-ID. Exacte tijd/plaats/leeftijd blijven mogelijk herleidbaar: dit is afgeschermde registratie, geen claim van anonimisering.
- Verlopen statistiek is direct niet meer opvraagbaar en wordt uiterlijk bij de volgende uurlijkse opruimactie verwijderd.
- PostgreSQL-back-ups, WAL, replica's en herstelde kopieën moeten hetzelfde verwijder-/retentiebeleid volgen. Een SQL-DELETE wist geen immutabele back-up direct.

## Beheer en ingebruikname

Zie de API-documentatie `docs/missing-persons.md` en het uitgeschakelde propertiesvoorbeeld. Voor de pilot zijn een expliciete schrijfverbinding naar een DEV-geodataomgeving en de echte organisatiegroepsnamen nodig. Geen credentials in GitHub zetten.

Schakel de component in via **Applicaties → Componenten → Vermissingen** en sla de applicatie op. Zonder expliciete componentinschakeling weigert ook de API de module. Schakel de API-optie uitsluitend in nadat doelverbinding en migraties zijn gecontroleerd.

Vóór een productie→DEV/staging-refresh moet schema `vermissingen` expliciet buiten de gewone geodatarestore blijven: geen echte actieve casussen naar test kopiëren en geen lokale testcasussen overschrijven. De bestaande refreshrunner is in deze feature niet aangepast; tot dit beheerpad is geïntegreerd geen live pilot op een database die door die runner wordt vervangen.

Uitrol volgt nieuwe immutabele API/viewer-candidates, behoud van branding, eerst DEV en vastgelegde rollback. Rollback van de functie: component en backendoptie uit, eerdere candidate/image terug. Geen schema-dropping of automatische database-downgrade. Er is geen serveruitrol uitgevoerd met deze wijziging.

## Testen en acceptatie

Viewer: volledige lint, volledige bestaande unittests, nieuwe API-/component-/tijdtests en productiebuild. API: compilatie en gerichte tests, waaronder echte PostGIS-proeven voor delen, ontoegankelijke organisaties, applicatiegrenzen, versieconflicten, fotoverwijdering, twee gelijktijdige afsluitingen en terugdraaien van een mislukte afsluiting. Het definitieve testresultaat staat bij de PR/issue-update.

De browseracceptatie op de werkelijke DEV-installatie blijft apart. In deze ontwikkelomgeving kon Chromium door een Unix-socketbeperking niet starten; er wordt geen geslaagde browsertest geclaimd.

DEV-acceptatie met uitsluitend fictieve personen:
1. Twee groepen/organisaties kunnen dezelfde gedeelde casus openen en bijwerken; een derde krijgt ook met het casus-ID geen toegang tot gegevens/foto/zoekcirkel.
2. Start vanaf mobiel en desktop, prik vermistpunt, upload foto en leg update vast. Vergelijk kaartpunt met WGS84-invoer.
3. Wijzig gelijktijdig: de tweede verouderde opslag krijgt een conflict. Controleer intrekken van organisatietoegang.
4. Bereken zoekcirkel vanaf een bekende tijd/snelheid; controleer tijd, straal en blokkade bij watercheck.
5. Prik vindpunt, sluit af en controleer dat foto/notities niet meer opvraagbaar zijn, ook vanuit de andere sessie. Alleen statistiek blijft.
6. Controleer branding, bestaande kaartmeldingen, camerafuncties en persoonlijke startpositie.

## Bewuste vervolgstappen

Weer-/waterkoppelingen zijn nog niet aangesloten: de snapshot bevat expliciet `unknown`. Geen verzonnen metingen. Bestaande `vermissing_punt`-records worden niet automatisch gemigreerd. Ook ORS, automatische leeftijdssnelheden, heropening, exports, uitgebreid toegangs-auditbeheer, gedeelde casussen over verschillende Tailormap-applicaties en Engels/Duits voor deze Nederlandstalige pilot vallen buiten deze eerste versie. Beveiligings- en beheeracceptatie zijn voorwaarden voor operationeel gebruik.
