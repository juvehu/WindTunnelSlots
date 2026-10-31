'use strict';
// =====================================================================
// Tunnel Slot Planner — wind tunnel session allocation with saved events
// All data stays on this device (localStorage). Export/import for backup.
// =====================================================================

// ---- Hard-coded rules ----
const DAY_START = 8 * 60, DAY_END = 22 * 60, PERIOD = 30, SESSION = 15;
const MIN_BREAK_MIN = 60;                                   // rest after a person's half-hour period
const REST_ROWS = 1 + Math.ceil(MIN_BREAK_MIN / PERIOD);    // 10:00 -> next allowed 11:30
const ROWS = (DAY_END - DAY_START) / PERIOD;
const MAX_TEAMS = 10;
const HUES = [205, 18, 140, 280, 48, 330, 175, 95, 245, 0];
const STORE_KEY = 'wts-store-v1';
const UI_KEY = 'wts-ui-v1';

const $ = id => document.getElementById(id);
const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const blankTeam = i => ({ name: 'Team ' + (i + 1), minutes: 30, members: ['', '', '', ''] });
const blankPins = () => Array.from({ length: ROWS }, () => [null, null]);
const blankAvail = () => Array.from({ length: ROWS }, () => [false, false]);

function blankPlan() {
  return { teamCount: 2, teams: Array.from({ length: MAX_TEAMS }, (_, i) => blankTeam(i)),
    unavailable: blankAvail(), pins: blankPins(), result: null, stale: false, open: 0, imgTitle: '' };
}
function examplePlan() {
  const p = blankPlan();
  p.teamCount = 3;
  p.teams[0] = { name: 'Aurora (example)', minutes: 60, members: ['Anna', 'Mikko', 'Sami', 'Liisa'] };
  p.teams[1] = { name: 'Kaira 2-way (example)', minutes: 45, members: ['Mikko', 'Jenni', '', ''] };
  p.teams[2] = { name: 'Solo Petra (example)', minutes: 30, members: ['Petra', '', '', ''] };
  [0, 1, 8, 9].forEach(r => p.unavailable[r] = [true, true]);
  for (let r = 20; r < ROWS; r++) p.unavailable[r] = [true, true];
  p.pins[4][0] = 2;
  return p;
}

// Make any loaded plan safe to use (older or hand-edited files)
function normalizePlan(p) {
  const b = blankPlan();
  if (!p || typeof p !== 'object') return b;
  const out = Object.assign(b, p);
  out.teamCount = Math.min(MAX_TEAMS, Math.max(1, +out.teamCount || 1));
  out.teams = Array.from({ length: MAX_TEAMS }, (_, i) => {
    const t = (p.teams && p.teams[i]) || blankTeam(i);
    const m = Array.isArray(t.members) ? t.members.slice(0, 4).map(x => String(x || '')) : [];
    while (m.length < 4) m.push('');
    let min = +t.minutes || 30; min = Math.min(240, Math.max(SESSION, Math.round(min / SESSION) * SESSION));
    return { name: String(t.name ?? ''), minutes: min, members: m };
  });
  const okGrid = (g, fill) => Array.isArray(g) && g.length === ROWS ? g.map(r => [r?.[0] ?? fill, r?.[1] ?? fill]) : null;
  out.unavailable = (okGrid(p.unavailable, false) || blankAvail()).map(r => [!!r[0], !!r[1]]);
  out.pins = (okGrid(p.pins, null) || blankPins()).map(r => r.map(v => (v === null || v === '' || isNaN(+v)) ? null : +v));
  if (out.result && !(Array.isArray(out.result.grid) && out.result.grid.length === ROWS)) out.result = null;
  out.imgTitle = String(out.imgTitle || '');
  return out;
}

