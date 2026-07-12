# AdsGram inquiry — ✅ SENT 2026-07-12 (Khabat, via AdsGram Telegram)

Task B-5 / `OPEN_QUESTIONS.md` Q2. **FINALIZED 2026-07-12** — sender filled,
ready to send verbatim. Neither agent has an AdsGram account/support channel,
so KHABAT sends this via AdsGram's own channel (their support Telegram, the
dashboard support/ticket, or partners email — same login used for the
Shahnameh rewarded-video integration). Log AdsGram's answer back in
`DECISIONS.md` when it arrives.

---

**Subject:** Confirming "alternative clients" placement scope — native
in-chat sponsored card

**Body:**

Hi AdsGram team,

We're an existing publisher (Shahnameh, a Telegram Mini App game already
running your rewarded-video "watch & earn" integration) planning a second
product: a Telegram-compatible client app ("RealGram") built on TDLib,
distributed outside Telegram's own app (Google Play / App Store).

Your docs list four placement categories: Mini Apps, channels, bots, and
"alternative clients." Before we design around it, we need to confirm one
specific thing:

1. Does "alternative clients" cover a **native, locally-rendered sponsored
   card inside the chat list/timeline UI** of a third-party TDLib-based
   client — i.e., not a Mini App/WebView surface, but a card built with the
   app's own native UI components, populated by an ad unit your SDK/API
   returns?
2. If yes: what's the integration path for that specific placement — same
   SDK as your Mini App integration, a different SDK/API, or something not
   yet public in your docs?
3. What are the content/frequency/labeling requirements for that placement
   (we need to design correctly for both your policies and app-store ad
   disclosure rules from day one)?
4. Is there a minimum audience/volume requirement, or can we integrate this
   from a small initial user base and scale into it?

We're not asking you to greenlight the product — just to confirm whether
this specific placement is something your platform actually supports today,
so we scope our build against reality instead of marketing copy.

Happy to share more detail about the client (TDLib-based, VLESS+Reality
transport, Iran-market anti-censorship focus) if useful context for your
answer.

Thanks,
Khabat — SetaLink / Shahnameh (existing AdsGram publisher)

---

## After sending

Log AdsGram's answer in `DECISIONS.md` (new dated entry) and update
`OPEN_QUESTIONS.md` Q2 status. If the answer is "no" or "not yet," the
in-chat sponsored card placement in `MONETIZATION_AND_REWARDS.md` needs a
fallback (Mini-App-style rewarded video is still confirmed working
regardless of this answer — only the *native in-chat card* idea depends on
it).
