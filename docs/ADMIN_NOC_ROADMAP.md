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

## § 6 — REALGRAM COMMUNITY & MESSAGING (ny hovedfunksjon)

Lagt til 2026-07-17 på Khabats eksplisitte instruks, **før** videre
implementering av dette området.

**Kontekst:** dagens "Inbox" er ikke en meldingstjeneste — det er i praksis
en support-ticketliste med anonyme tekniske ID-er (`SL-227-xxxx`). Dette
er kjernefunksjonen som gjør ReaLink til **RealGram**: bygges om fra
bunnen, ikke pusses på.

> **🚫 Kodesperre:** ingen kode for § 6 skrives før alle seks punktene i
> § 6.12 "Før koding" er levert og eksplisitt godkjent av Khabat. Denne
> seksjonen legges inn i roadmapen *nå* nettopp for å unngå at noen
> begynner å implementere før datamodell, ID-sammenslåing, migreringsplan
> og wireframes er på plass — jf. § 0.3 (roadmapen er eneste sannhetskilde,
> nytt arbeid legges inn her før koding starter, ikke etterpå).

### 6.1 Felles identitet

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Én permanent intern bruker-ID som forener RealGram user ID, VPN ID, Shahnameh player ID, referral/clan ID | Not started | — | — | — | — | — | venter på § 6.12 (datamodell + ID-sammenslåingsplan) |
| Profilfelter: display name, unikt @handle, avatar, Shahnameh-persona/helt, level/XP, clan, inviterte venner, online-status, språk, REAL/ZAR-balanse, tilgjengelig kvote | Not started | — | — | — | — | — | § 6.12 |
| Skjul tekniske `SL-227-xxxx`-ID-er fra primær UI (kun synlig i profil/admin) | Not started | — | — | — | — | — | § 6.12 |
| Valgfri Telegram-ID-kobling til profilen (ikke eneste identitet) | Not started | — | — | — | — | — | § 6.12, § 6.7 |

### 6.2 RealGram hovedskjerm

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Søkefelt | Not started | — | — | — | — | — | § 6.12 |
| Samtaleliste: avatar, navn/@handle, siste melding, tidspunkt, ulest badge, levert/lest-status, typing indicator, online-status, pinned, mute-status | Not started | — | — | — | — | — | § 6.12 |
| Ny samtale-knapp | Not started | — | — | — | — | — | § 6.12 |
| Filtre: Alle / Venner / Clan / Shahnameh / Support / Grupper | Not started | — | — | — | — | — | § 6.12 |
| Support = kun én chat i systemet, ikke hele meldingstjenesten | Not started | — | — | — | — | — | § 6.12 |

### 6.3 Direktemeldinger

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Start samtale med: clan-medlemmer, venner, inviterte, nylige medspillere, Shahnameh-ranking/community, @handle eller QR | Not started | — | — | — | — | — | § 6.12 |
| Tekst, emoji, svar, redigering, sletting, kopiering, intern videresending | Not started | — | — | — | — | — | § 6.12 |
| Bilder; filer (senere, Fase 3) | Not started | — | — | — | — | — | § 6.12, § 6.11 Fase 3 |
| Delivered/read-status, typing-status, online/last seen | Not started | — | — | — | — | — | § 6.12 |
| Blokkering og rapportering | Not started | — | — | — | — | — | § 6.10 |
| Live-oppdatering via WebSocket (eller tilsvarende) — ingen refresh-følelse | Not started | — | — | — | — | — | § 6.12 |

### 6.4 Shahnameh Community

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Shahnameh-profil flettet med VPN/RealGram-profil (felles ID, § 6.1) | Not started | — | — | — | — | — | § 6.1, § 6.12 |
| Fra spillerprofil: se helt/persona, level/chapter-progress, clan, achievements | Not started | — | — | — | — | — | § 6.12 |
| Fra spillerprofil: legg til venn, send melding, inviter til clan, send datakvote, send REAL/ZAR (når økonomien tillater), utfordre/inviter til aktivitet (senere) | Not started | — | — | — | — | — | § 6.6 (kvote/REAL), § 6.12 |
| Game-fane Community-del: Clan chat, Friends, Nearby/online warriors, Leaderboard, Recent players, Invitations, Community events | Not started | — | — | — | — | — | § 6.12 |

