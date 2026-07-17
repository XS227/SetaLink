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

### 0.5 RealGram designprinsipp: én-hånd-bruk (bindende for ALL ny RealGram-UI)

Lagt til 2026-07-17 på Khabats instruks. Gjelder retroaktivt som en
godkjenningsport for **§ 6, § 7 og § 8** — ingen skjerm fra de seksjonene
kan settes `Live` uten at den også består sjekken under. Dette er ikke en
egen oppgaveliste med Status-rader (det er en kvalitetsport), men en
eksplisitt del av "Verifisering"-feltet for enhver skjerm i de nevnte
seksjonene.

**Regelen:**
- Kjernehandlinger — koble til VPN, åpne chats, spille Shahnameh, sende
  datakvote, åpne Starlink, åpne profil — skal nås med **maksimalt 1–2
  trykk**, med én hånd.
- Ingen skjerm skal føles tom.
- Ingen skjerm skal ha **mer enn én hovedhandling**.
- Ingen funksjon skal kreve at brukeren leter (jf. § 7.4 innebygde
  guider, § 8 Hakim — begge finnes delvis *for* å forhindre leting, ikke
  som erstatning for at navigasjonen selv er tydelig).
- Hver side skal kunne svare på: *"Hva er det viktigste brukeren skal
  gjøre her?"* — hvis svaret er uklart, er siden ikke ferdig designet.

**Hvordan det verifiseres (ikke bare påstås):** når en skjerm fra § 6/§ 7/
§ 8 rapporteres `Live`, skal "Verifisering"-feltet eksplisitt bekrefte
antall trykk til hver relevant kjernehandling fra skjermen, ikke bare at
skjermen finnes.

---

## § 1 — Prioritet 1: Admin Redesign (HELE adminet, ikke bare Ads)

### 1.0 Inventar (utført 2026-07-17 — lest direkte fra kode på 7 brancher, ikke antatt)

**Kritisk funn før tabellen:** `main` har **ikke** dashboard-adminet i det
hele tatt — `main:admin/index.php` er 398 linjer og er det **gamle
CLI-produkt-adminet** (navngitte brukere, enkelt tabell+skjema), en helt
annen kodebase enn de ~4300–4700-linjers tabbede dashboard-adminene under.
**Ingen** av fanene i tabellen under har noensinne blitt merget til
`main`. Og siden prod-deploy er `scp`-basert, ikke git (§0, jf.
`DEPLOYMENT_CHECKLIST.md`), vet jeg **ikke** hvilken versjon som faktisk
kjører på `setalink.no` akkurat nå — SSH-forsøk mot prod feilet tidligere
denne uken (permission denied), så jeg kan ikke verifisere det live selv.
Kolonnen "Live på prod?" under er derfor `Ukjent`, ikke gjettet.

**Ingen branch har alt.** Sjekket `feat/starlink-node-phase1`,
`feat/admin-insights`, `feat/admin-intel-v2`, `feat/ecosystem-admin-visibility`,
`fix/admin-bootstrap-alt-profiles` — alle deler en felles kjerne på 13
faner, men to av dem har hver sin unike fane **ingen andre grener har**:
`feat/starlink-node-phase1` har **Starlink**; `feat/admin-insights` har
**User Insights** og **SEO Ranks**. De har aldri blitt kombinert.

| Khabats side | Finnes? | Synlig i meny? | Ferdig? | Placeholder? | Live på prod? | Mangler helt? |
|---|---|---|---|---|---|---|
| Dashboard | Ja, felles kjerne (alle grener) | Ja | Delvis — live monitoring finnes, ikke NOC-nivå (§ 4.5-kravet) | Nei | Ukjent | Nei (i kode) |
| Analytics | Ja, felles kjerne | Ja | Delvis — 30-dagers grafer, men ikke GA4/GSC-koblet (§ 4) | Delvis | Ukjent | Nei (i kode) |
| Ads & Revenue | Ja, felles kjerne | Ja | Nei — placeholder eCPM, AdMob-ID-er mangler (§ 2) | Ja | Ukjent, trolig ikke (aldri merget) | Nei (i kode) |
| Payments | Ja, felles kjerne | Ja | Ikke verifisert innhold denne runden | Ukjent | Ukjent | Nei (i kode) |
| Iran Debug | Ja, felles kjerne | Ja | Ikke verifisert innhold | Ukjent | Ukjent | Nei (i kode) |
| Network Intel | Ja, felles kjerne (+ Node Health på starlink-grenen) | Ja | Delvis — Node Health er cron-basert, ikke sanntid (§ 3) | Delvis | Ukjent | Nei (i kode) |
| User Insights | **Kun på `feat/admin-insights`** | Kun der | Ikke verifisert innhold | Ukjent | **Nei, ikke merget noe sted** | Ja, i alle andre grener |
| SEO | Delvis — kun enkel "SEO Ranks" (keyword-posisjoner) på `feat/admin-insights` | Kun der | Nei — full § 4 Command Center (GA4/GSC/AdMob/Google Ads-API) er 100 % "Not started" | Delvis | Nei | **Ja**, som samlet NOC-side |
| Rankings | **Presisert av Khabat 2026-07-17 — splittes i to sider, se § 1.2** | — | — | — | — | Ikke lenger uklart |
| Starlink | **Kun på `feat/starlink-node-phase1`** | Kun der | Delvis (beta/testing-stadium) | Delvis | **Nei, ikke merget noe sted** | Ja, i alle andre grener |
| Device Releases | Trolig dekket av "Release"-fanen (se under) | — | — | — | — | Ikke som egen fane — overlapp, ikke mangel |
| APK Channels | Dekket av "Release"-fanen (undertekst nevner det eksplisitt) | Ja | Ikke verifisert innhold | Ukjent | Ukjent | Nei — samme fane |
| Health | Delvis dekket (Release-undertekst + Node Health-panel) | Delvis | Nei som samlet side | — | — | **Ja**, som egen, samlet "System Health" |
| Monitoring | Delvis dekket av Dashboard | Delvis | Nei som dedikert NOC-monitoringsside | — | — | **Ja**, som egen fane utover Dashboard |
| Logs | Ja, felles kjerne | Ja | Ikke verifisert innhold | Ukjent | Ukjent | Nei (i kode) |
| API Status | — | — | — | — | — | **Ja, mangler helt** — ingen fane funnet noe sted |
| Event Log | — | — | — | — | — | **Ja, mangler helt** — dette er § 2.1.2s Ads Event Log, eksplisitt sperret til Agent A er ferdig |
| Wallet | — | — | — | — | — | **Ja, mangler helt som admin-fane** — backend-loopen er live (§ 9.0), men ingen admin-visning av den finnes noe sted |
| Users | Delvis dekket av "Devices" (device-sentrisk, ikke samlet profil) | Delvis | — | — | — | **Ja**, som samlet bruker/profil-visning — avhenger av § 6.1s identitetsarbeid |
| REAL Economy | Delvis dekket av "Payments" (REAL vs USDT, intents) | Delvis | — | — | — | **Ja**, som samlet økonomi-/treasury-oversikt (§ 9) |
| Community | — | — | — | — | — | **Ja, mangler helt** — avhenger av § 6 (messaging/clan), "Not started" |
| Hakim | — | — | — | — | — | **Ja, mangler helt som admin-fane** — MEN: `hakim-bot.service` kjører allerede i produksjon (siden 11. juli) med ekte data i `hakim.db` (`bot_messages`, `bot_users`), og koden har en kommentar som eksplisitt sier den er ment for "admin live-log view" — ingen web-UI leser den ennå |
| Settings | **Presisert av Khabat 2026-07-17 — utvides til fullt kontrollsenter, se § 1.3** | Delvis (dagens Config-fane) | — | — | — | Ikke lenger uklart |

**Store, tidligere udokumenterte funn fra dette inventaret:**
1. **Dashboard-adminet har aldri eksistert på `main`** — hele
   4300+-linjers tabbede panelet lever kun på feature-branches.
2. **`feat/starlink-node-phase1` og `feat/admin-insights` har hver sine
   unike sider som aldri er kombinert** — Starlink finnes ikke der
   User Insights/SEO Ranks finnes, og omvendt.
3. **Jeg kan ikke bekrefte hva som faktisk kjører på `setalink.no`** —
   ingen fungerende SSH-tilgang denne uken, og prod er uansett ikke git,
   så "hvilken branch" er strengt tatt ikke et spørsmål med noe entydig
   svar der.

### 1.1 Konsolideringsplan — **branch opprettet og pushet, 2026-07-17**

**Branch:** `feat/admin-noc-consolidated`, laget fra `feat/starlink-node-phase1`.
**Ikke merget til main** (Khabats eksplisitte instruks). Pushet til origin.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Opprett konsolideringsgren fra `feat/starlink-node-phase1` | **Live** (som gren, ikke som deploy) | `feat/admin-noc-consolidated` | `f496120` (base) | — | Ikke deployet | `git log` viser grenen pushet | — |
| Cherry-pick admin-relevante commits fra `feat/admin-insights` (User Insights, Iran Debug-fiks, SEO Ranks, GSC-integrasjon, .gitignore-vern, topbar-søk) | **Done** | `feat/admin-noc-consolidated` | `f62f17f`, `9efc655`, `14e67c2`, `289c0f2`, `a57e27c`, `cf4220a` | — | Ikke deployet | `php -l` kjørt på alle endrede filer — ingen syntaksfeil. Fullstendig fanevisning verifisert (17 faner) | — |
| Ekskludert bevisst: 5GB-starter-bump, ASN-carrier-deteksjon, payment-gate-krav (bundlet i samme opprinnelige commit som User Insights, men hører ikke til "admin, dashboards, NOC") | Bevisst utelatt | — | — | — | — | Se commit `f62f17f`s melding for full begrunnelse — allerede live i prod uansett per den opprinnelige commit-meldingen | — |
| **Reell bug funnet og fikset:** server-side side-whitelist (`admin/index.php` linje 25) manglet `starlink`, `insights`, `seoranks`, `tunnellogs` — disse fire sidene fantes og virket ved klikk i en åpen økt, men **spratt stille tilbake til Dashboard ved sideoppdatering/direktelenke** (styrer `INIT_PAGE` som klient-JS-routeren leser på førstelasting). Sannsynlig hovedårsak til "sider som virker tomme/mangler" | **Live** (i denne grenen) | `feat/admin-noc-consolidated` | `b0b3a44` | — | Ikke deployet | `php -l` OK, whitelist matcher nå alle 17 `data-page`-verdier i navigasjonen eksakt | — |
| Ett felles designsystem (farger, typografi, spacing, kort/panel/tabell/graf/badge-komponenter) | Not started | — | — | — | — | — | — |
| Modernisere/bygge de resterende sidene fra § 1.0-inventaret (Wallet, Users, REAL Economy, Community, Hakim, API Status, Health/Monitoring som egne sider, SEO/Community Rankings-splitten, utvidet Settings) | Not started | — | — | — | — | — | se § 1.2/§ 1.3/§ 8 for de nye, presiserte kravene |
| Konsistent global navigasjon/sidebar på alle sider — ingen skjulte/tomme menyvalg | Delvis (whitelist-bugen over var akkurat dette) | `feat/admin-noc-consolidated` | `b0b3a44` | — | — | — | — |
| Lesbart på NOC-storskjerm og laptop | Not started | — | — | — | — | — | — |
| Erstatt "bare tabell"-visninger med graf+tabell der relevant | Not started | — | — | — | — | — | — |

