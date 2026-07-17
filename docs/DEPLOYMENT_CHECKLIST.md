# Production Deployment Checklist

**Purpose:** one linear procedure, gated step-by-step, so a release cannot
accidentally skip a step. Each section has a literal command and an
explicit pass/fail criterion — if a step fails, **stop and fix it before
continuing**, do not skip ahead. This is a checklist to be followed with a
pen (or by literally checking `- [ ]` boxes in an editor), not a reference
to skim.

**Who runs this:** whoever has SSH/deploy access to the production VPS.
**Update, 2026-07-17:** a Claude Code session on the dev VPS was granted
working SSH access to production for this exact deploy (key
`docs/deploy/prod-audit-key.pub`, see §"Real deployment path" below) — the
"Claude has no SSH access" note above no longer holds universally, but
should not be assumed true in future sessions either; confirm access fresh
each time rather than trusting this file's history. Sections marked
**(automatable via `gh`)** can be run by an agent with `gh` CLI access;
everything else needs a human with production/App Store Connect access
unless SSH access has been separately, explicitly granted.

---

## Real deployment path — Android APK + version.json (verified 2026-07-17)

**Sections 2 and 3 below (git pull / git lfs pull) describe a workflow that
does not exist on the real production box.** Verified directly:
`/var/www/setalink` on production is **not a git repository at all**
(`git rev-parse --abbrev-ref HEAD` → `fatal: not a git repository`). The
Android APK/version.json release path is plain file management — `scp`/
`cp`, not `git pull` — and (as far as this session verified) always has
been; the "targeted file edits, not a full repo sync" suspicion flagged in
`docs/realgram/AGENT_HANDOFF.md` days earlier was correct. Whether the PHP
backend (`v1.php`, `lib/starlink.php`, admin panel) deploys differently was
**not verified this session** — do not assume either way without checking.

**Host / user / access:**
- Host: `5.249.252.221`, hostname `vps-5348441` — **always confirm with
  `hostname` after connecting**, before running anything else (see
  `docs/STARLINK_WINDOWS_HANDOFF.md` §2 for why this specific check matters
  — a prior session worked on production while believing it was the
  disposable Hetzner test box).
- Host key fingerprint (verify before trusting `known_hosts`):
  `SHA256:bXEaqnHLLo8ePtf9r5LZB//1gTAl5Mya23dGf+tOdjA`
- **Login user is `ubuntu`, not `root`.** `PermitRootLogin` is set to
  `without-password` (pubkey-only would theoretically work), but the only
  account actually provisioned with a usable key is `ubuntu`; every
  privileged file operation needs `sudo` (passwordless for `ubuntu` in this
  session).
- SSH key: `docs/deploy/prod-audit-key.pub` (public half; the private key
  lives only on whichever box was granted access, `~/.ssh/id_ed25519_prod_audit`
  on the dev VPS as of 2026-07-17). Public keys aren't secret — this file is
  safe to keep in git. Add it to `/home/ubuntu/.ssh/authorized_keys` (not
  `/root/.ssh/`) to grant a new box/session access; pull it with `curl` from
  GitHub's raw URL rather than retyping — manual transcription of this key
  produced multiple silent one-character mismatches (case swaps, l/1
  confusion) before this was figured out.

**Docroot:** `setalink.no` is served from `/var/www/setalink/public` on
production (nginx `server_name setalink.no www.setalink.no`, TLS terminated
on `127.0.0.1:4430`, SNI-routed via an nginx `stream` block on :443 — see
`nginx -T` output for the full block). `/download/version.json` and
`/download/buildNN/*.apk` are served as plain static files (`try_files`
falling through to them directly); `/releases/stable/*.apk` is the
`stable`-channel equivalent, untouched by a beta/experimental release.

**Steps that actually work, in order:**

