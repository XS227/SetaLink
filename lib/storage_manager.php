<?php
/**
 * Storage Manager -- Fase 1 (2026-07-17): automatic disk-space maintenance
 * for what the PHP process (www-data) actually owns and can safely delete.
 *
 * Explicitly OUT of scope here: /var/log/nginx/*.log and /var/log/xray/*.log
 * are root-owned (see admin/api.php's existing comment "/var/log/xray is
 * root-only") -- www-data cannot rotate or truncate them, and this file
 * does not attempt to. See docs/STORAGE_MANAGEMENT.md for the logrotate
 * config that covers those instead (a one-time root-installed file, not
 * something this code can install itself).
 *
 * What this DOES own and clean, oldest-first, same pattern as
 * lib/node_intel.php's ni_telemetry_rotate() / lib/node_console.php's
 * nc_rotate(): opportunistic (cheap probabilistic trigger, no cron needed),
 * bounded, and safe to call from any request path.
 *
 *   - data/tunnel-logs/*.txt, *.meta.json, *.config.json  (per-session
 *     diagnostic uploads, public/api.php's log-upload action -- unbounded
 *     until now, see docs/STORAGE_MANAGEMENT.md for how this was found)
 *   - public/releases/<channel>/*.apk                     (old release
 *     builds -- scripts/release.sh never pruned these either)
 *
 * Fase 2 (planned, not built here): an admin "Storage Manager" panel
 * (disk usage per folder, largest files, manual Clean/Archive/Expand
 * buttons) built ON TOP of the functions in this file -- sm_disk_report()
 * below is written with that in mind (structured, not just log lines).
 */

declare(strict_types=1);

/** Target: keep at least this fraction of the filesystem free. Below this,
 *  sm_auto_cleanup() escalates to more aggressive retention windows. */
const SM_TARGET_FREE_PCT = 0.25; // 25%, middle of the requested 20-30% band

const SM_TUNNEL_LOGS_KEEP_DAYS_NORMAL   = 14;
const SM_TUNNEL_LOGS_KEEP_DAYS_AGGRESSIVE = 3;
const SM_APK_KEEP_PER_CHANNEL_NORMAL      = 5;
const SM_APK_KEEP_PER_CHANNEL_AGGRESSIVE  = 2;

/** Free space as a fraction (0.0-1.0) of the filesystem holding the app.
 *  Same primitives admin/api.php's health check already uses. */
function sm_disk_free_pct(string $path = __DIR__): float
{
    $total = (float)@disk_total_space($path);
    $free  = (float)@disk_free_space($path);
    if ($total <= 0) return 1.0; // couldn't check -- fail open, don't false-alarm
    return $free / $total;
}

/**
 * Delete tunnel-log file triples (.txt/.meta.json/.config.json share one
 * stem) older than $keepDays. Groups by stem so a session's files are
 * always removed together, never partially.
 */
function sm_cleanup_tunnel_logs(int $keepDays, ?string $dirOverride = null): array
{
    $dir = $dirOverride ?? (dirname(__DIR__) . '/data/tunnel-logs');
    $result = ['dir' => $dir, 'checked' => false, 'deleted_files' => 0, 'freed_bytes' => 0, 'sessions_removed' => 0];
    if (!is_dir($dir)) return $result;
    $result['checked'] = true;

    $cutoff = time() - ($keepDays * 86400);
    $stems = [];
    foreach ((glob($dir . '/*.txt') ?: []) as $f) {
        $stems[basename($f, '.txt')] = true;
    }
    foreach ((glob($dir . '/*.meta.json') ?: []) as $f) {
        $stems[basename($f, '.meta.json')] = true;
    }

    foreach (array_keys($stems) as $stem) {
        // Basic path-safety: stem must match the format the uploader itself
        // generates (public/api.php: [A-Za-z0-9_-]+_YYYYMMDD_HHMMSS_NNN).
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $stem)) continue;
        $candidates = ["$dir/$stem.txt", "$dir/$stem.meta.json", "$dir/$stem.config.json"];
        $oldestMtime = null;
        foreach ($candidates as $f) {
            if (is_file($f)) {
                $m = filemtime($f);
                if ($m !== false && ($oldestMtime === null || $m < $oldestMtime)) $oldestMtime = $m;
            }
        }
        if ($oldestMtime === null || $oldestMtime >= $cutoff) continue;

        $removedThisSession = false;
        foreach ($candidates as $f) {
            if (is_file($f)) {
                $size = @filesize($f) ?: 0;
                if (@unlink($f)) {
                    $result['deleted_files']++;
                    $result['freed_bytes'] += $size;
                    $removedThisSession = true;
                }
            }
        }
        if ($removedThisSession) $result['sessions_removed']++;
    }
    return $result;
}