// ---- Store: all events on this device ----
let store = loadStore();
let state; // the current event's plan

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.events && Object.keys(s.events).length) {
      Object.values(s.events).forEach(e => e.plan = normalizePlan(e.plan));
      if (!s.events[s.currentId]) s.currentId = Object.keys(s.events)[0];
      return s;
    }
  } catch (e) {}
  const id = newId();
  return { version: 1, currentId: id, events: { [id]: { id, name: 'Example event', date: today(), updated: Date.now(), plan: examplePlan() } } };
}
let saveTimer = null, storageOk = true;
function persistNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); storageOk = true; setSaved('Saved'); }
  catch (e) { storageOk = false; setSaved('Not saved — storage unavailable'); }
}
function save() {
  const ev = currentEvent(); if (ev) ev.updated = Date.now();
  setSaved('Saving…');
  clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 400);
}
window.addEventListener('pagehide', () => { if (saveTimer) persistNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) persistNow(); });
function setSaved(t) { $('savedFlag').textContent = t; }
const currentEvent = () => store.events[store.currentId];
const sortedEvents = () => Object.values(store.events).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}.${+m}.${y}`; };

// ---- Small helpers ----
function personsOf(t) {
  const seen = new Set();
  return t.members.map(m => m.trim()).filter(m => m && !seen.has(m.toLowerCase()) && seen.add(m.toLowerCase()));
}
const teamName = i => state.teams[i].name || `Team ${i + 1}`;
const activePin = (r, s) => {
  const p = state.pins[r][s];
  return (p != null && p < state.teamCount && !state.unavailable[r][s]) ? p : null;
};

// =====================================================================
// Tabs (phone)
// =====================================================================
let ui = { tab: 'teams' };
try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY)) || {}); } catch (e) {}
function setTab(t) {
  ui.tab = t; document.body.dataset.tab = t;
  document.querySelectorAll('.tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {}
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

// keep sticky table headers just under the app header
const hdr = $('top');
const setHdr = () => document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
if (window.ResizeObserver) new ResizeObserver(setHdr).observe(hdr); else window.addEventListener('resize', setHdr);
setHdr();

// =====================================================================
// Event picker and sheet
// =====================================================================
const eventSel = $('eventSel');
function renderEventPicker() {
  eventSel.innerHTML = '';
  sortedEvents().forEach(e => eventSel.add(new Option(`${fmtDate(e.date)} · ${e.name || 'Untitled'}`, e.id)));
  eventSel.value = store.currentId;
}
eventSel.addEventListener('change', () => switchEvent(eventSel.value));
function switchEvent(id) {
  if (!store.events[id]) return;
  if (saveTimer) persistNow();
  store.currentId = id; state = store.events[id].plan;
  persistNow(); renderAll();
}

const sheet = $('sheet');
let editMode = null;
function openSheet(view, title) {
  ['menu', 'edit', 'delete'].forEach(v => $('view-' + v).hidden = v !== view);
  $('sheetTitle').textContent = title;
  sheetMsg('');
  sheet.hidden = false;
}
function closeSheet() { sheet.hidden = true; }
function sheetMsg(t, err) { const m = $('sheetMsg'); m.textContent = t; m.className = 'sheet-msg' + (err ? ' err' : ''); }
$('eventMenuBtn').addEventListener('click', () => openSheet('menu', currentEvent().name || 'Event'));
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

function openEdit(mode) {
  editMode = mode;
  const ev = currentEvent();
  const titles = { new: 'New event', duplicate: 'Duplicate event', rename: 'Rename event' };
  $('evName').value = mode === 'rename' ? ev.name : mode === 'duplicate' ? ev.name.replace(/\s*\(copy\)$/, '') : '';
  $('evName').placeholder = 'e.g. Tunnel day, Bodyflight';
  $('evDate').value = mode === 'rename' ? ev.date : today();
  $('evSubmit').textContent = mode === 'rename' ? 'Save' : 'Create';
  openSheet('edit', titles[mode]);
  setTimeout(() => $('evName').focus(), 50);
}
$('view-edit').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('evName').value.trim() || 'Untitled', date = $('evDate').value || today();
  if (editMode === 'rename') {
    Object.assign(currentEvent(), { name, date });
  } else {
    const id = newId();
    let plan;
    if (editMode === 'duplicate') {
      plan = normalizePlan(JSON.parse(JSON.stringify(state)));
      plan.result = null; plan.stale = false; plan.imgTitle = '';
    } else plan = blankPlan();
    store.events[id] = { id, name, date, updated: Date.now(), plan };
    store.currentId = id; state = plan;
    if (editMode === 'new') setTab('teams');
  }
  persistNow(); renderAll(); closeSheet();
});

$('deleteConfirm').addEventListener('click', () => {
  delete store.events[store.currentId];
  if (!Object.keys(store.events).length) {
    const id = newId();
    store.events[id] = { id, name: 'New event', date: today(), updated: Date.now(), plan: blankPlan() };
  }
  store.currentId = sortedEvents()[0].id; state = currentEvent().plan;
  persistNow(); renderAll(); closeSheet();
});

sheet.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.act;
  if (a === 'close') closeSheet();
  else if (a === 'cancel') openSheet('menu', currentEvent().name || 'Event');
  else if (a === 'new' || a === 'duplicate' || a === 'rename') openEdit(a);
  else if (a === 'delete') {
    const ev = currentEvent();
    $('deleteText').textContent = `Delete “${ev.name || 'Untitled'}” (${fmtDate(ev.date)})? Its teams, slots and plan are removed from this device. Export it first if you may need it later.`;
    openSheet('delete', 'Delete event');
  }
  else if (a === 'export-one') exportEvents([currentEvent()]);
  else if (a === 'export-all') exportEvents(sortedEvents());
  else if (a === 'import') $('importFile').click();
}));

// ---- Export / import ----
const slug = s => (s || 'event').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'event';
async function shareOrDownload(file, okText) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return okText;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'Cancelled.';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return `Downloaded ${file.name}.`;
}
async function exportEvents(list) {
  if (saveTimer) persistNow();
  const data = { app: 'WindTunnelSlots', version: 1, exported: new Date().toISOString(),
    events: list.map(e => ({ name: e.name, date: e.date, plan: e.plan })) };
  const name = list.length === 1 ? `wind-tunnel-${list[0].date}-${slug(list[0].name)}.json` : `wind-tunnel-all-events-${today()}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  const msg = await shareOrDownload(file, list.length === 1 ? 'Event exported.' : `${list.length} events exported.`);
  sheetMsg(msg);
}
$('importFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data.events) ? data.events : (data.plan ? [data] : null);
    if (!list || !list.length) throw new Error('no events');
    let firstId = null;
    list.forEach(x => {
      const id = newId(); firstId = firstId || id;
      store.events[id] = { id, name: String(x.name || 'Imported event'), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : today(), updated: Date.now(), plan: normalizePlan(x.plan) };
    });
    store.currentId = firstId; state = currentEvent().plan;
    persistNow(); renderAll();
    sheetMsg(`Imported ${list.length} event${list.length === 1 ? '' : 's'}. Now showing “${currentEvent().name}”.`);
  } catch (err) {
    sheetMsg('That file is not a Tunnel Slot Planner export. Choose a .json file made with Export.', true);
  }
});