### 1.2 Rankings — splittet i to sider (Khabat, 2026-07-17)

Erstatter den tidligere uklare "Rankings"-raden. To separate sider, ikke én blandet.

| Side | Innhold | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|---|
| **SEO Rankings** | Google keywords, impressions, CTR, position, clicks | Delvis grunnlag finnes — "SEO Ranks" (`seoranks`-fanen, cherry-picket § 1.1) har keyword/posisjon/GSC-data allerede; utvider til full CTR/impressions/clicks-visning | `feat/admin-noc-consolidated` | `14e67c2`, `289c0f2` (grunnlag) | — | Ikke deployet | § 4 (SEO & Analytics Command Center) er samme datakilde — ikke bygg to separate GSC-integrasjoner |
| **Community Rankings** | Shahnameh Heroes, Clans, REAL earners, Referrals, Starlink contributors | Not started | — | — | — | — | — | avhenger av § 6 (clan-data), § 9 (REAL-data), eksisterende `referral_uses`, Starlink-invitasjonslogikk fra § 3 |

### 1.3 Settings — utvidet til fullt kontrollsenter (Khabat, 2026-07-17)

Erstatter den tidligere uklare "Settings"-raden. Ikke bare Config — et
samlet kontrollsenter med underseksjoner. Dagens `config`-fane
(`remote config · bootstrap server · settings`) blir startpunktet, ikke
hele svaret.

| Underseksjon | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Remote Config | **Delvis live** — dagens `config`-fane | `feat/admin-noc-consolidated` | (arvet fra base) | — | Ikke deployet | — | — |
| Feature Flags | Not started | — | — | — | — | — | trolig samme underliggende `settings`-tabell som Remote Config, egen visning |
| Ads | Not started | — | — | — | — | — | § 2, § 2.1.2 — ads-relaterte innstillinger (eCPM, daily caps osv. finnes delvis i `REWARDED-ADS-RECOVERY.md` §8) |
| Wallet | Not started | — | — | — | — | — | § 9 |
| Hakim | Not started | — | — | — | — | — | se § 8.11 (ny) — konfig-delen av den nye Hakim Admin-siden |
| Community | Not started | — | — | — | — | — | § 6 |
| Security | Not started | — | — | — | — | — | — |
| Languages | Not started | — | — | — | — | — | — |
| Notifications | Not started | — | — | — | — | — | — |
| Maintenance | Not started | — | — | — | — | — | — |
| Releases | Not started | — | — | — | — | — | trolig samme underliggende data som "Release"-fanen (`release`), egen kontrollvisning |
| Branding | Not started | — | — | — | — | — | `brand/BRAND.md` (RealGram-identitet) finnes allerede som kildemateriale, ikke bygget inn i admin |

---

## § 2 — Prioritet 2: Ads & Revenue

**Blokkerende forutsetning (egen rad, må være `Live` før noe annet i denne
seksjonen kan bli `Live`):** ekte AdMob-konto med `admob_app_id` /
`admob_rewarded_unit_id` satt (i dag placeholders, jf.
`docs/REWARDED-ADS-RECOVERY.md` §4).

### 2.0 Annonsetype-taksonomi (Khabat, 2026-07-18 — bindende, gjelder hele § 2)

**Funn som utløste dette:** det faste banneret på Realink/RealGram-forsiden
er **AdMob** (vanlig Google-bannerformat, annonsørnavn, "Open"-knapp) —
**ikke** AdsGram. AdsGram-panelet (Shahnameh sin Rewarded Video Unit)
viser derimot ekte, verifisert aktivitet admin aldri har fanget opp:

| Dato | Impressions | Clicks | Merknad |
|---|---|---|---|
| 2026-07-17 | 6 | — | |
| 2026-07-16 | 3 | — | |
| 2026-07-12 | 3 | 1 | |
| **Totalt synlig i AdsGram-panelet** | | | ~0,04 USDT |

**Dette er ekte tall fra Khabats eget AdsGram-panel — bruk som
fasit/kryssjekk** når den ekte AdsGram-integrasjonen (§ 2.1) faktisk bygges:
de nye admin-tallene skal kunne gjenskape akkurat disse tallene for samme
periode, ellers er integrasjonen ikke korrekt.

**Hard regel — gjelder hele databasen og hele admin, ikke bare denne
seksjonen:** banner-, rewarded- og interstitial-visninger skal **aldri**
telles sammen eller vises som én "Rewarded Views"-sum. De er strukturelt
forskjellige annonseformater fra (potensielt) forskjellige nettverk og
skal holdes atskilt gjennom hele kjeden — database, API, admin-UI.

**Fire distinkte annonsetyper, ikke to:**

| # | Type | Nettverk | Status i dag |
|---|---|---|---|
| 1 | Banner | AdMob | Live i appen (Realink/RealGram-forsiden), **ikke separat sporet i admin** |
| 2 | Rewarded video | AdMob | Delvis sporet i dagens admin-tabell under — men mulig sammenblandet med type 4, se rad "Suspicious events"/"Rewarded dashboard" |
| 3 | Interstitial | AdMob | Ukjent om denne finnes i appen i det hele tatt — avklar før det bygges en admin-side for noe som ikke eksisterer |
| 4 | Rewarded video | AdsGram (Shahnameh) | **Stub — se § 2.1.** Ekte aktivitet finnes i AdsGram sitt eget panel (tabellen over), men når aldri admin |

**Per type skal admin kunne vise:** impressions, completed views, clicks,
fill rate, eCPM, revenue, utdelt GB/gems/quota, kostnad per belønning,
netto resultat/ROI. Ikke alle felt gir mening for alle typer (banner har
ingen "completed views", interstitial har ingen "reward") — vis kun det
som faktisk gjelder for typen, ikke tomme felt fremstilt som `0`.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| AdMob-konto koblet med ekte ID-er | Not started | — | — | — | — | — | Khabat må skaffe AdMob-konto |
| **Avklar om dagens "Rewarded dashboard"/`ads-metrics` faktisk er AdMob Rewarded, eller en blanding** | Not started | — | — | — | — | — | kode-revisjon av `admin/api.php`s `ads-metrics`-case før noe merkes `Live` |
| AdMob Banner — eget kort/seksjon (impressions, clicks, revenue) | Not started | — | — | — | — | — | AdMob-konto. **Finnes ikke sporet i admin i dag i det hele tatt** |
| AdMob Rewarded — eget kort/seksjon | Not started | — | — | — | — | — | AdMob-konto |
| AdMob Interstitial — eget kort/seksjon, **hvis den faktisk finnes i appen** | Not started | — | — | — | — | — | avklar eksistens først |
| Revenue trend (graf: i dag/7d/30d), **per type, ikke slått sammen** | Not started | — | — | — | — | — | AdMob-konto |
| Recovery trend (graf over tid) | Not started | — | — | — | — | — | — |
| Ad fill rate (ekte, fra AdMob), per type | Not started | — | — | — | — | — | AdMob-konto |
| eCPM (ekte, fra AdMob-konto/API), per type | Not started | — | — | — | — | — | AdMob-konto |
| Top users (høyest ad-reward-volum) | Not started | — | — | — | — | — | — |
| Suspicious events (review-kø) | In progress | feat/starlink-node-phase1 | — | — | — | kode finnes i `admin/api.php` `ads-metrics`, ikke verifisert live, **ikke bekreftet hvilken(e) annonsetype(r) den faktisk dekker** | — |
| Quota usage (ads vs betaling vs referral vs recovery) | Not started | — | — | — | — | — | — |
| Reward statistics (completion/avbrutt-rate, snitt reward/device), per type | Not started | — | — | — | — | — | — |
| Ad network health (SSV-endepunkt oppe, feilrate) | Not started | — | — | — | — | — | — |
| Remote config (rediger ad-nøkler i UI) | In progress | feat/starlink-node-phase1 | — | — | — | kode finnes, ikke verifisert live | — |

**Seksjonens Done:** AdMob-konto `Live`, alle rader `Live` med 100% ekte
tall (ingen placeholder-eCPM), **de fire annonsetypene vist atskilt, ikke
slått sammen**, skjermbilder.

### 2.1 AdsGram (Shahnameh) — separat annonsesystem, **funnet reelt ødelagt** 2026-07-17

**Dette er ikke samme system som tabellen over.** AdMob/rewarded-ads-recovery
(over) er SetaLink/ReaLink sitt eget VPN-kvote-system. **AdsGram er
Shahnameh sitt** (annet backend, `/var/www/backend/backend`), et helt
separat TON-basert rewarded-ads-system som krediterer `real_balance`
direkte. Khabats test 2026-07-17 (så en AdsGram-reklame via Shahnameh i
Telegram, ingenting synlig i admin) ble undersøkt direkte i koden — to
reelle, atskilte funn:

**Funn 1 — ingen admin-visning finnes i det hele tatt, uansett om
krediteringen virker.** `creditAdReward()` (`lib/adsgram.js`) skriver
`$inc real_balance`/`gems` rett på brukerdokumentet — **det finnes ingen
egen hendelseslogg/tabell** for individuelle annonsevisninger. Den eneste
sporen er en rå tekstfil (`/var/www/shahnameh/season2/data/ad-callback.log`),
ikke lest av noen admin-rute. "Ingen treff i admin" er derfor delvis
forventet — funksjonen for å *vise* treff finnes ikke, uavhengig av om
selve krediteringen fungerte.

**Funn 2 — server-side postback-verifisering (AdsGram sin "Reward URL")
har vært ødelagt i minst en måned.** Lest direkte fra
`ad-callback.log`: **hver eneste linje tilbake til 2026-06-15, inkludert
Khabats test i dag (2026-07-17T21:26:12Z), har tom `blockId`.**
`handleCallback()` (`routes/adminApi/ads.js`) avviser da med
`credited: false, reason: 'unknown_blockId'` — stille, ingen feilmelding
synlig for brukeren, AdsGram får `200 OK` og prøver aldri igjen. I tillegg
er `ADSGRAM_BLOCK_ID_BRONZE/SILVER/GOLD` tomme i `.env` (kun `WATCH` er
satt) — selv med riktig blockId ville bronze/silver/gold-nivåene aldri
matchet. **Sannsynlig rotårsak:** AdsGram-dashbordets "Reward URL"-mal
mangler `blockId`-parameteren i URL-en som faktisk er konfigurert der.

