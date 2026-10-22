/* Momentum — app UI */
(function () {
  'use strict';
  const APP_VERSION = '1.0.0';
  const E = window.Engine;
  const LC = window.LightweightCharts;
  const AUTO_LOCK_MS = 10 * 60 * 1000;
  const BACKUP_NAG_DAYS = 7;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEIGHT_LABEL = { 1: 'Light', 2: 'Moderate', 3: 'Heavy' };
  const COLORS = { up: '#26c281', down: '#f0525c', ma1: '#5aa9ff', ma2: '#c084fc', accent: '#f5b83d' };

  let state = null;
  const ui = { tab: 'chart', ticker: 'index', interval: 'D', range: 90, day: today(), detail: null };

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  function today() { return E.dayKey(new Date()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }
  function signed(n, suffix) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)) + (suffix || ''); }
  function cls(n) { return n > 0 ? 'up' : n < 0 ? 'down' : 'muted'; }
  function niceDate(k, opts) { return E.parseKey(k).toLocaleDateString(undefined, opts || { weekday: 'long', month: 'short', day: 'numeric' }); }
  function shortDate(k) { return E.parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function habit(id) { return state.habits.find(h => h.id === id); }
  function activeHabits() { return state.habits.filter(h => !h.archivedDay); }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
  function weightDots(w) { return '●'.repeat(w) + '○'.repeat(3 - w); }

  function blankState() {
    return { version: 1, createdAt: Date.now(), habits: [], completions: [], blocks: [], notes: {}, goals: [], settings: { lastBackup: null } };
  }
  function normalize(s) {
    const b = blankState();
    Object.keys(b).forEach(k => { if (s[k] == null) s[k] = b[k]; });
    return s;
  }

  // ---------- saving ----------
  let saveTimer = null, saving = Promise.resolve();
  function persist(immediate) {
    clearTimeout(saveTimer);
    const run = () => { saving = saving.then(() => Vault.save(state)).catch(e => toast('Save failed: ' + e.message)); return saving; };
    if (immediate) return run();
    saveTimer = setTimeout(run, 350);
  }
  function commit() { persist(); renderAll(); }

  // ================= LOCK SCREEN =================
  async function showLock() {
    $('app').hidden = true; $('lock').hidden = false; $('lockError').textContent = '';
    const exists = await Vault.exists();
    $('createForm').hidden = exists; $('unlockForm').hidden = !exists;
    $('lockSub').textContent = exists ? 'Enter your passphrase to unlock.' : 'Your habits, charted like a stock.';
    setTimeout(() => (exists ? $('unlockPass') : $('newPass')).focus(), 50);
  }
  function enterApp(s) {
    state = normalize(s);
    $('lock').hidden = true; $('app').hidden = false;
    $('unlockPass').value = $('newPass').value = $('newPass2').value = '';
    ui.day = today();
    switchTab(ui.tab);
  }

  $('createForm').addEventListener('submit', async e => {
    e.preventDefault();
    const p = $('newPass').value, p2 = $('newPass2').value;
    if (p.length < 8) return ($('lockError').textContent = 'Use at least 8 characters.');
    if (p !== p2) return ($('lockError').textContent = "Passphrases don't match.");
    $('lockError').textContent = 'Setting up…';
    enterApp(await Vault.create(p, blankState()));
    $('lockError').textContent = '';
    toast('Encrypted and ready. Add your first habit.');
    switchTab('habits');
  });

  $('unlockForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('lockError').textContent = 'Unlocking…';
    try { enterApp(await Vault.unlock($('unlockPass').value)); $('lockError').textContent = ''; }
    catch (err) { $('lockError').textContent = err.message; $('unlockPass').select(); }
  });

  $('forgot').addEventListener('click', () => {
    modal(`<h3>Forgot your passphrase?</h3>
      <p class="small">Your data is encrypted with it, so there's no way to recover it. Your options:</p>
      <ul class="small"><li>Keep trying. Passphrases are case-sensitive.</li>
      <li>Erase this device and restore from a backup file (you'll need that backup's passphrase).</li></ul>
      <label>Type ERASE to delete all Momentum data on this device<input id="eraseConfirm" autocomplete="off"></label>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="eraseGo">Erase this device</button></div>`);
    $('eraseGo').onclick = () => {
      if ($('eraseConfirm').value !== 'ERASE') return toast('Type ERASE to confirm');
      const r = indexedDB.deleteDatabase('momentum');
      r.onsuccess = r.onerror = r.onblocked = () => location.reload();
    };
  });

  $('restoreFirst').addEventListener('click', () => pickBackup(true));

  // auto-lock
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); if (state) persist(true); }
    else if (state && Date.now() - hiddenAt > AUTO_LOCK_MS && hiddenAt) lockNow();
    else if (state && ui.day !== today() && ui.tab === 'today') { /* new day while open */ renderAll(); }
  });
  function lockNow() { persist(true).then(() => { Vault.lock(); state = null; closeModal(); showLock(); }); }
  $('lockBtn').addEventListener('click', lockNow);

  // ================= NAV =================
  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
    window.scrollTo(0, 0);
    renderAll();
  }
  $('tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) switchTab(g.dataset.goto);
    const a = e.target.closest('[data-action="backup"]'); if (a) downloadBackup();
    if (e.target.closest('[data-close]')) closeModal();
  });

  function renderAll() {
    if (!state) return;
    renderBanner();
    if (ui.tab === 'chart') renderChartView();
    if (ui.tab === 'today') renderToday();
    if (ui.tab === 'habits') renderHabits();
    if (ui.tab === 'goals') renderGoals();
    if (ui.tab === 'settings') renderSettings();
  }

  function renderBanner() {
    const lb = state.settings.lastBackup;
    const age = lb ? Math.floor((Date.now() - lb) / 86400000) : null;
    const show = state.habits.length > 0 && (lb == null || age >= BACKUP_NAG_DAYS);
    $('backupBanner').hidden = !show;
    if (show) $('backupBannerText').textContent = lb == null ? 'Your data only lives on this device. Make a backup.' : `Last backup was ${age} days ago.`;
  }

  // ================= CHART VIEW =================
  let chart = null, S = {}, goalLines = [];
  function ensureChart() {
    if (chart) return;
    chart = LC.createChart($('chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#12161d' }, textColor: '#8a94a3', fontFamily: getComputedStyle(document.body).fontFamily, attributionLogo: true },
      grid: { vertLines: { color: '#1a2029' }, horzLines: { color: '#1a2029' } },
      rightPriceScale: { borderColor: '#232a35', scaleMargins: { top: 0.12, bottom: 0.24 } },
      timeScale: { borderColor: '#232a35', rightOffset: 4, barSpacing: 9 },
      crosshair: { mode: LC.CrosshairMode.Normal }
    });
    S.candle = chart.addSeries(LC.CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    S.vol = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const line = c => ({ color: c, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    S.ma1 = chart.addSeries(LC.LineSeries, line(COLORS.ma1));
    S.ma2 = chart.addSeries(LC.LineSeries, line(COLORS.ma2));
    S.proj = chart.addSeries(LC.LineSeries, Object.assign(line(COLORS.accent), { lineStyle: LC.LineStyle.Dashed, lineWidth: 1 }));
    chart.subscribeClick(p => { if (p.time) { ui.detail = typeof p.time === 'string' ? p.time : E.dayKey(new Date(p.time.year, p.time.month - 1, p.time.day)); renderDetail(); } });
    chart.subscribeCrosshairMove(p => {
      const d = p && p.time ? p.seriesData.get(S.candle) : null;
      if (d) $('legend').innerHTML = `<span>O <b>${fmt(d.open)}</b></span><span>H <b>${fmt(d.high)}</b></span><span>L <b>${fmt(d.low)}</b></span><span>C <b class="${cls(d.close - d.open)}">${fmt(d.close)}</b></span>`;
      else $('legend').innerHTML = legendDefault;
    });
  }
  let legendDefault = '';
  const MA_PERIODS = { D: [7, 30], W: [4, 13], M: [3, 12] };
  const MA_LABEL = { D: ['7D', '30D'], W: ['4W', '13W'], M: ['3M', '12M'] };

  function seriesFor(ticker) {
    return E.computeDaily(state, { habitIds: ticker === 'index' ? activeAndArchivedIds() : [ticker], today: today() });
  }
  function activeAndArchivedIds() { return state.habits.map(h => h.id); }

  function renderChartView() {
    // ticker chips
    const chips = [{ id: 'index', sym: 'INDEX' }].concat(activeHabits().map(h => ({ id: h.id, sym: h.ticker })));
    if (ui.ticker !== 'index' && !habit(ui.ticker)) ui.ticker = 'index';
    $('tickerRow').innerHTML = chips.map(c => {
      const d = seriesFor(c.id);
      const chg = d.length ? d[d.length - 1].close - (d.length > 1 ? d[d.length - 2].close : d[0].open) : 0;
      return `<button class="chip ${c.id === ui.ticker ? 'on' : ''}" data-t="${c.id}">${esc(c.sym)}<span class="chg ${cls(chg)}">${d.length ? signed(chg) : ''}</span></button>`;
    }).join('');

    const daily = seriesFor(ui.ticker);
    const h = ui.ticker === 'index' ? null : habit(ui.ticker);
    $('quoteSym').textContent = h ? `${h.ticker} · ${h.name}` : 'INDEX · All habits';
    $('chartEmpty').hidden = daily.length > 0;
    ensureChart();
    goalLines.forEach(l => S.candle.removePriceLine(l)); goalLines = [];

    if (!daily.length) {
      $('quotePrice').textContent = '—'; $('quoteChg').innerHTML = ''; $('stats').innerHTML = ''; $('goalCards').hidden = true; $('dayDetail').hidden = true;
      [S.candle, S.vol, S.ma1, S.ma2, S.proj].forEach(s => s.setData([]));
      return;
    }

    const candles = E.rollup(daily, ui.interval);
    S.candle.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    S.vol.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,194,129,.35)' : 'rgba(240,82,92,.35)' })));
    const [p1, p2] = MA_PERIODS[ui.interval];
    S.ma1.setData(E.movingAverage(candles, p1));
    S.ma2.setData(E.movingAverage(candles, p2));
    legendDefault = `<span><i style="background:${COLORS.ma1}"></i>MA ${MA_LABEL[ui.interval][0]}</span><span><i style="background:${COLORS.ma2}"></i>MA ${MA_LABEL[ui.interval][1]}</span><span>Volume = minutes</span>`;
    $('legend').innerHTML = legendDefault;

    // goals for this ticker
    const goals = state.goals.filter(g => g.scope === ui.ticker);
    let projLine = [];
    goals.forEach(g => {
      goalLines.push(S.candle.createPriceLine({ price: g.target, color: COLORS.accent, lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: true, title: g.name }));
    });
    if (ui.interval === 'D' && goals.length) {
      const g = nearestGoal(goals);
      const pr = g && E.projection(daily, g.target, g.deadline);
      if (pr && pr.line.length) projLine = pr.line;
    }
    S.proj.setData(projLine);

    // visible range
    const n = candles.length;
    let fromIdx = 0;
    if (ui.range) {
      const from = E.addDays(today(), -ui.range);
      fromIdx = candles.findIndex(c => c.time >= (ui.interval === 'D' ? from : from.slice(0, 7)));
      if (fromIdx < 0) fromIdx = 0;
    }
    const minBars = ui.interval === 'D' ? 20 : 8;
    chart.timeScale().setVisibleLogicalRange({ from: Math.min(fromIdx, n - minBars) - 0.5, to: n - 1 + 4 });

    // quote + stats
    const st = E.stats(state, daily, { today: today() });
    $('quotePrice').textContent = fmt(st.price);
    $('quoteChg').innerHTML = `<div class="${cls(st.dayChange)}">${signed(st.dayChange)} (${signed(st.dayPct, '%')})</div><div class="muted small">today</div>`;
    const streaks = E.currentStreaks(state, today());
    const streak = h ? streaks[h.id] : Math.max(0, ...activeHabits().map(x => streaks[x.id] || 0));
    $('stats').innerHTML = [
      ['7-day', `<span class="${cls(st.weekPct)}">${signed(st.weekPct, '%')}</span>`],
      ['Consistency 30d', st.consistency == null ? '—' : st.consistency + '%'],
      ['Hours invested', st.hours],
      ['All-time high', fmt(st.allTimeHigh)],
      ['Off high', `<span class="${cls(st.drawdown)}">${st.drawdown === 0 ? 'At high' : signed(st.drawdown, '%')}</span>`],
      [h ? 'Streak' : 'Best streak', streak + (streak === 1 ? ' day' : ' days')]
    ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

    // goal summary cards
    $('goalCards').hidden = !goals.length;
    $('goalCards').innerHTML = goals.length ? '<h3>Goals on this chart</h3>' + goals.map(g => goalSummary(g, daily)).join('') : '';
    renderDetail();
  }
  function nearestGoal(goals) {
    const open = goals.filter(g => !g.deadline || g.deadline >= today());
    return (open.length ? open : goals).sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1)[0];
  }

  $('tickerRow').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { ui.ticker = b.dataset.t; ui.detail = null; renderChartView(); } });
  function segHandler(id, key, parse) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      ui[key] = parse(b.dataset.v);
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      ui.detail = null; renderChartView();
    });
  }
  segHandler('intervalSeg', 'interval', v => v);
  segHandler('rangeSeg', 'range', Number);

  function renderDetail() {
    const box = $('dayDetail');
    if (!ui.detail || !state) { box.hidden = true; return; }
    const daily = seriesFor(ui.ticker);
    let days;
    if (ui.interval === 'D') days = daily.filter(c => c.time === ui.detail);
    else { const r = E.rollup(daily, ui.interval).find(c => c.time === ui.detail); days = r ? daily.filter(c => r.days.indexOf(c.time) !== -1) : []; }
    if (!days.length) { box.hidden = true; return; }
    const first = days[0], last = days[days.length - 1];
    const o = first.open, c = last.close, hi = Math.max(...days.map(d => d.high)), lo = Math.min(...days.map(d => d.low));
    const vol = days.reduce((s, d) => s + d.volume, 0);
    const title = days.length === 1 ? niceDate(first.time) : `${niceDate(first.time, { month: 'short', day: 'numeric' })} – ${niceDate(last.time, { month: 'short', day: 'numeric' })}`;
    let rows = '';
    if (days.length === 1) {
      const d = first;
      rows = d.done.map(x => `<li><span>✓ ${esc(nameOf(x.habitId))}${x.streak > 1 ? ` <span class="muted small">streak ${x.streak}</span>` : ''}</span><span class="pts up">+${fmt(x.points)}</span></li>`).join('')
        + d.extra.map(x => `<li><span>✓ ${esc(nameOf(x.habitId))} <span class="muted small">extra</span></span><span class="pts up">+${fmt(x.points)}</span></li>`).join('')
        + d.missed.map(x => `<li><span>✗ ${esc(nameOf(x.habitId))}${x.lostStreak > 1 ? ` <span class="muted small">lost ${x.lostStreak}-day streak</span>` : ''}</span><span class="pts down">${signed(x.points)}</span></li>`).join('');
      if (d.time === today() && !d.missed.length) rows += `<li class="muted small"><span>Misses are counted when the day ends.</span><span></span></li>`;
    } else {
      const g = days.reduce((s, d) => s + d.gained, 0), l = days.reduce((s, d) => s + d.lost, 0);
      const done = days.reduce((s, d) => s + d.done.length + d.extra.length, 0), miss = days.reduce((s, d) => s + d.missed.length, 0);
      rows = `<li><span>Completed ${done}</span><span class="pts up">+${fmt(g)}</span></li><li><span>Missed ${miss}</span><span class="pts down">−${fmt(l)}</span></li>`;
    }
    const notes = days.map(d => state.notes[d.time] ? `<div class="note-quote"><span class="muted small">${days.length > 1 ? niceDate(d.time, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' : ''}Note</span>\n${esc(state.notes[d.time])}</div>` : '').join('');
    box.hidden = false;
    box.innerHTML = `<div class="detail-head"><h3>${title}</h3><button class="btn link small" id="closeDetail">Close</button></div>
      <div class="ohlc"><span>O ${fmt(o)}</span><span>H ${fmt(hi)}</span><span>L ${fmt(lo)}</span><span class="${cls(c - o)}">C ${fmt(c)} (${signed(c - o)})</span><span>${vol} min</span></div>
      <ul class="ledger">${rows || '<li class="muted"><span>Nothing planned.</span><span></span></li>'}</ul>${notes}
      ${days.length === 1 ? `<button class="btn small" style="margin-top:10px" id="openDay">Open this day</button>` : ''}`;
    $('closeDetail').onclick = () => { ui.detail = null; box.hidden = true; };
    if ($('openDay')) $('openDay').onclick = () => { ui.day = first.time; switchTab('today'); };
  }
  function nameOf(id) { const h = habit(id); return h ? h.name : 'Deleted habit'; }

  // ================= TODAY =================
  function renderToday() {
    const k = ui.day, t = today();
    $('dayTitle').textContent = niceDate(k);
    const diff = E.daysBetween(k, t);
    $('daySub').textContent = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday · editing a past day' : `${diff} days ago · editing a past day`;
    $('nextDay').disabled = k >= t; $('nextDay').style.opacity = k >= t ? .3 : 1;

    const active = state.habits.filter(h => E.isActive(h, k));
    const planned = active.filter(h => E.isPlanned(h, k));
    const extra = active.filter(h => !E.isPlanned(h, k));
    const streaks = E.currentStreaks(state, t);
    $('plannedList').innerHTML = planned.length ? planned.map(h => habitRow(h, k, true, streaks)).join('')
      : `<li class="muted small">${state.habits.length ? 'Nothing planned for this day.' : 'No habits yet. <a href="#" data-goto="habits">Add one</a>.'}</li>`;
    $('extraList').innerHTML = extra.map(h => habitRow(h, k, false, streaks)).join('');
    $('extraH').hidden = !extra.length;

    // blocks
    const blocks = state.blocks.filter(b => b.day === k).sort((a, b) => a.start < b.start ? -1 : 1);
    $('blockList').innerHTML = blocks.length ? blocks.map(b => {
      const done = completionFor(b.habitId, k);
      return `<li><span class="time">${b.start}–${b.end}</span><span class="bname">${esc(nameOf(b.habitId))} ${done ? '<span class="done-tag">✓ done</span>' : ''}</span><button class="btn link small" data-delblock="${b.id}" aria-label="Remove block">✕</button></li>`;
    }).join('') : '<li class="muted small">No blocks scheduled. Plan when each habit happens.</li>';
    $('blockHabit').innerHTML = active.map(h => `<option value="${h.id}">${esc(h.ticker)} · ${esc(h.name)}</option>`).join('');
    $('blockForm').hidden = !active.length;
    const plannedMin = blocks.reduce((s, b) => s + blockMinutes(b), 0);
    const blockHabitIds = blocks.map(b => b.habitId);
    const loggedMin = state.completions.filter(c => c.day === k && blockHabitIds.indexOf(c.habitId) !== -1).reduce((s, c) => s + (Number(c.minutes) || 0), 0);
    $('blockSummary').textContent = blocks.length ? `Blocked ${plannedMin} min · logged ${loggedMin} min on those habits${plannedMin ? ` (${Math.round(loggedMin / plannedMin * 100)}%)` : ''}` : '';

    if (document.activeElement !== $('dayNote')) $('dayNote').value = state.notes[k] || '';
  }
  function completionFor(hid, k) { return state.completions.find(c => c.habitId === hid && c.day === k); }
  function blockMinutes(b) { const [h1, m1] = b.start.split(':').map(Number), [h2, m2] = b.end.split(':').map(Number); return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1)); }

  function habitRow(h, k, planned, streaks) {
    const c = completionFor(h.id, k);
    const w = E.ruleAt(h, k).weight;
    const R = E.RULES;
    let meta = `${esc(h.ticker)} · <span class="weight">${weightDots(w)}</span>`;
    if (planned) {
      const s = streaks[h.id] || 0;
      meta += c ? ` · done` : ` · +${fmt(w * R.GAIN_PER_WEIGHT * (1 + R.STREAK_STEP * Math.min(s, R.STREAK_CAP)))} / −${fmt(w * R.MISS_PER_WEIGHT)} if missed`;
      if (s > 1 && k === today()) meta += ` · 🔥 ${s}`;
    } else meta += ` · +${fmt(w * R.EXTRA_PER_WEIGHT)} extra`;
    const blk = state.blocks.find(b => b.habitId === h.id && b.day === k);
    if (blk) meta += ` · ${blk.start}`;
    const mins = h.trackTime ? `<input class="mins" type="number" inputmode="numeric" min="0" max="1440" placeholder="${h.targetMin || 'min'}" value="${c && c.minutes ? c.minutes : ''}" data-mins="${h.id}" aria-label="Minutes">` : '';
    return `<li class="habit-item ${c ? 'done' : ''}"><button class="check" data-check="${h.id}" aria-label="Mark ${esc(h.name)} done">✓</button>
      <div class="habit-main"><div class="habit-name">${esc(h.name)}</div><div class="habit-meta">${meta}</div></div>${mins}</li>`;
  }

  function toggleDone(hid) {
    const k = ui.day, c = completionFor(hid, k);
    if (c) { state.completions = state.completions.filter(x => x !== c); }
    else {
      const h = habit(hid);
      const inp = document.querySelector(`[data-mins="${hid}"]`);
      const m = h.trackTime ? (Number(inp && inp.value) || Number(h.targetMin) || 0) : 0;
      state.completions.push({ id: uid(), habitId: hid, day: k, ts: Date.now(), minutes: m });
      if (k === today()) toast(`${h.ticker} up. Logged.`);
    }
    commit();
  }
  ['plannedList', 'extraList'].forEach(id => {
    $(id).addEventListener('click', e => { const b = e.target.closest('[data-check]'); if (b) toggleDone(b.dataset.check); });
    $(id).addEventListener('change', e => {
      const inp = e.target.closest('[data-mins]'); if (!inp) return;
      const v = Math.max(0, Math.min(1440, Number(inp.value) || 0));
      const c = completionFor(inp.dataset.mins, ui.day);
      if (c) { c.minutes = v; commit(); }
      else if (v > 0) { state.completions.push({ id: uid(), habitId: inp.dataset.mins, day: ui.day, ts: Date.now(), minutes: v }); commit(); }
    });
  });
  $('prevDay').addEventListener('click', () => { ui.day = E.addDays(ui.day, -1); renderToday(); });
  $('nextDay').addEventListener('click', () => { if (ui.day < today()) { ui.day = E.addDays(ui.day, 1); renderToday(); } });

  $('blockForm').addEventListener('submit', e => {
    e.preventDefault();
    const b = { id: uid(), habitId: $('blockHabit').value, day: ui.day, start: $('blockStart').value, end: $('blockEnd').value };
    if (!b.habitId || !b.start || !b.end) return;
    if (b.end <= b.start) return toast('End time must be after start time');
    state.blocks.push(b); commit();
    $('blockStart').value = $('blockEnd').value = '';
  });
  $('blockList').addEventListener('click', e => {
    const b = e.target.closest('[data-delblock]'); if (!b) return;
    state.blocks = state.blocks.filter(x => x.id !== b.dataset.delblock); commit();
  });

  let noteTimer;
  $('dayNote').addEventListener('input', () => {
    $('noteStatus').textContent = 'Saving…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const v = $('dayNote').value;
      if (v.trim()) state.notes[ui.day] = v; else delete state.notes[ui.day];
      persist(); $('noteStatus').textContent = 'Saved automatically · encrypted';
    }, 500);
  });

  // ================= HABITS =================
  function renderHabits() {
    const act = activeHabits(), arch = state.habits.filter(h => h.archivedDay);
    $('habitManageList').innerHTML = act.length ? act.map(manageRow).join('') : '<li class="muted small">No habits yet. Start with 2–4. You can always add more.</li>';
    $('archivedWrap').hidden = !arch.length;
    $('archivedList').innerHTML = arch.map(manageRow).join('');
  }
  function scheduleText(days) {
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.indexOf(d) !== -1)) return 'Weekdays';
    if (days.length === 2 && days.indexOf(0) !== -1 && days.indexOf(6) !== -1) return 'Weekends';
    return days.slice().sort().map(d => DOW[d]).join(' ');
  }
  function manageRow(h) {
    return `<li><span class="sym">${esc(h.ticker)}</span><div class="habit-main"><div class="habit-name">${esc(h.name)}</div>
      <div class="habit-meta">${scheduleText(h.days)} · <span class="weight">${weightDots(h.weight)}</span> ${WEIGHT_LABEL[h.weight]}${h.trackTime ? ` · ${h.targetMin || 0} min` : ''}${h.archivedDay ? ' · archived' : ''}</div></div>
      <button class="btn small" data-edit="${h.id}">Edit</button></li>`;
  }
  $('newHabitBtn').addEventListener('click', () => habitForm(null));
  ['habitManageList', 'archivedList'].forEach(id => $(id).addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) habitForm(habit(b.dataset.edit)); }));

  function makeTicker(name, exceptId) {
    const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let base = letters.length <= 4 ? letters : (letters[0] + letters.slice(1).replace(/[AEIOU]/g, '')).slice(0, 4);
    if (base.length < 3) base = letters.slice(0, 4);
    base = base || 'HBT';
    let t = base, i = 2;
    while (state.habits.some(h => h.ticker === t && h.id !== exceptId)) t = base.slice(0, 3) + i++;
    return t;
  }

  function habitForm(h) {
    const editing = !!h;
    const f = h ? { ...h, days: h.days.slice() } : { name: '', ticker: '', weight: 2, days: [0, 1, 2, 3, 4, 5, 6], trackTime: false, targetMin: 30 };
    let tickerTouched = editing;
    modal(`<h3>${editing ? 'Edit habit' : 'New habit'}</h3>
      <label>Name<input id="fName" maxlength="40" value="${esc(f.name)}" placeholder="e.g. Gym, Prospecting calls, Read"></label>
      <label>Ticker symbol<input id="fTicker" maxlength="5" value="${esc(f.ticker)}" placeholder="AUTO" style="font-family:var(--mono);text-transform:uppercase"></label>
      <label>Weight: how much it costs you to do it</label>
      <div class="seg" id="fWeight" style="margin-top:6px">${[1, 2, 3].map(w => `<button type="button" data-v="${w}" class="${f.weight === w ? 'on' : ''}">${weightDots(w)} ${WEIGHT_LABEL[w]}</button>`).join('')}</div>
      <label>Planned days</label>
      <div class="days-pick" id="fDays">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" data-d="${d}" class="${f.days.indexOf(d) !== -1 ? 'on' : ''}">${DOW[d][0]}</button>`).join('')}</div>
      <div class="presets"><button type="button" class="btn small" data-p="all">Every day</button><button type="button" class="btn small" data-p="wk">Weekdays</button><button type="button" class="btn small" data-p="we">Weekends</button></div>
      <label class="toggle-row"><input type="checkbox" id="fTime" ${f.trackTime ? 'checked' : ''}> Track time spent</label>
      <label id="fMinWrap" ${f.trackTime ? '' : 'hidden'}>Typical minutes<input type="number" id="fMin" min="1" max="1440" value="${f.targetMin || 30}"></label>
      ${editing ? '<p class="muted small">Changes to weight or days apply from today forward. Your history stays as it was.</p>' : ''}
      <p class="error" id="fErr"></p>
      <div class="modal-actions">
        ${editing ? (h.archivedDay ? '<button class="btn" id="fUnarchive">Restore</button>' : '<button class="btn" id="fArchive">Archive</button>') + '<button class="btn danger" id="fDelete">Delete</button>' : ''}
        <button class="btn" data-close>Cancel</button><button class="btn primary" id="fSave">Save</button></div>`);
    $('fName').addEventListener('input', () => { if (!tickerTouched) $('fTicker').value = makeTicker($('fName').value, h && h.id); });
    $('fTicker').addEventListener('input', () => { tickerTouched = true; });
    $('fWeight').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.weight = Number(b.dataset.v); $('fWeight').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    const syncDays = () => $('fDays').querySelectorAll('button').forEach(b => b.classList.toggle('on', f.days.indexOf(Number(b.dataset.d)) !== -1));
    $('fDays').onclick = e => { const b = e.target.closest('button'); if (!b) return; const d = Number(b.dataset.d); f.days = f.days.indexOf(d) !== -1 ? f.days.filter(x => x !== d) : f.days.concat(d); syncDays(); };
    document.querySelector('.presets').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.days = { all: [0, 1, 2, 3, 4, 5, 6], wk: [1, 2, 3, 4, 5], we: [0, 6] }[b.dataset.p]; syncDays(); };
    $('fTime').onchange = () => { $('fMinWrap').hidden = !$('fTime').checked; };
    $('fSave').onclick = () => {
      const name = $('fName').value.trim();
      let ticker = $('fTicker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || makeTicker(name, h && h.id);
      if (!name) return ($('fErr').textContent = 'Give it a name.');
      if (!f.days.length) return ($('fErr').textContent = 'Pick at least one day.');
      if (ticker === 'INDEX' || state.habits.some(x => x.ticker === ticker && (!h || x.id !== h.id))) return ($('fErr').textContent = 'That ticker is taken.');
      const days = f.days.slice().sort(), t = today();
      const tt = $('fTime').checked, min = Math.max(1, Number($('fMin').value) || 30);
      if (editing) {
        if (days.join() !== h.days.slice().sort().join() || f.weight !== h.weight) {
          h.history = h.history || [{ from: h.createdDay, days: h.days.slice(), weight: h.weight }];
          const lastRule = h.history[h.history.length - 1];
          if (lastRule.from === t) { lastRule.days = days; lastRule.weight = f.weight; }
          else h.history.push({ from: t, days, weight: f.weight });
        }
        Object.assign(h, { name, ticker, days, weight: f.weight, trackTime: tt, targetMin: min });
      } else {
        state.habits.push({ id: uid(), name, ticker, weight: f.weight, days, trackTime: tt, targetMin: min, createdDay: t, archivedDay: null,
          history: [{ from: t, days, weight: f.weight }] });
      }
      closeModal(); commit(); toast(editing ? 'Saved' : `${ticker} listed. It starts trading today.`);
    };
    if (editing) {
      if ($('fArchive')) $('fArchive').onclick = () => { h.archivedDay = E.addDays(today(), 1); closeModal(); commit(); toast('Archived. History kept.'); };
      if ($('fUnarchive')) $('fUnarchive').onclick = () => { h.archivedDay = null; closeModal(); commit(); };
      $('fDelete').onclick = () => confirmModal(`Delete ${esc(h.name)}?`, 'This removes the habit and all its history from your chart. Archiving keeps the history instead.', 'Delete forever', () => {
        state.habits = state.habits.filter(x => x !== h);
        state.completions = state.completions.filter(c => c.habitId !== h.id);
        state.blocks = state.blocks.filter(b => b.habitId !== h.id);
        state.goals = state.goals.filter(g => g.scope !== h.id);
        commit(); toast('Deleted');
      });
    }
    if (!editing) setTimeout(() => $('fName').focus(), 50);
  }

  // ================= GOALS =================
  function goalSummary(g, daily, actions) {
    const cur = daily.length ? daily[daily.length - 1].close : E.RULES.START_PRICE;
    const pr = E.projection(daily, g.target, g.deadline);
    const span = g.target - g.startValue;
    const pct = span > 0 ? Math.max(0, Math.min(100, (cur - g.startValue) / span * 100)) : (cur >= g.target ? 100 : 0);
    let line;
    if (!pr) line = 'No data yet.';
    else if (pr.reached || cur >= g.target) line = '<span class="up">Target reached. Set the next one.</span>';
    else if (pr.tooEarly) line = 'Projection appears after 5 days of data.';
    else if (pr.hitDay) line = `At your 30-day pace (${signed(pr.slope)}/day) you hit it <b>${shortDate(pr.hitDay)}</b>.` + (g.deadline ? (pr.onTrack ? ' <span class="up">On track.</span>' : ` <span class="down">Behind. You need ${signed(pr.neededPerDay)}/day.</span>`) : '');
    else line = `<span class="down">Trend is flat or falling.</span>${pr.neededPerDay != null ? ` You need ${signed(pr.neededPerDay)}/day to make the deadline.` : ''}`;
    if (g.deadline && g.deadline < today() && cur < g.target) line = `<span class="down">Deadline passed at ${fmt(cur)}.</span>`;
    return `<div class="goal"><div class="row-between"><div><b>${esc(g.name)}</b> <span class="muted small mono">${esc(scopeName(g.scope))}</span></div>
      <div class="mono">${fmt(cur)} → ${fmt(g.target)}</div></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="small">${line}</div>
      <div class="muted small" style="margin-top:4px">${g.deadline ? 'By ' + shortDate(g.deadline) + ' · ' : ''}${g.horizon === 'long' ? 'Long-term' : 'Short-term'}</div>${actions || ''}</div>`;
  }
  function scopeName(s) { if (s === 'index') return 'INDEX'; const h = habit(s); return h ? h.ticker : '?'; }

  function renderGoals() {
    if (!state.goals.length) { $('goalList').innerHTML = '<p class="muted small">No goals yet.</p>'; return; }
    const sorted = state.goals.slice().sort((a, b) => (a.horizon === b.horizon ? ((a.deadline || '9') < (b.deadline || '9') ? -1 : 1) : a.horizon === 'short' ? -1 : 1));
    $('goalList').innerHTML = sorted.map(g => goalSummary(g, seriesFor(g.scope),
      `<div class="btn-row" style="margin-top:10px"><button class="btn small" data-viewgoal="${g.id}">View chart</button><button class="btn small danger" data-delgoal="${g.id}">Remove</button></div>`)).join('');
  }
  $('goalList').addEventListener('click', e => {
    const v = e.target.closest('[data-viewgoal]'), d = e.target.closest('[data-delgoal]');
    if (v) { const g = state.goals.find(x => x.id === v.dataset.viewgoal); ui.ticker = g.scope; ui.interval = 'D'; syncSegs(); switchTab('chart'); }
    if (d) confirmModal('Remove this goal?', '', 'Remove', () => { state.goals = state.goals.filter(x => x.id !== d.dataset.delgoal); commit(); });
  });
  function syncSegs() { $('intervalSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.interval)); }

  $('newGoalBtn').addEventListener('click', () => {
    if (!state.habits.length) return toast('Add a habit first');
    const opts = [{ id: 'index', label: 'INDEX · all habits' }].concat(activeHabits().map(h => ({ id: h.id, label: h.ticker + ' · ' + h.name })));
    const curOf = s => { const d = seriesFor(s); return d.length ? d[d.length - 1].close : E.RULES.START_PRICE; };
    modal(`<h3>New goal</h3>
      <label>Goal<input id="gName" maxlength="40" placeholder="e.g. Q4 discipline, 30-day reset"></label>
      <label>Chart<select id="gScope">${opts.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
      <label>Horizon<select id="gHorizon"><option value="short">Short-term (weeks)</option><option value="long">Long-term (months+)</option></select></label>
      <label>Target price <span id="gCur" class="mono"></span><input type="number" id="gTarget" step="1" min="1"></label>
      <label>Deadline<input type="date" id="gDeadline" min="${E.addDays(today(), 1)}"></label>
      <p class="error" id="gErr"></p>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="gSave">Save</button></div>`);
    const upd = () => {
      const c = curOf($('gScope').value), long = $('gHorizon').value === 'long';
      $('gCur').textContent = `(now ${fmt(c)})`;
      $('gTarget').value = Math.ceil(c * (long ? 1.6 : 1.15));
      $('gDeadline').value = E.addDays(today(), long ? 180 : 30);
    };
    $('gScope').onchange = upd; $('gHorizon').onchange = upd; upd();
    $('gSave').onclick = () => {
      const name = $('gName').value.trim() || 'Goal', target = Number($('gTarget').value), scope = $('gScope').value;
      const cur = curOf(scope);
      if (!(target > cur)) return ($('gErr').textContent = `Target must be above the current price (${fmt(cur)}).`);
      state.goals.push({ id: uid(), name, scope, target, deadline: $('gDeadline').value || null, horizon: $('gHorizon').value, startValue: cur, createdDay: today() });
      closeModal(); commit(); toast('Goal set. It shows as a line on the chart.');
    };
  });

  // ================= SETTINGS / DATA =================
  function renderSettings() {
    const lb = state.settings.lastBackup;
    $('lastBackupText').textContent = lb ? `Last backup: ${new Date(lb).toLocaleString()}` : 'No backup yet.';
    $('appVersion').textContent = APP_VERSION;
    const R = E.RULES;
    $('rulesList').innerHTML = [
      `Every chart starts at <b>${R.START_PRICE}</b>.`,
      `Completing a planned habit adds <b>${R.GAIN_PER_WEIGHT} × weight</b> (1–3 points).`,
      `Each consecutive planned completion adds a <b>${Math.round(R.STREAK_STEP * 100)}% bonus</b>, up to +${Math.round(R.STREAK_STEP * R.STREAK_CAP * 100)}%. That's the compounding.`,
      `Missing a planned habit subtracts <b>${R.MISS_PER_WEIGHT} × weight</b> when the day ends, and resets that streak to zero.`,
      `Doing a habit on an unplanned day adds <b>${R.EXTRA_PER_WEIGHT} × weight</b>.`,
      `Volume bars show minutes invested. Weekly and monthly candles combine the days inside them.`
    ].map(x => `<li>${x}</li>`).join('');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function downloadBackup() {
    state.settings.lastBackup = Date.now();
    const blob = await Vault.exportBackup(state);
    download(`momentum-backup-${today()}.json`, JSON.stringify(blob), 'application/json');
    persist(); renderAll(); toast('Backup downloaded. Store it somewhere safe.');
  }

  let pickingForFirstRun = false;
  function pickBackup(firstRun) { pickingForFirstRun = firstRun; $('fileInput').value = ''; $('fileInput').click(); }
  $('restoreBtn').addEventListener('click', () => pickBackup(false));
  $('fileInput').addEventListener('change', async () => {
    const file = $('fileInput').files[0]; if (!file) return;
    let blob;
    try { blob = JSON.parse(await file.text()); } catch (e) { return alertLock('That file isn\'t a Momentum backup.'); }
    modal(`<h3>Restore backup</h3><p class="small">Enter the passphrase that was in use when this backup was made.</p>
      <label>Backup passphrase<input type="password" id="rPass"></label>
      ${!Vault.isUnlocked() ? '' : '<p class="small down">This replaces everything currently on this device.</p>'}
      <p class="error" id="rErr"></p>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rGo">Restore</button></div>`);
    setTimeout(() => $('rPass').focus(), 50);
    $('rGo').onclick = async () => {
      $('rErr').textContent = 'Decrypting…';
      try {
        const data = normalize(await Vault.readBackup(blob, $('rPass').value));
        if (!Vault.isUnlocked()) { enterApp(await Vault.create($('rPass').value, data)); }
        else { state = data; await persist(true); }
        closeModal(); renderAll(); toast(`Restored ${state.habits.length} habits, ${state.completions.length} check-ins.`);
      } catch (err) { $('rErr').textContent = err.message; }
    };
  });
  function alertLock(msg) { if ($('app').hidden) $('lockError').textContent = msg; else toast(msg); }

  $('exportCsv').addEventListener('click', () => {
    const rows = [['date', 'ticker', 'habit', 'minutes', 'logged_at']].concat(
      state.completions.slice().sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.ts - b.ts)
        .map(c => { const h = habit(c.habitId); return [c.day, h ? h.ticker : '', h ? h.name : '', c.minutes || 0, new Date(c.ts).toISOString()]; }));
    download(`momentum-completions-${today()}.csv`, rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  });
  $('exportJson').addEventListener('click', () => confirmModal('Export unencrypted?', 'This file includes your notes in plain text. Anyone who opens it can read them.', 'Export', () => {
    download(`momentum-data-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  }, 'primary'));

  $('passForm').addEventListener('submit', async e => {
    e.preventDefault();
    const np = $('nextPass').value;
    if (np.length < 8) return toast('Use at least 8 characters');
    try {
      await Vault.changePassphrase($('curPass').value, np, state);
      $('curPass').value = $('nextPass').value = '';
      toast('Passphrase changed. Make a fresh backup.');
    } catch (err) { toast(err.message); }
  });

  // ================= MODAL =================
  function modal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; }
  function confirmModal(title, body, okLabel, onOk, kind) {
    modal(`<h3>${title}</h3>${body ? `<p class="small">${body}</p>` : ''}<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn ${kind || 'danger'}" id="cOk">${okLabel}</button></div>`);
    $('cOk').onclick = () => { closeModal(); onOk(); };
  }
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  // midnight rollover while open
  setInterval(() => { if (state && ui.lastToday !== today()) { const was = ui.lastToday; ui.lastToday = today(); if (was && ui.day === was) ui.day = today(); renderAll(); } }, 60000);
  ui.lastToday = today();

  // ================= BOOT =================
  if (!window.crypto || !crypto.subtle) {
    document.body.innerHTML = '<p style="padding:24px">Momentum needs a secure (https) connection to encrypt your data. Open it from its GitHub Pages link.</p>';
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  showLock();
})();
