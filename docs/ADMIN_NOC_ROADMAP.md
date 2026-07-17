# Admin NOC Roadmap — Eneste sannhetskilde

Sist oppdatert: **2026-07-17**, av Claude (dev-VPS-økt), etter Khabats
tilbakemelding om at admin-redesign, Ads & Revenue og kapasitetsarbeid var
markert "ferdig" flere ganger uten at det var merget/deployet/verifisert.
Se `docs/DEPLOYMENT_CHECKLIST.md` og `docs/STARLINK_WINDOWS_HANDOFF.md` §31
for konteksten (produksjons-SSH-tilgang som ikke overlever mellom økter,
`/var/www/setalink` på prod er ikke git, "ferdig" har historisk betydd
"committet på en branch" og ikke "live").

**Ingen APK-bygg før dette er ferdig** — Khabats eksplisitte instruks
2026-07-17. **Denne filen er den eneste sannhetskilden for Agent A og
Agent B** — se regel § 0.3. Ikke bygg mot en annen plan; hvis noe mangler
her, legg det inn her først.

---

## § 0 — Bindende regler (gjelder ALT under, ingen unntak)

### 0.1 "Ferdig" betyr ALLTID alle syv, i rekkefølge, ingen hoppes over

1. **Kodet**
2. **Commit**
3. **Pushet**
4. **Merget til `main`**
5. **Deployet til production** (`setalink.no`) — `scp`/`cp`-basert, ikke
   `git pull`, se `docs/DEPLOYMENT_CHECKLIST.md`.
6. **Verifisert med ekte data** — en direkte, live sjekk mot den faktiske
   prod-URL-en/filen/API-responsen, ikke en påstand i chat, ikke
   placeholder-tall.
7. **Skjermbilder levert** til Khabat.

Et punkt som mangler ett av disse syv er **ikke ferdig**, uansett hvor mye
kode som finnes på en branch.

### 0.2 Forbudte ord

Ingen agent skal skrive **"fikset"**, **"ferdig"** eller **"løst"** om noe
punkt med mindre § 0.1 punkt 1–7 *alle* er oppfylt for akkurat det punktet.
Bruk i stedet statusverdiene fra § 0.4.

### 0.3 Denne filen er eneste sannhetskilde

Nye funksjoner/idéer skal legges inn i denne roadmapen **før**
implementering starter — ikke bygges først og dokumenteres etterpå. Hvis
Agent A eller Agent B får en ny oppgave fra Khabat som ikke står her,
første steg er å legge den til her (med status `Not started`), ikke å
begynne å kode.

### 0.4 Påkrevd sporingsformat — hver eneste oppgave

Hver rad/oppgave i tabellene under skal ha disse feltene utfylt (bruk
`—` for tomt, aldri bare slette kolonnen):

| Felt | Verdier/format |
|---|---|
| **Status** | `Not started` / `In progress` / `Testing` / `Live` |
| **Branch** | eksakt branch-navn |
| **Commit** | kort SHA |
| **PR** | lenke, eller `—` hvis ikke merget via PR |
| **Deploy-tid** | ISO-tidspunkt for faktisk prod-deploy, eller `—` |
| **Verifisering** | hvordan det ble bekreftet live (kommando/URL/skjermbilde-ref) |
| **Blokkeringer** | f.eks. "venter på AdMob-konto", eller `—` |

`Status: Live` krever at alle syv punkter i § 0.1 er oppfylt for den raden.

---

## § 1 — Prioritet 1: Admin Redesign (HELE adminet, ikke bare Ads)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Inventar: alle eksisterende faner i `admin/index.php`, merket redesignet/ikke | Not started | — | — | — | — | — | — |
| Ett felles designsystem (farger, typografi, spacing, kort/panel/tabell/graf/badge-komponenter) | Not started | — | — | — | — | — | — |
| Modernisere hver fane (utvides til én rad per fane når inventaret er klart) | Not started | — | — | — | — | — | venter på inventar |
| Konsistent global navigasjon/sidebar på alle sider | Not started | — | — | — | — | — | — |
| Lesbart på NOC-storskjerm og laptop | Not started | — | — | — | — | — | — |
| Erstatt "bare tabell"-visninger med graf+tabell der relevant | Not started | — | — | — | — | — | — |

**Seksjonens Done:** hver fane fra inventaret er en egen `Status: Live`-rad
med skjermbilde — ikke én samle-rad for hele adminet.

---

## § 2 — Prioritet 2: Ads & Revenue

