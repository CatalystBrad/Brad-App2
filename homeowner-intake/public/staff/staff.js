// The conveyancer's view. One question it has to answer at a glance: which of
// my files need me today, and what for?
const $ = (id) => document.getElementById(id);
const KEY_STORE = 'hi_staff_key';

let key = null;
let cases = [];
let filter = 'all';

try { key = localStorage.getItem(KEY_STORE); } catch { key = null; }

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(opts.headers ?? {}) },
  });
  if (res.status === 401) { signOut('That key was not accepted'); throw new Error('unauthorised'); }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
};

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function signOut(message) {
  key = null;
  try { localStorage.removeItem(KEY_STORE); } catch { /* private window */ }
  $('app').classList.add('hidden');
  $('signin').classList.remove('hidden');
  $('signinError').textContent = message ?? '';
}

// ---- the list --------------------------------------------------------------

const ORDER = { action: 0, watch: 1, ok: 2, done: 3 };

function paintCounts() {
  const tally = { action: 0, watch: 0, ok: 0, done: 0 };
  for (const c of cases) tally[c.attention.level] = (tally[c.attention.level] ?? 0) + 1;
  const ready = cases.filter((c) => c.readyToSend).length;
  $('counts').innerHTML = `
    <div class="count action"><b>${tally.action}</b><span>need action</span></div>
    <div class="count watch"><b>${tally.watch}</b><span>worth watching</span></div>
    <div class="count"><b>${tally.ok}</b><span>progressing</span></div>
    <div class="count"><b>${ready}</b><span>ready to send</span></div>`;
}

function paintList() {
  const shown = cases
    .filter((c) => filter === 'all' || c.attention.level === filter)
    .sort((a, b) => (ORDER[a.attention.level] - ORDER[b.attention.level]) || (b.daysQuiet ?? 0) - (a.daysQuiet ?? 0));

  $('list').replaceChildren(...shown.map((c) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'case';
    const seller = c.sellers[0];
    const quiet = c.daysQuiet == null ? 'no activity yet' : c.daysQuiet === 0 ? 'active today' : `quiet ${c.daysQuiet}d`;
    const docs = c.documentsOutstanding ? ` · ${c.documentsOutstanding} docs to come` : '';
    el.innerHTML = `
      <div>
        <div class="addr">${esc(c.address ?? c.ref ?? 'Untitled file')}</div>
        <div class="meta">${esc(c.ref ?? '')}${c.ref ? ' · ' : ''}${esc(seller?.name ?? 'no seller')} · ${esc(seller?.channel ?? '—')} · ${quiet}${docs}</div>
      </div>
      <div class="right">
        <span class="pill ${c.attention.level}">${esc(c.attention.label)}</span>
        <span class="small muted">${c.blocking} question${c.blocking === 1 ? '' : 's'} left${c.documentsOutstanding ? ` · ${c.documentsOutstanding} docs` : ''}</span>
      </div>
      <div class="progress">
        <div class="track"><i style="width:${c.percent}%"></i></div>
        <span class="pct">${c.percent}%</span>
      </div>`;
    el.addEventListener('click', () => openCase(c.id));
    return el;
  }));

  $('empty').textContent = shown.length === 0 ? 'Nothing in this group.' : '';
  $('empty').classList.toggle('hidden', shown.length > 0);
}

async function load() {
  const { cases: rows } = await api('/api/cases');
  cases = rows;
  paintCounts();
  paintList();
}

// ---- one file --------------------------------------------------------------