// =====================================================================
// Teams
// =====================================================================
const teamCountSel = $('teamCount');
for (let i = 1; i <= MAX_TEAMS; i++) teamCountSel.add(new Option(i, i));
teamCountSel.addEventListener('change', () => { state.teamCount = +teamCountSel.value; renderTeams(); changed(); });
function metaText(t) { const n = personsOf(t).length; return `${n} flyer${n === 1 ? '' : 's'} · ${t.minutes} min`; }

function renderTeams() {
  teamCountSel.value = state.teamCount;
  const wrap = $('teams'); wrap.innerHTML = '';
  for (let i = 0; i < state.teamCount; i++) {
    const t = state.teams[i];
    const d = document.createElement('details');
    d.className = 'team'; d.style.setProperty('--h', HUES[i]);
    if (state.open === i) d.open = true;
    d.innerHTML = `
      <summary><span class="dot"></span><span class="t-name"></span><span class="t-meta"></span></summary>
      <div class="team-form">
        <label>Team name<input type="text" id="tn${i}" maxlength="40" autocomplete="off"></label>
        <label>Total tunnel time<select id="tm${i}"></select></label>
        <label>Flyers (1–4)
          <div class="flyers">${[0, 1, 2, 3].map(k => `<input type="text" id="tf${i}_${k}" maxlength="30" autocomplete="off" autocapitalize="words" placeholder="Flyer ${k + 1}${k ? ' (optional)' : ''}">`).join('')}</div>
        </label>
      </div>`;
    const nameEl = d.querySelector('.t-name'), metaEl = d.querySelector('.t-meta');
    const sync = () => { nameEl.textContent = t.name || `Team ${i + 1}`; metaEl.textContent = metaText(t); };
    sync();
    const tn = d.querySelector('#tn' + i); tn.value = t.name;
    tn.addEventListener('input', () => { t.name = tn.value; sync(); changed(); });
    const tm = d.querySelector('#tm' + i);
    for (let m = SESSION; m <= 240; m += SESSION) tm.add(new Option(`${m} min (${m / SESSION} × 15)`, m));
    tm.value = t.minutes;
    tm.addEventListener('change', () => { t.minutes = +tm.value; sync(); changed(); });
    for (let k = 0; k < 4; k++) {
      const f = d.querySelector(`#tf${i}_${k}`); f.value = t.members[k];
      f.addEventListener('input', () => { t.members[k] = f.value; sync(); changed(); });
    }
    d.addEventListener('toggle', () => {
      if (d.open) { state.open = i; wrap.querySelectorAll('details').forEach(o => { if (o !== d) o.open = false; }); save(); }
    });
    wrap.appendChild(d);
  }
}