### 6.5 Clans og grupper

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Automatisk clan group chat + announcement channel per clan | Not started | — | — | — | — | — | § 6.12 |
| Medlemsliste, roller (owner/commander/moderator/member) | Not started | — | — | — | — | — | § 6.12 |
| Invite link/code, clan-avatar og navn | Not started | — | — | — | — | — | § 6.12 |
| Shared achievements, referral progress; clan data pool (eventuelt, senere) | Not started | — | — | — | — | — | § 6.12 |
| Gruppesamtaler: adminroller, festede meldinger, medlemmer, invitasjoner, mute, rapportering, unread count | Not started | — | — | — | — | — | § 6.12 |

### 6.6 Sende datakvote ("Send data")

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Flyt: velg mottaker → velg mengde → vis egen kvote → bekreft → sikker ledger-transaksjon → systemmelding i chat ("Du sendte 500 MB") → push + saldo-oppdatering hos mottaker | Not started | — | — | — | — | — | § 6.12, sikker backend-ledger (se krav) |
| Atomisk transaksjon, ingen dobbeltbruk | Not started | — | — | — | — | — | — |
| Rate limiting, min/maks | Not started | — | — | — | — | — | — |
| Anti-fraud | Not started | — | — | — | — | — | — |
| Historikk i admin | Not started | — | — | — | — | — | knyttes til § 3 admin-arbeid |
| Remote deaktiverings-bryter | Not started | — | — | — | — | — | — |
| Tydelig skille kjøpt/opptjent/overførbar kvote (om nødvendig) | Not started | — | — | — | — | — | — |

**Hard regel:** dette skal **ikke** implementeres som en visuell mockup —
backend-ledgeren må være sikker og testet før funksjonen settes `Live`
(§ 0.1 punkt 6 gjelder strengt her: "verifisert med ekte data" betyr en
ekte, testet pengetransaksjon, ikke en UI som later som).

### 6.7 Telegram-samspill

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Inngang A: start via Telegram-bot | Not started | — | — | — | — | — | § 6.12 |
| Inngang B: start via RealGram-appen | Not started | — | — | — | — | — | § 6.12 |
| Inngang C: koble Telegram-konto til RealGram-profil (senere) | Not started | — | — | — | — | — | § 6.1, § 6.12 |
| RealGram og Shahnameh fungerer uten Telegram; ingen gjestekontoer; én varig bruker-ID | Not started | — | — | — | — | — | § 6.1 |
| Telegram-brukere informeres om at clan-chat/vennemeldinger/kvoteoverføring finnes i RealGram | Not started | — | — | — | — | — | — |

**Hard regel:** ikke kopier private Telegram-meldinger inn i RealGram. Kun
konto-/bot-kobling og eksplisitt community-funksjonalitet deles.

### 6.8 Navigasjon

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Hovednav: Home/VPN, **Chats** (primærfane, ikke konvoluttikon i header), Shahnameh, Servers, Profile | Not started | — | — | — | — | — | § 6.12 |
| Vurder å samle Servers under VPN hvis fem faner blir for mye | Not started | — | — | — | — | — | designbeslutning, avklares i wireframe (§ 6.12 pkt 5) |

### 6.9 Designkrav

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Levende, sosialt, raskt, premium, persisk-first, moderne messenger — ikke supportsystem-følelse | Not started | — | — | — | — | — | § 6.12 |
| Dagens mørke RealGram-tema videreført, men: tydelige avatarer, færre tomme flater, kompakte samtalerader | Not started | — | — | — | — | — | § 6.12 |
| Online green; gull kun for premium/REAL/Shahnameh-rang | Not started | — | — | — | — | — | § 6.12 |
| God RTL-støtte | Not started | — | — | — | — | — | § 6.12 |
| Egne Shahnameh-badges og clan-symboler | Not started | — | — | — | — | — | § 6.12 |
| Korrekt safe area, intet innhold bak bottom navigation | Not started | — | — | — | — | — | § 6.12 |
| Konsekvent bruk av navnet REALGRAM — ingen synlig SetaLink/TrustAI/interne prosjekt-ID-er | Not started | — | — | — | — | — | — |