**Det finnes en fungerende sekundærvei** — klient-rapportert
`POST /season2/ads/verify-reward` (`routes/api/season2.js`) tar `tier`
direkte fra klienten og kaller `creditAdReward()` uten å være avhengig av
blockId. Om frontend faktisk kaller denne etter AdsGram sitt `onReward`,
krediteres balansen — men fortsatt uten noen admin-synlig hendelse (Funn 1
gjelder uansett hvilken vei som brukes).

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Diagnostisk full-request-logging i `/ads/callback` (finne ekte AdsGram-payload) | **PAUSET** | `main` (Shahnameh-backend, live checkout) | `07277e4` | — | Ikke deployet | Committet, la stå (additiv, egen fil, bør ikke krysse Agent As arbeid) — **ikke deploy før Agent A sier ifra** | se § 2.1.1 |
| Undersøke/rette AdsGram Reward URL-konfigurasjon (mangler `blockId`) | **Nedprioritert** | — | — | — | — | — | Sannsynligvis en symptom, ikke rotårsaken — se § 2.1.1. Vent på Agent As SDK-fiks først |
| Sette `ADSGRAM_BLOCK_ID_BRONZE/SILVER/GOLD` i Shahnameh `.env` | Not started | — | — | — | — | — | samme — vent på Agent A |
| Egen hendelseslogg-tabell for AdsGram-visninger (ikke bare saldo-inkrement) | Not started | — | — | — | — | — | **Sperret: ikke start før Agent As ekte AdsGram SDK-integrasjon er levert OG én test har gått gjennom hele kjeden** |
| Admin-side/visning for AdsGram-hendelser (Shahnameh-siden, ikke SetaLink-adminet) | Not started | — | — | — | — | — | samme sperre |

#### 2.1.0 Den ekte integrasjonsflyten (Khabat, 2026-07-18 — bindende spesifikasjon for Agent As bygg)

**Ikke bruk manuelt innskrevne eller estimerte AdsGram-tall som permanent
løsning.** Åtte steg, alle må være reelle, ikke simulert:

| # | Steg | Status |
|---|---|---|
| 1 | Brukeren starter AdsGram-annonsen (ekte SDK, ikke stub) | Not started — dette er Agent As hovedoppgave |
| 2 | AdsGram bekrefter fullført visning | Not started |
| 3 | Callback/verifisering mottas på backend | Delvis kode finnes (`handleCallback()`), men aldri reelt truffet — se § 2.1.1 |
| 4 | Eventet lagres i databasen | Not started — ingen hendelsestabell finnes ennå (kun saldo-inkrement), se § 2.1.2 |
| 5 | Brukeren krediteres **kun én gang** (idempotent) | Delvis — `creditAdReward()`s cooldown-mønster gir delvis idempotens, ikke verifisert mot duplikate callbacks spesifikt |
| 6 | Admin leser **de samme lagrede eventene** — ikke en separat, parallell kilde | Not started |
| 7 | Duplikate callbacks må være idempotente | Se rad 5 |
| 8 | Mislykkede eller uverifiserte visninger skal **ikke** gi reward | Delvis — `handleCallback()` avviser allerede ugyldig `secret`/`blockId`, men uten reward-visning i admin er dette ikke verifiserbart i praksis ennå |

**Hvis AdsGram ikke tilbyr et direkte statistikk-API for earnings:**
impressions/completions/rewards kan komme fra våre egne verifiserte
events (steg 3–4 over), men **offisiell inntekt merkes eksplisitt "venter
på AdsGram rapport/import"** — aldri et anslått tall fremstilt som ekte.
Samme prinsipp som § 0.1/§ 8.0, anvendt på annonseinntekt spesifikt.

#### 2.1.1 Agent As pipeline-audit — dypere rotårsak enn antatt (2026-07-17)

**Khabat relayerte Agent As funn: Shahnameh-frontend (`season2/app.js`)
kjører fortsatt en stub-annonseleverandør, ikke ekte AdsGram SDK.**
Jeg verifiserte dette selv direkte i koden før jeg la det til grunn (ikke
bare stolt på relayen) — `season2/app.js` linje ~1508–1574: en falsk
1,5-sekunders "Ad loading…"-overlay, deretter et rått kall til
`/api/ads/claim` (stub-endepunktet, logger til `ad-rewards.json`) — **aldri**
den ekte AdsGram-widgeten, AdsGram sin callback/HMAC-verifisering, eller
`/v1/grant` mot REAL-ledgeren. Koden sier det selv: *"No real ad SDK is
wired — the stub provider is intentional and visible in the audit log."*

**Dette gjør mitt Funn 2 over (tom `blockId`) sannsynligvis til en
konsekvens, ikke rotårsaken:** hvis den ekte AdsGram-widgeten aldri lastes
klient-side, har AdsGram ingen ekte visning å sende en ekte postback for i
utgangspunktet. Det som *har* truffet `/ads/callback` er trolig ikke
relatert til hovedbrukerflyten. Reward URL/blockId kan fortsatt være en
separat, reell feil (Khabats eget poeng), men den er ikke hovedproblemet
før SDK-flyten er implementert.

**Stanset per Khabats instruks:** ingen videre endringer i
`routes/adminApi/ads.js`, `lib/adsgram.js`, eller andre AdsGram-filer i
`shahnameh-backend`, og ingen Ads Event Log, før Agent A har levert den
ekte AdsGram-integrasjonen og én test har gått gjennom hele kjeden
(ekte SDK → ekte annonse → ekte callback med gyldig `blockId` → HMAC
verifisert → `/v1/grant` krediterer REAL-ledgeren). Koordinert i
`docs/realgram/TASK_SPLIT.md` (ny oppføring, 2026-07-17) for å unngå
parallelle endringer i samme filer.

**Ikke funnet:** en skriftlig kopi av Agent As fulle audit-rapport — sjekket
`TASK_SPLIT.md`, `DECISIONS.md`, `COORDINATION_HUB.md` og nylige commits i
begge Shahnameh-repoene, ingen egen audit-fil. Kun koden selv, som
bekrefter funnet. Om den ligger i `/coord`, har ikke denne økten
`AGENT_COORD_API_KEY` — kan ikke lese den derfra.

#### 2.1.2 Kø for når Agent A er ferdig (Khabats instruks, 2026-07-17)

**Oppdatering samme dag (runde 1):** Khabat kjørte en ny ekte AdsGram-test
fra Telegram. Ventet først — rørte ikke AdsGram-filer/-logger parallelt
med Agent As analyse.

**Oppdatering, runde 2:** Khabat kjørte enda en test (belønning viste som
gitt, admin fortsatt 0) og ba **denne økten** eksplisitt undersøke hele
kjeden og finne den faktiske rotårsaken (ikke en workaround). Gjort,
read-only + kun diagnostisk logging, ingen forretningslogikk endret:

**Definitivt funnet — sporet admin-dashboardets egen lesevei, ikke bare
callback-loggen:** `GET /season2/admin/ads-stats`
(`routes/adminApi/season2Admin.js:524`) leser **kun** to kilder:
`ad-callback.log` (skrevet kun av den ekte callback-en) og
`Season2User.ad_watch_count`/`last_ad_watch` (skrevet kun av
`creditAdReward()`, kalt fra enten den ekte callback-en eller den ekte
klient-rapporterte veien `/season2/ads/verify-reward`). Knappen brukeren
faktisk trykker (`season2/app.js`s `grant()`) kaller `POST /api/ads/claim`
— stub-handleren — som skriver til en **helt separat fil**
(`ad-rewards.json`) og aldri rører noen av de to kildene admin faktisk
leser. **Det er strukturelt umulig for denne veien å noensinne flytte
admin-tallene, uansett hvor mange ganger noen trykker.** Ikke en
backend/database/admin-API-feil — alle tre leser riktig fra riktig sted.
Kjeden brekker ved første steg: klienten kaller aldri et
ekte-AdsGram-koblet endepunkt i det hele tatt.

Lagt til enda en diagnostisk logglinje (`shahnameh-backend` commit
`0db15a5`): hvert `/api/ads/claim`-treff logges nå til en ny
`ad-stub-claim.log`, så en side-om-side-sammenligning mot
`ad-callback-raw.log` (runde 1s diagnostikk) gjør dette observerbart i
praksis, ikke bare bevisbart ved kodelesing. Ingen av de to diagnostiske
commitene er deployet.

**Postet til den faktiske koordineringsbus-branchen** (`feature/realgram-foundation`,
ikke `docs/admin-noc-roadmap` som forrige runde — oppdaget at mine
tidligere notater trolig aldri nådde Agent A siden de lå på feil branch).

Event Log/Ads Performance starter først når Agent A bekrefter en fullført
ende-til-ende-flyt.

**Sperret til Agent A har levert alle fem:** ekte AdsGram SDK, ekte
callback, HMAC-verifisering, REAL-ledger-kreditering (`/v1/grant`), **og**
én verifisert ende-til-ende-test. Ingen av radene under starter før det.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| 1. Ads Event Log | Not started | — | — | — | — | — | Agent As AdsGram-levering, se over — **feltskjema presisert 2026-07-18, se § 2.1.2.1** |
| 2. Ads Performance Dashboard | Not started | — | — | — | — | — | samme, + Ads Event Log (1) som datakilde — **per annonsetype, jf. § 2.0-taksonomien, ikke slått sammen** |
| 3. AdsGram vs AdMob Comparison | Not started | — | — | — | — | — | samme, + § 2s AdMob-rader (eCPM/fill rate osv.) |
| 4. KPI-grafer | Not started | — | — | — | — | — | samme |
| 5. Hakim Ads-oppsummering | Not started | — | — | — | — | — | § 8 (Hakim), § 8.0 sannhetsprinsippet — må lese ekte data fra (1)–(4), ikke oppsummere plausibelt |

##### 2.1.2.1 Ads Event Log — feltskjema (Khabat, 2026-07-18)

Én rad per annonsehendelse, **uavhengig av type** (banner/rewarded/
interstitial, AdMob/AdsGram) — dette er kilden § 2.0s taksonomi og
§ 2.1.2s Performance Dashboard begge leser fra, ikke separate tabeller
per nettverk.