// =====================================================================
// Availability
// =====================================================================
function renderAvail() {
  const body = $('availBody'); body.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    const tr = document.createElement('tr');
    if ((DAY_START + r * PERIOD) % 60 === 0) tr.className = 'hour';
    const td0 = document.createElement('td'); td0.className = 'time';
    const tb = document.createElement('button'); tb.type = 'button'; tb.textContent = fmt(DAY_START + r * PERIOD);
    tb.setAttribute('aria-label', `Toggle both slots at ${fmt(DAY_START + r * PERIOD)}`);
    tb.addEventListener('click', () => {
      const v = !(state.unavailable[r][0] && state.unavailable[r][1]);
      state.unavailable[r] = [v, v]; renderAvail(); changed();
    });
    td0.appendChild(tb); tr.appendChild(td0);
    for (let s = 0; s < 2; s++) {
      const td = document.createElement('td');
      const off = state.unavailable[r][s];
      td.innerHTML = `<label class="cell${off ? ' off' : ''}"><input type="checkbox" id="u${r}_${s}"${off ? ' checked' : ''} aria-label="${fmt(DAY_START + r * PERIOD)} slot ${s ? 'B' : 'A'} unavailable"><span class="tick">${off ? '✕' : ''}</span></label>`;
      const cb = td.querySelector('input');
      cb.addEventListener('change', () => { state.unavailable[r][s] = cb.checked; renderAvail(); changed(); });
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}
$('clearAvail').addEventListener('click', () => { state.unavailable = blankAvail(); renderAvail(); changed(); });

// =====================================================================
// Allocation
// =====================================================================
function better(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] > b[i] + 1e-9) return true; if (a[i] < b[i] - 1e-9) return false; } return false; }

