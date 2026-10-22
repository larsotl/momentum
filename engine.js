/* Momentum scoring engine.
 * Turns raw events (habits + completions) into a stock-style price series.
 * Everything is recomputed from raw events, so the formula can change later
 * without losing any history.
 */
(function (root) {
  'use strict';

  // ---- Tunable constants -------------------------------------------------
  const RULES = {
    START_PRICE: 100,
    GAIN_PER_WEIGHT: 1.0,      // points earned per weight unit when a planned habit is done
    MISS_PER_WEIGHT: 0.8,      // points lost per weight unit when a planned habit is missed
    STREAK_STEP: 0.05,         // +5% bonus per consecutive planned completion...
    STREAK_CAP: 10,            // ...up to +50%
    EXTRA_PER_WEIGHT: 0.5,     // completing a habit on an unplanned day (no streak effect)
    FLOOR: 1                   // price never drops below this
  };

  // ---- Date helpers (local time, keys are YYYY-MM-DD) --------------------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d); }
  function dow(k) { return parseKey(k).getDay(); }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }

  // A habit's schedule/weight history: edits apply from the day they were made,
  // so changing a habit never rewrites past misses.
  function ruleAt(h, k) {
    const hist = h.history;
    if (!hist || !hist.length) return { days: h.days, weight: h.weight };
    let r = hist[0];
    for (let i = 1; i < hist.length; i++) { if (hist[i].from <= k) r = hist[i]; else break; }
    return r;
  }
  function isPlanned(h, k) {
    if (k < h.createdDay) return false;
    if (h.archivedDay && k >= h.archivedDay) return false;
    return ruleAt(h, k).days.indexOf(dow(k)) !== -1;
  }
  function isActive(h, k) {
    return k >= h.createdDay && !(h.archivedDay && k >= h.archivedDay);
  }

  /**
   * Compute daily candles.
   * @param state   app state
   * @param opts    { habitIds: array|null (null = whole index), today: 'YYYY-MM-DD' }
   * @returns array of { time, open, high, low, close, volume, gained, lost, done:[], missed:[], extra:[] }
   */
  function computeDaily(state, opts) {
    opts = opts || {};
    const today = opts.today || dayKey(new Date());
    const habits = state.habits.filter(h => !opts.habitIds || opts.habitIds.indexOf(h.id) !== -1);
    if (!habits.length) return [];
    const byId = {};
    habits.forEach(h => { byId[h.id] = h; });

    let start = habits.reduce((m, h) => h.createdDay < m ? h.createdDay : m, habits[0].createdDay);
    if (start > today) return [];

    // Group completions by day
    const comps = {};
    state.completions.forEach(c => {
      if (!byId[c.habitId] || c.day < start || c.day > today) return;
      (comps[c.day] = comps[c.day] || []).push(c);
    });
    Object.keys(comps).forEach(k => comps[k].sort((a, b) => a.ts - b.ts));

    const streak = {};
    habits.forEach(h => { streak[h.id] = 0; });

    const out = [];
    let price = RULES.START_PRICE;
    for (let k = start; k <= today; k = addDays(k, 1)) {
      const open = price;
      let running = open, high = open, low = open, volume = 0, gained = 0, lost = 0;
      const doneSet = {}, done = [], extra = [], missed = [];

      (comps[k] || []).forEach(c => {
        const h = byId[c.habitId];
        volume += Number(c.minutes) || 0;
        if (doneSet[h.id] || !isActive(h, k)) return; // one scoring completion per habit per day
        doneSet[h.id] = true;
        let g;
        if (isPlanned(h, k)) {
          const mult = 1 + RULES.STREAK_STEP * Math.min(streak[h.id], RULES.STREAK_CAP);
          g = ruleAt(h, k).weight * RULES.GAIN_PER_WEIGHT * mult;
          streak[h.id] += 1;
          done.push({ habitId: h.id, points: g, streak: streak[h.id] });
        } else {
          g = ruleAt(h, k).weight * RULES.EXTRA_PER_WEIGHT;
          extra.push({ habitId: h.id, points: g });
        }
        running += g; gained += g;
        if (running > high) high = running;
      });

      // Misses are only final once the day is over
      if (k < today) {
        habits.forEach(h => {
          if (isPlanned(h, k) && !doneSet[h.id]) {
            const l = ruleAt(h, k).weight * RULES.MISS_PER_WEIGHT;
            running -= l; lost += l;
            missed.push({ habitId: h.id, points: -l, lostStreak: streak[h.id] });
            streak[h.id] = 0;
          }
        });
      }
      running = Math.max(RULES.FLOOR, running);
      low = Math.min(low, running);
      price = running;
      out.push({
        time: k, open: r2(open), high: r2(high), low: r2(low), close: r2(running),
        volume, gained: r2(gained), lost: r2(lost), done, missed, extra
      });
    }
    return out;
  }

  function r2(x) { return Math.round(x * 100) / 100; }

  // ---- Roll-ups ---------------------------------------------------------
  function weekStart(k) { const d = dow(k); return addDays(k, -((d + 6) % 7)); } // Monday
  function monthStart(k) { return k.slice(0, 8) + '01'; }

  function rollup(daily, interval) {
    if (interval === 'D') return daily;
    const keyFn = interval === 'W' ? weekStart : monthStart;
    const out = [];
    let cur = null;
    daily.forEach(c => {
      const key = keyFn(c.time);
      if (!cur || cur.time !== key) {
        cur = { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, gained: 0, lost: 0, days: [] };
        out.push(cur);
      }
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.gained = r2(cur.gained + c.gained);
      cur.lost = r2(cur.lost + c.lost);
      cur.days.push(c.time);
    });
    return out;
  }

  function movingAverage(candles, period) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out.push({ time: candles[i].time, value: r2(sum / period) });
    }
    return out;
  }

  // ---- Projection (linear trend over recent closes) ---------------------
  function projection(daily, target, deadline, lookback) {
    lookback = lookback || 30;
    if (!daily.length) return null;
    const pts = daily.slice(-lookback);
    const last = daily[daily.length - 1];
    const current = last.close;
    const res = { current, target, slope: 0, hitDay: null, onTrack: null, neededPerDay: null, line: [] };
    if (deadline) {
      const left = daysBetween(last.time, deadline);
      res.daysLeft = left;
      res.neededPerDay = left > 0 ? r2((target - current) / left) : null;
    }
    if (current >= target) { res.reached = true; return res; }
    if (pts.length < 5) { res.tooEarly = true; return res; }
    const n = pts.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach((p, i) => { sx += i; sy += p.close; sxy += i * p.close; sxx += i * i; });
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    res.slope = r2(slope);
    if (slope > 0.01) {
      const days = Math.ceil((target - current) / slope);
      res.hitDay = addDays(last.time, days);
      if (deadline) res.onTrack = res.hitDay <= deadline;
      const horizon = Math.min(days, 730);
      const step = Math.max(1, Math.ceil(horizon / 60));
      for (let d = 0; d <= horizon; d += step) {
        res.line.push({ time: addDays(last.time, d), value: r2(current + slope * d) });
      }
      if (res.line[res.line.length - 1].time !== addDays(last.time, horizon)) {
        res.line.push({ time: addDays(last.time, horizon), value: r2(current + slope * horizon) });
      }
    } else if (deadline) {
      res.onTrack = false;
    }
    return res;
  }

  // ---- Stats ------------------------------------------------------------
  function stats(state, daily, opts) {
    opts = opts || {};
    const today = opts.today || dayKey(new Date());
    if (!daily.length) return null;
    const last = daily[daily.length - 1];
    const prev = daily.length > 1 ? daily[daily.length - 2].close : last.open;
    const wk = daily.length > 7 ? daily[daily.length - 8].close : daily[0].open;
    // consistency over last 30 finished days
    let planned = 0, hit = 0;
    daily.slice(-31).forEach(c => {
      if (c.time >= today) return;
      planned += c.done.length + c.missed.length;
      hit += c.done.length;
    });
    const minutes = daily.reduce((s, c) => s + c.volume, 0);
    const allHigh = daily.reduce((m, c) => Math.max(m, c.high), 0);
    return {
      price: last.close,
      dayChange: r2(last.close - prev),
      dayPct: prev ? r2((last.close - prev) / prev * 100) : 0,
      weekPct: wk ? r2((last.close - wk) / wk * 100) : 0,
      consistency: planned ? Math.round(hit / planned * 100) : null,
      hours: Math.round(minutes / 6) / 10,
      allTimeHigh: allHigh,
      drawdown: allHigh ? r2((last.close - allHigh) / allHigh * 100) : 0
    };
  }

  function currentStreaks(state, today) {
    today = today || dayKey(new Date());
    const out = {};
    state.habits.forEach(h => {
      const done = {};
      state.completions.forEach(c => { if (c.habitId === h.id) done[c.day] = true; });
      let s = 0;
      // today counts if done; otherwise start from yesterday
      let k = today;
      if (!done[k]) k = addDays(k, -1);
      let guard = 0;
      while (k >= h.createdDay && guard++ < 5000) {
        if (isPlanned(h, k)) { if (done[k]) s++; else break; }
        k = addDays(k, -1);
      }
      out[h.id] = s;
    });
    return out;
  }

  const api = { RULES, ruleAt, dayKey, parseKey, addDays, dow, daysBetween, isPlanned, isActive,
    computeDaily, rollup, movingAverage, projection, stats, currentStreaks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(this);