1. Build the APK via CI (`gh workflow run release-apk.yml --ref <branch>`),
   download the artifact, verify checksums + `unzip -l` validity + decode
   `AndroidManifest.xml` directly to confirm versionCode/versionName (don't
   trust `build.gradle` alone — parse the compiled manifest; see this
   session's transcript for a minimal Python AXML parser, no `aapt` needed).
2. `scp` the three renamed APKs to production (`/tmp/` first, `sudo mv`/`cp`
   into place — `ubuntu` doesn't own `/var/www/setalink/public/download/`):
   ```
   mkdir -p /var/www/setalink/public/download/buildNN   # sudo, owned by www-data
   # scp app-arm64-v8a-release.apk, app-armeabi-v7a-release.apk,
   #     app-universal-release.apk to production /tmp/, then per-file:
   sudo cp /tmp/app-arm64-v8a-release.apk   .../buildNN/setalink-vX.Y.Z.apk
   sudo cp /tmp/app-armeabi-v7a-release.apk .../buildNN/setalink-vX.Y.Z-arm32.apk
   sudo cp /tmp/app-universal-release.apk   .../buildNN/setalink-vX.Y.Z-universal.apk
   sudo chown www-data:www-data .../buildNN/*.apk && sudo chmod 644 .../buildNN/*.apk
   ```
   Verify `sha256sum` on production matches the CI-built checksum *before*
   moving into the web-served path — confirms the transfer wasn't corrupted.
3. Edit `version.json` with a small Python script (not `sed` — the file is
   structured JSON with a top-level/`channels.stable`/`channels.beta`/
   `channels.experimental` shape, and top-level fields mirror `stable`, not
   the channel being released). `sudo cp` a timestamped backup first. Update
   **only** `channels.beta` and `channels.experimental`
   (version/versionCode/apkUrl/apkUrlArm32/apkUrlUniversal) — leave
   `channels.stable` and every top-level field untouched for a beta/
   experimental-only release. `sudo chown www-data:www-data` +
   `sudo chmod 664` the file back afterward (ubuntu can't write it directly;
   it's `www-data`-owned).
4. **Verify against the live public URL, not the file on disk** —
   `curl https://setalink.no/download/version.json`, then actually download
   the APK from its public URL and re-check the checksum + decode the
   manifest again. This is the only verification that actually proves the
   deploy works end-to-end (nginx caching, wrong docroot, stale file — any
   of those would pass a same-box file check but fail this one).

---

## 0. Before you start — what release is this?

Fill in before running anything else, so every step below has a concrete
target to check against instead of a vague "the latest one":

```
Target commit SHA:      _______________  (git log --oneline -1)
Target Android version: _______________  (e.g. 0.9.68)
Target versionCode:     _______________  (e.g. 95)
Target APK checksum:    _______________  (sha256, from the publish commit message)
Target iOS build number:_______________  (e.g. 98)
```

---

## 1. Merge verification

- [ ] **1.1** Working tree is clean (no uncommitted changes, nothing half-merged):
  ```bash
  git status --short
  ```
  **Pass:** empty output. **Fail:** stop — resolve or stash before continuing, do not deploy an uncommitted or half-merged tree.

- [ ] **1.2** If the target commit is a merge, confirm it really has two parents (not an accidental fast-forward that silently dropped one side's work):
  ```bash
  git log --oneline -1 --parents <target-sha>
  ```
  **Pass:** two SHAs after the commit hash. **Fail:** the "merge" didn't actually merge two histories — investigate before deploying.

- [ ] **1.3** Confirm the target commit is actually on the branch you're about to deploy from, and matches what's on GitHub:
  ```bash
  git fetch origin
  git log --oneline -1 origin/<branch>
  ```
  **Pass:** SHA matches the target from section 0. **Fail:** wrong branch, or GitHub has moved since — re-check which commit you actually mean to ship.

---

## 2. `git pull` on production

- [ ] **2.1** SSH to the production box, confirm you're actually there (not fi-hel, not the dev VPS — this exact confusion happened once this project already, see `docs/STARLINK_WINDOWS_HANDOFF.md` §0):
  ```bash
  hostname; hostname -I
  ```
  **Pass:** matches production's known hostname/IP. **Fail:** stop, you're on the wrong box.

- [ ] **2.2** Pull:
  ```bash
  cd /var/www/setalink   # adjust to the real deploy path if different
  git fetch origin
  git checkout <branch>   # or merge into whatever branch production tracks
  git pull
  ```

- [ ] **2.3** Confirm the SHA landed:
  ```bash
  git log --oneline -1
  ```
  **Pass:** matches the target SHA from section 0 exactly. **Fail:** pull didn't take — check for local modifications blocking it (`git status`), do not force anything without understanding why first.

---

## 3. `git lfs pull` — do not skip, a plain `git pull` is not enough

APK binaries in this repo are LFS-tracked (`.gitattributes`:
`public/releases/**/*.apk`). A plain `git pull` on a box where LFS smudge
filters aren't configured, or where LFS wasn't run, leaves a ~130-byte
**pointer file** in place of the real APK — the download URL would still
return `200 OK`, just with garbage content. This has a real failure mode:
looks fine until someone actually downloads and installs it.

- [ ] **3.1** Pull the actual LFS content:
  ```bash
  git lfs pull
  ```

- [ ] **3.2** Confirm nothing is still a pointer:
  ```bash
  git lfs status
  ```
  **Pass:** no files listed as "not downloaded" / no pointer warnings. **Fail:** `git lfs pull` again; if it still fails, check `git lfs env` for a misconfigured remote before proceeding.

- [ ] **3.3** Confirm the file size directly — this is the check that actually catches a pointer file, independent of what `git lfs status` claims:
  ```bash
  ls -la public/releases/stable/setalink-v<target-version>.apk
  ```
  **Pass:** size is tens of MB (matches the target checksum's known size from section 0). **Fail:** if it's ~130 bytes, it's a pointer file — LFS did not actually fetch it. Do not proceed to section 5 until this is a real binary.

---

## 4. `version.json` verification

- [ ] **4.1** Fetch the LIVE file, cache-busted (not a stale CDN/browser cache):
  ```bash
  curl -s "https://setalink.no/download/version.json?_=$(date +%s)" | python3 -m json.tool
  ```

- [ ] **4.2** Check every field against section 0's targets:
  - `version` == target Android version
  - `versionCode` == target versionCode
  - `checksum.sha256` == target APK checksum
  - `apkUrl` / `apkUrlArm32` / `apkUrlUniversal` all point at filenames containing the target version
  - `channels.stable.version` / `channels.stable.versionCode` also match (a past incident: top-level fields updated, `channels.stable` left stale — checked separately on purpose)

  **Pass:** every field matches. **Fail:** stop — this is the file the app's OTA checker reads; a mismatch here means real devices will get told the wrong thing.

---

## 5. APK download verification

Don't just trust that the file exists — actually download it through the
public URL and verify the bytes, the same way a real device would.

- [ ] **5.1** Download via the real public URL (not a local file path):
  ```bash
  curl -fsSL -o /tmp/verify-release.apk "https://setalink.no/releases/stable/setalink-v<target-version>.apk"
  ```
  **Pass:** `curl` exits 0. **Fail:** check the URL is actually reachable (`curl -I` for the status code) before anything else.

- [ ] **5.2** Verify the checksum matches what `version.json` declared (section 4) — this is the single most important check in this whole document, it catches LFS pointer files, wrong files, symlink mistakes, and stale CDN caches all at once:
  ```bash
  sha256sum /tmp/verify-release.apk
  ```
  **Pass:** matches section 0's target checksum exactly. **Fail:** stop. Do not tell testers to download. Something is wrong between what was published and what's actually being served — re-run sections 2-3 and check for a CDN cache that needs purging.

- [ ] **5.3** Sanity-check the file type (catches an LFS pointer or an HTML error page slipping through the checksum check if section 0's target checksum was itself wrong):
  ```bash
  file /tmp/verify-release.apk
  ```
  **Pass:** `Zip archive data` or similar (APKs are ZIP files). **Fail:** if it says `ASCII text`, you downloaded an LFS pointer or an error page, not an APK.

---

## 6. OTA update verification

- [ ] **6.1** From a real device currently on an OLDER build (not a simulation) — open the app, go to Settings, tap "Check for update" (or wait for the automatic check).
  **Pass:** the app shows an update banner/prompt for the target version. **Fail:** re-check section 4 (version.json) first — if that's correct, check the device's network/DNS can actually reach `setalink.no` fresh (not a cached response — `updateService.ts` cache-busts with `?_=timestamp` and only serves a locally cached answer on network failure, so a stuck "no update" on a working connection points at version.json, not the app).

- [ ] **6.2** Tap through the actual download + install once, on one device, before telling testers it's ready.
  **Pass:** installs and opens, shows the target version in Settings/About. **Fail:** stop — do not roll out to testers with a broken OTA path.

---

## 7. TestFlight verification **(automatable via `gh`)**

- [ ] **7.1** Confirm the build workflow itself succeeded:
  ```bash
  gh run list --repo XS227/SetaLink --workflow=ios-testflight.yml --limit 1
  ```
  **Pass:** `completed success`. **Fail:** stop, do not proceed — check the run log for the failure.

- [ ] **7.2** Query Apple directly for the build's actual processing state (not just "did our workflow finish uploading" — Apple still has to process it server-side before testers can see it):
  ```bash
  gh workflow run ios-asc-status.yml --repo XS227/SetaLink -f build_number=<target-build-number>
  # wait ~30s, then:
  gh run list --repo XS227/SetaLink --workflow=ios-asc-status.yml --limit 1
  gh run view <run-id> --repo XS227/SetaLink --log | grep RESULT
  ```
  **Pass:** `processingState=VALID`. **Fail:** `PROCESSING` means wait and re-check (can take Apple several minutes to tens of minutes); `INVALID`/`FAILED` means stop and investigate in App Store Connect directly before telling any tester. **`NOT_FOUND`** is a real, observed transient state (confirmed 2026-07-17 running this exact check right after a real upload finished) — Apple hasn't indexed the build into a queryable state yet, distinct from `PROCESSING` (indexed, still working). Wait ~1-2 minutes after the upload workflow completes before the first check, not immediately.

- [ ] **7.3** Manual confirmation in App Store Connect (`appstoreconnect.apple.com` → your app → TestFlight tab): the build appears, is attached to the intended tester group, and at least one tester's device shows it as installable.
  **Pass:** visually confirmed. **Fail:** even if 7.1/7.2 passed, don't skip this — tester-group assignment is not visible from the API call above.

---

## 8. Release / Deploy admin panel verification

- [ ] **8.1** Log into the admin panel, open the **Release** tab. **Pass:** shows the target Android version/versionCode, matches section 0. **Fail:** the admin panel itself may be running stale code — confirm production actually deployed the admin/ changes too (this is the same `git pull` from section 2, covering the whole repo, not just the mobile app).

- [ ] **8.2** Open the **Deploy** page (if present in this build). **Pass:** loads without error, shows current deploy state. **Fail:** if the nav item is missing entirely, production hasn't pulled the commit that restores it — re-check section 2.

- [ ] **8.3** Open the **Network Intel** tab, confirm the evidence-driven recommendations panel shows confidence scores (🟢/🟡/🔴, sample sizes) on any recommendation present, not just severity labels. **Pass:** confidence badge visible. **Fail:** admin/index.php or lib/node_intel.php changes didn't deploy — re-check section 2.

- [ ] **8.4** Confirm a Starlink node with `test_mode` devices allowlisted appears correctly in `/v1/servers` for one of those devices (use a real test device's credentials, or `curl` with a known test `device_id`). **Pass:** the Starlink node appears in the response with `nodeType: "STARLINK"`. **Fail:** check `st_get`/`v1_device_allowed` state on production directly — this is real production data the git deploy alone doesn't populate (node rows, allowlist entries are admin-panel actions, not code).

---

## 9. Go / No-Go

Only after **every** box above is checked:

- [ ] All of sections 1-8 passed with no unresolved **Fail** states.
- [ ] Someone with production access has done sections 2-3, 6.2, 7.3, and 8 personally (not delegated to an agent without production/App Store Connect credentials).

**If all checked: proceed to controlled Iran testing.**
**If anything is unchecked: do not proceed — fix it, re-run the failed
section (not the whole checklist from scratch), and re-verify.**

---

## Rollback, if something ships broken anyway

- **Android**: `version.json`'s `forceUpdate`/`minSupported` fields can
  gate a bad build without a new release — but the faster fix is usually
  re-running section 5's publish step with the PREVIOUS known-good
  version's files (git history has every prior `public/releases/stable/*`
  commit). Do not delete the bad APK from git history; just stop pointing
  `version.json`/the `*-latest.apk` symlinks at it.
- **iOS**: TestFlight builds can be individually expired/removed from a
  tester group in App Store Connect without a new build — no code rollback
  needed for a bad TestFlight build, just stop distributing that build
  number to testers there.
- **Admin panel**: `git checkout <previous-good-sha> -- admin/ lib/` on
  production, or a full `git reset --hard <previous-good-sha>` if nothing
  else has changed since — confirm with `git status` first per this
  session's own standing safety rule before any reset.