function allocate() {
  const msgs = [], teams = [];
  for (let i = 0; i < state.teamCount; i++) {
    const t = state.teams[i];
    const persons = personsOf(t).map(p => p.toLowerCase());
    if (!persons.length) { msgs.push(`${teamName(i)} has no flyers and was skipped.`); continue; }
    teams.push({ idx: i, need: t.minutes / SESSION, persons });
  }
  const slots = [];
  for (let r = 0; r < ROWS; r++) for (let s = 0; s < 2; s++) if (!state.unavailable[r][s]) slots.push([r, s]);

  // fixed slots
  const kOf = new Map(teams.map((t, k) => [t.idx, k]));
  const pinned = Array.from({ length: ROWS }, () => [null, null]);
  const pinCount = teams.map(() => 0);
  const pinList = [];
  for (let r = 0; r < ROWS; r++) for (let s = 0; s < 2; s++) {
    const p = activePin(r, s);
    if (p == null || !kOf.has(p)) continue;
    const k = kOf.get(p);
    pinned[r][s] = k; pinCount[k]++; pinList.push({ r, s, k });
  }
  // keep auto sessions clear of the rest window around each fixed slot
  const pinBlock = Array.from({ length: ROWS }, () => new Set());
  pinList.forEach(({ r, k }) => teams[k].persons.forEach(p => {
    for (let d = -(REST_ROWS - 1); d <= REST_ROWS - 1; d++) if (r + d >= 0 && r + d < ROWS) pinBlock[r + d].add(p);
  }));
  for (let a = 0; a < pinList.length; a++) for (let b = a + 1; b < pinList.length; b++) {
    const A = pinList[a], B = pinList[b];
    if (Math.abs(A.r - B.r) >= REST_ROWS) continue;
    const shared = teams[A.k].persons.filter(p => teams[B.k].persons.includes(p));
    if (!shared.length) continue;
    const tA = fmt(DAY_START + A.r * PERIOD + A.s * SESSION), tB = fmt(DAY_START + B.r * PERIOD + B.s * SESSION);
    msgs.push(`Fixed slots at ${tA} (${teamName(teams[A.k].idx)}) and ${tB} (${teamName(teams[B.k].idx)}) break the rest rule for ${shared.join(', ')}.`);
  }
  teams.forEach((t, k) => { if (pinCount[k] > t.need) msgs.push(`${teamName(t.idx)} has ${pinCount[k] * SESSION} min of fixed slots, more than its ${t.need * SESSION} min total.`); });

  const pinRows = teams.map(() => []);
  pinList.forEach(({ r, k }) => pinRows[k].push(r));
  pinRows.forEach(a => a.sort((x, y) => x - y));
  const teamRows = (grid, idx) => { const rows = []; for (let r = 0; r < ROWS; r++) if (grid[r][0] === idx || grid[r][1] === idx) rows.push(r); return rows; };
  const excessOf = rows => rows.slice(1).reduce((a, r, i) => a + Math.max(0, r - rows[i] - REST_ROWS), 0);

  let best = null;
  const RUNS = 1500;
  for (let run = 0; run < RUNS; run++) {
    const jitter = run === 0 ? 0 : 0.1 + 0.6 * Math.random();
    const wCad = run === 0 ? 1.5 : 0.3 + 2.7 * Math.random();
    const rem = teams.map((t, k) => t.need - pinCount[k]);
    const last = new Map();
    const teamLast = teams.map(() => null);
    const grid = Array.from({ length: ROWS }, () => [null, null]);
    for (const [r, s] of slots) {
      if (pinned[r][s] != null) {
        const k = pinned[r][s];
        grid[r][s] = teams[k].idx;
        teams[k].persons.forEach(p => last.set(p, r));
        teamLast[k] = r;
        continue;
      }
      let pick = -1, pickScore = -Infinity;
      teams.forEach((t, k) => {
        if (rem[k] <= 0) return;
        if (t.persons.some(p => pinBlock[r].has(p))) return;
        if (!t.persons.every(p => !last.has(p) || r - last.get(p) >= REST_ROWS)) return;
        // cadence: prefer exactly 1 h 30 min after the previous session, or before the next fixed slot
        let cad = 0;
        if (teamLast[k] != null) cad = 1 / (1 + (r - teamLast[k] - REST_ROWS));
        const nextPin = pinRows[k].find(x => x > r);
        if (nextPin != null) cad = Math.max(cad, 1 / (1 + (nextPin - r - REST_ROWS)));
        const sc = rem[k] / t.need + 0.01 * rem[k] + wCad * cad + (jitter ? Math.random() * jitter : -0.0001 * k);
        if (sc > pickScore) { pickScore = sc; pick = k; }
      });
      if (pick < 0) continue;
      grid[r][s] = teams[pick].idx;
      teams[pick].persons.forEach(p => last.set(p, r));
      teamLast[pick] = r;
      rem[pick]--;
    }
    const filled = teams.reduce((a, t, k) => a + t.need - rem[k], 0);
    const shortSq = rem.reduce((a, x) => a + Math.max(0, x) ** 2, 0);
    const maxShortShare = Math.max(0, ...rem.map((x, k) => x / teams[k].need));
    const excess = teams.reduce((a, t) => a + excessOf(teamRows(grid, t.idx)), 0);
    const score = [filled, -maxShortShare, -excess, -shortSq];
    if (!best || better(score, best.score)) best = { score, grid, rem };
  }
  const alloc = {};
  teams.forEach((t, k) => {
    const rows = teamRows(best.grid, t.idx);
    const gaps = rows.slice(1).map((r, i) => (r - rows[i]) * PERIOD);
    alloc[t.idx] = { got: t.need - best.rem[k], need: t.need, maxGap: gaps.length ? Math.max(...gaps) : 0, extraGap: excessOf(rows) * PERIOD };
  });
  state.result = { grid: best.grid, alloc, msgs };
  state.stale = false;
  save(); renderOut();
  status('');
}
$('allocate').addEventListener('click', allocate);
$('clearPins').addEventListener('click', () => { state.pins = blankPins(); changed(); });

