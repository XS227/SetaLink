<?php
/**
 * SetaLink audio/video calling — authorization, session bookkeeping, and
 * signaling-voucher minting. Mirrors lib/messaging.php's structure (every
 * function takes a PDO; identity resolution reuses quota_economy.php's
 * qe_fetch_device()/qe_resolve_device() and messaging.php's dm_is_blocked()
 * so calling shares the exact same trust boundary as DMs — a user blocked
 * from messaging someone is blocked from calling them too).
 *
 * `docs/realgram/TASK_SPLIT.md` A→B(162)/(164)/(166): Khabat asked for
 * friend-to-friend calling in the Inbox, audio first (video parked),
 * premium-gated, with the real-time media relay (TURN) kept off this VPS
 * — One.com blocks inbound UDP at the hypervisor level, confirmed during
 * the Starlink WireGuard work, so TURN has to live on `fi-hel` (Hetzner)
 * or a similar box, not here.
 *
 * ARCHITECTURE — why this file only does REST bookkeeping, not the
 * real-time signaling itself:
 *   This PHP backend (api.php) is stateless request/response — it can't
 *   hold an open connection to push "you have an incoming call" to a
 *   device that isn't actively polling. Real-time signaling (SDP offer/
 *   answer, ICE candidates, ring/accept/decline) needs a persistent
 *   connection, so it runs on a small standalone Node/socket.io relay
 *   (see calling-relay/, not deployed yet — same fi-hel-vs-this-box
 *   question as TURN, though this relay is light enough to not force the
 *   TURN answer either way).
 *
 *   This file is the *trust boundary* for that relay: the relay itself
 *   has no database and can't check premium status, blocks, or rate
 *   limits — it just relays messages between two sockets it's told to
 *   connect. Every call has to start here first (call_initiate()), which
 *   does all the real authorization checks and mints a short-lived signed
 *   voucher (HMAC-SHA256, same pattern as real_economy.php's
 *   re_verify_link_proof()) that the relay can verify on its own without
 *   a network round-trip back to this box.
 *
 * OPEN PRODUCT DECISIONS (flagged in TASK_SPLIT.md B→A(168), not silently
 * assumed — confirm before this ships):
 *   1. Only the CALLER needs to be premium to place a call; the callee
 *      can be a free-plan user answering. (Matches how most "premium
 *      feature" gates work — the person using the feature pays — but
 *      it's a real product call, not an obvious default.)
 *   2. V1 only delivers a ring while the callee's app is foregrounded
 *      (actively connected to the relay). No push-wake for a backgrounded/
 *      killed app yet — that needs real APNs VoIP-push (+CallKit) and FCM
 *      integration, a separate, larger phase. Calling someone whose app
 *      isn't open just reports "unavailable," same as any other offline
 *      state — an honest V1 limitation, not a bug.
 *
 * RESOLVED since (168): Khabat's testing-phase ask (A→B(170)) — calling
 * restricted to exactly her account + the Iran tester's, on top of (not
 * instead of) the premium gate — is `calling_allowlist` /
 * call_is_allowlisted() below. Empty allowlist = no restriction (the
 * eventual general-rollout state); this ships non-empty for now.
 *
 * fi-hel's coturn is installed+configured (A→B(168), Agent A) but not yet
 * started pending Khabat's go-ahead on the shared Starlink box — TURN
 * credential minting (call_ice_servers()) degrades to STUN-only until
 * calling_turn_secret is set, so this doesn't block shipping the rest.
 */

const CALL_MAX_PER_HOUR      = 10;   // per caller device — spam/harassment guard
const CALL_VOUCHER_TTL_SECS  = 60;   // call-scoped voucher lifetime (just long enough to connect+ring)
const CALL_PRESENCE_TTL_SECS = 300;  // "I'm online for calls" token lifetime, app refreshes while Inbox is open
const CALL_STALE_RINGING_SECS = 45;  // a call still 'ringing' after this long is treated as missed
// A call still 'accepted' after this long with no ended_at is abandoned, not
// a genuinely long conversation — belt-and-suspenders for the client-side
// failure this is meant to survive (TASK_SPLIT.md A->B(242)): if a client
// crashes/errors between call-accept and hangUp/call-end (found live,
// 2026-07-30 — an offer that never arrived left exactly this), the row used
// to stay 'accepted' forever, since only 'ringing' rows were ever swept —
// every future call_initiate() for either party then failed permanently
// with "you are already on a call" until someone fixed the DB by hand.
// 3 hours is generous enough to never touch a real in-progress call.
const CALL_STALE_ACCEPTED_SECS = 10800;

