// Due alerts, data collection marked complete (what's still missing) and section sign-off.
import { PAGES, SERIES, isShown, WARM_MIN } from './schema.js';
import { val, lastEdit, isGone } from './store.js';
import { cleanup, esc, field, nowHM, nowMin, patients, read, render, settings, showBanner, sid, toMin, toast, view, write } from './ui-core.js';
import { set } from './ui-sync.js';
import { colsFor, dueOf, expected, noWarming, nowFor, pointsFor, savedAt } from './series.js';
import { declined, podDays } from './ui-home.js';
import { ESSENTIAL, EVENTS, PACU_TIMES, nextEvent } from './ui-patient.js';
import { DATA_SIGNS } from './ui-data.js';
import { FORM } from './ui-forms.js';

// ---------- due alerts (only while the app is open)
// On every patient screen (both tabs, the forms, Perioperative data): a reading of any series falling due alerts
// (banner, vibrate, beep, as set in Settings), and the screen is kept awake, taken again after switching apps.
// patients still being charted on this phone (not deleted, locked or marked complete; changed in the last 12 hours)
export const charting = q => !isGone(q) && !q.lock?.on && !val(q, 'done') && Date.now() - (lastEdit(q)?.t || q.created || 0) < 12 * 3600e3;
// alerts for patient p (or, with p null, every patient being charted); other patients' alerts carry their Subject ID,
// since the next patient pre-warms while the last one is in surgery
export function startAlerts(p) {
  // when each reading last buzzed: a reading still unsaved buzzes again every 2 minutes for 10 minutes after it falls
  // due (a missed buzz in theatre gets another chance, and a phone that slept catches up when it wakes) (14 Oct 2026)
  const nag = Object.fromEntries(Object.entries(read('nag', {})).filter(([, t]) => Date.now() - t < 3600e3));
  let lock = null;
  const awake = () => { if ((p || Object.values(patients).some(q => charting(q) && Date.now() - (read('opened', {})[q.id] || 0) < 12 * 3600e3)) && settings.remind.awake && navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {}); };
  awake();
  document.addEventListener('visibilitychange', awake);
  const check = () => {
    // everything falling due this second goes in one banner, with one buzz / beep
    const due = []; let target = null;
    // other patients only if opened on this phone today (not a teammate's patient in another theatre)
    const opened = read('opened', {});
    const others = Object.values(patients).filter(q => q.id !== p?.id && charting(q) && Date.now() - (opened[q.id] || 0) < 12 * 3600e3);
    for (const q of p ? [p, ...others] : others) {
      const pre = q === p ? '' : sid(q) + ': ';
      const hit = (tag, msg, to) => { if (nag[tag] && Date.now() - nag[tag] < 120e3) return; nag[tag] = Date.now(); due.push(pre + msg); target ||= to; };
      // stopping the warming on time matters as much as a reading: Prewarm off due alerts too
      const nx = nextEvent(q);
      if (nx?.id === 'ev_wstop' && nx.due != null) {
        const now = nowFor(q, 'prewarm');
        if (now >= nx.due && now <= nx.due + 10) hit(q.id + 'ev_wstop' + val(q, 'pw_start'), `Prewarm off ${now > nx.due + 5 ? 'overdue' : 'due now'} (${WARM_MIN[val(q, 'arm')]} min of warming): tap Log`, { pid: q.id, ev: 'ev_wstop' });
      }
      // BP, HR, BIS alarm only when switched on in Settings (owner, 13 Oct 2026; off by default): their due time
      // still shows in the top bar and on the tab
      for (const s of settings.remind.haemo ? ['prewarm', 'iotemp', 'haemo'] : ['prewarm', 'iotemp']) {
        if ((s === 'prewarm' && noWarming(q)) || sealedBy(q, s)) continue;
        const now = nowFor(q, s);
        for (const x of pointsFor(q, s)) {
          const d = dueOf(q, s, x), tag = q.id + s + x.key + (val(q, SERIES[s].ref[0]) || '');
          if (d == null || !expected(q, s, d) || savedAt(q, s, x.key) || now < d || now > d + 10) continue;
          hit(tag, `${s === 'haemo' ? 'BP, HR, BIS' : 'Temperature'} ${x.label} reading ${now > d + 5 ? 'overdue' : 'due now'}`, { pid: q.id, s, key: x.key });
        }
      }
    }
    if (!due.length) return;
    write('nag', nag);
    if (settings.remind.banner) showBanner(due.join(' · ') + ' (tap to open)', 15000, target);
    if (settings.remind.vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    if (settings.remind.beep) beep();
  };
  const iv = setInterval(check, 1000);
  // a phone that slept (timers pause) checks the moment it is back in front
  const back = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', back);
  const stop = () => { clearInterval(iv); document.removeEventListener('visibilitychange', awake); document.removeEventListener('visibilitychange', back); lock?.release?.().catch(() => {}); };
  cleanup.push(stop);
  return stop;
}
let actx;
// three short beeps, loud enough for theatre; sound needs a tap first on phones, and is suspended again after
// switching apps, so every tap (and each beep) wakes it up
export function beep() {
  try {
    actx ||= new AudioContext();
    if (actx.state !== 'running') actx.resume?.();
    for (let i = 0; i < 3; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.35;
      o.frequency.value = 880; g.gain.value = 0.5; o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
  } catch { /* sound needs a tap first on some phones */ }
}
document.addEventListener('pointerdown', () => { try { actx ||= new AudioContext(); if (actx.state !== 'running') actx.resume?.(); } catch { /* no sound */ } });

// ---------- the patient's op-day data collection marked complete (bottom of the main screen, so it isn't tapped by
// accident); shown at the top of the main screen and in the patient list. The Word form's sign-off lines use it.
// What's still missing (owner, 12 Oct 2026: nothing easy to miss during intra-op collection): readings whose time
// has passed, times skipped, warming marked on with no start time, and the forms' unanswered questions once their
// stage has come. Each: { what, items, href }.
export const INTRAOP_Q = ['io_tech', 'io_ebl', 'io_cs', 'io_cs_vol', 'io_cs_ret', 'io_pcc', 'io_pcc_dose', 'io_txa', 'io_txa_bolus', 'io_txa_inf', 'io_txa_total', 'io_fib', 'io_fib_dose'];
export const PACU_Q = ['pacu_temp', 'pacu_shiver', 'pacu_ponv', 'pacu_hypot', 'pacu_tx', 'pacu_pain', 'nd_dis', 'nd_beh', 'nd_com', 'nd_ill', 'nd_psy', 'pacu_delay', 'pacu_delay1h', 'pacu_delay_why'];
export function gaps(p) {
  const out = [], get = k => val(p, k), at = s => `#/p/${p.id}/${s}`;
  const add = (what, items, href) => { if (items.length) out.push({ what, items, href }); };
  // readings: the link opens the first one missed
  const missed = (s, what) => {
    const xs = pointsFor(p, s).filter(x => {
      const d = dueOf(p, s, x);
      return d != null && !savedAt(p, s, x.key) && expected(p, s, d) && nowFor(p, s) > d + 5;
    });
    if (xs.length) add(what, xs.map(x => x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min + ' min'), at(s) + '/' + xs[0].key);
  };
  if (!noWarming(p)) missed('prewarm', 'Pre-warming temps not saved');
  missed('iotemp', 'Intra-op temps not saved');
  missed('haemo', 'BP, HR, BIS not saved');
  // saved readings with a blank box (asked about at Save, listed so it can be filled in later)
  for (const [s, what] of [['prewarm', 'Pre-warming temps'], ['iotemp', 'Intra-op temps'], ['haemo', 'BP, HR, BIS']]) {
    if (s === 'prewarm' && noWarming(p)) continue;
    const part = pointsFor(p, s).filter(x => savedAt(p, s, x.key)).map(x => {
      const miss = colsFor(s, x).filter(c => get(`${s}_${x.key}_${c.key}`) == null);
      return miss.length ? `${x.key === 'base' ? 'Baseline' : x.key === 'end' ? 'End' : x.min + ' min'} (${miss.map(c => c.label).join(', ')})` : null;
    }).filter(Boolean);
    add(what + ' saved with blanks', part, at(s));
  }
  // readings switched off in Settings are never asked for: say so while collecting
  const off = Object.entries({ skin: 'chest, arm, thigh, calf', set: 'gown set temp', ts: 'thermal sensation', warm: 'warming yes / no', room: 'room temp', bis: 'BIS', haemo15: 'BP, HR, BIS every 15 min' }).filter(([k]) => settings.hide[k]).map(([, l]) => l);
  if (off.length && !get('done')) add('Hidden in Settings (not being recorded)', off, '#/settings');
  // in OT a while with no induction time: the intra-op readings have no due times, so nothing else would flag them
  const ot = toMin(get('ev_ot'));
  if (ot != null && !get('io_knife') && ((nowMin() - ot + 1440) % 1440) > 20 && !get('io_done')) add('Induction not logged', ['intra-op readings fall due from it'], '#/p/' + p.id);
  // times: any essential one skipped before the latest one logged
  const evs = ESSENTIAL.filter(id => !(noWarming(p) && (id === 'pw_start' || id === 'ev_wstop')));
  const last = evs.reduce((i, id, j) => get(id) ? j : i, -1);
  const label = id => EVENTS.find(([f]) => f === id)[1].replace('\u00ad', '');
  add('Times not logged', evs.slice(0, last).filter(id => !get(id)).map(label), '#/p/' + p.id);
  // PACU in / To ward are logged on the PACU page once surgery has ended
  if (get('io_done')) add('PACU times not logged', PACU_TIMES.filter(id => !get(id)).map(label), `#/p/${p.id}/form/pacu`);
  // key times going backwards (more than a few minutes; past midnight counts forward): usually a mistyped time
  const logged = evs.filter(id => toMin(get(id)) != null);
  add('Times out of order', logged.slice(1).map((id, k) => [logged[k], id]).filter(([a, b]) => {
    const d = (toMin(get(b)) - toMin(get(a)) + 1440) % 1440;
    return d > 720;
  }).map(([a, b]) => `${label(b)} ${get(b)} is before ${label(a)} ${get(a)}`), '#/p/' + p.id);
  // warming marked Yes on a reading, but its start time not logged
  const yes = col => SERIES.iotemp.points.some(x => String(get(`iotemp_${x.key}_${col}`)) === '1');
  const afterStart = (col, ev) => {
    const st = toMin(get(ev)); if (st == null) return [];
    return SERIES.iotemp.points.filter(x => savedAt(p, 'iotemp', x.key) && String(get(`iotemp_${x.key}_${col}`)) === '0')
      .filter(x => { const d = dueOf(p, 'iotemp', x); return d != null && (d - st + 1440) % 1440 < 720 && d - st > 0; })
      .map(x => x.key === 'end' ? 'End' : x.key === 'base' ? 'Baseline' : x.min + ' min');
  };
  add('Underbody warming says No after its start time', afterStart('under', 'io_under_start'), at('iotemp'));
  add('Gown warming says No after its start time', afterStart('gown', 'io_gown_start'), at('iotemp'));
  add('Warming on, start time not logged', [['under', 'io_under_start'], ['gown', 'io_gown_start']].filter(([c, id]) => yes(c) && !get(id)).map(([, id]) => label(id)), '#/p/' + p.id);
  const unanswered = ids => ids.map(field).filter(f => f && isShown(f, get) && get(f.id) == null).map(f => f.label);
  if (get('io_done')) add('Intra-op details unanswered', unanswered(INTRAOP_Q), `#/p/${p.id}/form/intraop`);
  if (get('pacu_in')) add('PACU unanswered', unanswered(PACU_Q), `#/p/${p.id}/form/pacu`);
  // chart review: POD1 / POD2 once due and not ticked complete (how many of the questions have an answer)
  const days = podDays(p);
  for (const [n, sign, pages] of [[1, 'sign_pod1', ['pod1', 'pod1an']], [2, 'sign_pod2', ['pod2', 'pod2an']]]) {
    if (days == null || days < n || get(sign)) continue;
    const all = pages.flatMap(pg => FORM[pg].map(([k]) => k)), done = all.filter(k => get(k) != null).length;
    add(`POD${n} chart review ${days > n ? 'overdue' : 'due today'}`, [`${done} of ${all.length} answered`], at('data/day' + n));
  }
  if (get('ev_ot') && get('sat_pre') == null) add('Comfort not asked', ['Before surgery'], `#/p/${p.id}/prewarm`);
  if (get('pacu_in') && get('sat_post') == null) add('Comfort not asked', ['After surgery'], `#/p/${p.id}/form/pacu`);
  return out;
}
export function gapsHtml(p) {
  const g = gaps(p);
  if (!g.length) return '';
  return `<div class="gaps" id="gaps"><b>Still to fill</b><ul>${g.map(x => `<li><a href="${x.href}">${esc(x.what)}</a>: ${x.items.map(esc).join(', ')}</li>`).join('')}</ul></div>`;
}
// a section marked complete is read only until its tick is undone; "data collection complete" closes every op-day
// screen (owner, 12 Oct 2026). The Perioperative data page (filled in later from the chart) stays open.
export function sealedBy(p, pg) {
  // the perioperative pages are filled in later from the chart, so "data collection complete" doesn't close them: only their own ticks
  if (val(p, 'done') && !DATA_SIGNS.has(pg)) return 'Data collection';
  if (!pg || !val(p, 'sign_' + pg)) return null;
  const n = SECTION[pg] || PAGES.find(x => x.id === pg)?.title || 'This section';
  return n[0].toUpperCase() + n.slice(1);
}
export const sealedMsg = (p, pg) => `${sealedBy(p, pg)} is marked complete. Undo its tick to change this.`;
export const sealNote = (p, pg) => `<p class="sealnote">✓ ${esc(sealedMsg(p, pg))}</p>`;
// boxes in a closed section can't be typed in
export const disableSealed = () => view.querySelectorAll('.sealed input, .sealed select, .sealed textarea').forEach(i => { i.disabled = true; });
// which sections are marked complete, shown on the patient list (owner, 13 Oct 2026): read only, they just
// mirror the existing complete ticks inside each section
// the list's ticks, in fill-in order (owner, 21 Oct 2026: Pre-op after BP, HR, BIS; PayNow ticked once its details are saved)
const SECTION_ORDER = [['prewarm', 'Pre-warm'], ['iotemp', 'Intra-op temps'], ['haemo', 'BP, HR, BIS'], ['periop', 'Pre-op'], ['intraop', 'Intra-op details'], ['pacu', 'PACU'], ['pod1', 'POD1'], ['pod2', 'POD2'], ['dc', 'Discharge'], ['pay', 'PayNow']];
const sectionDone = (p, k) => k === 'pay' ? !!(p.f.pay_saved || p.f.pay_cleared) : !!val(p, 'sign_' + k);
const SECTION_HREF = { haemo: 'haemo', periop: 'data', intraop: 'form/intraop', pacu: 'form/pacu', pod1: 'data/day1', pod2: 'data/day2', dc: 'data/dc', pay: 'pay' };
// tapping a patient on the list opens the first section not yet ticked (owner, 21 Oct 2026). The temperature tabs open
// the patient's chart as before (it picks Induction room or Intra-op itself); chart-review days only once they are due.
export function nextHref(p) {
  if (val(p, 'done')) return '#/p/' + p.id;
  const days = podDays(p) ?? 0;
  const k = SECTION_ORDER.map(([x]) => x).find(x => !(x === 'prewarm' && noWarming(p)) && !(x === 'pay' && declined(p)) && !sectionDone(p, x)
    && !(x === 'pod1' && days < 1) && !(x === 'pod2' && days < 2) && !(x === 'dc' && days < 1));
  return '#/p/' + p.id + (SECTION_HREF[k] ? '/' + SECTION_HREF[k] : '');
}
export function progressHtml(p) {
  const rows = SECTION_ORDER.filter(([k]) => !(k === 'prewarm' && noWarming(p)) && !(k === 'pay' && declined(p)));
  return `<span class="progress" role="list" aria-label="Sections marked complete">${rows.map(([k, l]) => { const on = sectionDone(p, k);
    return `<span role="listitem" class="${on ? 'on' : ''}" aria-label="${l}: ${on ? 'complete' : 'not marked complete'}"><span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>${l}</span>`; }).join('')}</span>`;
}
export function doneHtml(p) {
  return tickHtml(!!val(p, 'done'), 'data collection', val(p, 'done') || '', 'data-undone', 'data-done').replace('Mark data collection complete', 'Mark data collection as complete').replace('<b>data collection complete', '<b>Data collection complete');
}

// ---------- section sign-off (replaces the paper form's Name / Signature / Date)
// each sign-off names its section, and shows a ticked box once marked (owner, 12 Oct 2026)
export const SECTION = { periop: 'pre-op and patient details', pod1: 'POD1', pod2: 'POD2', dc: 'Discharge', prewarm: 'pre-warming temps', iotemp: 'intra-op temps', haemo: 'BP, HR, BIS', intraop: 'Intra-op details', pacu: 'PACU', satis: 'Patient comfort' };
export const tickHtml = (on, label, who, undo, mark) => on
  ? `<div class="sign on"><span class="tick" aria-hidden="true">✓</span><span><b>${esc(label)} complete</b><small>${esc(who)}</small></span><button class="link" ${undo}>Undo</button></div>`
  : `<div class="sign${label === 'PACU' ? ' big' : ''}"><button class="tickbtn" ${mark}><span class="tick" aria-hidden="true"></span>Mark ${esc(label)} complete</button></div>`;
export function signoffHtml(p, pg) {
  const name = SECTION[pg] || PAGES.find(x => x.id === pg)?.title || 'section';
  return tickHtml(!!val(p, 'sign_' + pg), name, val(p, 'sign_' + pg) || '', `data-unsign="${pg}"`, `data-sign="${pg}"`);
}
export function signoffClick(p, pg, t) {
  // the tick names its own section (the Temperatures tab has two)
  pg = t.closest('[data-sign]')?.dataset.sign || t.closest('[data-unsign]')?.dataset.unsign || pg;
  if (t.closest('[data-sign]')) {
    if (!settings.me) return toast('Add your initials in Settings first.');
    set(p, 'sign_' + pg, `${settings.me} ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${nowHM()}`); render();
  } else if (t.closest('[data-unsign]')) {
    if (!confirm(`Undo "${sealedBy(p, pg) || pg} complete" (${val(p, 'sign_' + pg)})?\n\nIt can then be changed again.`)) return;
    set(p, 'sign_' + pg, null); render();
  }
}

// BP / HR / BIS: the next 15-min reading's state, like the due time (readings missed by over 15 min are let go)
export function haemoState(p, s = 'haemo') {
  if (sealedBy(p, s)) return 'later';
  const now = nowFor(p, s);
  const lefts = pointsFor(p, s).filter(x => !savedAt(p, s, x.key))
    .map(x => dueOf(p, s, x)).filter(d => d != null && expected(p, s, d)).map(d => d - now).filter(l => l > (s === 'haemo' ? -15 : -5));
  if (!lefts.length) return 'later';
  const left = Math.min(...lefts);
  return left > 2 ? 'later' : left > 0 ? 'soon' : left > -5 ? 'now' : 'late';
}
// the paper form's "Vital Signs Data Collected": ticked once any BP / HR / BIS value is saved
export const vitalsCollected = p => Object.keys(p.f).some(k => /^haemo_/.test(k) && val(p, k) != null);