| Felt | Betydning |
|---|---|
| `provider` | `admob` \| `adsgram` |
| `format` | `banner` \| `rewarded` \| `interstitial` |
| `app_source` | `realgram` \| `shahnameh` |
| `user_id` | REAL_ID/telegram_id — se § 6.1/§ 2.1 for hvilken identitet som faktisk er tilgjengelig på hvert punkt i kjeden |
| `unit_id` | AdMob/AdsGram enhets-ID |
| `impression_at` | Tidspunkt annonsen ble vist |
| `completed_at` | Tidspunkt visningen ble fullført (rewarded/interstitial — `null` for banner) |
| `callback_received` | Om server-side callback faktisk kom inn |
| `reward_granted` | Om belønning faktisk ble gitt |
| `reward_amount` | Beløp/mengde belønnet |
| `revenue` | Inntekt — `null`/"venter på rapport" hvis ikke offisielt bekreftet, aldri et gjettet tall, jf. § 2.1.0 |
| `external_event_id` | AdsGram/AdMob sin egen hendelses-ID, for idempotens og kryssjekk mot deres paneler |
| `status`/`error` | Feilkode/status for hendelser som ikke fullførte |

**Hard regel (samme som § 2.0):** `format` skiller banner fra rewarded fra
interstitial i **denne samme tabellen** — ikke separate tabeller som kan
drive fra hverandre. Én kilde, filtrert på `format`/`provider`, ikke flere
kilder som må holdes synkronisert manuelt.

**Rollefordeling (Khabat, 2026-07-17, supersedert 2026-07-11-splitten i
`TASK_SPLIT.md`):** Agent A eier Shahnameh/AdsGram SDK/Wallet/REAL_ID/
RealGram/Hakim/frontend-backend-flyt; Agent B eier Admin/Analytics/SEO/
Ads-dashboards/Kapasitet/Infrastruktur/Monitoring/NOC — se
`TASK_SPLIT.md`s nye oppføring for detaljer. **Uavklart:** om "Agent B" i
denne splitten er meg (denne dev-VPS-økten) eller den opprinnelige,
separate Agent B-økten — spurt Khabat direkte om dette i chat. Køen over
starter uansett når Agent A er ferdig, av hvilken økt som helst som eier
"Agent B"-omfanget.

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

## § 5 — MOBILE APP VISUAL REDESIGN: Realink = RealGram (neste store mobile build)