const CALL_TURN_HOST = '65.109.183.7'; // fi-hel — coturn, TASK_SPLIT.md A→B(168)

const CALL_SERVICE_SETTING_DEFAULTS = [
    // HMAC-SHA256 key shared with the standalone signaling relay (calling-
    // relay/) — empty = calling disabled entirely (relay can't verify any
    // voucher without it), same fail-safe posture as real_link_secret.
    'calling_relay_secret' => '',
    // coturn's static-auth-secret from fi-hel's /etc/turnserver.conf (TURN
    // REST API HMAC scheme, A→B(168)) — empty = calls still work but with
    // STUN only, no TURN relay (fine on networks that don't need one, a
    // hard failure on restrictive NATs/firewalls).
    'calling_turn_secret' => '',
    // Where the relay's internal push hook (calling-relay/server.js,
    // POST /internal/push) listens, e.g. http://127.0.0.1:8096/internal/push
    // — empty = real-time "you have an incoming call" push is skipped;
    // calling still works via the client re-checking call state, just
    // with a delayed ring instead of an instant one.
    'calling_relay_internal_url' => '',
    // Shared secret for the header above — distinct from calling_relay_secret
    // on purpose (see calling-relay/README.md's "why two secrets").
    'calling_relay_internal_secret' => '',
    // Comma-separated device_id and/or user_id values. Empty = no
    // restriction (final rollout state, gated only by the premium plan
    // check). Non-empty = ONLY listed identities may place or receive
    // calls — Khabat's testing-phase ask (TASK_SPLIT.md A→B(170)): just
    // her account and the Iran tester's while this is being validated.
    'calling_allowlist' => '',
];

// ── Schema ───────────────────────────────────────────────────────────────────