async function openCase(id) {
  const c = await api(`/api/cases/${id}`);
  $('dRef').textContent = [c.ref, c.status].filter(Boolean).join(' · ');
  $('dAddress').textContent = c.address ?? 'Untitled file';

  const seller = c.sellers[0] ?? {};
  const outstanding = c.outstanding.slice(0, 40);

  $('dBody').innerHTML = `
    <div class="actions">
      <button class="primary" data-act="nudge">Nudge the seller now</button>
      <button class="secondary" data-act="open">Open the form</button>
      <button class="secondary" data-act="copy">Copy the seller's link</button>
    </div>

    <div class="section">
      <h3>Where it stands</h3>
      <dl class="kv">
        <dt>Answered</dt><dd>${c.answered} of ${c.applicable} (${c.percent}%) · about ${c.minutesLeft} min of questions left</dd>
        <dt>Parked</dt><dd>${c.parked} question${c.parked === 1 ? '' : 's'} the seller is checking</dd>
        <dt>To confirm</dt><dd>${c.toConfirm} pre-filled answer${c.toConfirm === 1 ? '' : 's'} awaiting a tap</dd>
        <dt>Documents</dt><dd>${c.documentsTotal - c.documentsOutstanding} of ${c.documentsTotal} received</dd>
        <dt>Seller</dt><dd>${esc(seller.name ?? '—')} · ${esc(seller.channel ?? '—')} · last active ${fmtDate(seller.lastActivityAt)}${seller.ignoredStreak ? ` · ${seller.ignoredStreak} nudges unanswered` : ''}</dd>
        <dt>Signed</dt><dd>${c.sellers.filter((s) => s.signed).length} of ${c.sellers.length} owners</dd>
        <dt>Audit trail</dt><dd>${c.auditTrailLength} entries</dd>
      </dl>
    </div>

    <div class="section">
      <h3>Outstanding (${c.outstanding.length})</h3>
      <div class="rows">
        ${outstanding.map((o) => `<div class="row">
          <span class="n">${esc(o.number)}</span>
          <span>${esc(o.question)}</span>
          <span class="st ${o.status === 'parked' ? 'parked' : 'missing'}">${o.status === 'parked' ? 'seller checking' : 'not answered'}</span>
        </div>`).join('') || '<p class="muted small">Nothing outstanding.</p>'}
      </div>
      ${c.outstanding.length > 40 ? `<p class="muted small">…and ${c.outstanding.length - 40} more.</p>` : ''}
    </div>

    <div class="section">
      <h3>Documents still to come (${c.documentsOutstandingList.length})</h3>
      <div class="rows">
        ${c.documentsOutstandingList.slice(0, 20).map((d) => `<div class="row">
          <span class="n">${esc(d.number)}</span>
          <span>${esc(d.document)}</span>
          <span class="st missing">not received</span>
        </div>`).join('') || '<p class="muted small">All in.</p>'}
      </div>
    </div>

    <div class="section">
      <h3>Recent activity</h3>
      <ul class="timeline">
        ${c.events.slice(-12).reverse().map((e) => `<li><span class="when">${fmtDate(e.at)}</span><span>${esc(String(e.kind).replace(/_/g, ' '))}</span></li>`).join('')}
      </ul>
    </div>`;

  $('dBody').querySelector('[data-act="nudge"]').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const res = await api(`/api/cases/${id}/nudge`, { method: 'POST' });
    toast(res.deferred ? 'Queued — outside the seller\'s chosen hours' : 'Nudge sent');
    ev.target.disabled = false;
    load();
  });
  $('dBody').querySelector('[data-act="open"]').addEventListener('click', async () => {
    // The staff key never goes in a URL. Ask for a ten-minute token for this
    // one file instead, so a bookmarked or logged link is worthless later.
    const { token } = await api(`/api/cases/${id}/export-token`, { method: 'POST' });
    window.open(`/api/cases/${id}/export.html?t=${encodeURIComponent(token)}`, '_blank', 'noopener');
  });
  $('dBody').querySelector('[data-act="copy"]').addEventListener('click', async () => {
    const res = await api(`/api/cases/${id}/invite`, { method: 'POST' });
    try {
      await navigator.clipboard.writeText(res.link);
      toast('Link copied');
    } catch {
      toast(res.link);
    }
  });

  $('detail').showModal();
}

// ---- wiring ----------------------------------------------------------------

$('signinBtn').addEventListener('click', async () => {
  key = $('key').value.trim();
  if (!key) return;
  try {
    const { firm } = await api('/api/firm');
    try { localStorage.setItem(KEY_STORE, key); } catch { /* private window */ }
    $('firmName').textContent = firm.name;
    $('signin').classList.add('hidden');
    $('app').classList.remove('hidden');
    await load();
  } catch {
    $('signinError').textContent = 'That key was not accepted.';
  }
});
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signinBtn').click(); });
$('refreshBtn').addEventListener('click', () => load().then(() => toast('Refreshed')));
$('signoutBtn').addEventListener('click', () => signOut());
$('closeDetail').addEventListener('click', () => $('detail').close());
for (const b of $('filters').children) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    for (const sib of $('filters').children) sib.setAttribute('aria-pressed', String(sib === b));
    paintList();
  });
}

if (key) {
  api('/api/firm')
    .then(async ({ firm }) => {
      $('firmName').textContent = firm.name;
      $('signin').classList.add('hidden');
      $('app').classList.remove('hidden');
      await load();
    })
    .catch(() => signOut());
}