// =====================================================================
// Plan view
// =====================================================================
function renderOut() {
  const res = state.result;
  const sum = $('summary'); sum.innerHTML = '';
  if (state.stale && res) { const st = document.createElement('div'); st.className = 'stale'; st.textContent = 'Inputs changed since the last run. Press Allocate to update.'; sum.appendChild(st); }
  if (!res) { const st = document.createElement('div'); st.className = 'stale'; st.textContent = 'No plan yet. Press Allocate.'; sum.appendChild(st); }
  if (res) {
    const chips = document.createElement('div'); chips.className = 'chips';
    Object.entries(res.alloc).forEach(([i, a]) => {
      if (+i >= state.teamCount) return;
      const t = state.teams[i];
      const c = document.createElement('span');
      c.className = 'chip ' + (a.got >= a.need ? 'ok' : 'short');
      c.style.setProperty('--h', HUES[i]);
      c.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="n"></span>';
      c.querySelector('.nm').textContent = t.name || `Team ${+i + 1}`;
      c.querySelector('.n').textContent = `${a.got * SESSION}/${a.need * SESSION} min` + (a.maxGap ? ` · max gap ${Math.floor(a.maxGap / 60)}:${String(a.maxGap % 60).padStart(2, '0')}` : '');
      if (a.extraGap) c.classList.add('gappy');
      c.title = personsOf(t).join(', ');
      chips.appendChild(c);
    });
    sum.appendChild(chips);
    const short = Object.entries(res.alloc).filter(([i, a]) => a.got < a.need && +i < state.teamCount);
    const m = document.createElement('div'); m.className = 'msgs';
    [...res.msgs, ...short.map(([i, a]) => `${teamName(+i)} is ${(a.need - a.got) * SESSION} min short. Free more slots or reduce requested time.`)]
      .forEach(t => { const d = document.createElement('div'); d.textContent = t; m.appendChild(d); });
    if (m.childNodes.length) sum.appendChild(m);
  }
  const availCount = state.unavailable.flat().filter(x => !x).length;
  const reqCount = state.teams.slice(0, state.teamCount).reduce((a, t) => a + t.minutes / SESSION, 0);
  const tot = document.createElement('div'); tot.className = 'totals';
  tot.textContent = `Requested ${reqCount * SESSION} min · Available ${availCount * SESSION} min`;
  sum.appendChild(tot);
  const lg = document.createElement('div'); lg.className = 'legend';
  lg.innerHTML = '<span><i class="lg-fix"></i>FIX = fixed by you</span><span><i class="lg-free"></i>Free</span><span><i class="lg-block"></i>Unavailable</span><span>Gaps are start to start; 1:30 is the tightest the rest rule allows.</span>';
  sum.appendChild(lg);

  const body = $('outBody'); body.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    const tr = document.createElement('tr');
    if ((DAY_START + r * PERIOD) % 60 === 0) tr.className = 'hour';
    const td0 = document.createElement('td'); td0.className = 'time'; td0.textContent = fmt(DAY_START + r * PERIOD);
    tr.appendChild(td0);
    for (let s = 0; s < 2; s++) {
      const td = document.createElement('td'); td.className = 's';
      const div = document.createElement('div'); div.className = 'slot';
      if (state.unavailable[r][s]) { div.classList.add('blocked'); div.textContent = 'Unavailable'; td.appendChild(div); tr.appendChild(td); continue; }
      const pin = activePin(r, s);
      const ti = pin != null ? pin : (res ? res.grid[r][s] : null);
      if (ti != null && ti < state.teamCount) {
        div.classList.add('team'); div.style.setProperty('--h', HUES[ti]);
        if (pin != null) div.classList.add('fixed'); else if (state.stale) div.classList.add('stale-cell');
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = teamName(ti);
        div.appendChild(nm);
        if (pin != null) { const f = document.createElement('span'); f.className = 'fixtag'; f.textContent = 'FIX'; div.appendChild(f); }
      } else { div.classList.add('free'); div.textContent = res ? 'Free' : '—'; }
      td.appendChild(div);
      const sel = document.createElement('select');
      sel.className = 'pinsel'; sel.id = `pin${r}_${s}`;
      sel.setAttribute('aria-label', `Fix team for ${fmt(DAY_START + r * PERIOD + s * SESSION)}, slot ${s ? 'B' : 'A'}`);
      sel.add(new Option('Auto (allocator decides)', ''));
      for (let i = 0; i < state.teamCount; i++) sel.add(new Option('Fix: ' + teamName(i), i));
      sel.value = pin != null ? String(pin) : '';
      sel.addEventListener('change', () => { state.pins[r][s] = sel.value === '' ? null : +sel.value; changed(); });
      td.appendChild(sel);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  schedulePicture();
}

function changed() { if (state.result) state.stale = true; save(); renderOut(); }

// =====================================================================
// Picture: share sheet / clipboard
// =====================================================================
const IMG = { bg: '#ffffff', fg: '#16232b', muted: '#5d6f78', line: '#d6dee2', head: '#0a7ea4', block: '#e3e8eb', blockFg: '#8a979e', free: '#9aa8af' };
const imgTitleEl = $('imgTitle');
imgTitleEl.addEventListener('input', () => { state.imgTitle = imgTitleEl.value; save(); schedulePicture(); });

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function pictureTitle() {
  const ev = currentEvent();
  return state.imgTitle.trim() || `${ev.name || 'Wind tunnel schedule'} · ${fmtDate(ev.date)}`;
}
function drawPicture() {
  const res = state.result;
  let r0 = 0, r1 = ROWS - 1;
  const closed = r => state.unavailable[r][0] && state.unavailable[r][1];
  while (r0 < r1 && closed(r0)) r0++;
  while (r1 > r0 && closed(r1)) r1--;
  const teamIdx = [...Array(state.teamCount).keys()];
  const W = 760, PAD = 32, ROWH = 30, TIMEW = 92, GAP = 8;
  const colW = (W - PAD * 2 - TIMEW - GAP) / 2;
  const headH = 86, tblHeadH = 30, legendRowH = 26;
  const H = headH + tblHeadH + (r1 - r0 + 1) * ROWH + 28 + 24 + teamIdx.length * legendRowH + 46;
  const SC = 2;
  const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
  const ctx = cv.getContext('2d'); ctx.scale(SC, SC);
  const sans = (w, sz) => `${w} ${sz}px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
  const mono = sz => `500 ${sz}px ui-monospace,"SF Mono",Menlo,monospace`;

  ctx.fillStyle = IMG.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = IMG.head; ctx.fillRect(0, 0, W, 6);
  ctx.fillStyle = IMG.fg; ctx.font = sans(700, 24); ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, pictureTitle(), W - PAD * 2), PAD, 46);
  ctx.fillStyle = IMG.muted; ctx.font = sans(400, 12.5);
  ctx.fillText(`15-min sessions · ${fmt(DAY_START + r0 * PERIOD)}–${fmt(DAY_START + (r1 + 1) * PERIOD)} · min. 1:30 between a flyer's sessions (start to start)`, PAD, 68);

  let y = headH;
  ctx.font = sans(600, 11); ctx.fillStyle = IMG.muted;
  ctx.fillText('TIME', PAD, y + 18);
  ctx.fillText('SLOT A', PAD + TIMEW, y + 18);
  ctx.fillText('SLOT B', PAD + TIMEW + colW + GAP, y + 18);
  y += tblHeadH;
  ctx.strokeStyle = IMG.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y - .5); ctx.lineTo(W - PAD, y - .5); ctx.stroke();

  for (let r = r0; r <= r1; r++) {
    const t = DAY_START + r * PERIOD;
    ctx.fillStyle = IMG.fg; ctx.font = mono(13); ctx.textBaseline = 'middle';
    ctx.fillText(fmt(t), PAD, y + ROWH / 2);
    for (let s = 0; s < 2; s++) {
      const x = PAD + TIMEW + s * (colW + GAP), cy = y + 3, ch = ROWH - 6;
      if (state.unavailable[r][s]) {
        ctx.fillStyle = IMG.block; roundRect(ctx, x, cy, colW, ch, 4); ctx.fill();
        ctx.fillStyle = IMG.blockFg; ctx.font = sans(500, 10.5);
        ctx.textAlign = 'center'; ctx.fillText('UNAVAILABLE', x + colW / 2, y + ROWH / 2); ctx.textAlign = 'left';
        continue;
      }
      const pin = activePin(r, s);
      const ti = pin != null ? pin : (res ? res.grid[r][s] : null);
      if (ti != null && ti < state.teamCount) {
        const h = HUES[ti];
        ctx.fillStyle = `hsl(${h} 62% 84%)`; roundRect(ctx, x, cy, colW, ch, 4); ctx.fill();
        ctx.fillStyle = `hsl(${h} 55% 42%)`; ctx.fillRect(x, cy, 4, ch);
        ctx.fillStyle = IMG.fg; ctx.font = sans(pin != null ? 600 : 500, 13);
        ctx.fillText(fitText(ctx, `${fmt(t + s * SESSION)}  ${teamName(ti)}`, colW - (pin != null ? 54 : 18)), x + 11, y + ROWH / 2);
        if (pin != null) {
          ctx.fillStyle = `hsl(${h} 55% 42%)`; roundRect(ctx, x + colW - 38, y + ROWH / 2 - 8, 30, 16, 3); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = mono(9.5); ctx.textAlign = 'center';
          ctx.fillText('FIX', x + colW - 23, y + ROWH / 2 + .5); ctx.textAlign = 'left';
        }
      } else {
        ctx.setLineDash([4, 3]); ctx.strokeStyle = IMG.line; roundRect(ctx, x + .5, cy + .5, colW - 1, ch - 1, 4); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = IMG.free; ctx.font = sans(400, 11.5); ctx.textAlign = 'center';
        ctx.fillText('Free', x + colW / 2, y + ROWH / 2); ctx.textAlign = 'left';
      }
    }
    y += ROWH;
    ctx.strokeStyle = IMG.line; ctx.beginPath(); ctx.moveTo(PAD, y - .5); ctx.lineTo(W - PAD, y - .5); ctx.stroke();
  }

  y += 28; ctx.textBaseline = 'alphabetic';
  ctx.font = sans(600, 11); ctx.fillStyle = IMG.muted; ctx.fillText('TEAMS', PAD, y); y += 12;
  teamIdx.forEach(i => {
    const t = state.teams[i], a = res && res.alloc[i];
    const cy = y + legendRowH / 2;
    ctx.fillStyle = `hsl(${HUES[i]} 62% 76%)`; roundRect(ctx, PAD, cy - 6, 12, 12, 3); ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = IMG.fg; ctx.font = sans(600, 13);
    ctx.fillText(fitText(ctx, teamName(i), 210), PAD + 22, cy);
    ctx.fillStyle = IMG.muted; ctx.font = sans(400, 12.5);
    ctx.fillText(fitText(ctx, personsOf(t).join(', ') || '—', 300), PAD + 245, cy);
    ctx.font = mono(12); ctx.textAlign = 'right';
    ctx.fillText(a ? `${a.got * SESSION}/${a.need * SESSION} min` : `${t.minutes} min`, W - PAD, cy); ctx.textAlign = 'left';
    y += legendRowH;
  });
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = IMG.free; ctx.font = sans(400, 11);
  ctx.fillText(`Generated ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`, PAD, H - 18);
  return cv;
}
const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));

