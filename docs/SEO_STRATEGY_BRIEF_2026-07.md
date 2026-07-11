# SEO Strategy Brief — ReaLink / setalink.no (2026-07)

**For:** the ReaLink SEO agent/system.
**From:** Agent A (dev box), at Khabat's direction 2026-07-11.
**Scope of this brief:** keyword strategy + what to work on next. Decision
locked with Khabat: **Iran / Persian only for now** — see §4 on why zh/ru
Google SEO is deprioritized.

This is a strategy brief, not an implementation. It's grounded in the actual
Google Search Console data below, not assumptions.

---

## 1. The data reality (why the current strategy needs to change)

GSC has been syncing into `keyword_ranks` (source `gsc`) since 2026-07-10.
As of this brief:

- **The whole site is effectively invisible in search.** The only query that
  registers is the brand term **`setalink`** — 1 impression, position ~3.
- **All 10 seeded target keywords have 0 impressions** after a week:
  `فیلترشکن`, `فیلترشکن رایگان`, `دانلود فیلترشکن`, `فیلترشکن قوی`,
  `فیلترشکن پرسرعت`, `بهترین فیلترشکن`, `فیلترشکن بدون قطعی`,
  `فیلترشکن اندروید`, `فیلترشکن آیفون`, `V2Ray ایران`.

**Diagnosis:** those 10 are the most-fought head terms in the entire Iranian
censorship-circumvention market. `فیلترشکن رایگان` is owned by sites with
years of backlinks and topical authority. setalink.no is a brand-new domain
(live early July, domain authority ~0). It will not rank for the head term
for many months **no matter how many times the word appears in the H1**. The
current keyword set bets everything on the one term the site cannot win yet,
so it earns zero visibility in the meantime.

## 2. The strategic shift

Stop optimizing for head terms as the *primary* target. Optimize for what a
new domain can actually rank for **now**, build topical authority, and let the
head terms become reachable in 6–12 months as authority accrues. Keep the head
terms *tracked* (aspirational) but move content and on-page focus to:

### 2a. App-specific intent (users search for what they want to unblock)

Highest-intent, far less competitive than bare `فیلترشکن`:

- `فیلترشکن اینستاگرام` / `فیلترشکن برای اینستاگرام`
- `فیلترشکن واتساپ`
- `فیلترشکن تلگرام`
- `فیلترشکن یوتیوب`
- `باز کردن اینستاگرام` (open Instagram)

### 2b. Problem / question intent (blog-native, lowest competition)

These match how frustrated users actually phrase things, and they map
directly to ReaLink's real differentiator (a tunnel that holds under DPI):

