/* =========================
   /script.js
   Got Rhythm — Simple (Loop Match) — v2
   Changes:
   - Accuracy starts on first hit; pauses after 8 beats without input ("No recent input detected")
   - Score pauses whenever accuracy pauses
   - Rhythm / Metronome are popup modals (Select Rhythm / Select Metronome)
   - Default BPM 90
   - Stricter tiers: 5/5 under 25ms
   - Best accuracy (ms) tracked and added to scorecard
   - preserves iframe sizing + scroll forwarding
   ========================= */
(() => {
  "use strict";

  const AUDIO_DIR = "audio";

  // ---------------- Tunables ----------------
  const SCHED_AHEAD_SEC = 0.14;
  const SCHED_TICK_MS = 25;

  const MATCH_MAX_MS = 180;

  const ROLLING_BEATS = 4;
  const LIVE_EVAL_DELAY_BEATS = 0.5;

  const INPUT_IDLE_BEATS = 8;

  const TIERS = {
    TIER_5_MS: 25,
    TIER_4_MS: 60,
    TIER_3_MS: 95,
    TIER_2_MS: 135,
  };

  const BEAT_FLASH_MS = 120;

  const METRONOME_GAIN = 0.55;
  const DRUM_GAIN = 0.95;

  const GHOST_CLICK_BLOCK_MS = 700;

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);

  const beginBtn = $("beginBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const downloadScoreBtn = $("downloadScoreBtn");

  const openRhythmBtn = $("openRhythmBtn");
  const openMetroBtn = $("openMetroBtn");

  const rhythmModal = $("rhythmModal");
  const rhythmSel = $("rhythmSel");
  const rhythmOk = $("rhythmOk");
  const rhythmCancel = $("rhythmCancel");

  const metroModal = $("metroModal");
  const bpmRange = $("bpmRange");
  const bpmNum = $("bpmNum");
  const metroOk = $("metroOk");
  const metroCancel = $("metroCancel");

  const kickBtn = $("kickBtn");
  const snareBtn = $("snareBtn");

  const phaseTitle = $("phaseTitle");
  const phaseSub = $("phaseSub");
  const feedbackOut = $("feedbackOut");
  const scoreBar = $("scoreBar");
  const feedbackCard = $("feedbackCard");

  const avgScoreOut = $("avgScoreOut");
  const lastScoreOut = $("lastScoreOut");
  const roundsOut = $("roundsOut");
  const avgMsOut = $("avgMsOut");
  const bestMsOut = $("bestMsOut");

  const beatDots = [$("beatDot1"), $("beatDot2"), $("beatDot3"), $("beatDot4")];

  const infoBtn = $("infoBtn");
  const infoModal = $("infoModal");
  const infoOk = $("infoOk");

  const summaryModal = $("summaryModal");
  const summaryBody = $("summaryBody");
  const summaryClose = $("summaryClose");
  const summaryDownload = $("summaryDownload");

  if (
    !beginBtn ||
    !pauseBtn ||
    !stopBtn ||
    !downloadScoreBtn ||
    !openRhythmBtn ||
    !openMetroBtn ||
    !rhythmModal ||
    !rhythmSel ||
    !rhythmOk ||
    !rhythmCancel ||
    !metroModal ||
    !bpmRange ||
    !bpmNum ||
    !metroOk ||
    !metroCancel ||
    !kickBtn ||
    !snareBtn ||
    !phaseTitle ||
    !phaseSub ||
    !feedbackOut ||
    !scoreBar ||
    !feedbackCard ||
    !avgScoreOut ||
    !lastScoreOut ||
    !roundsOut ||
    !avgMsOut ||
    !bestMsOut ||
    beatDots.some((d) => !d) ||
    !summaryModal ||
    !summaryBody ||
    !summaryClose ||
    !summaryDownload
  ) {
    alert("UI mismatch: required elements missing. Ensure index.html matches script.js ids.");
    return;
  }

  // ---------------- iframe sizing (preserved) ----------------
  let lastHeight = 0;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const height = Math.ceil(entry.contentRect.height);
      if (height !== lastHeight) {
        parent.postMessage({ iframeHeight: height }, "*");
        lastHeight = height;
      }
    }
  });
  ro.observe(document.documentElement);

  function postHeightNow() {
    try {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      parent.postMessage({ iframeHeight: h }, "*");
    } catch {}
  }

  window.addEventListener("load", () => {
    postHeightNow();
    setTimeout(postHeightNow, 250);
    setTimeout(postHeightNow, 1000);
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(postHeightNow, 100);
    setTimeout(postHeightNow, 500);
  });

  function enableScrollForwardingToParent() {
    const SCROLL_GAIN = 6.0;

    const isVerticallyScrollable = () =>
      document.documentElement.scrollHeight > window.innerHeight + 2;

    const isInteractiveTarget = (t) =>
      t instanceof Element && !!t.closest("button, a, input, select, textarea, label");

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lockedMode = null;

    let lastMoveTs = 0;
    let vScrollTop = 0;

    window.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.target;

        lockedMode = null;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastY = startY;

        lastMoveTs = e.timeStamp || performance.now();
        vScrollTop = 0;

        if (isInteractiveTarget(t)) lockedMode = "x";
      },
      { passive: true }
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        if (isVerticallyScrollable()) return;

        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;

        const dx = x - startX;
        const dy = y - startY;

        if (!lockedMode) {
          if (Math.abs(dy) > Math.abs(dx) + 4) lockedMode = "y";
          else if (Math.abs(dx) > Math.abs(dy) + 4) lockedMode = "x";
          else return;
        }
        if (lockedMode !== "y") return;

        const nowTs = e.timeStamp || performance.now();
        const dt = Math.max(8, nowTs - lastMoveTs);
        lastMoveTs = nowTs;

        const fingerStep = (y - lastY) * SCROLL_GAIN;
        lastY = y;

        const scrollTopDelta = -fingerStep;
        const instV = scrollTopDelta / dt;
        vScrollTop = vScrollTop * 0.75 + instV * 0.25;

        e.preventDefault();
        parent.postMessage({ scrollTopDelta }, "*");
      },
      { passive: false }
    );

    function endGesture() {
      if (lockedMode === "y" && Math.abs(vScrollTop) > 0.05) {
        const capped = Math.max(-5.5, Math.min(5.5, vScrollTop));
        parent.postMessage({ scrollTopVelocity: capped }, "*");
      }
      lockedMode = null;
      vScrollTop = 0;
    }

    window.addEventListener("touchend", endGesture, { passive: true });
    window.addEventListener("touchcancel", endGesture, { passive: true });

    window.addEventListener(
      "wheel",
      (e) => {
        if (isVerticallyScrollable()) return;
        parent.postMessage({ scrollTopDelta: e.deltaY }, "*");
      },
      { passive: true }
    );
  }
  enableScrollForwardingToParent();

  // ---------------- Audio ----------------
  let audioCtx = null;
  let masterGain = null;

  const bufferCache = new Map();
  const activeVoices = new Set();

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      alert("Your browser doesn’t support Web Audio (required for playback).");
      return null;
    }
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
    return audioCtx;
  }

  async function resumeAudioIfNeeded() {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
  }

  function trackVoice(src, gain) {
    const voice = { src, gain };
    activeVoices.add(voice);
    src.onended = () => activeVoices.delete(voice);
    return voice;
  }

  function stopAllAudio(fadeSec = 0.06) {
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const fade = Math.max(0.02, Number.isFinite(fadeSec) ? fadeSec : 0.06);

    for (const v of Array.from(activeVoices)) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, fade / 6);
        v.src.stop(now + fade + 0.02);
      } catch {}
    }
  }

  function urlFor(name) {
    return `${AUDIO_DIR}/${name}`;
  }

  async function loadBuffer(url) {
    if (bufferCache.has(url)) return bufferCache.get(url);

    const p = (async () => {
      const ctx = ensureAudio();
      if (!ctx) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await ctx.decodeAudioData(ab);
      } catch {
        return null;
      }
    })();

    bufferCache.set(url, p);
    return p;
  }

  function playOneShot(buffer, whenSec, gainValue) {
    const ctx = ensureAudio();
    if (!ctx || !masterGain || !buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const g = ctx.createGain();
    const gVal = Math.max(0, gainValue);

    const dur = Math.max(0.01, buffer.duration);
    const fadeTail = Math.min(0.04, dur * 0.25);
    const endTime = whenSec + dur;

    g.gain.setValueAtTime(gVal, whenSec);
    g.gain.setValueAtTime(gVal, Math.max(whenSec, endTime - fadeTail));
    g.gain.linearRampToValueAtTime(0, endTime);

    src.connect(g);
    g.connect(masterGain);

    trackVoice(src, g);
    src.start(whenSec);
    src.stop(endTime + 0.05);
  }

  let kickBuf = null;
  let snareBuf = null;

  let metroHighBuf = null;
  let metroLowBuf = null;

  async function preloadAudio() {
    await resumeAudioIfNeeded();
    const [k, s, mh, ml] = await Promise.all([
      loadBuffer(urlFor("kick1.mp3")),
      loadBuffer(urlFor("snare1.mp3")),
      loadBuffer(urlFor("metronomehigh.mp3")),
      loadBuffer(urlFor("metronomelow.mp3")),
    ]);
    kickBuf = k;
    snareBuf = s;
    metroHighBuf = mh;
    metroLowBuf = ml;
  }

  function playMetronomeClick(whenSec, isDownbeat) {
    const buf = isDownbeat ? metroHighBuf : metroLowBuf;
    if (!buf) return;
    playOneShot(buf, whenSec, METRONOME_GAIN);
  }

  function playDrum(i, whenSec) {
    const buf = i === "K" ? kickBuf : snareBuf;
    if (!buf) return;
    playOneShot(buf, whenSec, DRUM_GAIN);
  }

  // ---------------- UI helpers ----------------
  function setFeedback(html) {
    feedbackOut.innerHTML = html || "";
    postHeightNow();
  }

  function setPhase(title, sub) {
    phaseTitle.textContent = title;
    phaseSub.innerHTML = sub || "";
  }

  function setFeedbackGlow(score1to5) {
    if (!score1to5) {
      delete feedbackCard.dataset.score;
      scoreBar.style.width = "0%";
      scoreBar.style.background = "var(--score3)";
      return;
    }
    feedbackCard.dataset.score = String(score1to5);
    scoreBar.style.width = "100%";
    const c =
      score1to5 === 1
        ? "var(--score1)"
        : score1to5 === 2
        ? "var(--score2)"
        : score1to5 === 3
        ? "var(--score3)"
        : score1to5 === 4
        ? "var(--score4)"
        : "var(--score5)";
    scoreBar.style.background = c;
  }

  function flashBeatDot(idx0to3) {
    beatDots.forEach((d, i) => d.classList.toggle("on", i === idx0to3));
    setTimeout(() => {
      beatDots.forEach((d, i) => {
        if (i === idx0to3) d.classList.remove("on");
      });
    }, BEAT_FLASH_MS);
  }

  function flashPad(btn) {
    btn.classList.remove("flash");
    btn.offsetWidth;
    btn.classList.add("flash");
  }

  // ---------------- Rhythm selection ----------------
  const RHYTHMS = {
    r1: ["K", null, "K", null],
    r2: ["K", null, "S", null],
    r3: ["K", "K", "K", "K"],
    r4: ["K", "S", "K", "S"],
  };

  function selectedRhythm() {
    const v = String(rhythmSel.value || "r1");
    return RHYTHMS[v] || RHYTHMS.r1;
  }

  // ---------------- Scoring (rolling) ----------------
  const LIVE_FEEDBACK = {
    1: "Listen to the beat - try and match it!",
    2: "You're a little out",
    3: "Not bad!",
    4: "Good!",
    5: "Excellent! You are on beat!",
  };

  const FINAL_AVG_TEXT = (avg) => {
    const rounded = Math.round(avg);
    if (rounded <= 1)
      return "You scored an average of 1/5 - You're down but you're not out! Give it another go and see if you can improve ☝️";
    if (rounded === 2)
      return "You scored an average of 2/5 - That's not a bad way to begin, but I reckon you've got a higher score in you!";
    if (rounded === 3)
      return "You scored an average of 3/5 - That's not bad at all, though the higher scores are calling your name 😉";
    if (rounded === 4)
      return "You scored an average of 4/5 - That's pretty great! A score to be proud of, but can you go one further? 💪🧐";
    return "Average 5/5:\n\nNice one! You were consistently on beat! Time to move on to the next game in the series!";
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function bpmValue() {
    const v = Number(bpmNum.value);
    return clamp(Number.isFinite(v) ? v : 90, 40, 140);
  }

  function beatDurSec() {
    return 60 / bpmValue();
  }

  const beatTimeline = [];
  const hitTimeline = [];

  function pruneTimelines(nowSec) {
    const keepSec = beatDurSec() * 12;
    while (beatTimeline.length && beatTimeline[0].tSec < nowSec - keepSec) beatTimeline.shift();
    while (hitTimeline.length && hitTimeline[0].tSec < nowSec - keepSec) hitTimeline.shift();
  }

  function scoreFromWindow(windowBeats) {
    const maxMs = MATCH_MAX_MS;
    const usedHitIdx = new Set();

    let misses = 0;
    let extras = 0;
    const errs = [];

    for (const b of windowBeats) {
      const t = b.tSec;
      const expected = b.expected;

      const candidates = [];
      for (let hi = 0; hi < hitTimeline.length; hi++) {
        if (usedHitIdx.has(hi)) continue;
        const h = hitTimeline[hi];
        const errMs = Math.abs(h.tSec - t) * 1000;
        if (errMs <= maxMs) candidates.push({ hi, h, errMs });
      }
      candidates.sort((a, b2) => a.errMs - b2.errMs);

      if (expected == null) {
        if (candidates.length) {
          usedHitIdx.add(candidates[0].hi);
          extras += 1;
          errs.push(maxMs);
        } else {
          errs.push(0);
        }
        continue;
      }

      if (!candidates.length) {
        misses += 1;
        errs.push(maxMs);
        continue;
      }

      const best = candidates[0];
      usedHitIdx.add(best.hi);
      if (candidates.length > 1) extras += candidates.length - 1;

      if (best.h.i !== expected) {
        misses += 1;
        errs.push(maxMs);
        continue;
      }

      errs.push(best.errMs);
    }

    const avgErrMs = errs.length ? errs.reduce((s, x) => s + x, 0) / errs.length : maxMs;
    const totalExpected = Math.max(1, windowBeats.length);

    const missPenalty = misses / totalExpected;
    const extraPenalty = extras / totalExpected;

    const effectiveErr = avgErrMs * (1 + 0.85 * missPenalty + 0.55 * extraPenalty);

    let score = 1;
    if (effectiveErr <= TIERS.TIER_5_MS && misses === 0 && extras === 0) score = 5;
    else if (effectiveErr <= TIERS.TIER_4_MS) score = 4;
    else if (effectiveErr <= TIERS.TIER_3_MS) score = 3;
    else if (effectiveErr <= TIERS.TIER_2_MS) score = 2;

    return { score, avgErrMs, effectiveErr, misses, extras };
  }

  // ---------------- Session stats + summary snapshot ----------------
  const scoreState = {
    beats: 0,
    last: null,
    totalScore: 0,
    avg: 0,
    totalAvgErrMs: 0,
    avgErrMs: 0,
    bestErrMs: Infinity,
  };

  let summarySnapshot = null;

  function setScoreUI(state = scoreState) {
    roundsOut.textContent = String(state.beats);
    lastScoreOut.textContent = state.last ? `${state.last}/5` : "—";
    avgScoreOut.textContent = state.beats ? `${state.avg.toFixed(1)}/5` : "—";
    avgMsOut.textContent = state.beats ? `${Math.round(state.avgErrMs)}ms` : "—";
    bestMsOut.textContent =
      state.beats && Number.isFinite(state.bestErrMs) ? `${Math.round(state.bestErrMs)}ms` : "—";
  }

  function snapshotFromState() {
    return {
      beats: scoreState.beats,
      last: scoreState.last,
      avg: scoreState.avg,
      avgErrMs: scoreState.avgErrMs,
      bestErrMs: scoreState.bestErrMs,
      bpm: bpmValue(),
      rhythmLabel: rhythmSel.options[rhythmSel.selectedIndex]?.text || "Rhythm",
    };
  }

  function updateLiveUI(score, avgErrMs) {
    setFeedbackGlow(score);
    const msg = LIVE_FEEDBACK[score] || "";
    setFeedback(
      `<div class="scoreBigWrap">
         <div class="scoreBigLine">${score}/5</div>
       </div>
       <div class="scoreBelow">
         ${msg}<br/>
         <span class="dim">Rolling accuracy (last ${ROLLING_BEATS} beats): ~${Math.round(avgErrMs)}ms</span>
       </div>`
    );
  }

  function showNoRecentInput() {
    setFeedbackGlow(null);
    setFeedback(
      `<div class="scoreBigWrap">
         <div class="scoreBigWord">No recent input detected</div>
       </div>`
    );
  }

  // ---------------- Scheduler ----------------
  let started = false;
  let paused = false;

  let schedTimer = null;

  let nextBeatTimeSec = 0;
  let globalBeatIndex = 0;

  let lastEvaluatedBeatIdx = -1;

  // Input gating
  let hasEverHit = false;
  let lastInputTimeSec = -Infinity;
  let trackingActive = false;

  function setControls() {
    beginBtn.classList.toggle("pulse", !started);
    pauseBtn.disabled = !started;
    stopBtn.disabled = !started;

    const canHit = started && !paused;
    kickBtn.disabled = !canHit;
    snareBtn.disabled = !canHit;
  }

  function isTrackingActive(ctxNowSec) {
    if (!hasEverHit) return false;
    const bd = beatDurSec();
    const beatsSince = (ctxNowSec - lastInputTimeSec) / bd;
    return beatsSince < INPUT_IDLE_BEATS;
  }

  function onTrackingResume(ctxNowSec) {
    trackingActive = true;
    // Reset evaluation cursor so we don't "score" the idle section.
    // Also clear hits so old hits don't get matched to new beats.
    hitTimeline.length = 0;
    pruneTimelines(ctxNowSec);

    const eligible = beatTimeline.filter((b) => b.tSec <= ctxNowSec - LIVE_EVAL_DELAY_BEATS * beatDurSec());
    const lastIdx = eligible.length ? eligible[eligible.length - 1].idx : globalBeatIndex - 1;
    lastEvaluatedBeatIdx = lastIdx;
  }

  function scheduleTick() {
    const ctx = ensureAudio();
    if (!ctx || !started || paused) return;

    const bd = beatDurSec();
    const rhythm = selectedRhythm();

    while (nextBeatTimeSec < ctx.currentTime + SCHED_AHEAD_SEC) {
      const thisBeatTimeSec = nextBeatTimeSec;
      const beatIdx = globalBeatIndex;

      const inBarIdx = ((beatIdx % 4) + 4) % 4;
      const isDownbeat = inBarIdx === 0;

      playMetronomeClick(thisBeatTimeSec, isDownbeat);

      const dtMs = Math.max(0, (thisBeatTimeSec - ctx.currentTime) * 1000);
      window.setTimeout(() => flashBeatDot(inBarIdx), dtMs);

      const expected = rhythm[inBarIdx] ?? null;
      if (expected) playDrum(expected, thisBeatTimeSec);

      beatTimeline.push({ idx: beatIdx, tSec: thisBeatTimeSec, expected });

      globalBeatIndex += 1;
      nextBeatTimeSec += bd;
    }

    pruneTimelines(ctx.currentTime);

    const activeNow = isTrackingActive(ctx.currentTime);

    if (!trackingActive && activeNow) onTrackingResume(ctx.currentTime);
    if (trackingActive && !activeNow) trackingActive = false;

    if (!activeNow) {
      showNoRecentInput();
      setPhase("Playing", "Match the looping rhythm. Pause with <strong>Space</strong>.");
      setControls();
      return;
    }

    const cutoff = ctx.currentTime - LIVE_EVAL_DELAY_BEATS * bd;
    const eligible = beatTimeline.filter((b) => b.tSec <= cutoff);
    if (!eligible.length) return;

    // Update score for newly eligible beats ONLY while tracking is active.
    for (const b of eligible) {
      if (b.idx <= lastEvaluatedBeatIdx) continue;

      const lastN = eligible.filter((x) => x.idx <= b.idx).slice(-ROLLING_BEATS);
      const res = scoreFromWindow(lastN);

      scoreState.beats += 1;
      scoreState.last = res.score;
      scoreState.totalScore += res.score;
      scoreState.avg = scoreState.totalScore / scoreState.beats;

      scoreState.totalAvgErrMs += res.avgErrMs;
      scoreState.avgErrMs = scoreState.totalAvgErrMs / scoreState.beats;

      if (Number.isFinite(res.avgErrMs)) scoreState.bestErrMs = Math.min(scoreState.bestErrMs, res.avgErrMs);

      lastEvaluatedBeatIdx = b.idx;
    }

    const lastWindow = eligible.slice(-ROLLING_BEATS);
    const lastRes = scoreFromWindow(lastWindow);

    setScoreUI();
    updateLiveUI(lastRes.score, lastRes.avgErrMs);
    setPhase("Playing", "Match the looping rhythm. Pause with <strong>Space</strong>.");
  }

  function startScheduler() {
    if (schedTimer) window.clearInterval(schedTimer);
    schedTimer = window.setInterval(scheduleTick, SCHED_TICK_MS);
  }

  function stopScheduler() {
    if (schedTimer) window.clearInterval(schedTimer);
    schedTimer = null;
  }

  // ---------------- Input ----------------
  function registerHit(i) {
    const ctx = ensureAudio();
    if (!ctx || !started || paused) return;

    const now = ctx.currentTime;

    hasEverHit = true;
    lastInputTimeSec = now;

    playDrum(i, now);
    if (i === "K") flashPad(kickBtn);
    else flashPad(snareBtn);

    hitTimeline.push({ tSec: now, i });
    pruneTimelines(now);
  }

  let ignoreClicksUntilTs = 0;
  function shouldIgnoreClickNow() {
    return performance.now() < ignoreClicksUntilTs;
  }

  function bindImmediatePad(btn, instrument) {
    btn.addEventListener(
      "pointerdown",
      async (e) => {
        if (btn.disabled) return;

        e.preventDefault();
        e.stopPropagation();

        ignoreClicksUntilTs = performance.now() + GHOST_CLICK_BLOCK_MS;
        await resumeAudioIfNeeded();

        try {
          if (btn.setPointerCapture && e.pointerId != null) btn.setPointerCapture(e.pointerId);
        } catch {}

        registerHit(instrument);
      },
      { passive: false }
    );

    btn.addEventListener("click", (e) => {
      if (shouldIgnoreClickNow()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      registerHit(instrument);
    });
  }

  // ---------------- Modals ----------------
  function showModal(el) {
    el.classList.remove("hidden");
    postHeightNow();
  }
  function hideModal(el) {
    el.classList.add("hidden");
    postHeightNow();
  }

  function showInfo() {
    showModal(infoModal);
  }
  function hideInfo() {
    hideModal(infoModal);
  }

  infoBtn?.addEventListener("click", showInfo);
  infoOk?.addEventListener("click", hideInfo);
  infoModal?.addEventListener("click", (e) => {
    if (e.target === infoModal) hideInfo();
  });

  const pending = {
    rhythm: null,
    bpm: null,
  };

  function openRhythm() {
    pending.rhythm = rhythmSel.value;
    showModal(rhythmModal);
  }
  function closeRhythm(apply) {
    if (!apply && pending.rhythm != null) rhythmSel.value = pending.rhythm;
    hideModal(rhythmModal);
  }

  function openMetro() {
    pending.bpm = bpmValue();
    bpmRange.value = String(pending.bpm);
    bpmNum.value = String(pending.bpm);
    showModal(metroModal);
  }
  function closeMetro(apply) {
    if (!apply && pending.bpm != null) {
      bpmRange.value = String(pending.bpm);
      bpmNum.value = String(pending.bpm);
      syncBpmInputs(bpmNum);
    }
    hideModal(metroModal);
  }

  openRhythmBtn.addEventListener("click", openRhythm);
  openMetroBtn.addEventListener("click", openMetro);

  rhythmOk.addEventListener("click", () => closeRhythm(true));
  rhythmCancel.addEventListener("click", () => closeRhythm(false));
  rhythmModal.addEventListener("click", (e) => {
    if (e.target === rhythmModal) closeRhythm(false);
  });

  metroOk.addEventListener("click", () => closeMetro(true));
  metroCancel.addEventListener("click", () => closeMetro(false));
  metroModal.addEventListener("click", (e) => {
    if (e.target === metroModal) closeMetro(false);
  });

  function showSummary() {
    summarySnapshot = snapshotFromState();

    const avgText = summarySnapshot.beats ? `${summarySnapshot.avg.toFixed(1)}/5` : "—";
    const bestText =
      summarySnapshot.beats && Number.isFinite(summarySnapshot.bestErrMs)
        ? `${Math.round(summarySnapshot.bestErrMs)}ms`
        : "—";

    const lines = [
      `Beats played: ${summarySnapshot.beats}`,
      `Average score: ${avgText}`,
      `Avg ms accuracy: ${summarySnapshot.beats ? `${Math.round(summarySnapshot.avgErrMs)}ms` : "—"}`,
      `Best accuracy: ${bestText}`,
      "",
      FINAL_AVG_TEXT(summarySnapshot.avg || 0),
    ];

    summaryBody.textContent = lines.join("\n");
    showModal(summaryModal);
    summaryClose.focus();
  }

  function hideSummary() {
    hideModal(summaryModal);
  }

  summaryClose.addEventListener("click", hideSummary);
  summaryModal.addEventListener("click", (e) => {
    if (e.target === summaryModal) hideSummary();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!infoModal.classList.contains("hidden")) hideInfo();
      if (!rhythmModal.classList.contains("hidden")) closeRhythm(false);
      if (!metroModal.classList.contains("hidden")) closeMetro(false);
      if (!summaryModal.classList.contains("hidden")) hideSummary();
    }
  });

  // ---------------- Scorecard PNG ----------------
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function drawCardBase(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfbfc";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = "#111";
    ctx.fillRect(8, 8, w - 16, 74);
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  function getPlayerName() {
    const prev = localStorage.getItem("hol_player_name") || "";
    const name = window.prompt("Enter your name for the score card:", prev) ?? "";
    const trimmed = String(name).trim();
    if (trimmed) localStorage.setItem("hol_player_name", trimmed);
    return trimmed || "Player";
  }

  function getScoreSource() {
    if (summarySnapshot && summaryModal && !summaryModal.classList.contains("hidden")) return summarySnapshot;
    return snapshotFromState();
  }

  async function downloadScoreCardPng(playerName) {
    const src = getScoreSource();

    const w = 760;
    const h = 600;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawCardBase(ctx, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "900 30px Arial";
    ctx.fillText("Got Rhythm — Simple Scorecard", 28, 56);

    const bodyX = 28;
    const bodyY = 130;

    ctx.fillStyle = "#111";
    ctx.font = "900 22px Arial";
    ctx.fillText("Summary", bodyX, bodyY);

    ctx.font = "700 20px Arial";

    const avgText = src.beats ? `${src.avg.toFixed(1)}/5` : "—";
    const avgMsText = src.beats ? `${Math.round(src.avgErrMs)}ms` : "—";
    const bestText =
      src.beats && Number.isFinite(src.bestErrMs) ? `${Math.round(src.bestErrMs)}ms` : "—";

    const lines = [
      `Name: ${playerName}`,
      `Rhythm: ${src.rhythmLabel}`,
      `Metronome: ${src.bpm} bpm`,
      `Beats played: ${src.beats}`,
      `Average score: ${avgText}`,
      `Last score: ${src.last ? `${src.last}/5` : "—"}`,
      `Avg ms accuracy: ${avgMsText}`,
      `Best accuracy: ${bestText}`,
      "",
      FINAL_AVG_TEXT(src.avg || 0),
    ];

    let y = bodyY + 44;
    for (const ln of lines) {
      if (ln === "") {
        y += 16;
        continue;
      }
      if (y > h - 90) break;
      drawWrappedText(ctx, ln, bodyX, y, w - 56, 28);
      y += 32;
    }

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "700 16px Arial";
    ctx.fillText("Downloaded from www.eartraininglab.com 🥁", bodyX, h - 36);

    const blob = await canvasToPngBlob(canvas);
    if (blob) downloadBlob(blob, "Got Rhythm Simple Scorecard.png");
  }

  async function onDownloadScoreCard() {
    const name = getPlayerName();
    await downloadScoreCardPng(name);
  }

  // ---------------- Controls / lifecycle ----------------
  function resetStateToIdle() {
    started = false;
    paused = false;

    stopScheduler();
    stopAllAudio(0.06);

    nextBeatTimeSec = 0;
    globalBeatIndex = 0;
    lastEvaluatedBeatIdx = -1;

    beatTimeline.length = 0;
    hitTimeline.length = 0;

    scoreState.beats = 0;
    scoreState.last = null;
    scoreState.totalScore = 0;
    scoreState.avg = 0;
    scoreState.totalAvgErrMs = 0;
    scoreState.avgErrMs = 0;
    scoreState.bestErrMs = Infinity;

    summarySnapshot = null;

    hasEverHit = false;
    lastInputTimeSec = -Infinity;
    trackingActive = false;

    setScoreUI();
    setFeedbackGlow(null);

    setPhase("Ready", "Press <strong>Begin Game</strong> to start.");
    setFeedback("Press <strong>Begin Game</strong> to start.");
    beatDots.forEach((d) => d.classList.remove("on"));

    beginBtn.textContent = "Begin Game";
    pauseBtn.textContent = "Pause";
    beginBtn.classList.add("pulse");

    setControls();
    postHeightNow();
  }

  async function beginGame() {
    await preloadAudio();
    await resumeAudioIfNeeded();

    const ctx = ensureAudio();
    if (!ctx) return;

    started = true;
    paused = false;

    beginBtn.textContent = "Restart Game";
    beginBtn.classList.remove("pulse");

    nextBeatTimeSec = ctx.currentTime + 0.10;
    globalBeatIndex = 0;
    lastEvaluatedBeatIdx = -1;

    beatTimeline.length = 0;
    hitTimeline.length = 0;

    scoreState.beats = 0;
    scoreState.last = null;
    scoreState.totalScore = 0;
    scoreState.avg = 0;
    scoreState.totalAvgErrMs = 0;
    scoreState.avgErrMs = 0;
    scoreState.bestErrMs = Infinity;

    summarySnapshot = null;

    hasEverHit = false;
    lastInputTimeSec = -Infinity;
    trackingActive = false;

    setScoreUI();
    setFeedbackGlow(null);
    setPhase("Starting", "Find the beat…");
    showNoRecentInput();

    setControls();
    startScheduler();
  }

  async function restartGame() {
    stopAllAudio(0.06);
    stopScheduler();
    await beginGame();
  }

  async function togglePause() {
    if (!started) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    if (!paused) {
      paused = true;
      pauseBtn.textContent = "Continue";
      setPhase("Paused", "Press <strong>Continue</strong> (or <strong>Space</strong>) to resume.");
      setFeedback("Paused.");
      setControls();
      try {
        await ctx.suspend();
      } catch {}
      return;
    }

    try {
      await ctx.resume();
    } catch {}
    paused = false;
    pauseBtn.textContent = "Pause";
    setControls();
  }

  function stopAndReset() {
    if (!started) return;
    showSummary();
    resetStateToIdle();
  }

  // ---------------- Events ----------------
  function syncBpmInputs(from) {
    const v = clamp(Number(from.value), 40, 140);
    bpmRange.value = String(v);
    bpmNum.value = String(v);

    const ctx = ensureAudio();
    if (ctx && started && !paused) {
      nextBeatTimeSec = Math.max(nextBeatTimeSec, ctx.currentTime + 0.05);
    }
  }

  bpmRange.addEventListener("input", () => syncBpmInputs(bpmRange));
  bpmNum.addEventListener("input", () => syncBpmInputs(bpmNum));

  beginBtn.addEventListener("click", async () => {
    if (!started) await beginGame();
    else await restartGame();
  });

  pauseBtn.addEventListener("click", togglePause);
  stopBtn.addEventListener("click", stopAndReset);

  downloadScoreBtn.addEventListener("click", onDownloadScoreCard);
  summaryDownload.addEventListener("click", onDownloadScoreCard);

  bindImmediatePad(kickBtn, "K");
  bindImmediatePad(snareBtn, "S");

  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePause();
      return;
    }

    if (!started || paused) return;

    if (e.code === "ArrowLeft") {
      e.preventDefault();
      registerHit("K");
      return;
    }
    if (e.code === "ArrowRight") {
      e.preventDefault();
      registerHit("S");
      return;
    }
  });

  // ---------------- Init ----------------
  function syncStartDependentButtons() {
    pauseBtn.disabled = !started;
    stopBtn.disabled = !started;
  }

  // Default BPM 90
  bpmRange.value = "90";
  bpmNum.value = "90";
  syncBpmInputs(bpmNum);

  resetStateToIdle();
  syncStartDependentButtons();
})();