// iPhone only opens the share sheet straight from a tap, so the picture is prepared in advance
let pictureFile = null, pictureTimer = null;
function schedulePicture() {
  pictureFile = null;
  clearTimeout(pictureTimer);
  pictureTimer = setTimeout(async () => {
    if (!state.result) return;
    const blob = await toBlob(drawPicture());
    const ev = currentEvent();
    pictureFile = new File([blob], `tunnel-plan-${ev.date}-${slug(ev.name)}.png`, { type: 'image/png' });
  }, 350);
}

const canShareFiles = (() => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' })] })); }
  catch (e) { return false; }
})();
$('shareImg').hidden = !canShareFiles;

function status(msg, kind) { const s = $('shareStatus'); s.textContent = msg; s.className = 'share-status' + (kind ? ' ' + kind : ''); }
const staleNote = () => state.stale ? ' Note: inputs changed since the last allocation.' : '';
let previewUrl = null;
function showPreview(blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $('previewImg').src = previewUrl; $('sharePreview').hidden = false;
}

$('shareImg').addEventListener('click', async () => {
  if (!state.result) { status('Press Allocate first.', 'err'); return; }
  if (!pictureFile) { status('Preparing the picture… tap Share picture again in a moment.'); schedulePicture(); return; }
  try {
    await navigator.share({ files: [pictureFile], title: pictureTitle() });
    status('Shared.' + staleNote(), 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') { status(''); return; }
    showPreview(pictureFile);
    status('The share sheet did not open. Press and hold the picture below to copy or save it.', 'err');
  }
});

$('copyImg').addEventListener('click', async () => {
  if (!state.result) { status('Press Allocate first.', 'err'); return; }
  const blobP = pictureFile ? Promise.resolve(pictureFile) : toBlob(drawPicture());
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP.then(b => new Blob([b], { type: 'image/png' })) })]);
    $('sharePreview').hidden = true;
    status('Picture copied. Paste it into WhatsApp, Messages or email.' + staleNote(), 'ok');
  } catch (e) {
    try { showPreview(await blobP); } catch (_) {}
    status('Copying was blocked here. Press and hold (or right-click) the picture below and choose Copy.' + staleNote(), 'err');
  }
});

// =====================================================================
// Start
// =====================================================================
function renderAll() {
  state = currentEvent().plan;
  renderEventPicker();
  imgTitleEl.value = state.imgTitle || '';
  $('sharePreview').hidden = true; status('');
  renderTeams(); renderAvail(); renderOut();
}
state = currentEvent().plan;
setTab(['teams', 'avail', 'plan'].includes(ui.tab) ? ui.tab : 'teams');
renderAll();
if (!state.result) allocate();
setSaved(storageOk ? 'Saved' : '');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
