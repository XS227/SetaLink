/* SetaLink Admin — dashboard JS
   No external deps. Works with api.php for AJAX actions.
   CSRF token + API_URL injected by index.php via inline <script>.
*/

'use strict';

// ─── Modal system ────────────────────────────────────────────────────────────

const backdrop = document.getElementById('modalBackdrop');
let _activeModal = null;

function openModal(id) {
    if (_activeModal) closeModal(_activeModal);
    const m = document.getElementById(id);
    if (!m) return;
    _activeModal = id;
    m.classList.add('open');
    backdrop.classList.add('open');
    // Focus first input/button
    const focusable = m.querySelector('input:not([type=hidden]), select, textarea, button.btn-primary');
    if (focusable) setTimeout(() => focusable.focus(), 50);
}

function closeModal(id) {
    const m = document.getElementById(id ?? _activeModal);
    if (!m) return;
    m.classList.remove('open');
    backdrop.classList.remove('open');
    _activeModal = null;
}

// Close on backdrop click
backdrop.addEventListener('click', () => closeModal(_activeModal));

// Close on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _activeModal) closeModal(_activeModal);
});

// Wire all .js-modal-close buttons
document.querySelectorAll('.js-modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(_activeModal));
});

// ─── Toast notifications ──────────────────────────────────────────────────────

function showToast(msg, type = 'info', duration = 3500) {
    const area = document.getElementById('toastArea');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    area.appendChild(t);
    setTimeout(() => {
        t.classList.add('out');
        t.addEventListener('animationend', () => t.remove());
    }, duration);
}

// ─── API helper ──────────────────────────────────────────────────────────────

async function apiPost(payload) {
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ _csrf: CSRF, ...payload }),
    });
    const json = await resp.json();
    return json;
}

// ─── Page refresh (reload data without full page reload) ─────────────────────

let _refreshPending = false;

async function refreshDashboard() {
    if (_refreshPending) return;
    _refreshPending = true;
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.disabled = true; btn.querySelector('svg')?.classList.add('spin'); }
    try {
        // Full page reload — simplest and most reliable
        location.reload();
    } catch {
        _refreshPending = false;
        if (btn) { btn.disabled = false; btn.querySelector('svg')?.classList.remove('spin'); }
    }
}

document.getElementById('refreshBtn')?.addEventListener('click', refreshDashboard);

// ─── Sidebar (mobile) ────────────────────────────────────────────────────────

const sidebar  = document.getElementById('sidebar');
const overlay  = document.getElementById('overlay');
const menuBtn  = document.getElementById('menuBtn');
const sidebarClose = document.getElementById('sidebarClose');

function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
}
function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
}
menuBtn?.addEventListener('click', openSidebar);
sidebarClose?.addEventListener('click', closeSidebar);
overlay?.addEventListener('click', closeSidebar);

// ─── Search & filter ─────────────────────────────────────────────────────────

const searchInput  = document.getElementById('userSearch');
const statusFilter = document.getElementById('statusFilter');
const pkgFilter    = document.getElementById('pkgFilter');
const usersBody    = document.getElementById('usersBody');
const userCountEl  = document.getElementById('userCount');

function filterTable() {
    if (!usersBody) return;
    const q   = (searchInput?.value ?? '').toLowerCase().trim();
    const st  = statusFilter?.value ?? '';
    const pkg = pkgFilter?.value ?? '';
    let vis = 0;

    usersBody.querySelectorAll('tr').forEach(row => {
        const name = (row.dataset.name ?? '').toLowerCase();
        const rowSt = row.dataset.status ?? '';
        const rowPkg = row.dataset.pkg ?? '';

        const matchQ   = !q   || name.includes(q);
        const matchSt  = !st  || rowSt === st;
        const matchPkg = !pkg || rowPkg === pkg;

        const show = matchQ && matchSt && matchPkg;
        row.classList.toggle('hidden-row', !show);
        if (show) vis++;
    });

    if (userCountEl) {
        const total = usersBody.querySelectorAll('tr').length;
        userCountEl.textContent = vis === total ? `${total} users` : `${vis} / ${total} users`;
    }
}

searchInput?.addEventListener('input', filterTable);
statusFilter?.addEventListener('change', filterTable);
pkgFilter?.addEventListener('change', filterTable);

