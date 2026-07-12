/* ==========================================================================
   RealGram Mini App — skeleton (task B-4)
   Path A per docs/realgram/PRODUCT_VISION.md: runs inside official Telegram,
   reuses Shahnameh's live season2 backend as the earn engine (AdsGram) and
   the new /season2/link-real-proof endpoint (task B-3) to link a SetaLink
   VPN device to the player's REAL account (== telegram_id).

   Deployment note (open question, see docs/realgram/OPEN_QUESTIONS.md):
   this file assumes it is served from behind the same reverse-proxy prefix
   Shahnameh's own frontend uses (`/api/season2/...` -> backend :45721,
   stripping `/api`). If RealGram gets its own domain, change API_BASE to a
   fully-qualified backend URL and add that origin to app.js's CORS list.
   ========================================================================== */
(function () {
  'use strict';

  const API_BASE = '/api'; // TODO: confirm final RealGram domain, see note above

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const tgUser = () => {
    try {
      return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
    } catch (_) { return null; }
  };

  const telegramId = () => {
    const u = tgUser();
    return u ? String(u.id) : null;
  };

  /* If launched via a SetaLink deep link (t.me/RealGramBot/app?startapp=<device_id>),
     Telegram exposes it here — pre-fills the link card so the user doesn't
     have to copy/paste the device ID by hand. */
  const startParamDeviceId = () => {
    try {
      const p = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
      return p ? String(p) : '';
    } catch (_) { return ''; }
  };

  const $ = (id) => document.getElementById(id);

  /* ── Balance ────────────────────────────────────────────────────────── */
  async function loadBalance() {
    const uid = telegramId();
    if (!uid) {
      $('balance-value').textContent = 'N/A';
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/season2/user/me?` + new URLSearchParams({ telegram_id: uid }), { cache: 'no-store' });
      const d = await r.json();
      if (d.status === 1 && d.user) {
        $('balance-value').textContent = Math.floor(d.user.real_balance || 0).toLocaleString();
      } else {
        $('balance-value').textContent = '0';
      }
    } catch (_) {
      $('balance-value').textContent = '—';
    }
  }

  /* ── Earn (AdsGram) — mirrors /var/www/shahnameh/season2/adsgram.js ──── */
  let watchBlockId = '';

  async function ensureWatchConfig() {
    try {
      const r = await fetch(`${API_BASE}/season2/ads/config`, { cache: 'no-store' });
      const d = await r.json();
      watchBlockId = (d && d.adsgram && d.adsgram.watch && d.adsgram.watch.blockId) || '';
    } catch (_) { /* leave blank, button stays disabled */ }
    $('watch-btn').disabled = !watchBlockId;
  }

  async function watchAd() {
    const status = $('watch-status');
    const uid = telegramId();
    if (!uid) { status.textContent = 'Open this from Telegram to earn.'; return; }
    if (!watchBlockId || !window.Adsgram) { status.textContent = 'Ads not available right now.'; return; }

    let controller;
    try {
      controller = window.Adsgram.init({ blockId: watchBlockId });
    } catch (e) {
      status.textContent = 'Could not start ad.';
      return;
    }

    status.textContent = 'Loading ad…';
    try {
      const result = await controller.show();
      if (!result || !result.done) {
        status.textContent = 'Ad skipped — no reward.';
        return;
      }
      const r = await fetch(`${API_BASE}/season2/ads/verify-reward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: uid, tier: 'watch' }),
      });
      const d = await r.json();
      if (d.status === 1) {
        status.textContent = `+${d.rewards.real} REAL` + (d.rewards.gems ? ` +${d.rewards.gems} gem` : '');
        loadBalance();
      } else if (d.error === 'cooldown') {
        status.textContent = `Come back in ${Math.ceil((d.wait_seconds || 0) / 60)} min.`;
      } else if (d.error === 'daily_limit') {
        status.textContent = 'Daily watch limit reached.';
      } else {
        status.textContent = 'Reward not granted.';
      }
    } catch (_) {
      status.textContent = 'Ad failed to load.';
    }
  }

  /* ── Link VPN device (task B-3) ───────────────────────────────────────
     Scheme confirmed by Agent A 2026-07-11 (docs/realgram/TASK_SPLIT.md):
     the Android manifest registers setalink:// and deepLinkService.ts only
     understands that scheme — the earlier realink:// guess would have
     no-op'd. Implemented app-side (parse + linkRealAccount, rejects a
     proof whose device_id isn't this device) on feat/ecosystem-phase1
     (f124fad). Param is `account`, not `real_account` — matches the app
     parser exactly, not this file's own API response field name. */
  const DEEPLINK_SCHEME = 'setalink://link-real-account';

  async function requestLinkProof() {
    const status = $('link-status');
    const uid = telegramId();
    const deviceId = $('device-id-input').value.trim();

    if (!uid) { status.textContent = 'Open this from Telegram to link.'; return; }
    if (!deviceId) { status.textContent = 'Enter the device ID from the SetaLink app.'; return; }
    // link-real-proof mints a proof that can claim a REAL wallet, so the
    // backend verifies the caller's identity itself (Telegram initData
    // HMAC, see lib/telegramAuth.js on the backend) instead of trusting a
    // client-supplied id — unlike balance/ads-reward above, which still
    // send telegram_id directly (accepted gap for those, see
    // README.md "Open questions" #4). tg.initData is the raw signed
    // string; initDataUnsafe (used elsewhere in this file) is parsed but
    // NOT verified, so it's the wrong one to send here.
    const rawInitData = tg && tg.initData;
    if (!rawInitData) { status.textContent = 'Open this from Telegram to link.'; return; }

    status.textContent = 'Requesting proof…';
    try {
      const r = await fetch(`${API_BASE}/season2/link-real-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: rawInitData, device_id: deviceId }),
      });
      const d = await r.json();
      if (r.status !== 200) {
        status.textContent = d.error === 'account_not_found'
          ? 'Play a bit of Shahnameh first, then try again.'
          : d.error === 'unauthorized'
          ? 'Could not verify your Telegram session — reopen this page.'
          : 'Could not get a link proof right now.';
        return;
      }

      const params = new URLSearchParams({
        device_id: d.device_id,
        account: d.real_account,
        ts: String(d.ts),
        sig: d.sig,
      });
      const deeplink = `${DEEPLINK_SCHEME}?${params.toString()}`;

      const a = $('proof-deeplink');
      a.href = deeplink;
      a.textContent = deeplink;
      $('proof-box').hidden = false;
      status.textContent = 'Proof valid for 10 minutes.';
    } catch (_) {
      status.textContent = 'Network error — try again.';
    }
  }

  function copyProofLink() {
    const link = $('proof-deeplink').href;
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  }

  /* ── TON Connect — wallet display only, skeleton.
     REAL redemption itself is off-chain (telegram_id-keyed ledger, see
     docs/realgram/DECISIONS.md "internal settlement, no on-chain ops"), so
     this is not wired into the earn/link flows above. Included because
     TASK_SPLIT.md B-4 names it explicitly; extend only if a real on-chain
     use case is decided. */
  function initTonConnect() {
    if (!window.TON_CONNECT_UI) return;
    try {
      new window.TON_CONNECT_UI.TonConnectUI({
        manifestUrl: new URL('tonconnect-manifest.json', document.baseURI).toString(),
        buttonRootId: 'ton-connect',
      });
    } catch (_) { /* non-fatal — wallet connect is optional in this skeleton */ }
  }

  /* ── Wire up ───────────────────────────────────────────────────────── */
  $('watch-btn').addEventListener('click', watchAd);
  $('link-btn').addEventListener('click', requestLinkProof);
  $('proof-copy').addEventListener('click', copyProofLink);

  const prefill = startParamDeviceId();
  if (prefill) $('device-id-input').value = prefill;

  loadBalance();
  ensureWatchConfig();
  initTonConnect();
})();
