# AdsGram inquiry — draft, not sent

Task B-5 / `OPEN_QUESTIONS.md` Q2. This is a **draft only** — sending it
needs an AdsGram account/support channel and a decision on who signs it as
the sender, neither of which this session has. Ready to paste into
AdsGram's support chat, a support ticket, or an email once Khabat (or
whoever holds the AdsGram dashboard login) is ready to send it.

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
[Khabat / SetaLink — sender to confirm before sending]

---

## After sending

Log AdsGram's answer in `DECISIONS.md` (new dated entry) and update
`OPEN_QUESTIONS.md` Q2 status. If the answer is "no" or "not yet," the
in-chat sponsored card placement in `MONETIZATION_AND_REWARDS.md` needs a
fallback (Mini-App-style rewarded video is still confirmed working
regardless of this answer — only the *native in-chat card* idea depends on
it).