// ─── Add User ────────────────────────────────────────────────────────────────

function openAddUserModal() {
    document.getElementById('newUsername').value = '';
    document.getElementById('addUserError').style.display = 'none';
    openModal('addUserModal');
}

['addUserBtn','addUserBtnMobile','addUserBtnEmpty'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openAddUserModal);
});

// Allow Enter to submit within the modal
document.getElementById('newUsername')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('addUserSubmit')?.click();
});

document.getElementById('addUserSubmit')?.addEventListener('click', async () => {
    const name = document.getElementById('newUsername').value.trim();
    const pkg  = document.getElementById('newPackage').value;
    const errEl = document.getElementById('addUserError');

    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(name)) {
        errEl.textContent = 'Invalid username — lowercase a-z, 0-9, . _ − only, max 32 chars';
        errEl.style.display = 'flex';
        document.getElementById('newUsername').focus();
        return;
    }
    errEl.style.display = 'none';

    const btn = document.getElementById('addUserSubmit');
    btn.disabled = true;
    btn.textContent = 'Adding…';

    const res = await apiPost({ action: 'add', name, package: pkg });
    btn.disabled = false;
    btn.innerHTML = '+ Add User';

    if (res.ok) {
        closeModal('addUserModal');
        showToast(`User "${name}" added successfully`, 'ok');
        setTimeout(() => location.reload(), 800);
    } else {
        errEl.textContent = res.error ?? 'Failed to add user';
        errEl.style.display = 'flex';
    }
});

// ─── QR Code modal ───────────────────────────────────────────────────────────

let _currentQrUser = null;

document.querySelectorAll('.js-qr-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        _currentQrUser = name;
        document.getElementById('qrModalTitle').textContent = `Config — ${name}`;

        // Reset state
        const imgWrap = document.getElementById('qrImgWrap');
        const linkTxt = document.getElementById('vlessLinkText');
        imgWrap.innerHTML = '<div class="qr-loading">Loading QR…</div>';
        linkTxt.textContent = 'Loading…';
        document.getElementById('qrDownloadBtn').href = '#';

        openModal('qrModal');

        // Fetch QR image
        try {
            const qrResp  = await fetch(`${QR_URL}?name=${encodeURIComponent(name)}&fmt=qr`, { credentials: 'same-origin' });
            const linkResp = await fetch(`${QR_URL}?name=${encodeURIComponent(name)}&fmt=link`, { credentials: 'same-origin' });

            if (!qrResp.ok) throw new Error('QR fetch failed');
            if (!linkResp.ok) throw new Error('Link fetch failed');

            const blob = await qrResp.blob();
            const url  = URL.createObjectURL(blob);
            const link = (await linkResp.text()).trim();

            imgWrap.innerHTML = `<img src="${url}" alt="QR Code for ${name}" id="qrImage">`;
            linkTxt.textContent = link;
            document.getElementById('qrDownloadBtn').href = url;
            document.getElementById('qrDownloadBtn').download = `${name}.png`;

            // Store link for copy button
            document.getElementById('qrCopyBtn').dataset.link = link;
        } catch (err) {
            imgWrap.innerHTML = '<div class="qr-loading" style="color:var(--danger)">Failed to load</div>';
            linkTxt.textContent = 'Error loading config link';
        }
    });
});