**Blokkerende forutsetning (egen rad, må være `Live` før noe annet i denne
seksjonen kan bli `Live`):** ekte AdMob-konto med `admob_app_id` /
`admob_rewarded_unit_id` satt (i dag placeholders, jf.
`docs/REWARDED-ADS-RECOVERY.md` §4).

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| AdMob-konto koblet med ekte ID-er | Not started | — | — | — | — | — | Khabat må skaffe AdMob-konto |
| Rewarded dashboard (samlet oversikt) | Not started | — | — | — | — | — | AdMob-konto |
| Revenue trend (graf: i dag/7d/30d) | Not started | — | — | — | — | — | AdMob-konto |
| Recovery trend (graf over tid) | Not started | — | — | — | — | — | — |
| Ad fill rate (ekte, fra AdMob) | Not started | — | — | — | — | — | AdMob-konto |
| eCPM (ekte, fra AdMob-konto/API) | Not started | — | — | — | — | — | AdMob-konto |
| Top users (høyest ad-reward-volum) | Not started | — | — | — | — | — | — |
| Suspicious events (review-kø) | In progress | feat/starlink-node-phase1 | — | — | — | kode finnes i `admin/api.php` `ads-metrics`, ikke verifisert live | — |
| Quota usage (ads vs betaling vs referral vs recovery) | Not started | — | — | — | — | — | — |
| Reward statistics (completion/avbrutt-rate, snitt reward/device) | Not started | — | — | — | — | — | — |
| Ad network health (SSV-endepunkt oppe, feilrate) | Not started | — | — | — | — | — | — |
| Remote config (rediger ad-nøkler i UI) | In progress | feat/starlink-node-phase1 | — | — | — | kode finnes, ikke verifisert live | — |

**Seksjonens Done:** AdMob-konto `Live`, alle rader `Live` med 100% ekte
tall (ingen placeholder-eCPM), skjermbilder.

---

## § 3 — Prioritet 3: Infrastruktur / Kapasitet

Kombinerer opprinnelig kapasitetsliste med Khabats utvidede
infrastruktur-krav (2026-07-17, punkt 6). I dag finnes kun: en enkel
"Node Health — Telemetry Scores"-panel (cron-matet, ikke sanntid) og
allokert/nominell Mbps per node.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Aktive VPN-noder — oversikt | Not started | — | — | — | — | — | — |
| Starlink-noder — dedikert visning | Not started | — | — | — | — | — | — |
| Node load (live, ikke cron-snapshot) | Not started | — | — | — | — | — | — |
| CPU per node | Not started | — | — | — | — | — | — |
| RAM per node | Not started | — | — | — | — | — | — |
| Bandwidth per node | Not started | — | — | — | — | — | — |
| Latency per node | Not started | — | — | — | — | — | — |
| Active sessions per node | Not started | — | — | — | — | — | — |
| Node health (finnes delvis) | In progress | feat/starlink-node-phase1 | — | — | — | cron-panel finnes, ikke sanntid, ikke verifisert live | — |
| Alerts ved høy belastning | Not started | — | — | — | — | — | — |
| Automatic balancing (flytter faktisk last) | Not started | — | — | — | — | — | — |
| Automatic node selection (live-kapasitetsbasert) | Not started | — | — | — | — | — | — |
| Autoscaling-status (feltet skal finnes selv om autoscaling ikke er bygget) | Not started | — | — | — | — | — | denne runden: plan, ikke kode |
| Recovery quota (aggregert på tvers av devices) | Not started | — | — | — | — | — | datamodell finnes (`recovery_used_bytes`), UI mangler |
| Hidden reserve monitoring (aggregert) | Not started | — | — | — | — | — | datamodell finnes (`hidden_recovery_total_bytes`), UI mangler |

**Seksjonens Done:** alle rader unntatt autoscaling-implementasjon
`Live` med ekte tall. Autoscaling: egen rad med en dokumentert,
Khabat-godkjent arkitekturplan (status `Testing` er ikke gyldig for en
plan — bruk `In progress`/`Live` kun for selve dokumentet, og vær
eksplisitt i "Verifisering"-feltet at det er en plan, ikke en
implementasjon).

---

## § 4 — Prioritet 4: SEO & Analytics Command Center

Mål (Khabats ord): *"Jeg skal aldri trenge å logge inn på Google Analytics
eller Search Console igjen."* Skal føles som et profesjonelt Network
Operations Center.

