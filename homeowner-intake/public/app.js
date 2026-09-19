// Seller-facing app. One question on screen at a time, saved on every tap,
// resumable from any device, and honest about how much is left.
const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (res.status === 401) { show('start'); toast('Please open your link again'); throw new Error('unauthorised'); }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
};
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

const state = { me: null, item: null, asked: 0, spent: 0, lastSection: null, sections: {}, reviewing: false };

const SCREENS = ['loading', 'start', 'qcard', 'done', 'review', 'signed'];
function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function paintProgress(p) {
  if (!p) return;
  $('fill').style.width = `${p.percent}%`;
  const left = p.minutesLeft <= 1 ? 'under a minute left' : `about ${p.minutesLeft} min left in total`;
  $('stat').textContent = p.percent === 100
    ? `All ${p.applicable} questions answered`
    : `${p.answered} of ${p.applicable} answered · ${left}`;

  const docs = p.paperworkOutstanding ?? 0;
  $('paperworkBtn').classList.toggle('hidden', docs === 0);
  $('paperworkBtn').textContent = docs ? `Documents (${docs})` : 'Documents';
}

// ---- rendering an answer control -----------------------------------------
function optionButton(label, onPick, cls = '') {
  const b = document.createElement('button');
  b.className = `opt ${cls}`.trim();
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => onPick(label, b));
  return b;
}