### 6.10 Sikkerhet og moderering

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Block user, report user/message | Not started | — | — | — | — | — | § 6.12 |
| Spam rate limiting | Not started | — | — | — | — | — | — |
| DM privacy setting: hvem kan finne meg / sende melding / sende clan-invite | Not started | — | — | — | — | — | — |
| Moderator/admin queue, audit log | Not started | — | — | — | — | — | knyttes til § 1 admin-arbeid |
| Sikker lagring | Not started | — | — | — | — | — | — |
| Push notification privacy | Not started | — | — | — | — | — | — |
| Sletting av konto og meldingsdata etter policy | Not started | — | — | — | — | — | policy må defineres først |
| Krypteringsmodell avklart og dokumentert | Not started | — | — | — | — | — | **må gjøres før noe kalles "sikker"/"privat"** |

**Hard regel:** ikke bruk "secure" eller "private" som teknisk påstand om
denne meldingstjenesten før krypteringsmodellen faktisk er avklart og
dokumentert — jf. § 0.2 (forbudte ord uten dekning).

### 6.11 Leveransefaser

Ikke bygg alt som én stor uverifisert leveranse. Hver fase følger § 0.1 og
§ 6.12 fullt ut før neste fase starter.

| Fase | Innhold | Status |
|---|---|---|
| **Fase 1** | Felles brukerprofil, @handle, samtaleliste, 1-til-1 tekstchat live, online/read/typing, support som vanlig chat, søk etter brukere, blokkering/rapportering | Not started |
| **Fase 2** | Shahnameh-profiler, venner, clan-chat, grupper, spillerkontakt, push-varsler | Not started |
| **Fase 3** | Sikker kvoteoverføring, REAL/ZAR-overføring, bilder/filer, community events, avansert moderering | Not started |

### 6.12 Done-krav for § 6 (i tillegg til § 0.1, ikke i stedet for)

**Før noe i § 6 rapporteres ferdig**, i tillegg til § 0.1s syv steg:

- [ ] Testet med **minst to ekte brukere**
- [ ] Live meldinger verifisert på **to enheter**
- [ ] Skjermbilder av: chat list, direct chat, profile, clan
- [ ] Ingen placeholder-data presentert som ekte data

**Før koding starter på NOE i § 6 (kodesperre, se varsel øverst i § 6):**

| # | Leveranse | Status | Godkjent av Khabat |
|---|---|---|---|
| 1a | Denne seksjonen lagt inn i `ADMIN_NOC_ROADMAP.md` | Done (denne commiten) | — |
| 1b | Krysshenvisning lagt inn i produkt-roadmapen (`docs/realgram/PRODUCT_VISION.md`) — **avdekket en uløst produktkonflikt i samme slag: `PRODUCT_VISION.md` beskriver RealGram som en TDLib-basert Telegram-klient som speiler brukerens ekte Telegram-chatter; § 6 her beskriver et eget RealGram-native meldingssystem der Telegram kun er en inngang. Ikke reconcilert — se varsel i `PRODUCT_VISION.md`.** | Done (denne commiten) | — (konflikt, ikke innhold, venter på Khabat) |
| 2 | Foreslått datamodell vist | Not started | Nei |
| 3 | Kartlegging av hvilke eksisterende user-ID-systemer som må slås sammen | Not started | Nei |
| 4 | Migreringsplan (eksisterende VPN-/Shahnameh-brukere mister ikke konto eller saldo) | Not started | Nei |
| 5 | Wireframes: Chats, Direct Message, Warrior Profile, Clan Chat | Not started | Nei |
| 6 | Godkjenning fra Khabat | Not started | Nei |

**Fase 1-koding kan ikke starte før rad 2–6 over er `Done`/`Ja`.**

---

## § 7 — Rapporteringsformat (bindende, erstatter fritekst-rapportering)

Enhver agent som rapporterer status på en oppgave i denne roadmapen skal
oppdatere raden direkte i denne filen (Status/Branch/Commit/PR/Deploy-tid/
Verifisering/Blokkeringer) — ikke bare skrive i chat at noe er "fikset".
Chat-oppsummeringer skal peke til den oppdaterte raden, ikke erstatte den.

Når en hel seksjon (§1–§4) har alle rader på `Live`, samles skjermbilder av
*alle* admin-sider i seksjonen og leveres samlet til Khabat før seksjonen
kan rapporteres som ferdig.