- `چرا فیلترشکن قطع میشه` (why does my filtershekan disconnect)
- `فیلترشکنی که قطع نمیشه` (a filtershekan that doesn't disconnect)
- `فیلترشکن که واقعا کار کنه` (one that actually works)
- `بهترین فیلترشکن برای اینستاگرام`

### 2c. Carrier-specific (a genuine, data-backed differentiator)

ReaLink telemetry shows node reachability is **carrier-dependent** — Hetzner
is blackholed on Irancell/TCI but reachable on MCI/Hamrah-e Avval (see the
build backlog). That's real, true, and almost nobody writes about it:

- `فیلترشکن ایرانسل` (Irancell)
- `فیلترشکن همراه اول` (MCI)
- `فیلترشکن برای ایرانسل که کار کنه`

Content that honestly explains "which node/protocol works on which carrier"
is both useful and uncontested long-tail.

### 2d. Savvy / technical (exact product match, very low competition)

The V2Ray-literate crowd searches precisely, in low volume but with almost no
competition and perfect product fit (ReaLink = VLESS+REALITY):

- `کانفیگ vless` (vless config)
- `کانفیگ ریالیتی` / `reality config`
- `آموزش v2ray` (v2ray tutorial)
- `تفاوت vless و vmess` (vless vs vmess)
- `فیلترشکن vless`

### 2e. Current-events (time-sensitive, ranks fast)

Filtershekan search spikes around specific blackouts/throttling events. Fresh,
dated content ("Iran internet status today", "filtershekan during the
blackout") ranks quickly because it's timely and low-competition in the moment:

- `وضعیت اینترنت ایران امروز`
- `فیلترشکن برای قطعی اینترنت`

## 3. Content plan (what to actually write)

The blog (`/blog/`, 3 articles) is the right vehicle but too thin to build
authority. Build **clusters** — a pillar page + supporting articles that
inter-link, each targeting one long-tail cluster above:

1. **Instagram/WhatsApp cluster:** "بهترین فیلترشکن برای اینستاگرام و واتساپ",
   "چرا اینستاگرام با فیلترشکن باز نمیشه", each linking to the download CTA
   and to the pillar.
2. **"Doesn't disconnect" cluster:** the disconnect problem → why mvfst/QUIC
   sessions hang → the force-quit fix → why ReaLink's tunnel holds. This is
   ReaLink's true story and it's uncontested.
3. **Carrier cluster:** "کدام فیلترشکن روی ایرانسل کار می‌کند" etc., grounded
   in the real carrier-dependence finding.
4. **V2Ray/technical cluster:** vless vs vmess, what REALITY is, config
   basics — captures the savvy searchers who convert well.

Cross-link every article to the others and to the download CTA. Internal
linking is half of how a new domain builds authority.

## 4. Markets — Iran only for now (locked with Khabat 2026-07-11)

The site targets Iran/China/Russia, but the **Google-SEO effort should only go
where Google is the search engine**:

- **Iran — YES.** Google is dominant. This is where SEO pays off. All effort
  here for now.
- **China — NO (for Google SEO).** Google is blocked in China; users search on
  **Baidu**. Chinese-language Google SEO is wasted effort and GSC won't even
  see Chinese Google search. If China matters, it's a separate Baidu / non-SEO
  channel decision — not part of this brief.
- **Russia — PARKED.** **Yandex** is ~50%+ of Russian search; Google SEO is
  only half-useful there. If Russia becomes a priority, stand up **Yandex
  Webmaster** as its own track — don't dilute the Persian effort with ru
  Google keywords in the meantime.

Practical consequence: **don't spread the seed keyword list across fa/zh/ru.**
Concentrate the whole tracked set on Persian long-tail (§2).

## 5. What to change operationally

- **Reseed `keyword_ranks`** (the `seed`-source rows): keep the 10 head terms
  as *tracked-but-aspirational*, and add the §2 long-tail set as the primary
  tracked targets. The GSC sync's `top_untracked` suggestions should also be
  reviewed weekly and promoted into the tracked set as real impressions appear.
- **On-page:** the landing H1 already leads with the head term; that's fine to
  keep, but the *new content* (blog clusters) should target §2 long-tail, not
  restate the head term.
- **Brand consistency:** the product rebranded setalink → **ری‌لینک / ReaLink**.
  Make sure brand mentions/anchor text are consistent so the brand term (which
  already ranks #3) consolidates rather than splitting between two names.
- **Backlinks:** a new domain needs links. The SetAI dofollow footer link
  exists; pursue a few more relevant, honest links (the point is authority,
  not volume).
- **Measurement expectation:** first wins will show up on §2 long-tail in
  *weeks*, on head terms in *months*. Judge progress by long-tail impressions
  climbing, not by head-term rank (which will stay ~nowhere for a while — and
  that's expected, not failure).

## 6. What NOT to do

- Don't keep pouring on-page real estate into `فیلترشکن رایگان` expecting it to
  move — it won't for a new domain, and the effort is better spent on §2.
- Don't fabricate ratings/reviews or stuff keywords — the existing work
  correctly avoided fake `AggregateRating`; keep that discipline (Google
  penalties are worse than slow growth).
- Don't spend on zh/ru Google keywords now (§4).

---

*Infra note for the SEO agent: GSC service account + daily sync
(`admin/gsc_sync.php`, cron 06:17 UTC) already feed `keyword_ranks`. The
domain property is `sc-domain:setalink.no`. The tracked-keyword seed list is
the lever to change first.*