/** One file picker, wired to one document request. */
function uploadControl(item, onDone, { compact = false } = {}) {
  const zone = document.createElement('div');
  zone.className = compact ? 'uploadzone compact' : 'uploadzone';
  if (!compact) zone.innerHTML = '<strong>Take a photo or pick a file</strong><br>Several pages? Send them one at a time.';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.capture = 'environment';
  input.id = `up_${item.id.replace(/[^\w]/g, '_')}`;
  input.className = 'filein';
  // A styled label is the tap target; the raw input is what actually opens the
  // camera, so it stays in the DOM and keyboard-reachable, just not on show.
  const label = document.createElement('label');
  label.className = compact ? 'filebtn compact' : 'filebtn';
  label.htmlFor = input.id;
  label.textContent = compact ? '📷 Take a photo or choose a file' : 'Take a photo or choose a file';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    label.textContent = 'Sending…';
    label.classList.add('busy');
    toast('Sending…');
    try {
      const res = await fetch(`/api/upload?itemId=${encodeURIComponent(item.id)}&filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file,
      });
      if (!res.ok) throw new Error(String(res.status));
      toast('Got it - thank you');
      await onDone();
    } catch {
      input.disabled = false;
      label.classList.remove('busy');
      label.textContent = compact ? '📷 Try that again' : 'Try that again';
      toast('That did not send. Try again?');
    }
  });
  zone.append(input, label);
  return zone;
}

function renderAnswer(item, { correcting = false } = {}) {
  const box = $('answer');
  box.replaceChildren();
  const save = (value) => submit(item, value);

  // Something we already found for them: confirming it should cost one tap,
  // not a retyped answer.
  if (item.prefilled != null && !correcting) {
    const yes = document.createElement('button');
    yes.className = 'primary';
    yes.type = 'button';
    yes.textContent = "That's right";
    yes.addEventListener('click', () => save(item.prefilled));
    box.append(yes);
    box.append(optionButton('Not quite — let me correct it', () => renderAnswer(item, { correcting: true })));
    return;
  }

  if (item.t === 'yesno') {
    const row = document.createElement('div');
    row.className = 'row2';
    row.append(optionButton('Yes', save, 'yes'), optionButton('No', save, 'no'));
    box.append(row);
    if (item.confirmable) box.append(optionButton('Not known', save));
    return;
  }

  if (item.t === 'choice' && !item.multiOk) {
    for (const opt of item.opts ?? []) box.append(optionButton(opt, save));
    return;
  }

  if (item.t === 'multi' || (item.t === 'choice' && item.multiOk)) {
    const picked = new Set();
    for (const opt of item.opts ?? []) {
      box.append(optionButton(opt, (label, btn) => {
        const on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', on ? 'false' : 'true');
        if (on) picked.delete(label); else picked.add(label);
        done.disabled = picked.size === 0;
      }));
    }
    const done = document.createElement('button');
    done.className = 'primary';
    done.type = 'button';
    done.textContent = 'Next';
    done.disabled = true;
    done.addEventListener('click', () => save([...picked]));
    box.append(done);
    return;
  }

  // A room at a time: every fitting on one screen, three taps wide. Far faster
  // than ninety separate questions, and it reads like the list it is.
  if (item.t === 'checklist') {
    const picked = {};
    const grid = document.createElement('div');
    grid.className = 'checklist';
    for (const row of item.rows ?? []) {
      const line = document.createElement('div');
      line.className = 'clrow';
      const label = document.createElement('span');
      label.className = 'cllabel';
      label.textContent = row.label;
      const choices = document.createElement('div');
      choices.className = 'clchoices';
      for (const opt of item.opts ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'clopt';
        b.textContent = opt;
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', `${row.label}: ${opt}`);
        b.addEventListener('click', () => {
          picked[row.k] = { status: opt };
          for (const sib of choices.children) sib.setAttribute('aria-pressed', String(sib === b));
          line.classList.add('answered');
          priceBox.hidden = opt !== item.opts[1];
          done.textContent = remaining() === 0 ? 'Save and continue' : `Save (${remaining()} left)`;
        });
        choices.append(b);
      }
      const priceBox = document.createElement('input');
      priceBox.type = 'text';
      priceBox.className = 'clprice';
      priceBox.placeholder = 'Would sell it for… (optional)';
      priceBox.hidden = true;
      priceBox.addEventListener('input', () => {
        if (picked[row.k]) picked[row.k].price = priceBox.value || undefined;
      });
      line.append(label, choices, priceBox);
      grid.append(line);
    }
    const remaining = () => (item.rows ?? []).filter((r) => !picked[r.k]).length;
    box.append(grid);

    const done = document.createElement('button');
    done.className = 'primary';
    done.type = 'button';
    done.textContent = `Save (${(item.rows ?? []).length} left)`;
    done.addEventListener('click', () => {
      if (remaining() > 0 && !confirm(`${remaining()} not answered yet. Save anyway and come back to them?`)) return;
      save(picked);
    });
    box.append(done);
    return;
  }

  if (item.t === 'upload') {
    box.append(uploadControl(item, async () => {
      if (state.reviewing) { state.reviewing = false; return openReview(); }
      await advance();
    }));
    box.append(optionButton("I can't find it", () => submit(item, null, 'parked')));
    return;
  }

  if (item.t === 'service_block') {
    const values = {};
    for (const f of item.fields ?? []) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.className = 'fieldlabel';
      label.textContent = f.label + (f.optional ? ' (optional)' : '');
      label.htmlFor = `f_${f.k}`;
      wrap.append(label);
      if (f.t === 'yesno') {
        const row = document.createElement('div');
        row.className = 'row2';
        for (const v of ['Yes', 'No']) {
          row.append(optionButton(v, (lbl, btn) => {
            values[f.k] = lbl;
            for (const sib of row.children) sib.setAttribute('aria-pressed', String(sib === btn));
          }));
        }
        wrap.append(row);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `f_${f.k}`;
        if (f.hint) input.placeholder = f.hint;
        input.addEventListener('input', () => { values[f.k] = input.value; });
        wrap.append(input);
      }
      box.append(wrap);
    }
    const next = document.createElement('button');
    next.className = 'primary';
    next.type = 'button';
    next.textContent = 'Save and continue';
    next.addEventListener('click', () => save(values));
    box.append(next);
    return;
  }

  // free text, dates, years
  const input = document.createElement(item.t === 'longtext' ? 'textarea' : 'input');
  // When they are correcting something we pre-filled, start from what we had.
  // Retyping an address from scratch to fix a postcode is a silly ask.
  if (correcting && item.prefilled != null) {
    input.value = typeof item.prefilled === 'object'
      ? Object.values(item.prefilled).filter(Boolean).join(', ')
      : String(item.prefilled);
  }
  if (item.t !== 'longtext') {
    input.type = item.t.startsWith('date') ? 'date' : item.t.startsWith('month_year') ? 'month' : item.t.startsWith('year') ? 'number' : 'text';
    if (input.type === 'number') { input.min = '1800'; input.max = String(new Date().getFullYear()); input.placeholder = 'e.g. 2018'; }
  } else {
    input.placeholder = 'A sentence or two is plenty';
  }
  box.append(input);
  const next = document.createElement('button');
  next.className = 'primary';
  next.type = 'button';
  next.textContent = item.optional ? 'Save (or leave blank)' : 'Save and continue';
  next.addEventListener('click', () => {
    if (!input.value && !item.optional) { toast('Add an answer, or tap "I\'ll check"'); return; }
    save(input.value || null);
  });
  box.append(next);
  if (item.t.endsWith('_or_unknown')) box.append(optionButton('Not known', () => save('Not known')));
  // A way back from a mis-tap on "Not quite".
  if (correcting && item.prefilled != null) box.append(optionButton('Actually, it was right', () => save(item.prefilled)));
  input.focus({ preventScroll: true });
}

function paintQuestion(item, progress) {
  state.item = item;
  const section = state.sections[item.s];
  $('section').textContent = section ? `${section.n}. ${section.title}` : '';
  $('counter').textContent = item.t === 'upload' ? 'document' : item.kind === 'followup' ? 'follow-up' : `~${item.secs}s`;
  $('question').textContent = item.q;

  $('help').textContent = item.help ?? item.hint ?? '';
  $('help').classList.add('hidden');
  $('helpBtn').classList.toggle('hidden', !(item.help || item.hint));

  if (item.prefilled != null) {
    $('prefilled').classList.remove('hidden');
    const v = typeof item.prefilled === 'object' ? Object.values(item.prefilled).filter(Boolean).join(', ') : item.prefilled;
    $('prefilled').innerHTML = `We already have: <strong>${escapeHtml(String(v))}</strong> — just confirm it is right.`;
  } else {
    $('prefilled').classList.add('hidden');
  }

  $('skipBtn').classList.toggle('hidden', !item.optional);
  $('backToReview').classList.toggle('hidden', !state.reviewing);
  renderAnswer(item);
  paintProgress(progress);
  show('qcard');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- flow -----------------------------------------------------------------
async function submit(item, value, status = 'answered') {
  const res = await post('/api/answer', { itemId: item.id, value, status });
  paintProgress(res.progress);

  // Editing from the review screen goes back to the review screen. Dropping
  // someone into the next question when they came to fix one answer is how
  // people lose their place and give up.
  if (state.reviewing) {
    state.reviewing = false;
    toast('Changed');
    return openReview();
  }

  state.asked += 1;
  state.spent += item.secs ?? 30;
  state.lastSection = item.s;
  await advance();
}

async function advance() {
  const p = new URLSearchParams({ asked: state.asked, spent: state.spent });
  if (state.lastSection) p.set('last', state.lastSection);
  const res = await api(`/api/next?${p}`);
  paintProgress(res.progress);

  // Questions are done but documents are not: keep going with those rather
  // than parking the seller on a screen they can do nothing with.
  if (res.formDone && !res.item && res.paperworkDone) return openReview();
  if (res.formDone && !res.item) return sessionComplete(res.progress);
  if (res.sessionDone) return sessionComplete(res.progress);
  paintQuestion(res.item, res.progress);
}

async function sessionComplete(progress) {
  const cadence = state.me.cadence;
  const when = { twice_daily: 'later today', daily: 'tomorrow', weekdays: 'the next working day', every_other_day: 'in a couple of days', weekly: 'next week' }[cadence.frequency] ?? 'soon';
  const allAnswered = progress.percent === 100;
  $('doneTitle').textContent = allAnswered ? 'Every question answered' : progress.percent >= 80 ? 'Nearly there' : "That's you done for now";
  $('doneBody').textContent = allAnswered
    ? `Just the paperwork left. ${progress.paperworkOutstanding} document${progress.paperworkOutstanding === 1 ? '' : 's'} to send whenever you can find them.`
    : `${progress.answered} of ${progress.applicable} answered — about ${progress.minutesLeft} minutes of questions left in total. We'll nudge you ${when} between ${cadence.window.start} and ${cadence.window.end}.`;
  $('moreBtn').textContent = allAnswered ? 'Review and sign' : 'Keep going — a few more';
  $('moreBtn').onclick = allAnswered
    ? () => openReview()
    : () => { state.asked = 0; state.spent = 0; advance(); };
  $('moreBtn').classList.remove('hidden');
  $('doneSettings').classList.remove('hidden');
  $('paperworkBack').classList.add('hidden');
  await paintPaperwork();
  show('done');
}

function showSigned() {
  const others = (state.me.sellers ?? []).filter((s) => !s.signed);
  $('signed').querySelector('.lede').textContent = others.length
    ? `You have signed - thank you. We still need ${others.map((s) => s.name).filter(Boolean).join(' and ') || `${others.length} other owner${others.length === 1 ? '' : 's'}`} to sign before this goes to your solicitor.`
    : 'Your solicitor has it. If anything changes before you complete, come back here and tell us: it is important the buyer has the current picture.';
  show('signed');
}

/** The document to-do list, with a camera on every outstanding row. */
async function paintPaperwork() {
  const { items } = await api('/api/paperwork');
  const left = items.filter((i) => !i.done);
  $('paperwork').classList.toggle('hidden', items.length === 0);
  $('paperworkCount').textContent = left.length === 0
    ? 'All in - nothing left to send.'
    : `${left.length} still to send. Photos are fine: a blurry photo of the right certificate beats a perfect one you never send.`;

  paintProgress(await api('/api/me').then((m) => m.progress).catch(() => null));
  $('paperworkList').replaceChildren(...items.map((i) => {
    const li = document.createElement('li');
    li.className = i.done ? 'done' : '';
    const label = document.createElement('div');
    label.className = 'pwlabel';
    label.innerHTML = `<span class="tick">${i.done ? '✓' : '○'}</span> ${escapeHtml(i.label)}${i.hint && !i.done ? `<div class="help">${escapeHtml(i.hint)}</div>` : ''}`;
    li.append(label);
    if (!i.done) li.append(uploadControl({ id: i.id }, paintPaperwork, { compact: true }));
    return li;
  }));
}

async function openReview() {
  const data = await api('/api/review');
  const body = $('reviewBody');
  body.replaceChildren();
  for (const section of data.sections) {
    const h = document.createElement('div');
    h.className = 'rsec';
    h.textContent = `${section.n}. ${section.title}`;
    body.append(h);
    for (const row of section.rows) {
      const div = document.createElement('div');
      div.className = 'rrow';
      const left = document.createElement('div');
      left.innerHTML = `${escapeHtml(row.question)}<div class="v ${row.answer ? '' : 'missing'}">${escapeHtml(row.answer ?? 'not answered')}</div>`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Change';
      edit.addEventListener('click', async () => {
        // Fetch the real question, so it re-opens with the control it was
        // asked with - a choice stays a choice, a fittings list stays a list.
        const { item } = await api(`/api/item?id=${encodeURIComponent(row.id)}`);
        state.reviewing = true;
        paintQuestion(item, data.progress);
      });
      div.append(left, edit);
      body.append(div);
    }
  }
  $('confirmBox').checked = false;
  $('signBtn').disabled = true;
  show('review');
}

async function openSettings() {
  const dlg = $('settings');
  const { plan, cadence } = state.me;
  const mark = (containerId, matcher) => {
    for (const b of $(containerId).children) b.setAttribute('aria-pressed', String(matcher(b.dataset)));
  };
  mark('sizeChips', (d) => d.mode === plan.mode && Number(d.size) === plan.size);
  mark('freqChips', (d) => d.freq === cadence.frequency);
  mark('whenChips', (d) => d.start === cadence.window.start);
  mark('chanChips', (d) => d.chan === cadence.channel);
  const f = state.me.forecast;
  $('forecast').textContent = f ? `At this rate: about ${f.sessionsLeft} more sittings, finishing in roughly ${f.daysLeft} days.` : '';

  const pick = (containerId, apply) => {
    for (const b of $(containerId).children) {
      b.onclick = () => {
        for (const sib of $(containerId).children) sib.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        apply(b.dataset);
      };
    }
  };
  const draft = { plan: { ...plan }, cadence: { ...cadence, window: { ...cadence.window } } };
  pick('sizeChips', (d) => { draft.plan.mode = d.mode; draft.plan.size = Number(d.size); });
  pick('freqChips', (d) => { draft.cadence.frequency = d.freq; });
  pick('whenChips', (d) => { draft.cadence.window = { start: d.start, end: d.end }; });
  pick('chanChips', (d) => { draft.cadence.channel = d.chan; });

  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'save') return;
    const saved = await post('/api/preferences', draft);
    state.me.plan = saved.plan;
    state.me.cadence = saved.cadence;
    state.asked = 0;
    state.spent = 0;
    toast('Saved — that is how we will ask from now on');
  }, { once: true });
}