Lagt til 2026-07-17, **revidert samme dag** etter Khabats oppfølging
("dette begynner å ligne retningen jeg ser for meg, men vi gjør noen
viktige endringer før vi bygger videre"). **Kodesperre, eksplisitt fra
Khabat:** dette er neste store mobile-redesign, **etter** § 1–§ 4
(Admin/NOC) er ferdig og fungerer — ikke noe som startes nå. Dokumenteres
her nettopp for å ikke miste spesifikasjonen mens admin-arbeidet pågår
(§ 0.3-regelen).

> **Prosessregel, Khabats egne ord: "La oss bygge denne retningen steg for
> steg, og vis alltid preview før du implementerer større endringer."**
> Gjelder når § 5-arbeidet faktisk starter — ingen store visuelle endringer
> uten en preview til Khabat først, ett steg om gangen, ikke alt på én gang.

**Hva som faktisk endret seg i revisjonen** (så ingen bygger mot den gamle
versjonen — begge stod i konflikt med hverandre, ikke bare en presisering):
- **Bannerrekkefølgen er snudd** — se § 5.7, AdMob/AdsGram gikk fra plass 1
  til plass 3.
- **Starlink-teksten endret** fra "Secure • Stable • Satellite" til
  "Secure / Stable / Private / Low latency" — se § 5.3.
- **Connect-knappen har nå eksplisitte fargetilstander** (gull outline AV,
  grønn PÅ, rød frakobler) — nytt, se § 5.5.1.
- **Footeren er nå fullt spesifisert** (fire konkrete faner, ingen egen
  VPN-knapp) — tidligere "ikke ferdig ennå", se § 5.8.
- **Tap-to-Earn samler nå også routing/packet loss/server score**, ikke
  bare latency/stabilitet — se § 5.5.
- **Følelsen er kvantifisert**: 90 % premium / 10 % gaming — se § 5.9.

### 5.1 Brand — REALINK = REALGRAM, ett produkt

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Realink og RealGram slås sammen til ett produkt — VPN er én funksjon blant flere, ikke hele appens identitet | Not started | — | — | — | — | — | § 1–4 må være ferdig først |
| Hele appen føles som en kommunikasjonsplattform med fri internettilgang, ikke en "VPN-app" | Not started | — | — | — | — | — | samme |

### 5.2 Designfilosofi og designspråk

**Ikke en "gaming app" — en premium Generation Z-app.** Referanser, direkte
fra Khabat: Telegram, Revolut, Nothing, Apple, SpaceX. Mørk, ren, eksklusiv,
minimal. **Ikke for mye neon.**

| Element | Krav | Status |
|---|---|---|
| Primærfarge | Gold | Not started |
| Bakgrunn | Mørk blå/svart | Not started |
| Grønn | **Kun** når noe er PÅ eller Connected — ikke en generell aksentfarge. Skal føles spesielt når det vises | Not started |
| Rød | **Kun** når noe er AV eller feiler | Not started |
| Retning | Premium Gen Z — Telegram/Revolut/Nothing/Apple/SpaceX. Elegant, **ikke** gaming | Not started |

**Verifisering ved `Live`:** skjermbilde sammenlignet direkte mot forrige
("for grønt") mockup, med en eksplisitt vurdering av om grønn faktisk kun
vises ved PÅ/Connected-tilstand.

#### 5.2.1 Header — i hovedsak uendret

Khabat: *"Headeren er bra... ingen store endringer."* Kun: VIP kan være
gull; Wallet/profil kan være gull. Meldinger og Settings-ikonene
uendret. **Ikke** en full redesign-oppgave — en liten presisering.

### 5.3 Starlink — WOW-faktoren

**Revidert tekst** (var "Secure • Stable • Satellite", se korrigering
øverst i seksjonen).

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Vis Starlink-parabol (dish), ikke bare tekst — stor, ikke liten | Not started | — | — | — | — | — | — |
| Tekst: Secure / Stable / Private / Low latency | Not started | — | — | — | — | — | — |
| Premium badge | Not started | — | — | — | — | — | — |
| Følelse av ekte satellittnettverk — "Wow, dette er noe annet enn en vanlig VPN" | Not started | — | — | — | — | — | designvurdering, ikke kun en oppgaveliste |
| **Ingen landsnavn vist — kun "STARLINK"** | Not started | — | — | — | — | — | hard krav, ikke valgfritt |

### 5.4 Speedometer — lite, premium instrument

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Mye mindre enn en full skjermfyller — inspirert av sportsbil-instrumenter | Not started | — | — | — | — | — | — |
| Viser kun: Current Speed, Latency, Status | Not started | — | — | — | — | — | — |
| Dominerer ikke skjermen | Not started | — | — | — | — | — | — |

### 5.5 Tap to Earn ZAR — erstatter connect-knappens gamle plass

**Viktig kobling:** dette er samme ZAR-mekanisme som § 9 (REAL Wallet)
allerede dokumenterer (ZAR er allerede live som tap-to-earn-valuta siden
build 92, jf. § 9.0) — denne redesignen endrer *konteksten og plasseringen*
(egen seksjon, en levende aktivitet mens VPN er tilkoblet), ikke selve
ZAR-mekanismen fra bunnen.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Egen "Tap to Earn ZAR"-seksjon, ikke lenger sammenfallende med connect-knappen | Not started | — | — | — | — | — | — |
| Genererer ZAR per tap | Not started | — | — | — | — | — | § 9.0 (eksisterende ZAR-mekanisme) |
| Hjelper AI med å analysere nettverket | Not started | — | — | — | — | — | § 3 Adaptive Routing |
| Samler: latency, stabilitet, routing, packet loss, server score | Not started | — | — | — | — | — | koble til eksisterende Tap-to-Learn-telemetri (§ 3, `NODE_INTELLIGENCE_ARCHITECTURE.md`) hvis samme infrastruktur kan gjenbrukes — sjekk før noe bygges nytt |
| Føles som en levende aktivitet mens VPN er tilkoblet, ikke en engangsknapp | Not started | — | — | — | — | — | designvurdering |
| Brukerfølelsen: "jeg hjelper nettverket OG tjener ZAR samtidig" | Not started | — | — | — | — | — | designvurdering |

#### 5.5.1 Connect-knappen — egen, enkel, fargekodet (nytt i revisjonen)

| Tilstand | Farge | Status |
|---|---|---|
| OFF | Gull outline | Not started |
| ON | Grønn | Not started |
| Disconnecting | Rød | Not started |

Ren, premium knapp — ingen ekstra dekor utover fargetilstanden.

### 5.6 Servervalg — uendret fra forrige runde

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| To valg: AI Auto (standard) og Manual (for avanserte brukere) | Not started | — | — | — | — | — | — |
| AI Auto er forhåndsvalgt | Not started | — | — | — | — | — | § 3 Adaptive Routing må faktisk styre "AI Auto"-valget med ekte logikk, ikke en tilfeldig/statisk serverliste presentert som "AI" |

### 5.7 Bannerrekkefølge — **snudd i revisjonen**

| Rekkefølge | Banner | Status |
|---|---|---|
| 1 | Gratis kvote (Watch video) | Not started |
| 2 | Inviter 11 venner → Starlink Premium | Not started |
| 3 | AdMob/AdsGram banner | Not started |

**Dette er MOTSATT rekkefølge av den forrige versjonen av denne
seksjonen** (som hadde AdMob/AdsGram først) — bruk denne, ikke den gamle.
Avhenger av § 2 (Ads & Revenue, selv sperret til Agent A er ferdig med
AdsGram) for at AdMob/AdsGram-banneret faktisk viser ekte annonser.

#### 5.7.1 Starlink Premium-kort (nytt i revisjonen)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Stort gull-kort med Starlink-parabol | Not started | — | — | — | — | — | — |
| Tekst i retning: "STARLINK PREMIUM / Invite only 11 friends / Unlock secure satellite routing" | Not started | — | — | — | — | — | — |
| Skal føles som noe folk *får lyst til* å oppnå, ikke bare en informasjonsboks | Not started | — | — | — | — | — | designvurdering |

### 5.8 Footer — **fullt spesifisert i revisjonen** (var "ikke ferdig ennå")

| Fane | Ikon | Status |
|---|---|---|
| Home | 🏠 | Not started |
| Stats | 📊 | Not started |
| Shahnameh | 📖 | Not started |
| Profile | 👤 | Not started |

**Ingen egen VPN-knapp i footeren** — konsistent med § 5.1 (VPN er én
funksjon, ikke appens identitet). Shahnameh direkte tilgjengelig, ikke
gjemt bak et annet menyvalg.

### 5.9 Følelsen — kvantifisert i revisjonen: 90 % premium / 10 % gaming

Khabats formulering: *"Dette ser ikke ut som en VPN"* → *"Dette ser ut som
fremtidens kommunikasjonsplattform."* Konkretisert denne runden:
**90 % premium, 10 % gaming — ikke omvendt.** Mer luft, mer spacing, større
typografi, mindre visuell støy. Mer Apple/SpaceX. Mindre cyberpunk. Vi
skal imponere med kvalitet, ikke med mange effekter. Dette er et
kvalitetsmål som § 5.1–§ 5.8 samlet skal oppfylle — verifiseres ved
skjermbilde-gjennomgang mot dette målet spesifikt, ikke en egen kode-oppgave.

**Seksjonens Done:** alle underseksjoner `Live`, skjermbilder av alle
berørte skjermer, **og** en eksplisitt vurdering (ikke bare påstått) av om
90/10-målet i § 5.9 faktisk er nådd — sammenlign mot forrige "for
grønt"-mockup som referansepunkt for hva som IKKE er målet. Preview vist
til Khabat før hver større endring (prosessregelen øverst i seksjonen),
ikke bare ved ferdigstillelse.

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
| **REAL_ID som langsiktig kanonisk identitet** (Telegram = midlertidig primær, ikke permanent) — `realgram_profiles.id` formaliseres som REAL_ID | Not started | — | — | — | — | — | `REALGRAM_NATIVE_MESSAGING_DESIGN.md` § 2.1 — denne repoens del kan gjøres uavhengig |
| Fremtidige identitetskoblinger: Apple, Google, telefonnummer, e-post, wallet-adresse — alle peker mot samme REAL_ID | Not started | — | — | — | — | — | `realgram_identity_links.system` utvides, ingen skjemaendring nødvendig |
| **"Aldri mist wallet/Shahnameh-progresjon/REAL/ZAR/kvote/clan/venner/historikk selv om Telegram kobles fra"** | Not started | — | — | — | — | — | **Krever Shahnameh-side migrasjon** (season2_users.telegram_id er selve Mongo-nøkkelen i dag, ikke bare en fremmednøkkel) — Agent B/Shahnameh-backend-eier må avklare, ikke løsbart kun fra denne repoen |

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

**Korrigert 2026-07-17, se `REALGRAM_NATIVE_MESSAGING_DESIGN.md` § 0/§ 4:**
backend-ledgeren finnes allerede og er live — `qe_transfer()`
(`lib/quota_economy.php:370`), `POST action=transfer-quota`
(`public/api.php:1207`), med egen mobilskjerm allerede skipet
(`TransferScreen.tsx`). Atomisk, auditert, med anti-fraud-grenser allerede
håndhevet (min 100 MiB, maks 50 GiB/dag, 10 overføringer/dag). Det som
faktisk mangler er kun **chat-integrasjonen** (velge mottaker fra en
samtale, systemmelding i tråden) og admin-historikkpanelet — ikke
ledgeren selv.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Backend-ledger (atomisk, anti-fraud, rate limiting, min/maks) | **Live** (allerede eksisterende, forut for dette roadmap-arbeidet) | main | — | — | — | `lib/quota_economy.php:370`, `public/api.php:1207` | ingen — gjenbruk, ikke bygg på nytt |
| Chat-integrasjon: velg mottaker fra samtale, kall eksisterende `transfer-quota`, sett inn `messages`-rad (`kind='quota_transfer'`) | Not started | — | — | — | — | — | § 6.12 |
| Systemmelding i chat ("Du sendte 500 MB") | Not started | — | — | — | — | — | § 6.12 |
| Push + saldo-oppdatering hos mottaker | Not started | — | — | — | — | — | delvis live via `push_device_message`, må kobles til ny chat-visning |
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
| 2 | Foreslått datamodell vist | Testing (skrevet, venter på gjennomgang) | Nei — se `REALGRAM_NATIVE_MESSAGING_DESIGN.md` § 1 |
| 3 | Kartlegging av hvilke eksisterende user-ID-systemer som må slås sammen | Testing (skrevet, **Shahnameh-feltet bekreftet 2026-07-17** — `season2_users.telegram_id`, lest direkte fra backend-koden, ingen åpne avklaringer igjen) | Nei — se samme dok § 2 |
| 4 | Migreringsplan (eksisterende VPN-/Shahnameh-brukere mister ikke konto eller saldo) | Testing (skrevet, venter på gjennomgang) | Nei — se samme dok § 3 |
| 5 | Wireframes: Chats, Direct Message, Warrior Profile, Clan Chat | Testing (tekst-wireframes skrevet + Artifact publisert) | Nei — se samme dok § 5 |
| 6 | Godkjenning fra Khabat | Not started | Nei |

**Fase 1-koding kan ikke starte før rad 2–6 over er `Done`/`Ja`.**

---

## § 7 — REALGRAM CINEMATIC ONBOARDING & HELP CENTER

Lagt til 2026-07-17 på Khabats instruks. **Dette er kosmetisk/UI-arbeid på
mobilappen** — samme kategori Khabat selv eksplitt satte på vent i denne
roadmapens aller første instruks: *"Jeg ønsker ikke flere kosmetiske
endringer før infrastrukturen er ferdig."* og *"Ingen APK før admin og
backend er ferdig."*

> **📌 Sekvensering (antagelse — si fra hvis feil):** § 7 legges inn i
> roadmapen nå (§ 0.3-regelen: nytt arbeid dokumenteres før det bygges),
> men **kodesperret** til § 1 (Admin Redesign), § 2 (Ads & Revenue) og
> § 3 (Kapasitet) står som `Live`, **og** § 6s Fase 1
> (messaging) er godkjent og har startet. Ingenting under er implementert
> eller påbegynt. Hvis Khabat vil at noe spesifikt her (f.eks. Help
> Center-strukturen, som er innhold/dokumentasjon mer enn kode) skal
> prioriteres tidligere, må det sies eksplisitt — antagelsen over gjelder
> til noe annet er bekreftet.

### 7.1 Åpningssekvens (cinematic intro, 3–6 sek)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Mørk scene + svak ørkenvind-lyd | Not started | — | — | — | — | — | § 1–3, § 6 Fase 1 |
| Gyllen sand-animasjon som gradvis forsvinner | Not started | — | — | — | — | — | samme |
| REAL-logo avdekkes i polert gull under sanden | Not started | — | — | — | — | — | samme |
| Svakt gullskinn sprer seg | Not started | — | — | — | — | — | samme |
| Tekst: "REAL is more than a token." → "Freedom • Community • Knowledge" | Not started | — | — | — | — | — | samme |
| Fade fra logo til app | Not started | — | — | — | — | — | samme |
| Ingen eksplosjoner/overdrevne effekter — rolig, premium, filmatisk | Not started | — | — | — | — | — | designprinsipp, ikke en oppgave i seg selv |
| **Hakim dukker rolig opp** — kun avatar + navn, ingen chatboble, ingen supportbot-følelse | Not started | — | — | — | — | — | § 8 (Hakim må eksistere som karakter/avatar først) |
| Én kort velkomst: *"Velkommen. Du har funnet mer enn en app. Du har funnet et fellesskap."* + `[Fortsett]` | Not started | — | — | — | — | — | samme |

**Hakim som første karakter, lagt til 2026-07-17:** dette er **ikke** en
chatboble eller en supportbot-introduksjon — Hakim leder brukeren inn i
RealGram-universet én gang, rolig, så trer han tilbake til
tilgjengelig-når-ønsket (§ 8.1s "aldri mase"-regel, se under). Dette er
det første av mange stedene samme visuelle karakter (§ 8.1.1) må gjenkjennes.

### 7.2 Onboarding (5–6 sider, kan hoppes over) — Hakim-narrert

Hver side har nå én kort Hakim-linje i tillegg til ikon/tittel — dette
erstatter de tidligere generiske beskrivelsene under, ikke et tillegg til dem.

| Side | Innhold | Hakim-linje | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 🌍 VPN | *"Frihet begynner med en trygg forbindelse."* | Not started | — | — | — | — | — | § 1–3, § 6 Fase 1 |
| 2 | 🛰 Starlink | *"Noen bygger nettverket. Andre styrker det."* | Not started | — | — | — | — | — | § 3 (Kapasitet) |
| 3 | 💬 RealGram | *"Et community er sterkere enn en kontaktliste."* | Not started | — | — | — | — | — | avhenger av § 6 Fase 1 faktisk live |
| 4 | ⚔️ Shahnameh | *"Historier skaper helter. Helter bygger fellesskap."* | Not started | — | — | — | — | — | § 1–3 |
| 5 | 💰 REAL Wallet | *"Verdi er sterkest når den deles."* | Not started | — | — | — | — | — | § 9 (Wallet & Community Economy) |
| 6 | 🚀 "Velkommen til RealGram" / "Alt er klart" + [Koble til] | — | Not started | — | — | — | — | — | alle over |

**Hard regel (uendret, nå også gjeldende Hakim-linjene):** ingen
onboarding-side eller Hakim-linje skal reklamere for en funksjon som ikke
faktisk er `Live` (§ 0.1) på det tidspunktet siden vises til en ekte
bruker — spesielt side 2 (Starlink), side 3 (RealGram-meldinger) og side 5
(REAL Wallet-enhet av REAL/ZAR/Data), som alle i dag er under bygging.

### 7.3 Help Center — er egentlig Hakim, ikke en separat FAQ-UI

**Presisert 2026-07-17:** brukeren søker ikke i en FAQ-liste — brukeren
**spør Hakim**, og Hakim svarer ved å bruke den ekte dokumentasjonen under
som kilde. Kategoriene/artikkelstrukturen nedenfor er derfor **Hakims
kunnskapsbase**, ikke en konkurrerende browse-UI — se § 8.6 for
spørsmål/svar-grensesnittet selv. Rekkefølgen "brukeren spør → Hakim
svarer fra ekte dokumentasjon" er selve poenget: hvis dokumentasjonen
under mangler, må Hakim si ⚪ "jeg vet ikke ennå" (§ 8.0), ikke gjette.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Dokumentasjonskilde (ikke en egen browse-først-UI) med søkbar struktur | Not started | — | — | — | — | — | § 1–3 |
| Kategorier: VPN, Starlink, Shahnameh, RealGram, Clan, REAL, ZAR, Rewards, Ads, Data Sharing, Security, Troubleshooting, Getting Started | Not started | — | — | — | — | — | samme |
| Artikkelmal: illustrasjon + kort forklaring + steg-for-steg + video (senere) + relaterte artikler | Not started | — | — | — | — | — | samme |
| Kjerneartikler: invitere venner, Starlink, tjene REAL, hva er ZAR, sende datakvote, clans, koble Telegram, spille Shahnameh | Not started | — | — | — | — | — | artikler om Starlink/RealGram/datakvote/Telegram avhenger av at § 3/§ 6 faktisk er live |
| Hakim-spørsmål/svar-grensesnitt bruker denne kilden | Not started | — | — | — | — | — | § 8.6, samme dokumentasjon |

### 7.4 Innebygde guider (contextual overlay, første gang en funksjon åpnes)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Overlay peker på nøkkelknapper, 2–3 korte steg, ingen lange tekster | Not started | — | — | — | — | — | § 1–3, § 6 Fase 1 |
| Eksempler: "Her finner du Starlink", "Her sender du datakvote", "Her ser du helten din" | Not started | — | — | — | — | — | samme |

### 7.5 Progressiv opplæring (dag 1–5, gradvis funksjonsoppdagelse)

| Dag | Mål | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|---|
| 1 | Koble VPN | Not started | — | — | — | — | — | — |
| 2 | Se første annonse | Not started | — | — | — | — | — | § 2 |
| 3 | Inviter én venn | Not started | — | — | — | — | — | — |
| 4 | Spill første Shahnameh-kapittel | Not started | — | — | — | — | — | — |
| 5 | Bli med i en clan | Not started | — | — | — | — | — | § 6 Fase 2 (clan-chat) |

### 7.6 Første gang appen åpnes — Hakim hjelper direkte (ikke en veiviser-modal)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Opprette profil | Not started | — | — | — | — | — | § 6.1 (`realgram_profiles`) |
| Velge @handle | Not started | — | — | — | — | — | § 6.1 |
| Forklare wallet | Not started | — | — | — | — | — | § 9 (REAL Wallet) |
| Forklare ZAR | Not started | — | — | — | — | — | § 9 |
| Forklare REAL | Not started | — | — | — | — | — | § 9 |
| Forklare datakvote | Not started | — | — | — | — | — | eksisterende quota-ledger |
| Forklare clan | Not started | — | — | — | — | — | § 6.5 |
| Forklare hvordan man inviterer venner | Not started | — | — | — | — | — | eksisterende `referral_uses` |

**Hard regel:** dette er Hakim som svarer/veileder direkte når brukeren
trenger det (§ 8.1s "tilgjengelig, ikke masete") — **ikke** en tvungen
7-stegs modal-veiviser brukeren må klikke seg gjennom før appen åpnes.

**Seksjonens Done (§ 7 samlet):** alle underseksjoner `Live` med
skjermbilder, **og** verifisert at ingen onboarding/help-center/Hakim-tekst
reklamerer for noe som ikke faktisk er live på deployment-tidspunktet.

---

## § 8 — Hakim AI · Guardian of the Network

Lagt til 2026-07-17 på Khabats instruks. Én AI-assistent, samme
personlighet og samme "ansikt" overalt i økosystemet (VPN → RealGram →
Shahnameh → Starlink → REAL) — den røde tråden som gjør de fem
delsystemene til ett merkevareopplevd hele.

### 8.0 Sannhetsprinsippet (den viktigste regelen i § 8 — utvidet 2026-07-17)

**Dette er samme verifiser-før-du-påstår-prinsipp som § 0.1/§ 0.2 håndhever
for agenter i denne roadmapen, nå håndhevet for Hakims faktiske svar til
ekte brukere — samme filosofi, to domener.** Hakim skal alltid vite hvilken
av disse tre kategoriene et svar tilhører, og aldri blande dem:

| Kategori | Farge | Betyr | Eksempel |
|---|---|---|---|
| **Fakta** | 🟢 grønn | Lest direkte fra ekte, live data — VPN-status, Starlink-status, saldo, meldinger, SEO, Ads, servere, Shahnameh-progresjon | "Du har 1,2 GB igjen." |
| **Anbefaling** | 🔵 blå | En vurdering Hakim gjør, ikke en observasjon — skal alltid merkes som nettopp det | "Jeg anbefaler Finland fordi den har lavere ping enn Norge akkurat nå." |
| **Ukjent** | ⚪ grå | Data mangler, funksjonen finnes ikke ennå, eller Hakim ikke har tilgang | "Jeg vet ikke ennå." / "Denne funksjonen er ikke aktivert." / "Jeg har ikke tilgang til disse dataene." |

**Hard regel, ikke forhandlingsbar: Hakim skal aldri dikte opp et svar.**
En nodeanbefaling må lese ekte telemetri fra § 3 (Kapasitet); et
ulest-sammendrag må lese ekte meldingsdata fra § 6; en referral-status må
lese ekte data fra eksisterende `referral_uses`. Hvis den underliggende
dataen ikke er `Live` (§ 0.1) ennå, svarer Hakim **⚪ Ukjent** for det
området — aldri et plausibelt, oppdiktet 🟢-svar. En selvsikker AI som
lyver er verre enn et dashboard som viser `0`.

**Verifisering ved `Live` (gjelder hele § 8, ikke bare 8.0):** et
representativt utvalg faktiske Hakim-svar skal vise alle tre farger i
praksis — minst ett 🟢-svar mot ekte data, ett 🔵-svar tydelig merket som
anbefaling, og ett scenario i den grå "Ukjent"-kategorien der Hakim faktisk sier "jeg vet ikke" i
stedet for å gjette. Mangler det siste eksempelet, er sannhetsprinsippet
ikke verifisert, uansett hvor bra de to første ser ut.

### 8.1 Personlighet (bindende spesifikasjon, ikke smakssak)

| Egenskap | Krav |
|---|---|
| Tone | Klok og rolig, inspirert av en gammel vismann — **ikke** en morsom chatbot |
| Lengde | Kort og tydelig, aldri langdryg |
| Stemme | Føles som en mentor, ikke teknisk support |
| Kulturelt anker | Små, naturlig plasserte sitater fra Shahnameh — aldri påtvunget der det ikke passer |
| **Tilgjengelighet** | Aldri masete — ingen popup-spam, ingen "Hei! Trenger du hjelp?"-varsler. Hakim er tilgjengelig når brukeren selv oppsøker ham, ikke pushy |
| **Visuell identitet** | **Samme avatar overalt** — VPN, Shahnameh, Wallet (§ 9), Admin, Community. Skal alltid føles som samme person, uansett sone (§ 8.1.1) |

**Verifisering ved `Live`:** et lite eksempel-utvalg av faktiske Hakim-svar
(minimum: én VPN-anbefaling, én Shahnameh-hint, ett Help Center-svar)
vedlagt skjermbilde-leveransen, så tonen kan vurderes mot tabellen over —
ikke bare påstått fulgt. For Tilgjengelighet/Visuell identitet:
skjermbilder av Hakims avatar fra minst tre ulike soner side om side (bevis
på gjenkjennbarhet), og en eksplisitt bekreftelse på at ingen uoppfordret
popup/varsel fra Hakim finnes i implementasjonen.

**Langsiktig merkevareposisjon (kontekst, ikke en oppgave i seg selv):**
Hakim er ment å bli et av tre ting brukeren husker når de tenker på
RealGram — REAL-logoen, Hakim, Community — ikke bare "en VPN-app". Dette
er hvorfor visuell/tonal konsistens (denne seksjonen) og
sannhetsprinsippet (§ 8.0) begge er bindende, ikke valgfrie finpuss: en
karakter som skal *bære merkevaren* kan ikke variere i utseende eller lyve
i svar uten at hele poenget forsvinner.

#### 8.1.1 Kontekstuell tone (samme karakter, ulik oppførsel per sone)

Lagt til 2026-07-17. **Én Hakim, ikke fire assistenter** — grunntonen fra
tabellen over (klok, rolig, mentor) holder seg konstant; det som endres
per sone er register og lengde, ikke personlighet.

| Sone | Register |
|---|---|
| VPN | Kort og teknisk |
| Shahnameh | Litt mer historiefortellende, inspirert av eposet |
| RealGram | Vennlig og sosial |
| Admin/NOC | Ren, profesjonell, datadrevet |

**Verifisering:** samme svar-eksempel-krav som § 8.1 over, men fordelt slik
at minst ett eksempel fra hver sone er med — hvis alle eksemplene lyder
identisk uansett sone, er dette punktet ikke bestått selv om § 8.1s
grunntone stemmer.

### 8.2 I VPN

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Anbefaler beste node | Not started | — | — | — | — | — | § 3 (ekte node-telemetri må være `Live` først) |
| Forklarer hvorfor en node er raskere/mer stabil | Not started | — | — | — | — | — | § 3 |
| Varsler når Starlink er tilgjengelig | Not started | — | — | — | — | — | § 3 Starlink-kapasitet |
| Hjelper ved tilkoblingsproblemer | Not started | — | — | — | — | — | eksisterende diagnostikk (`Network Intel`-fanen) |

### 8.3 I Shahnameh

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Veileder gjennom historiene | Not started | — | — | — | — | — | Shahnameh-backend (separat repo) — grensesnitt TBC med Agent B |
| Gir hint i oppdrag | Not started | — | — | — | — | — | samme |
| Forteller om persisk historie/mytologi | Not started | — | — | — | — | — | innholdsarbeid, ikke bare kode |
| Belønner progresjon | Not started | — | — | — | — | — | eksisterende REAL/milestone-ledger |

### 8.4 I RealGram

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Finner venner/clan-medlemmer | Not started | — | — | — | — | — | § 6 (identitet/clan-data må være `Live`) |
| Oppsummerer uleste meldinger | Not started | — | — | — | — | — | § 6 (ekte meldingsdata) |
| Oversetter meldinger mellom språk (ved behov) | Not started | — | — | — | — | — | § 6, + valg av oversettelses-API (ikke besluttet) |
| Foreslår relevante grupper/communities | Not started | — | — | — | — | — | § 6 Fase 2 (clans) |

### 8.5 I REAL-økonomien

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Forklarer hvordan man tjener REAL/ZAR | Not started | — | — | — | — | — | § 2 (ekte tall, ikke placeholder) |
| Viser referral-fremgang | Not started | — | — | — | — | — | eksisterende `referral_uses`-tabell |
| Forklarer hvordan datakvoter fungerer | Not started | — | — | — | — | — | — |
| Hjelper med overføringer | Not started | — | — | — | — | — | eksisterende `qe_transfer()`, se `REALGRAM_NATIVE_MESSAGING_DESIGN.md` § 0 |

### 8.6 I Help Center (erstatter tradisjonell FAQ)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Fritekst-spørsmål ("Hvordan får jeg Starlink?" osv.) besvares direkte av Hakim | Not started | — | — | — | — | — | § 7.3 (Help Center-innhold må finnes som kilde) |
| Erstatter navigering gjennom hjelpesider, ikke bare et tillegg til dem | Not started | — | — | — | — | — | samme |

### 8.7 Hakim Memory (differensiator — ingen andre VPN-apper har dette)

Husker brukerens faktiske aktivitet i RealGram og gjenbruker den proaktivt
— **alltid** ved å lese ekte data (§ 8.0), aldri ved å finne på noe.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| "Du inviterte 8 venner. Tre til, så låser du opp Starlink." | Not started | — | — | — | — | — | eksisterende `referral_uses` + § 3 Starlink-unlock-logikk |
| "Du fullførte kapittel 5 i Shahnameh i går." | Not started | — | — | — | — | — | Shahnameh-backend (separat repo), avhenger av § 8.3 |
| "Du har 1,2 GB som snart utløper." | Not started | — | — | — | — | — | eksisterende quota-ledger (`lib/quota_economy.php`) |
| "Clan-en din mangler to medlemmer før neste bonus." | Not started | — | — | — | — | — | § 6.5 (clan-data må være `Live`) |

**Hard regel:** hver påstand Hakim Memory gjør må kunne spores til én
konkret spørring mot ekte data — samme prinsipp som § 8.0, anvendt på
minne spesifikt. Ingen "antatt aktivitet".

### 8.8 Dagens visdom

Én kort melding per dag — enten en generert leveseetning i Hakims tone
(§ 8.1) eller et ekte sitat fra Shahnameh, aldri begge blandet uten at det
er tydelig hvilket som er hvilket.

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Én kort melding/dag, matcher personlighetsspesifikasjonen i § 8.1 | Not started | — | — | — | — | — | § 8.1 |
| Ekte Shahnameh-sitater brukt der det passer naturlig (ikke tvunget inn daglig) | Not started | — | — | — | — | — | krever en faktisk kilde-liste med sitater, ikke generert av Hakim selv (unngår at et "sitat" er oppdiktet — jf. § 8.0) |

### 8.9 Hakim Advisor Mode

To tydelige moduser — brukeren vet alltid hvilken av dem Hakim er i:

| Modus | Oppførsel |
|---|---|
| **Assistant Mode** (standard) | Svarer på spørsmål, forklarer funksjoner, leser kun ekte data, følger § 8.0 rett frem |
| **Advisor Mode** (brukeren aktiverer eksplisitt) | Analyserer brukerens situasjon og gir anbefalinger basert på ekte data — men strukturert i tre atskilte deler hver gang, aldri flytende sammen |

**Advisor Mode-svar skal alltid ha tre atskilte deler:**
1. **Observerte fakta** — 🟢, direkte lest data
2. **Mulige alternativer** — hva situasjonen faktisk åpner for
3. **Anbefalt handling** — 🔵, Hakims vurdering, begrunnet med *hvilke*
   data den bygger på (ikke bare en konklusjon uten kilde)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Modus-bryter (Assistant ⇄ Advisor), tydelig hvilken modus som er aktiv | Not started | — | — | — | — | — | § 8.0 |
| "Du er 3 invitasjoner unna Starlink." | Not started | — | — | — | — | — | § 3 (Starlink-unlock), `referral_uses` |
| "Finland-noden har vært mest stabil den siste uken." | Not started | — | — | — | — | — | § 3 (ekte node-telemetri over tid, ikke et øyeblikksbilde) |
| "Clan-en din mangler én aktiv spiller for neste bonus." | Not started | — | — | — | — | — | § 6.5 (clan-data) |
| "Du har nok ZAR til å konvertere til REAL." | Not started | — | — | — | — | — | § 2/§ 8.5 (ekte saldo, ekte kurs — ikke placeholder) |

**Hard regel:** Advisor Mode skal **aldri** presentere spekulasjon som
fakta — dette er § 8.0 anvendt strengt på en modus som per definisjon gir
vurderinger, ikke bare observasjoner. Hvis "Mulige alternativer" eller
"Anbefalt handling" ikke tydelig kan skilles fra "Observerte fakta" i et
faktisk skjermbilde, er ikke denne seksjonen `Live`.

### 8.11 Hakim Admin — egen adminside (Khabat, 2026-07-17)

**Bakgrunn:** `hakim-bot.service` kjører allerede i produksjon (funnet
2026-07-17, se § 2.1.1s naboseksjon i chat-historikken — kjørt siden
11. juli, ekte data i `hakim.db`: `bot_messages`, `bot_users`). I dag:
**ingen admin-UI leser den**, til tross for at koden selv har en
kommentar som sier den er ment for "admin live-log view". Khabats
instruks: gi Hakim en egen, førsteklasses adminside — ikke en skjult
tjeneste.

**Bygget 2026-07-17/18** på `feat/admin-noc-consolidated` (commit
`8ab2df5`) + instrumentering i `hakim-bot` selv (commits `054221d`,
`5435222`, ikke deployet — restart av `hakim-bot.service` nødvendig).

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Bot-status (Online/Offline) | **Testing** | `feat/admin-noc-consolidated` | `8ab2df5` | — | Ikke deployet | `systemctl is-active hakim-bot` bekreftet lesbar av `www-data` uten ny sudo-tilgang; `php -l` OK | venter på deploy |
| Hvilken modell brukes (OpenAI/Anthropic/fallback) | **Testing** | `feat/admin-noc-consolidated` | `8ab2df5` | — | Ikke deployet | Leser `bot_config.ai_provider`/`openai_model`/`anthropic_model` direkte fra `hakim.db` | venter på deploy |
| Antall forespørsler | **Testing** | `feat/admin-noc-consolidated` | `8ab2df5` | — | Ikke deployet | `COUNT(*) FROM bot_messages WHERE direction='in'` — bekreftet 30 rader i dag | venter på deploy |
| Suksessrate | **Testing (kode), ingen data ennå** | `feat/admin-noc-consolidated` + `hakim-bot@054221d` | `8ab2df5` / `054221d` | — | Ingen av delene deployet | Ny `bot_requests`-tabell + instrumentering i `bot.py` skrevet og syntakssjekket — siden viser ærlig "No data yet" til `hakim-bot` er restartet, ikke et gjettet tall | venter på deploy + restart av `hakim-bot.service` |
| Gjennomsnittlig svartid | **Testing (kode), ingen data ennå** | samme som over | samme | — | samme | `latency_ms` måles nå med `time.monotonic()` rundt provider-kallet i `bot.py` | samme |
| Feillogg | **Testing (kode), ingen data ennå** | samme som over | samme | — | samme | `bot_requests.error`-feltet, lest og vist i admin — tomt til restart | samme |
| Kunnskapskilder | **Testing** | `feat/admin-noc-consolidated` | `8ab2df5` | — | Ikke deployet | Leser faktisk `KNOWLEDGE_DIR`-mappen — bekreftet: 1 fil (`rikets-lover.md`), 1,2 KB | venter på deploy |
| Siste oppdatering | **Testing** | `feat/admin-noc-consolidated` | `8ab2df5` | — | Ikke deployet | `MAX(updated_at) FROM bot_config` | venter på deploy |
| Konfigurasjon av Advisor Mode | Not started (siden viser ærlig "ikke implementert ennå") | — | — | — | — | — | § 8.9 selv er ikke bygget klient-side ennå — ingen falsk bryter vist |
| Test-spørsmål mot Hakim | **Testing** | `feat/admin-noc-consolidated` + `hakim-bot@5435222` | `8ab2df5` / `5435222` | — | Ingen av delene deployet | `admin_test_query.py` gjenbruker `bot.py`s eksakte provider/config/kunnskaps-kode — ekte API-kall, ekte kostnad per test, skriver ikke til `bot_messages`/`bot_users`/`bot_requests` (unngår å forurense ekte brukstall) | venter på deploy |

**Hard regel:** denne siden skal lese `hakim-bot`s faktiske, kjørende
tilstand (`hakim.db`, `systemctl status`, `journalctl`) — ikke en egen,
parallell kopi av statusen som kan divergere fra virkeligheten. Samme
prinsipp som § 8.0: ingen plausibel, oppdiktet "Online"-status.

**🔒 Sikkerhetsfunn, ikke rettet (utenfor denne oppgavens omfang, men
viktig):** `bot_config`-tabellen i `hakim.db` lagrer `openai_api_key`,
`anthropic_api_key` og `telegram_token` i **klartekst**, lesbar av
`www-data` (samme bruker som kjører SetaLink-adminet og trolig andre
apper på boksen). `hakim-status`-spørringen velger eksplisitt kun
`ai_provider`/`bot_active`/`openai_model`/`anthropic_model` — aldri disse
kolonnene — men selve det at nøklene ligger slik er en reell
hemmelighets-hygiene-svakhet. Ikke rettet av meg (krever trolig
nøkkelrotasjon, en beslutning jeg ikke tar stille); flagget her og i
sluttrapporten til Khabat.

**Seksjonens Done (§ 8 samlet):** hver deltabell `Live` med ekte
data-koblinger (ingen fabrikkerte svar, jf. § 8.0), personlighetskravene i
§ 8.1 verifisert med eksempel-svar som dekker alle tre fargekategorier
(§ 8.0) **og** alle fire soner (§ 8.1.1), Advisor Mode verifisert med et
skjermbilde der Observerte fakta / Mulige alternativer / Anbefalt handling
er synlig atskilt (§ 8.9), Hakim Admin-siden (§ 8.11) viser ekte
bot-tilstand, skjermbilder.

---

## § 9 — REALGRAM WALLET, VIZH & COMMUNITY ECONOMY

Lagt til 2026-07-17 på Khabats instruks. **Vizh** brukes her som navnet på
**overføringsfunksjonen** ("trykk Vizh for å sende"), ikke som navnet på
walleten selv — Khabats egen presisering i samme melding. Walleten heter
**REAL Wallet**; Vizh er knappen/handlingen, omtrent slik "Vipps" er blitt
et verb.

### 9.0 Hva finnes allerede — les før noe designes som "nytt"

**Viktig funn, verifisert direkte i `docs/realgram/TASK_SPLIT.md` og
`DECISIONS.md`, 2026-07-17:** en betydelig del av "REAL Wallet" er
**allerede live**, ikke et nytt konsept:

- **REAL-saldo + innløsning:** panelets `real-wallet`-handling (A-2) og
  mobilens wallet-kort på Profile + redeem-sheet (A-3), gated bak
  remote-config `rc_real_wallet_enabled`. Per `TASK_SPLIT.md` linje 192:
  **"The full wallet loop is LIVE for build-88 devices."** Backend:
  Shahnameh-siden `/v1/verify-spend`, `/v1/balance/:account`, `/v1/spend`
  (B-1), live mot `real_balance`-ledgeren siden 2026-07-11/12.
- **ZAR:** allerede live siden build 92 som tap-to-earn-mynt mens
  tilkoblet (`TASK_SPLIT.md` B-15/linje 756) — **ZAR→REAL-konvertering er
  IKKE bygget ennå**, kun ZAR-opptjening.
- **Data Quota:** eksisterende ledger (`lib/quota_economy.php`), inkludert
  p2p-overføring (`qe_transfer()`, se `REALGRAM_NATIVE_MESSAGING_DESIGN.md`
  § 0 — allerede live, brukt av § 6.6).
- **Tonkeeper:** brukes allerede for premium-betaling
  (`docs/PREMIUM-REAL-PAYMENTS.md` — Tonkeeper-deeplink, TON Connect), men
  **kun for kjøp**, ikke som en generell import/eksport-bro for en
  eksisterende REAL-saldo.

**Det som faktisk er nytt i dette kapittelet:**
1. **Én samlet REAL Wallet-visning** på tvers av REAL + ZAR + Data (i dag
   tre separate steder/skjermer).
2. **ZAR→REAL-konvertering** (opptjening finnes, konvertering finnes ikke).
3. **Vizh — p2p-overføring av REAL og ZAR mellom brukere** (Data-transfer
   finnes allerede via § 6.6; REAL/ZAR har i dag kun bruker→system
   (redeem), ikke bruker→bruker).
4. **Tonkeeper som generell import/eksport-bro**, ikke bare betalingsflyt.
5. **Community Treasury + transparens** — helt nytt, ingen eksisterende kode.

### 9.1 REAL Wallet (samlet visning) — designprinsipp, utvidet 2026-07-17

**Grunnregel:** REAL Wallet skal føles som **én enkel lommebok**, uansett
hvor mange systemer som faktisk ligger under (VPN-panelet, Shahnameh
MongoDB, Tonkeeper, ecosystem-API-en i § 9.0). Brukeren skal **aldri**
måtte forstå eller se den forskjellen — kun:

**Én profil. Én wallet. Én historikk. Én identitet.**

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Saldo-visning: 💰 REAL, ⚡ ZAR, 🌐 Data, 🎁 Rewards, 📈 History | Not started | — | — | — | — | — | § 9.0 — kombinerer eksisterende kilder (`real_ecosystem_tx`/`season2_users` + `quota_transactions`), ikke ny ledger |
| Trykk på en saldo → Hakim forklarer hvor den kommer fra og hva den kan brukes til | Not started | — | — | — | — | — | § 8 (Hakim), § 8.0 (må lese ekte kildedata, aldri gjette forklaringen) |
| Samme wallet-komponent brukt i VPN, RealGram og Shahnameh (§ 9.6) | Not started | — | — | — | — | — | — |
| Del av brukerprofilen (§ 6.1) | Not started | — | — | — | — | — | § 6.1 |

#### 9.1.1 Én samlet historikk (ikke separate lister per system)

| Transaksjonstype | Status | Kilde (ekte, ikke oppfunnet) |
|---|---|---|
| Earned from Shahnameh | Not started | `real_ecosystem_tx` (`kind='grant'`) / Shahnameh AdsGram-motor |
| Referral reward | Not started | `referral_uses` (denne repoen) + tilsvarende på Shahnameh-siden |
| Ad reward | Not started | `ad_reward_events` (`REWARDED-ADS-RECOVERY.md`) |
| Community reward | Not started | § 9.5 Community Treasury — finnes ikke ennå, avhenger av at Treasury er bygget |
| Sent via Vizh | Not started | § 9.2 (ny p2p-ledger) |
| Received via Vizh | Not started | § 9.2 |
| REAL conversion | Not started | ZAR→REAL-konvertering, § 9.0 punkt 2 (ikke bygget ennå) |
| ZAR conversion | Not started | samme |
| Data transfer | Not started | **allerede live** — `quota_transfer`/`qe_transfer()` |
| Premium purchase | Not started | `docs/PREMIUM-REAL-PAYMENTS.md` — designet, ikke skipet til mobil |

**Hard regel:** denne tabellen viser eksplisitt at en "samlet historikk" i
praksis må slå sammen minst tre-fire forskjellige eksisterende/planlagte
kilder (`real_ecosystem_tx`, `quota_transactions`, `ad_reward_events`,
`referral_uses`, fremtidig Vizh-ledger). Brukeren skal aldri se sømmen —
men det betyr at sammenslåingslaget selv er en ekte teknisk oppgave, ikke
bare en UI-visning av én tabell. Ingen rad her kan settes `Live` før den
faktisk leser fra kilden sin, jf. § 0.1/§ 8.0 — en historikk-rad som ser
riktig ut men er hardkodet er nøyaktig den typen placeholder-data denne
roadmapen finnes for å luke ut.

### 9.2 Vizh (ویژ) — overføringshandlingen

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| "Vizh"-knapp fra chat eller brukerprofil | Not started | — | — | — | — | — | § 6.2/§ 6.4 (UI-plassering) |
| Send Data | Not started | — | — | — | — | — | **Allerede live backend** — `qe_transfer()`, kun UI-kobling gjenstår (samme som § 6.6) |
| Send REAL | Not started | — | — | — | — | — | **Ny** — dagens REAL-ledger støtter bruker→system, ikke bruker→bruker; trenger egen p2p-transfer-funksjon, samme rigor som `qe_transfer()` (atomisk, idempotent, anti-fraud) |
| Send ZAR | Not started | — | — | — | — | — | **Ny**, samme som Send REAL — pluss ZAR→REAL-konvertering (§ 9.0 punkt 2) må avklares først: sendes ZAR som ZAR, eller konverteres den underveis? Åpent spørsmål, ikke besluttet her |
| Mottaker får: push-varsel + melding i chat + wallet oppdatert + historikk | Not started | — | — | — | — | — | § 6 (meldingssystem), samme mønster som § 1.4 i messaging-designdokumentet |

**Hard regel:** Send REAL og Send ZAR er **pengeoverføring**, ikke en
visuell mockup — samme regel som § 6.6 allerede sier om datakvote, nå
strengere fordi REAL/ZAR er verditokens. Backend-ledger for p2p REAL/ZAR
må være sikker, testet og gjennomgått **før** noe her settes `Live` — ikke
etter.

### 9.3 Tonkeeper (ekstern blockchain-bro)

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| REAL Wallet er dagligwalleten — brukeren trenger normalt ikke åpne Tonkeeper | Not started | — | — | — | — | — | designprinsipp, ikke egen kodeoppgave |
| REAL Wallet → Tonkeeper-flyt ved faktiske blockchain-operasjoner | Not started | — | — | — | — | — | utvider eksisterende Tonkeeper-deeplink fra `PREMIUM-REAL-PAYMENTS.md` |
| Koble egen Tonkeeper-konto | Not started | — | — | — | — | — | — |
| Eksportere REAL (RealGram → on-chain) | Not started | — | — | — | — | — | on-chain REAL-pris er fortsatt simulert per `INTEGRATION_MAP.md` §1 — avklar hva "eksport" betyr før implementering |
| Importere REAL (on-chain → RealGram) | Not started | — | — | — | — | — | samme |

### 9.4 Community First — prinsipp (styringsbeslutning, ikke kode)

| Punkt | Status |
|---|---|
| RealGram skal ikke maksimere profitt — målet er et selvforsterkende community | Not started (prinsipp, må formaliseres skriftlig og godkjennes av Khabat) |
| Inntektskilder: AdsGram, AdMob, Premium, fremtidige tjenester | Delvis live — AdsGram/AdMob eksisterer (§ 2), Premium designet men ikke skipet (`PREMIUM-REAL-PAYMENTS.md`) |
| Etter driftskostnader (servere, Starlink, båndbredde, utvikling, sikkerhet, likviditetsbuffer) → overskudd tilbake til communityet | Not started — krever regnskapsmessig kildekobling, se § 9.7 |

### 9.5 Community Treasury

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| 7 bruksområder: liquidity buyback, airdrops, gratis datakvote, Shahnameh-belønninger, clan rewards, referral rewards, community events | Not started | — | — | — | — | — | § 9.4 må være besluttet først |
| Admin-styrt prosentfordeling (eksempel: 40 % liquidity / 30 % airdrops / 20 % data quota / 10 % reserve) | Not started | — | — | — | — | — | knyttes til § 1 admin-arbeid — egen adminside, samme designsystem |
| Fordelingen er justerbar av admin, ikke hardkodet | Not started | — | — | — | — | — | — |

**Hard regel:** enhver Treasury-fordeling som vises — til brukere eller i
admin — må være **ekte, utbetalte/reserverte tall**, aldri en projeksjon
fremstilt som et faktum. Samme prinsipp som § 0.1/§ 8.0, anvendt på
faktiske pengestrømmer: dette er stedet i hele roadmapen der en
placeholder-verdi ville gjøre mest skade.

### 9.6 Delt wallet i Shahnameh

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Shahnameh viser REAL, ZAR, Data, Rewards, Achievements fra samme wallet som VPN/RealGram | Not started | — | — | — | — | — | § 9.1, krever avklaring med Agent B/Shahnameh-backend om felles datamodell |

### 9.7 Transparens

| Oppgave | Status | Branch | Commit | PR | Deploy-tid | Verifisering | Blokkeringer |
|---|---|---|---|---|---|---|---|
| Offentlig synlig: annonseinntekt inn | Not started | — | — | — | — | — | § 2 (Ads & Revenue) må ha ekte tall først |
| Offentlig synlig: serverkostnader ut | Not started | — | — | — | — | — | § 3 (Kapasitet) |
| Offentlig synlig: beløp tilbake til liquidity | Not started | — | — | — | — | — | § 9.5 |
| Offentlig synlig: airdroppet beløp | Not started | — | — | — | — | — | § 9.5 |
| Offentlig synlig: delt datakvote | Not started | — | — | — | — | — | § 9.5 |

**Seksjonens Done (§ 9 samlet):** § 9.0s fem "faktisk nytt"-punkter alle
`Live` med ekte tall/koblinger (ingen av dem gjenoppfinner det som
allerede finnes), Community Treasury-fordelingen faktisk admin-justerbar
og verifisert med et ekte tall-eksempel (ikke bare et forslag),
transparens-tallene i § 9.7 lest fra samme kilder som admin selv bruker
(§ 2/§ 3) — aldri en egen, separat "pen versjon" av tallene, skjermbilder.

---

## § 10 — Rapporteringsformat (bindende, erstatter fritekst-rapportering)

Enhver agent som rapporterer status på en oppgave i denne roadmapen skal
oppdatere raden direkte i denne filen (Status/Branch/Commit/PR/Deploy-tid/
Verifisering/Blokkeringer) — ikke bare skrive i chat at noe er "fikset".
Chat-oppsummeringer skal peke til den oppdaterte raden, ikke erstatte den.

Når en hel seksjon (§1–§4) har alle rader på `Live`, samles skjermbilder av
*alle* admin-sider i seksjonen og leveres samlet til Khabat før seksjonen
kan rapporteres som ferdig.