### 4.0 Blokkerende forutsetninger — egne rader, må være `Live` før noe
annet i § 4 kan bli `Live`

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Google Analytics Data API — koblet, ekte kall returnerer ekte data | Not started | — | — | — | — | — | GA4-property + credential trengs |
| Search Console API — koblet, ekte kall returnerer ekte data | Not started | — | — | — | — | — | verifisert GSC-site + credential trengs |
| AdMob API — koblet, ekte kall returnerer ekte data | Not started | — | — | — | — | — | AdMob-konto + credential trengs |
| Google Ads API — koblet, ekte kall returnerer ekte data | Not started | — | — | — | — | — | Google Ads-kunde-ID + credential trengs, "når tilgjengelig" |
| Server-side caching-lag for alle fire API-er (auto-oppdatert, ikke live-kall per sidevisning) | Not started | — | — | — | — | — | — |

**Ingen scraping av Google-sider, noensinne** — kun de fire API-ene over.

### 4.1 Dashboard (forsiden) / kjernevisninger

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Live users | Not started | — | — | — | — | — | GA4 API |
| Land (kart) | Not started | — | — | — | — | — | GA4 API |
| Besøk 24t/7d/30d | Not started | — | — | — | — | — | GA4 API |
| SEO-oppsummering (organiske klikk, impressions, CTR, snitt posisjon) | Not started | — | — | — | — | — | GSC API |
| Indekserte / ikke-indekserte sider | Not started | — | — | — | — | — | GSC API |
| Robots.txt-status, Sitemap-status, HTTPS-status | Not started | — | — | — | — | — | — |
| Core Web Vitals | Not started | — | — | — | — | — | — |
| Breadcrumb-status | Not started | — | — | — | — | — | — |

### 4.2 Google Analytics (detaljvisning)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Active/New users, Sessions, Engagement time/rate, Events, Conversions | Not started | — | — | — | — | — | GA4 API |
| Top pages, Landing pages, Exit pages, Bounce rate | Not started | — | — | — | — | — | GA4 API |
| Devices, OS, Browser, Screen size, App version | Not started | — | — | — | — | — | GA4 API |
| Traffic sources m/ utvikling over tid: Organic/Direct/Referral/ChatGPT/Google/Bing/Facebook/Telegram/X/Reddit/Andre | Not started | — | — | — | — | — | GA4 API |
| Land: kart + tabell (aktive/nye brukere, sessions, engagement, snitt tid, konvertering) | Not started | — | — | — | — | — | GA4 API |

### 4.3 Search Console (detaljvisning)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Total Clicks/Impressions, Avg Position, CTR + grafer 24t/7d/28d/90d | Not started | — | — | — | — | — | GSC API |
| Indeksering: indekserte/ikke-indekserte, robots.txt-feil, redirect-feil, canonical-feil, crawled-not-indexed, discovered-not-indexed (med grafer) | Not started | — | — | — | — | — | GSC API |
| Top Queries: keyword, klikk, impressions, CTR, position, trend opp/ned | Not started | — | — | — | — | — | GSC API |
| Top Pages: URL, klikk, impressions, CTR, position | Not started | — | — | — | — | — | GSC API |

### 4.4 Ads & Revenue (samlet i SEO/NOC-visningen)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| AdMob, Google Ads, Rewarded Ads: eCPM, Revenue, Fill Rate, Requests, Match Rate, Estimated earnings, Revenue trend | Not started | — | — | — | — | — | AdMob/Google Ads API, se § 2 |

### 4.5 Live Dashboard (30-sekunders auto-refresh)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Auto-oppdatering hvert 30. sekund | Not started | — | — | — | — | — | — |
| Live: aktive brukere, VPN-tilkoblinger, Starlink-noder, Ads, Recovery GB, SEO-trafikk, Serverstatus | Not started | — | — | — | — | — | — |

### 4.6 Graf-/chart-krav (gjelder HELE admin, ikke bare SEO-siden)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Line, Area, Bar, Donut charts, Heatmaps, World map — brukt konsekvent | Not started | — | — | — | — | — | — |
| Ingen visning er "kun tabell uten graf" | Not started | — | — | — | — | — | — |

**Seksjonens Done:** alle fire API-er `Live` med ekte credentials og ekte
data, caching bekreftet virkende, alle rader i 4.1–4.6 `Live`, skjermbilder
av alle SEO/Analytics-sider.

---

## § 5 — Rapporteringsformat (bindende, erstatter fritekst-rapportering)

Enhver agent som rapporterer status på en oppgave i denne roadmapen skal
oppdatere raden direkte i denne filen (Status/Branch/Commit/PR/Deploy-tid/
Verifisering/Blokkeringer) — ikke bare skrive i chat at noe er "fikset".
Chat-oppsummeringer skal peke til den oppdaterte raden, ikke erstatte den.

Når en hel seksjon (§1–§4) har alle rader på `Live`, samles skjermbilder av
*alle* admin-sider i seksjonen og leveres samlet til Khabat før seksjonen
kan rapporteres som ferdig.