async function boot() {
  state.me = await api('/api/me');
  state.sections = Object.fromEntries(state.me.sections.map((s) => [s.id, s]));
  $('addr').textContent = state.me.property.address ?? state.me.property.ref ?? 'Your property';
  paintProgress(state.me.progress);

  const p = state.me.progress;
  const f = state.me.forecast;
  $('startTitle').textContent = p.answered > 0 ? `Welcome back${state.me.name ? `, ${state.me.name.split(' ')[0]}` : ''}` : `Hello${state.me.name ? ` ${state.me.name.split(' ')[0]}` : ''}`;
  $('startBody').textContent = p.answered > 0
    ? `You are ${p.percent}% through — about ${p.minutesLeft} minutes of questions left. Pick up where you left off.`
    : `Your solicitor needs the standard property information for ${state.me.property.address ?? 'your sale'}. It is normally a 20-page form in one sitting. We have split it into ${f.sessionsLeft} short goes of ${state.me.plan.mode === 'count' ? `${state.me.plan.size} questions` : `${Math.round(state.me.plan.size / 60)} minutes`}.`;
  $('beginBtn').textContent = p.answered > 0 ? 'Carry on' : 'Start';

  // Someone who has answered everything came back to sign, not to answer.
  // The form cannot go to the buyer until they do, so take them there rather
  // than showing a start screen with nothing left to start.
  if (state.me.signed) return showSigned();
  if (location.hash === '#review' || state.me.purpose === 'review_and_sign' || p.percent === 100) return openReview();
  show('start');
}

