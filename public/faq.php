<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · FAQ</title>
  <meta name="description" content="Frequently asked questions about SetaLink VPN — how it works, security, Android-only, invites, and more.">
  <meta name="robots" content="noindex,nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="icon" type="image/x-icon" href="/assets/logo/shirokhorshid/favicon.ico">
  <link rel="stylesheet" href="/css/main.css">
</head>
<body dir="ltr">
<div class="page-wrap">

<nav class="nav">
  <a href="/" class="nav-logo">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="32" height="32" alt="SetaLink">
    <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
  </a>
  <div class="nav-actions">
    <a href="/" style="font-size:.85rem;color:var(--text-2);text-decoration:none;transition:.2s" onmouseover="this.style.color='var(--gold)'" onmouseout="this.style.color='var(--text-2)'">← Back</a>
    <a href="/download/setalink-latest.apk" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      Download APK
    </a>
  </div>
</nav>

<div class="faq-page-hero">
  <div class="section-label">FAQ</div>
  <h1 style="font-size:clamp(2rem,5vw,3.5rem);font-weight:900;letter-spacing:-.04em;margin-bottom:16px">
    Frequently Asked Questions
  </h1>
  <p style="font-size:1.05rem;color:var(--text-2);max-width:500px;margin:0 auto;line-height:1.7">
    Real questions about how SetaLink actually works — no marketing fluff.
  </p>
</div>

<section class="section" style="padding-top:0;max-width:800px">
  <div class="faq-list">
<?php
$faqs = [
  [
    'How does the invite / referral system work?',
    'When you install SetaLink, the app generates a unique referral code tied to your device. Share that code with friends. When a friend installs the app and uses your code, both of you receive +512 MB of data. There is no limit on how many friends you can invite. The bonus is credited immediately after the friend\'s device registers.',
  ],
  [
    'What is the 1 GB emergency package and who qualifies?',
    'Every new device that installs SetaLink automatically receives 1 GB of free data — no account, no login, no credit card. It is called "emergency" because it is designed for someone who has just lost internet access. There are no eligibility requirements. The quota is tied to the device ID, not a user account.',
  ],
  [
    'How does the AI protocol optimizer decide which protocol to use?',
    'On every connection attempt, SetaLink tests three transports in parallel: VLESS+Reality (direct TLS to port 8443), VLESS+XHTTP (via nginx edge), and VLESS+WebSocket (via nginx edge). For each transport, it performs a real HTTP/HTTPS probe — an actual data request, not just a TCP handshake. The first transport to return real data wins. Subsequent connections start with the last winner, falling back to the others if it stops working.',
  ],
  [
    'How does SetaLink prevent "fake connected" states?',
    'Most VPNs declare success when a TCP connection to the server is established. SetaLink requires a full HTTP/HTTPS data response before marking the connection as valid. If the probe returns no data, a connection reset, or times out, the protocol is marked as failed and the next candidate is tried. This eliminates tunnels that are technically open but where traffic is not reaching the internet.',
  ],
  [
    'Does SetaLink keep logs? What data is stored?',
    'No user activity logs are kept. Device IDs are anonymous hashes generated on the device — the server never knows who the device belongs to. Aggregate statistics (connections per hour, which protocols worked) are stored in the analytics database, but these cannot be traced to individual users.',
  ],
  [
    'Why is SetaLink Android-only? What about iPhone?',
    'Android allows full TUN-based VPN without App Store gatekeeping. iOS requires App Store distribution and compliance with Apple\'s review policies — incompatible with operating an anti-censorship tool openly. The primary target regions (Iran and Turkey) have significantly higher Android market share. iOS support may come via TestFlight in a future phase.',
  ],
  [
    'What happens when Iran blocks a new SNI?',
    'Two systems handle this. First, Remote Config lets the admin push updated SNI priority lists to all apps immediately — no update required. Second, the AI optimizer tracks real success rates: if a working SNI stops returning data, its priority drops automatically. Both systems work together for fast manual override and long-term automatic adaptation.',
  ],
  [
    'How is VLESS+Reality traffic different from a VPN that gets blocked?',
    'VLESS+Reality makes tunnel traffic cryptographically indistinguishable from a normal TLS 1.3 handshake to a legitimate domain like www.microsoft.com. Deep Packet Inspection cannot distinguish SetaLink traffic from a browser connecting to Microsoft. This is why it is more resistant than Shadowsocks, V2Ray, or WireGuard in heavily censored regions.',
  ],
  [
    'What is the difference between connecting from Turkey vs Iran?',
    'Turkey has looser DPI with most standard SNIs working. Iran has stricter filtering — some SNIs that work in Turkey are blocked in Iran. SetaLink\'s AI optimizer adjusts the SNI priority order per region. Iran-specific SNI lists are maintained separately and updated via Remote Config as blocking patterns change.',
  ],
  [
    'What is the roadmap?',
    'Near-term: premium unlimited tier, more server nodes in the Middle East, improved referral UI. Medium-term: iOS TestFlight, community voting on new regions. Long-term: user-funded server expansion, open-source release of the protocol selection engine, and a decentralized config distribution system.',
  ],
];

foreach ($faqs as $i => [$q, $a]): ?>
    <div class="faq-item" id="faqq<?= $i ?>">
      <button class="faq-q" aria-expanded="false">
        <?= htmlspecialchars($q) ?>
        <svg class="faq-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="faq-a"><?= htmlspecialchars($a) ?></div>
    </div>
<?php endforeach; ?>
  </div>
</section>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="SetaLink" style="border-radius:7px">
      <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
    </div>
    <nav class="footer-links">
      <a href="/">Home</a>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener">Telegram</a>
      <a href="https://github.com/XS227/SetaLink" target="_blank" rel="noopener">GitHub</a>
      <a href="/download/setalink-latest.apk">Download APK</a>
    </nav>
    <p class="footer-copy">&copy; <?= date('Y') ?> SETAEI · SetaLink VPN</p>
  </div>
</footer>

</div>
<script src="/js/main.js" defer></script>
</body>
</html>