/**
 * Delete old APK builds beyond the $keepPerChannel most recent, per channel
 * directory under public/releases/. Never touches the file the *-latest.apk
 * symlinks point at (resolved first, explicitly excluded) even if it would
 * otherwise be outside the keep window -- a stale "latest" symlink pointing
 * at a deleted file would break every OTA download.
 */
function sm_cleanup_old_apks(int $keepPerChannel, ?string $dirOverride = null): array
{
    $releasesDir = $dirOverride ?? (dirname(__DIR__) . '/public/releases');
    $result = ['dir' => $releasesDir, 'checked' => false, 'deleted_files' => 0, 'freed_bytes' => 0];
    if (!is_dir($releasesDir)) return $result;
    $result['checked'] = true;

    foreach ((glob($releasesDir . '/*', GLOB_ONLYDIR) ?: []) as $channelDir) {
        $protect = [];
        foreach ((glob($channelDir . '/*latest*.apk') ?: []) as $link) {
            $real = @realpath($link);
            if ($real) $protect[$real] = true;
        }

        $apks = glob($channelDir . '/*.apk') ?: [];
        // Skip symlinks themselves -- only real files are candidates for deletion.
        $apks = array_values(array_filter($apks, fn($f) => is_file($f) && !is_link($f)));
        usort($apks, fn($a, $b) => filemtime($b) <=> filemtime($a)); // newest first

        $kept = 0;
        foreach ($apks as $f) {
            $real = @realpath($f);
            if ($real !== false && isset($protect[$real])) continue; // never delete what a symlink points at
            $kept++;
            if ($kept <= $keepPerChannel) continue; // within the keep window
            $size = @filesize($f) ?: 0;
            if (@unlink($f)) {
                $result['deleted_files']++;
                $result['freed_bytes'] += $size;
            }
        }
    }
    return $result;
}

/**
 * Opportunistic auto-cleanup, same cheap-probabilistic-trigger pattern as
 * ni_telemetry_rotate()/nc_rotate() -- call from any frequently-hit request
 * path (e.g. public/api.php's log-upload action), no cron needed.
 *
 * Escalation: normal retention windows first; if disk is still below
 * SM_TARGET_FREE_PCT after that, re-run with the aggressive windows. This
 * is what "maintain at least 20-30% free" actually means in code -- react
 * to the real number, not just run on a fixed schedule regardless of need.
 */
function sm_auto_cleanup(): array
{
    $log = ['triggered' => false];
    try {
        if (random_int(1, 40) !== 1) return $log;
        $log['triggered'] = true;
        $log['free_pct_before'] = round(sm_disk_free_pct() * 100, 1);

        $log['tunnel_logs'] = sm_cleanup_tunnel_logs(SM_TUNNEL_LOGS_KEEP_DAYS_NORMAL);
        $log['apks']        = sm_cleanup_old_apks(SM_APK_KEEP_PER_CHANNEL_NORMAL);

        if (sm_disk_free_pct() < SM_TARGET_FREE_PCT) {
            $log['escalated'] = true;
            $log['tunnel_logs_aggressive'] = sm_cleanup_tunnel_logs(SM_TUNNEL_LOGS_KEEP_DAYS_AGGRESSIVE);
            $log['apks_aggressive']        = sm_cleanup_old_apks(SM_APK_KEEP_PER_CHANNEL_AGGRESSIVE);
        }
        $log['free_pct_after'] = round(sm_disk_free_pct() * 100, 1);
    } catch (\Throwable $_) {
        // Cleanup must never break the request it rode in on.
    }
    return $log;
}

/**
 * Structured disk usage report -- foundation for the Fase 2 admin Storage
 * Manager panel ("disk usage per folder", "largest files"). Not wired into
 * any admin UI yet (Fase 2, not built this pass) but usable standalone.
 */
function sm_disk_report(): array
{
    $root = dirname(__DIR__);
    $folders = ['data', 'public/releases', 'public/download', 'public/assets'];
    $report = ['free_pct' => round(sm_disk_free_pct() * 100, 1), 'folders' => []];
    foreach ($folders as $rel) {
        $path = "$root/$rel";
        if (!is_dir($path)) continue;
        $size = 0; $count = 0;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile() && !$f->isLink()) { $size += $f->getSize(); $count++; }
        }
        $report['folders'][$rel] = ['bytes' => $size, 'files' => $count];
    }
    return $report;
}