$('beginBtn').addEventListener('click', () => { state.asked = 0; state.spent = 0; advance(); });
$('moreBtn').addEventListener('click', () => { state.asked = 0; state.spent = 0; advance(); });
$('helpBtn').addEventListener('click', () => $('help').classList.toggle('hidden'));
$('backToReview').addEventListener('click', () => { state.reviewing = false; openReview(); });
$('parkBtn').addEventListener('click', async () => {
  await post('/api/park', { itemId: state.item.id, days: 3 });
  toast("Parked — we'll ask again in a few days");
  await advance();
});
$('skipBtn').addEventListener('click', () => submit(state.item, null, 'answered'));
for (const id of ['settingsBtn', 'startSettings', 'doneSettings']) $(id).addEventListener('click', openSettings);
let cameFrom = 'start';
$('paperworkBtn').addEventListener('click', async () => {
  cameFrom = SCREENS.find((id) => !$(id).classList.contains('hidden')) ?? 'start';
  await paintPaperwork();
  $('doneTitle').textContent = 'Paperwork';
  $('doneBody').textContent = 'Send these whenever you can find them. They are the usual reason a sale sits waiting.';
  $('moreBtn').classList.add('hidden');
  $('doneSettings').classList.add('hidden');
  $('paperworkBack').classList.remove('hidden');
  show('done');
});
$('paperworkBack').addEventListener('click', () => {
  $('moreBtn').classList.remove('hidden');
  $('doneSettings').classList.remove('hidden');
  $('paperworkBack').classList.add('hidden');
  if (cameFrom === 'review') return openReview();
  show(cameFrom);
});
$('confirmBox').addEventListener('change', (e) => { $('signBtn').disabled = !e.target.checked; });
$('signBtn').addEventListener('click', async () => {
  const res = await post('/api/sign', { confirmed: true });
  state.me = await api('/api/me');
  showSigned();
});

boot().catch((err) => {
  $('loading').classList.remove('hidden');
  $('loading').innerHTML = '<h2>We could not open your form</h2><p class="lede">Your link may have expired. Reply to our last message and we will send a new one.</p>';
  console.error(err);
});