document.getElementById('qrCopyBtn')?.addEventListener('click', async function () {
    const link = this.dataset.link ?? document.getElementById('vlessLinkText').textContent;
    try {
        await navigator.clipboard.writeText(link);
        showToast('VLESS link copied!', 'ok', 2500);
        this.textContent = '✓ Copied!';
        setTimeout(() => { this.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Link`; }, 2000);
    } catch {
        showToast('Clipboard unavailable — copy manually from below', 'error', 4000);
    }
});

// ─── Inline copy (row copy button) ──────────────────────────────────────────

document.querySelectorAll('.js-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        try {
            const resp = await fetch(`${QR_URL}?name=${encodeURIComponent(name)}&fmt=link`, { credentials: 'same-origin' });
            if (!resp.ok) throw new Error('fetch failed');
            const link = (await resp.text()).trim();
            await navigator.clipboard.writeText(link);
            showToast(`Config for "${name}" copied!`, 'ok', 2500);

            // Brief icon feedback
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
            btn.style.color = 'var(--ok)';
            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
        } catch {
            showToast('Copy failed — try the QR modal', 'error', 3500);
        }
    });
});

// ─── Enable / Disable actions ────────────────────────────────────────────────

document.querySelectorAll('.js-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const name   = btn.dataset.name;
        const action = btn.dataset.action; // 'enable' or 'disable'

        btn.disabled = true;
        const res = await apiPost({ action, name });
        btn.disabled = false;

        if (res.ok) {
            showToast(`User "${name}" ${action}d`, 'ok');
            setTimeout(() => location.reload(), 700);
        } else {
            showToast(`Failed: ${res.error ?? 'unknown error'}`, 'error');
        }
    });
});

// ─── Delete user ─────────────────────────────────────────────────────────────

let _deleteTarget = null;

document.querySelectorAll('.js-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        _deleteTarget = btn.dataset.name;
        document.getElementById('deleteUserLabel').textContent = _deleteTarget;
        openModal('deleteModal');
    });
});

document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
    if (!_deleteTarget) return;
    const name = _deleteTarget;
    const btn = document.getElementById('deleteConfirmBtn');
    btn.disabled = true;
    btn.textContent = 'Deleting…';

    const res = await apiPost({ action: 'remove', name });
    btn.disabled = false;
    btn.textContent = 'Delete User';

    if (res.ok) {
        closeModal('deleteModal');
        showToast(`User "${name}" deleted`, 'ok');
        setTimeout(() => location.reload(), 700);
    } else {
        closeModal('deleteModal');
        showToast(`Delete failed: ${res.error ?? 'unknown error'}`, 'error', 5000);
    }
    _deleteTarget = null;
});

// ─── Auto-refresh stats every 60s ────────────────────────────────────────────

let _autoRefreshTimer = null;

function scheduleAutoRefresh(ms = 60000) {
    clearTimeout(_autoRefreshTimer);
    _autoRefreshTimer = setTimeout(async () => {
        // Only refresh stats cards (not full reload) by calling API
        try {
            const resp = await fetch(`${API_URL}?action=status`, { credentials: 'same-origin' });
            const json = await resp.json();
            if (json.ok && json.data) {
                const d = json.data;
                // Silently update the stats grid values if we can find them
                const grid = document.getElementById('statsGrid');
                if (grid) {
                    const cards = grid.querySelectorAll('.stat-card');
                    // Card 0: total users (we'd need list endpoint for this, skip)
                    // Cards update on next scheduled or manual refresh
                }
            }
        } catch { /* ignore */ }
        scheduleAutoRefresh(ms);
    }, ms);
}

scheduleAutoRefresh();

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    // Ignore when typing in inputs
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (_activeModal) return;

    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openAddUserModal();
    }
    if (e.key === '/' || e.key === 'f') {
        e.preventDefault();
        searchInput?.focus();
    }
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        refreshDashboard();
    }
});

// ─── Row context: double-click to open QR ────────────────────────────────────

document.querySelectorAll('#usersBody tr').forEach(row => {
    row.addEventListener('dblclick', () => {
        const name = row.dataset.name;
        if (name) {
            row.querySelector('.js-qr-btn')?.click();
        }
    });
});

// ─── Full Xray JSON — download ────────────────────────────────────────────────

document.querySelectorAll('.js-json-dl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        // Trigger browser download via the api.php full-json endpoint.
        const a = document.createElement('a');
        a.href = `${API_URL}?action=full-json&name=${encodeURIComponent(name)}`;
        a.download = `xray-${name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Downloading xray-${name}.json…`, 'info', 2500);
    });
});

// ─── Full Xray JSON — copy to clipboard ──────────────────────────────────────

document.querySelectorAll('.js-json-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        try {
            const resp = await fetch(
                `${API_URL}?action=full-json&name=${encodeURIComponent(name)}`,
                { credentials: 'same-origin' }
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            await navigator.clipboard.writeText(text);
            showToast(`Full JSON for "${name}" copied!`, 'ok', 2500);

            const orig = btn.innerHTML;
            btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
            btn.style.color = 'var(--ok)';
            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
        } catch (err) {
            showToast(`Failed to copy JSON: ${err.message}`, 'error', 4000);
        }
    });
});