function call_ensure_schema(PDO $pdo): void {
    // Same settings table real_economy.php already creates — CREATE TABLE
    // IF NOT EXISTS makes re-declaring it here harmless if this path runs
    // first on a fresh DB.
    $pdo->exec('CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "",
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $existing = $pdo->query('SELECT key FROM settings')->fetchAll(PDO::FETCH_COLUMN);
    $existing = $existing ? array_flip($existing) : [];
    $ins = $pdo->prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    foreach (CALL_SERVICE_SETTING_DEFAULTS as $k => $v) {
        if (!isset($existing[$k])) $ins->execute([$k, $v]);
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS call_sessions (
        call_id           TEXT PRIMARY KEY,
        caller_device     TEXT NOT NULL,
        caller_user_id    TEXT DEFAULT '',
        callee_device     TEXT NOT NULL,
        callee_user_id    TEXT DEFAULT '',
        kind              TEXT DEFAULT 'audio',
        status            TEXT DEFAULT 'ringing',
        started_at        TEXT DEFAULT (datetime('now')),
        accepted_at       TEXT DEFAULT NULL,
        ended_at          TEXT DEFAULT NULL,
        end_reason        TEXT DEFAULT '',
        duration_secs     INTEGER DEFAULT 0
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_call_sessions_caller ON call_sessions(caller_device, started_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_call_sessions_callee ON call_sessions(callee_device, started_at)');
}

function call_service_config(PDO $pdo): array {
    $keys = array_keys(CALL_SERVICE_SETTING_DEFAULTS);
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $st = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($placeholders)");
    $st->execute($keys);
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    return [
        'relay_secret'          => trim((string)($rows['calling_relay_secret'] ?? '')),
        'turn_secret'           => trim((string)($rows['calling_turn_secret'] ?? '')),
        'relay_internal_url'    => trim((string)($rows['calling_relay_internal_url'] ?? '')),
        'relay_internal_secret' => trim((string)($rows['calling_relay_internal_secret'] ?? '')),
        'allowlist'             => trim((string)($rows['calling_allowlist'] ?? '')),
    ];
}

/** Empty allowlist = no restriction (final rollout state, premium check
 *  alone gates access). Non-empty = the device_id AND user_id are checked
 *  against it, so either identifier can be used to allowlist an account. */
function call_is_allowlisted(array $cfg, array $device): bool {
    $allowlist = array_filter(array_map('trim', explode(',', $cfg['allowlist'] ?? '')));
    if (!$allowlist) return true;
    $candidates = [(string)($device['device_id'] ?? ''), (string)($device['user_id'] ?? '')];
    foreach ($allowlist as $entry) {
        if (in_array($entry, $candidates, true)) return true;
    }
    return false;
}

/** Best-effort real-time push to the calling-relay's internal hook so an
 *  already-connected device gets an instant `call:incoming`/`call:accepted`/
 *  etc. rather than waiting for its next poll. If the relay isn't
 *  configured or isn't reachable, this silently no-ops — REST bookkeeping
 *  (call_sessions, call_history) is already durable regardless, so a
 *  missed push degrades to a delayed ring, not a broken call. Short
 *  timeouts since this always targets a private/localhost URL, never a
 *  public host — no reason for latency-sensitive REST endpoints like
 *  call_initiate() to hang waiting on it. */
function call_relay_push(array $cfg, string $deviceId, array $event): void {
    if ($cfg['relay_internal_url'] === '' || $cfg['relay_internal_secret'] === '') return;
    if (!function_exists('curl_init')) return;
    $ch = curl_init($cfg['relay_internal_url']);
    if ($ch === false) return;
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['device_id' => $deviceId, 'event' => $event], JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Internal-Secret: ' . $cfg['relay_internal_secret']],
        CURLOPT_TIMEOUT_MS => 800,
        CURLOPT_CONNECTTIMEOUT_MS => 300,
        CURLOPT_RETURNTRANSFER => true,
    ]);
    @curl_exec($ch); // best-effort — failures intentionally swallowed, see doc comment above
    curl_close($ch);
}

// ── Vouchers ─────────────────────────────────────────────────────────────────
// Deliberately not a full JWT library (no new composer dependency) — same
// "HMAC over a short-lived signed payload" shape as real_economy.php's
// account-link proofs, just carrying a JSON payload instead of a fixed
// field list since the relay needs a few different voucher shapes
// (presence / caller / callee).

function call_b64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}
function call_b64url_decode(string $s): string {
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    return (string)base64_decode($s);
}

function call_sign_voucher(string $secret, array $payload): string {
    $payload['exp'] = $payload['exp'] ?? (time() + CALL_VOUCHER_TTL_SECS);
    $body = call_b64url_encode(json_encode($payload, JSON_UNESCAPED_SLASHES));
    $sig  = call_b64url_encode(hash_hmac('sha256', $body, $secret, true));
    return $body . '.' . $sig;
}

/** Returns the decoded payload if the voucher is validly signed and not
 *  expired, null otherwise. The relay calls the equivalent of this in
 *  Node (see calling-relay/) — keep the two in sync if this changes. */
function call_verify_voucher(string $secret, string $voucher): ?array {
    if ($secret === '') return null;
    $parts = explode('.', $voucher, 2);
    if (count($parts) !== 2) return null;
    [$body, $sig] = $parts;
    $expected = call_b64url_encode(hash_hmac('sha256', $body, $secret, true));
    if (!hash_equals($expected, $sig)) return null;
    $payload = json_decode(call_b64url_decode($body), true);
    if (!is_array($payload) || !isset($payload['exp'])) return null;
    if ((int)$payload['exp'] < time()) return null;
    return $payload;
}

/** General-purpose "I'm online and able to receive calls" token, minted
 *  once when the Inbox screen (or wherever calling lives) mounts and
 *  refreshed on its own TTL — proves device identity to the relay for
 *  presence registration only, not tied to any specific call. */
function call_presence_token(PDO $pdo, string $deviceId): array {
    call_ensure_schema($pdo);
    $cfg = call_service_config($pdo);
    if ($cfg['relay_secret'] === '') {
        return ['enabled' => false, 'token' => '', 'expires_in' => 0];
    }
    $device = qe_fetch_device($pdo, $deviceId);
    if (!$device || (int)($device['blocked'] ?? 0)) {
        return ['enabled' => false, 'token' => '', 'expires_in' => 0];
    }
    $exp = time() + CALL_PRESENCE_TTL_SECS;
    $token = call_sign_voucher($cfg['relay_secret'], [
        'role' => 'presence', 'device_id' => $deviceId, 'exp' => $exp,
    ]);
    return ['enabled' => true, 'token' => $token, 'expires_in' => CALL_PRESENCE_TTL_SECS];
}

// ── Call lifecycle ───────────────────────────────────────────────────────────

/** Is this device the caller or callee on any call that's still ringing/
 *  accepted? Used to block placing a second call while one is already in
 *  flight, and to auto-resolve stale 'ringing' rows as missed. */
function call_active_for(PDO $pdo, string $deviceId): ?array {
    // Anything past CALL_STALE_RINGING_SECS in 'ringing' with nobody having
    // accepted is dead — the caller's app gave up, or the callee's socket
    // dropped. Sweep it to 'missed' here so it doesn't block new calls
    // forever; cheap to do inline given the tiny row count this table will
    // ever have.
    $pdo->prepare(
        "UPDATE call_sessions SET status='missed', ended_at=datetime('now'), end_reason='timeout'
         WHERE status='ringing' AND started_at < datetime('now', ?)"
    )->execute(['-' . CALL_STALE_RINGING_SECS . ' seconds']);

    // Same idea for 'accepted' — see CALL_STALE_ACCEPTED_SECS's own comment.
    // duration_secs left at 0 (unknown, not worth reconstructing) — status/
    // end_reason are what call_active_for()'s callers actually check.
    $pdo->prepare(
        "UPDATE call_sessions SET status='ended', ended_at=datetime('now'), end_reason='abandoned'
         WHERE status='accepted' AND started_at < datetime('now', ?)"
    )->execute(['-' . CALL_STALE_ACCEPTED_SECS . ' seconds']);

    $st = $pdo->prepare(
        "SELECT * FROM call_sessions
         WHERE (caller_device=? OR callee_device=?) AND status IN ('ringing','accepted')
         ORDER BY started_at DESC LIMIT 1"
    );
    $st->execute([$deviceId, $deviceId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Start a call. Does every real authorization check (premium, blocks,
 * rate limit, no-call-already-in-flight) so the relay itself never has to.
 * Throws \RuntimeException with a client-safe message on any failure.
 * Returns ['call_id', 'voucher', 'callee_device', 'callee_user_id', 'relay_enabled'].
 */
function call_initiate(PDO $pdo, string $callerDevice, string $calleeParam, string $kind = 'audio'): array {
    call_ensure_schema($pdo);
    $kind = $kind === 'video' ? 'video' : 'audio';
    if ($kind === 'video') {
        // Khabat, A→B(162)/(166): audio first, video stays parked until
        // there's real phase-1 relay-rate/volume data to size it against.
        throw new \RuntimeException('video calling is not available yet');
    }

    $cfg = call_service_config($pdo);
    if ($cfg['relay_secret'] === '') throw new \RuntimeException('calling is not configured yet');

    $caller = qe_fetch_device($pdo, $callerDevice);
    if (!$caller)                            throw new \RuntimeException('caller not found');
    if ((int)($caller['blocked'] ?? 0))      throw new \RuntimeException('caller is blocked');
    // Premium gate — caller only (see file header, open decision #1).
    if (($caller['plan'] ?? 'free') === 'free') throw new \RuntimeException('calling is a premium feature');
    // Testing-phase allowlist — Khabat, TASK_SPLIT.md A→B(170): both sides
    // must be listed while calling is restricted to her + the Iran tester.
    if (!call_is_allowlisted($cfg, $caller)) throw new \RuntimeException('calling is not available on your account yet');

    $callee = qe_resolve_device($pdo, $calleeParam);
    if (!$callee)                                throw new \RuntimeException('recipient not found');
    if ($callee['device_id'] === $callerDevice)  throw new \RuntimeException('cannot call yourself');
    if ((int)($callee['blocked'] ?? 0))          throw new \RuntimeException('recipient unavailable');
    if (dm_is_blocked($pdo, $callerDevice, $callee['device_id']))
                                                 throw new \RuntimeException('recipient unavailable');
    if (!call_is_allowlisted($cfg, $callee))    throw new \RuntimeException('recipient does not have calling enabled yet');

    if (call_active_for($pdo, $callerDevice)) throw new \RuntimeException('you are already on a call');
    if (call_active_for($pdo, $callee['device_id'])) throw new \RuntimeException('recipient is on another call');

    $rl = $pdo->prepare(
        "SELECT COUNT(*) FROM call_sessions
         WHERE caller_device=? AND started_at >= datetime('now','-1 hour')"
    );
    $rl->execute([$callerDevice]);
    if ((int)$rl->fetchColumn() >= CALL_MAX_PER_HOUR) throw new \RuntimeException('too many calls, slow down');

    $callId = bin2hex(random_bytes(16)); // unguessable capability token, doubles as the relay's room id

    $pdo->prepare(
        "INSERT INTO call_sessions
            (call_id, caller_device, caller_user_id, callee_device, callee_user_id, kind, status)
         VALUES (?,?,?,?,?,?, 'ringing')"
    )->execute([
        $callId, $callerDevice, (string)($caller['user_id'] ?? ''),
        $callee['device_id'], (string)($callee['user_id'] ?? ''), $kind,
    ]);

    $voucher = call_sign_voucher($cfg['relay_secret'], [
        'role' => 'caller', 'call_id' => $callId, 'device_id' => $callerDevice,
    ]);

    call_relay_push($cfg, $callee['device_id'], [
        'type' => 'call:incoming', 'call_id' => $callId,
        'caller_device_id' => $callerDevice, 'caller_user_id' => (string)($caller['user_id'] ?? ''),
        'kind' => $kind,
    ]);

    return [
        'call_id'         => $callId,
        'voucher'         => $voucher,
        'callee_device'   => $callee['device_id'],
        'callee_user_id'  => (string)($callee['user_id'] ?? ''),
        'kind'            => $kind,
    ];
}

/** Short-lived TURN REST API credentials (coturn's use-auth-secret /
 *  static-auth-secret scheme, set up on fi-hel per TASK_SPLIT.md
 *  A→B(168) — username = "<unix-expiry>:<device_id>", credential =
 *  base64(HMAC-SHA1(secret, username)), coturn's own documented format).
 *  STUN is always included so a call can still connect (on networks that
 *  don't need a relay) even before the TURN secret is configured. */
function call_ice_servers(PDO $pdo, string $callId, string $deviceId): array {
    call_ensure_schema($pdo);
    $cfg = call_service_config($pdo);

    $st = $pdo->prepare('SELECT caller_device, callee_device FROM call_sessions WHERE call_id=?');
    $st->execute([$callId]);
    $call = $st->fetch(PDO::FETCH_ASSOC);
    if (!$call) throw new \RuntimeException('call not found');
    if ($call['caller_device'] !== $deviceId && $call['callee_device'] !== $deviceId) {
        throw new \RuntimeException('not your call');
    }

    $servers = [
        ['urls' => ['stun:stun.l.google.com:19302']],
    ];
    if ($cfg['turn_secret'] !== '') {
        $ttl = 300;
        $username = (string)(time() + $ttl) . ':' . $deviceId;
        $credential = base64_encode(hash_hmac('sha1', $username, $cfg['turn_secret'], true));
        $servers[] = [
            'urls' => [
                'turn:' . CALL_TURN_HOST . ':3478?transport=udp',
                'turn:' . CALL_TURN_HOST . ':3478?transport=tcp',
            ],
            'username'   => $username,
            'credential' => $credential,
        ];
    }
    return ['ice_servers' => $servers];
}

/**
 * Called by the CALLEE once their (already-connected, presence-
 * authenticated) relay socket receives a `call:incoming` push carrying
 * this call_id — mints their own call-scoped voucher so both sides
 * authenticate to the relay independently (the caller's voucher alone
 * can't be replayed to impersonate the callee).
 */
function call_callee_voucher(PDO $pdo, string $calleeDevice, string $callId): array {
    call_ensure_schema($pdo);
    $cfg = call_service_config($pdo);
    if ($cfg['relay_secret'] === '') throw new \RuntimeException('calling is not configured yet');

    $st = $pdo->prepare('SELECT * FROM call_sessions WHERE call_id=?');
    $st->execute([$callId]);
    $call = $st->fetch(PDO::FETCH_ASSOC);
    if (!$call)                                     throw new \RuntimeException('call not found');
    if ($call['callee_device'] !== $calleeDevice)   throw new \RuntimeException('not your call');
    if ($call['status'] !== 'ringing')              throw new \RuntimeException('call is no longer ringing');

    $voucher = call_sign_voucher($cfg['relay_secret'], [
        'role' => 'callee', 'call_id' => $callId, 'device_id' => $calleeDevice,
    ]);
    return ['call_id' => $callId, 'voucher' => $voucher, 'kind' => $call['kind']];
}

/** Durable state transitions — the relay fires these over REST alongside
 *  its own real-time relay of the same events, so call_sessions stays an
 *  honest history even though the relay itself keeps no database. Each
 *  takes the acting device_id so a stranger can't end/accept someone
 *  else's call by guessing a call_id. */

function call_mark_accepted(PDO $pdo, string $callId, string $deviceId): void {
    $st = $pdo->prepare("SELECT * FROM call_sessions WHERE call_id=? AND callee_device=? AND status='ringing'");
    $st->execute([$callId, $deviceId]);
    $call = $st->fetch(PDO::FETCH_ASSOC);
    if (!$call) return; // already handled / not found — same silent no-op as before

    $pdo->prepare(
        "UPDATE call_sessions SET status='accepted', accepted_at=datetime('now') WHERE call_id=?"
    )->execute([$callId]);
    call_relay_push(call_service_config($pdo), $call['caller_device'], ['type' => 'call:accepted', 'call_id' => $callId]);
}

function call_mark_declined(PDO $pdo, string $callId, string $deviceId): void {
    $st = $pdo->prepare("SELECT * FROM call_sessions WHERE call_id=? AND callee_device=? AND status='ringing'");
    $st->execute([$callId, $deviceId]);
    $call = $st->fetch(PDO::FETCH_ASSOC);
    if (!$call) return;

    $pdo->prepare(
        "UPDATE call_sessions SET status='declined', ended_at=datetime('now'), end_reason='declined' WHERE call_id=?"
    )->execute([$callId]);
    call_relay_push(call_service_config($pdo), $call['caller_device'], ['type' => 'call:declined', 'call_id' => $callId]);
}

/** Returns the final row (for duration/status) so the caller of this
 *  function can report it back to whichever side asked. */
function call_mark_ended(PDO $pdo, string $callId, string $deviceId, string $reason): array {
    $st = $pdo->prepare('SELECT * FROM call_sessions WHERE call_id=?');
    $st->execute([$callId]);
    $call = $st->fetch(PDO::FETCH_ASSOC);
    if (!$call) throw new \RuntimeException('call not found');
    if ($call['caller_device'] !== $deviceId && $call['callee_device'] !== $deviceId) {
        throw new \RuntimeException('not your call');
    }
    if (in_array($call['status'], ['ended', 'declined', 'missed'], true)) {
        return $call; // already terminal, idempotent no-op
    }
    $reason = in_array($reason, ['caller_hangup', 'callee_hangup', 'failed'], true) ? $reason : 'caller_hangup';
    $duration = $call['accepted_at']
        ? max(0, strtotime('now') - strtotime($call['accepted_at'] . ' UTC'))
        : 0;
    $pdo->prepare(
        "UPDATE call_sessions
         SET status='ended', ended_at=datetime('now'), end_reason=?, duration_secs=?
         WHERE call_id=?"
    )->execute([$reason, $duration, $callId]);
    $call['status'] = 'ended';
    $call['end_reason'] = $reason;
    $call['duration_secs'] = $duration;

    $peerDevice = $call['caller_device'] === $deviceId ? $call['callee_device'] : $call['caller_device'];
    call_relay_push(call_service_config($pdo), $peerDevice, ['type' => 'call:ended', 'call_id' => $callId, 'reason' => $reason]);

    return $call;
}

/** Recent call history for a device, newest first — mirrors dm_list()'s
 *  shape/spirit for the client (direction in/out, peer identity, no raw
 *  internal fields the app has no use for). */
function call_history(PDO $pdo, string $deviceId, int $limit = 50): array {
    call_ensure_schema($pdo);
    $limit = max(1, min(200, $limit));
    $st = $pdo->prepare(
        "SELECT * FROM call_sessions
         WHERE caller_device=? OR callee_device=?
         ORDER BY started_at DESC LIMIT $limit"
    );
    $st->execute([$deviceId, $deviceId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    return array_map(function (array $r) use ($deviceId) {
        $outgoing = $r['caller_device'] === $deviceId;
        return [
            'call_id'        => $r['call_id'],
            'direction'      => $outgoing ? 'out' : 'in',
            'peer_device'    => $outgoing ? $r['callee_device'] : $r['caller_device'],
            'peer_user_id'   => $outgoing ? $r['callee_user_id'] : $r['caller_user_id'],
            'kind'           => $r['kind'],
            'status'         => $r['status'],
            'end_reason'     => $r['end_reason'],
            'duration_secs'  => (int)$r['duration_secs'],
            'started_at'     => $r['started_at'],
        ];
    }, $rows);
}
