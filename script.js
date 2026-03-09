/* =========================
   /script.js
   Got Rhythm — Simple (Loop Match) — Unified Settings + Modals + Grid Scorecard
   ========================= */
   (() => {
    "use strict";
  
    const AUDIO_DIR = "audio";
    const LS_KEY_NAME = "ktb_player_name";
  
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
    const UI_GAIN = 0.85;
  
    const GHOST_CLICK_BLOCK_MS = 700;
  
    // ---------------- DOM ----------------
    const $ = (id) => document.getElementById(id);
  
    const beginBtn = $("beginBtn");
    const pauseBtn = $("pauseBtn");
    const settingsBtn = $("settingsBtn");
    const downloadScoreBtn = $("downloadScoreBtn");
  
    const settingsModal = $("settingsModal");
    const rhythmSel = $("rhythmSel");
    const bpmRange = $("bpmRange");
    const bpmNum = $("bpmNum");
    const settingsOk = $("settingsOk");
    const settingsCancel = $("settingsCancel");
  
    const introRhythmSel = $("introRhythmSel");
    const introBpmRange = $("introBpmRange");
    const introBpmNum = $("introBpmNum");
  
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
  
    const introModal = $("introModal");
    const introGotIt = $("introGotIt");
  
    const summaryModal = $("summaryModal");
    const summaryScoreOut = $("summaryScoreOut");
    const summaryClose = $("summaryClose");
    const summaryDownload = $("summaryDownload");
    const modalPlayerNameInput = $("modalPlayerNameInput");
  
    // ---------------- iframe sizing ----------------
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
      // Show Intro Screen on load
      setTimeout(showIntro, 80);
    });
  
    window.addEventListener("orientationchange", () => {
      setTimeout(postHeightNow, 100);
      setTimeout(postHeightNow, 500);
    });
  
    // ---------------- Audio Engine ----------------
    let audioCtx = null;
    let masterGain = null;
  
    const bufferCache = new Map();
    const activeVoices = new Set();
  
    function ensureAudio() {
      if (audioCtx) return audioCtx;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
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
        try { await ctx.resume(); } catch {}
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
  
    function urlFor(name) { return `${AUDIO_DIR}/${name}`; }
  
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
        } catch { return null; }
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
  
    let kickBuf, snareBuf, metroHighBuf, metroLowBuf;
    let selectBuf, backBuf;
  
    async function preloadAudio() {
      await resumeAudioIfNeeded();
      const [k, s, mh, ml, sel, back] = await Promise.all([
        loadBuffer(urlFor("kick1.mp3")),
        loadBuffer(urlFor("snare1.mp3")),
        loadBuffer(urlFor("metronomehigh.mp3")),
        loadBuffer(urlFor("metronomelow.mp3")),
        loadBuffer(urlFor("select1.mp3")),
        loadBuffer(urlFor("back1.mp3")),
      ]);
      kickBuf = k; snareBuf = s; metroHighBuf = mh; metroLowBuf = ml;
      selectBuf = sel; backBuf = back;
    }
  
    async function playUiSound(buffer) {
      const ctx = ensureAudio();
      if (!ctx || !buffer) return;
      await resumeAudioIfNeeded();
      playOneShot(buffer, ctx.currentTime + 0.01, UI_GAIN);
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
      const c = score1to5 === 1 ? "var(--score1)"
              : score1to5 === 2 ? "var(--score2)"
              : score1to5 === 3 ? "var(--score3)"
              : score1to5 === 4 ? "var(--score4)"
              : "var(--score5)";
      scoreBar.style.background = c;
    }
  
    function flashBeatDot(idx0to3) {
      beatDots.forEach((d, i) => d.classList.toggle("on", i === idx0to3));
      setTimeout(() => {
        beatDots.forEach((d, i) => { if (i === idx0to3) d.classList.remove("on"); });
      }, BEAT_FLASH_MS);
    }
  
    function flashPad(btn) {
      btn.classList.remove("flash");
      btn.offsetWidth;
      btn.classList.add("flash");
    }
  
    // Sync Input Value
    function syncNames(val) {
      if (modalPlayerNameInput && modalPlayerNameInput.value !== val) modalPlayerNameInput.value = val;
    }
    modalPlayerNameInput?.addEventListener("input", e => syncNames(e.target.value));
  
    // Sync Settings logic
    introRhythmSel?.addEventListener("change", (e) => { if (rhythmSel) rhythmSel.value = e.target.value; });
    rhythmSel?.addEventListener("change", (e) => { if (introRhythmSel) introRhythmSel.value = e.target.value; });
  
    // ---------------- Rhythm selection ----------------
    const RHYTHMS = {
      r1: ["K", null, "K", null],
      r2: ["K", null, "S", null],
      r3: ["K", "K", "K", "K"],
      r4: ["K", "S", "K", "S"],
    };
  
    function selectedRhythm() {
      const v = String(rhythmSel?.value || "r1");
      return RHYTHMS[v] || RHYTHMS.r1;
    }
  
    // ---------------- Scoring ----------------
    const LIVE_FEEDBACK = {
      1: "Listen to the beat - try and match it!",
      2: "You're a little out",
      3: "Not bad!",
      4: "Good!",
      5: "Excellent! You are on beat!",
    };
  
    const FINAL_AVG_TEXT = (avg) => {
      const rounded = Math.round(avg);
      if (rounded <= 1) return "You scored an average of 1/5 - You're down but you're not out! Give it another go and see if you can improve ☝️";
      if (rounded === 2) return "You scored an average of 2/5 - That's not a bad way to begin, but I reckon you've got a higher score in you!";
      if (rounded === 3) return "You scored an average of 3/5 - That's not bad at all, though the higher scores are calling your name 😉";
      if (rounded === 4) return "You scored an average of 4/5 - That's pretty great! A score to be proud of, but can you go one further? 💪🧐";
      return "Average 5/5: Nice one! You were consistently on beat! Time to move on to the next game in the series!";
    };
  
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function bpmValue() { return clamp(Number(bpmNum?.value) || 90, 40, 140); }
    function beatDurSec() { return 60 / bpmValue(); }
  
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
      let misses = 0; let extras = 0; const errs = [];
  
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
            extras += 1; errs.push(maxMs);
          } else { errs.push(0); }
          continue;
        }
  
        if (!candidates.length) { misses += 1; errs.push(maxMs); continue; }
  
        const best = candidates[0];
        usedHitIdx.add(best.hi);
        if (candidates.length > 1) extras += candidates.length - 1;
  
        if (best.h.i !== expected) { misses += 1; errs.push(maxMs); continue; }
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
  
    // ---------------- Session stats ----------------
    const scoreState = { beats: 0, last: null, totalScore: 0, avg: 0, totalAvgErrMs: 0, avgErrMs: 0, bestErrMs: Infinity };
    let summarySnapshot = null;
  
    function setScoreUI() {
      if(roundsOut) roundsOut.textContent = String(scoreState.beats);
      if(lastScoreOut) lastScoreOut.textContent = scoreState.last ? `${scoreState.last}/5` : "—";
      if(avgScoreOut) avgScoreOut.textContent = scoreState.beats ? `${scoreState.avg.toFixed(1)}/5` : "—";
      if(avgMsOut) avgMsOut.textContent = scoreState.beats ? `${Math.round(scoreState.avgErrMs)}ms` : "—";
      if(bestMsOut) bestMsOut.textContent = scoreState.beats && Number.isFinite(scoreState.bestErrMs) ? `${Math.round(scoreState.bestErrMs)}ms` : "—";
    }
  
    function snapshotFromState() {
      return {
        beats: scoreState.beats, last: scoreState.last, avg: scoreState.avg,
        avgErrMs: scoreState.avgErrMs, bestErrMs: scoreState.bestErrMs,
        bpm: bpmValue(), rhythmLabel: rhythmSel?.options[rhythmSel.selectedIndex]?.text || "Rhythm",
      };
    }
  
    function updateLiveUI(score, avgErrMs) {
      setFeedbackGlow(score);
      const msg = LIVE_FEEDBACK[score] || "";
      setFeedback(
        `<div class="scoreBigWrap"><div class="scoreBigLine">${score}/5</div></div>
         <div class="scoreBelow">${msg}<br/><span class="dim">Rolling accuracy (last ${ROLLING_BEATS} beats): ~${Math.round(avgErrMs)}ms</span></div>`
      );
    }
  
    function showNoRecentInput() {
      setFeedbackGlow(null);
      setFeedback(`<div class="scoreBigWrap"><div class="scoreBigWord">No recent input detected</div></div>`);
    }
  
    // ---------------- Scheduler ----------------
    let started = false;
    let paused = false;
    let schedTimer = null;
    let nextBeatTimeSec = 0;
    let globalBeatIndex = 0;
    let lastEvaluatedBeatIdx = -1;
  
    let hasEverHit = false;
    let lastInputTimeSec = -Infinity;
    let trackingActive = false;
    let trackingStartBeatIdx = -1; // Dictates where our scoring logic begins evaluating
  
    function setControls() {
      if (beginBtn) {
        if (!started) {
          beginBtn.textContent = "Begin Game";
          beginBtn.classList.add("pulse", "primary");
        } else {
          beginBtn.textContent = "End Game";
          beginBtn.classList.remove("pulse", "primary");
        }
      }
      if (pauseBtn) pauseBtn.disabled = !started;
      
      const canHit = started && !paused;
      if (kickBtn) kickBtn.disabled = !canHit;
      if (snareBtn) snareBtn.disabled = !canHit;
    }
  
    function isTrackingActive(ctxNowSec) {
      if (!hasEverHit) return false;
      const bd = beatDurSec();
      return ((ctxNowSec - lastInputTimeSec) / bd) < INPUT_IDLE_BEATS;
    }
  
    function onTrackingResume(ctxNowSec) {
      trackingActive = true;
      pruneTimelines(ctxNowSec);
      
      // Find the beat that corresponds most closely to the user's initial tracking hit
      let closestBeat = null;
      let minDiff = Infinity;
      for (const b of beatTimeline) {
        const diff = Math.abs(b.tSec - lastInputTimeSec);
        if (diff < minDiff) {
          minDiff = diff;
          closestBeat = b;
        }
      }
      
      // Ensure evaluating logic skips beats *before* this moment
      trackingStartBeatIdx = closestBeat ? closestBeat.idx : Math.max(0, globalBeatIndex - 1);
      lastEvaluatedBeatIdx = trackingStartBeatIdx - 1;
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
  
      for (const b of eligible) {
        if (b.idx <= lastEvaluatedBeatIdx) continue;
        
        // Do not score any beats that occurred before the player officially started tapping
        if (b.idx < trackingStartBeatIdx) {
          lastEvaluatedBeatIdx = b.idx;
          continue;
        }
  
        // Restrict the sliding window to ONLY beats that have occurred since tracking began
        const lastN = eligible.filter((x) => x.idx <= b.idx && x.idx >= trackingStartBeatIdx).slice(-ROLLING_BEATS);
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
  
      // Apply exact same filter for the live output window so visual layout matches true data
      const lastWindow = eligible.filter((x) => x.idx >= trackingStartBeatIdx).slice(-ROLLING_BEATS);
      if (lastWindow.length > 0) {
        const lastRes = scoreFromWindow(lastWindow);
        setScoreUI();
        updateLiveUI(lastRes.score, lastRes.avgErrMs);
      }
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
      if (i === "K" && kickBtn) flashPad(kickBtn); 
      else if (i === "S" && snareBtn) flashPad(snareBtn);
      hitTimeline.push({ tSec: now, i });
      pruneTimelines(now);
    }
  
    let ignoreClicksUntilTs = 0;
    function shouldIgnoreClickNow() { return performance.now() < ignoreClicksUntilTs; }
  
    function bindImmediatePad(btn, instrument) {
      if(!btn) return;
      btn.addEventListener("pointerdown", async (e) => {
        if (btn.disabled) return;
        e.preventDefault(); e.stopPropagation();
        ignoreClicksUntilTs = performance.now() + GHOST_CLICK_BLOCK_MS;
        await resumeAudioIfNeeded();
        try { if (btn.setPointerCapture && e.pointerId != null) btn.setPointerCapture(e.pointerId); } catch {}
        registerHit(instrument);
      }, { passive: false });
  
      btn.addEventListener("click", (e) => {
        if (shouldIgnoreClickNow()) { e.preventDefault(); e.stopPropagation(); return; }
        registerHit(instrument);
      });
    }
  
    // ---------------- Modals ----------------
    function showModal(el) { el?.classList.remove("hidden"); postHeightNow(); }
    function hideModal(el) { el?.classList.add("hidden"); postHeightNow(); }
  
    // Info
    infoBtn?.addEventListener("click", async () => { await playUiSound(selectBuf); showModal(infoModal); });
    infoOk?.addEventListener("click", async () => { await playUiSound(backBuf); hideModal(infoModal); });
    infoModal?.addEventListener("click", async (e) => { if (e.target === infoModal) { await playUiSound(backBuf); hideModal(infoModal); } });
  
    // Intro
    function showIntro() { showModal(introModal); introGotIt?.focus(); }
    function hideIntro() { hideModal(introModal); beginBtn?.focus(); }
    introGotIt?.addEventListener("click", async () => { 
      await playUiSound(selectBuf); 
      hideIntro(); 
    });
    introModal?.addEventListener("click", async (e) => { if (e.target === introModal) { await playUiSound(backBuf); hideIntro(); } });
  
    // Settings
    let pendingRhythm = null;
    let pendingBpm = null;
    function openSettings() {
      if(rhythmSel) pendingRhythm = rhythmSel.value;
      pendingBpm = bpmValue();
      if(bpmRange) bpmRange.value = String(pendingBpm);
      if(bpmNum) bpmNum.value = String(pendingBpm);
      showModal(settingsModal);
    }
    async function closeSettings(apply) {
      if (apply) {
        await playUiSound(selectBuf);
        resetStateToIdle();
      } else {
        await playUiSound(backBuf);
        if (pendingRhythm != null && rhythmSel) rhythmSel.value = pendingRhythm;
        if (pendingBpm != null) {
          if(bpmRange) bpmRange.value = String(pendingBpm);
          if(bpmNum) bpmNum.value = String(pendingBpm);
          syncBpmInputs(bpmNum);
        }
      }
      hideModal(settingsModal);
    }
    
    settingsBtn?.addEventListener("click", async () => { await playUiSound(selectBuf); openSettings(); });
    settingsOk?.addEventListener("click", () => closeSettings(true));
    settingsCancel?.addEventListener("click", () => closeSettings(false));
    settingsModal?.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(false); });
  
    // Summary
    let returnToIntroAfterSummary = false;
    function showSummary() {
      summarySnapshot = snapshotFromState();
      const avgText = summarySnapshot.beats ? `${summarySnapshot.avg.toFixed(1)}/5` : "—";
      const bestText = summarySnapshot.beats && Number.isFinite(summarySnapshot.bestErrMs) ? `${Math.round(summarySnapshot.bestErrMs)}ms` : "—";
      const avgMsText = summarySnapshot.beats ? `${Math.round(summarySnapshot.avgErrMs)}ms` : "—";
      
      const html = `
        <div class="scoreItem"><span class="scoreK">Beats Played</span><span class="scoreV">${summarySnapshot.beats}</span></div>
        <div class="scoreItem"><span class="scoreK">Average Score</span><span class="scoreV">${avgText}</span></div>
        <div class="scoreItem"><span class="scoreK">Avg ms Accuracy</span><span class="scoreV">${avgMsText}</span></div>
        <div class="scoreItem"><span class="scoreK">Best Accuracy</span><span class="scoreV">${bestText}</span></div>
        <div style="margin-top: 16px; font-weight: 600; opacity: 0.9;">${FINAL_AVG_TEXT(summarySnapshot.avg || 0)}</div>
      `;
      if(summaryScoreOut) summaryScoreOut.innerHTML = html;
      showModal(summaryModal);
      summaryClose?.focus();
    }
    async function hideSummaryHandler() {
      await playUiSound(backBuf);
      hideModal(summaryModal);
      if (returnToIntroAfterSummary) {
        returnToIntroAfterSummary = false;
        showIntro();
      }
    }
    summaryClose?.addEventListener("click", hideSummaryHandler);
    summaryModal?.addEventListener("click", async (e) => { if (e.target === summaryModal) hideSummaryHandler(); });
  
    document.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        if (infoModal && !infoModal.classList.contains("hidden")) { await playUiSound(backBuf); hideModal(infoModal); }
        if (settingsModal && !settingsModal.classList.contains("hidden")) closeSettings(false);
        if (summaryModal && !summaryModal.classList.contains("hidden")) hideSummaryHandler();
      }
    });
  
    // ---------------- PNG Output ----------------
    function downloadBlob(blob, filename) {
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  
    function canvasToPngBlob(canvas) { return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png")); }
    
    function drawRoundRect(ctx, x, y, w, h, r) {
      const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  
    function getScoreSource() {
      if (summarySnapshot && summaryModal && !summaryModal.classList.contains("hidden")) return summarySnapshot;
      return snapshotFromState();
    }
  
    async function downloadScoreCardPng(playerName) {
      const name = String(playerName || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (name) try { localStorage.setItem(LS_KEY_NAME, name.slice(0, 32)); } catch {}
  
      const src = getScoreSource();
      const avgText = src.beats ? `${src.avg.toFixed(1)}/5` : "—";
      const avgMsText = src.beats ? `${Math.round(src.avgErrMs)}ms` : "—";
      const bestText = src.beats && Number.isFinite(src.bestErrMs) ? `${Math.round(src.bestErrMs)}ms` : "—";
  
      // Reconstruct simplified name for the scorecard graphic since R1, R2 etc is long.
      let printRhythm = "Rhythm";
      if (src.rhythmLabel.includes("Rhythm 1")) printRhythm = "Rhythm 1";
      if (src.rhythmLabel.includes("Rhythm 2")) printRhythm = "Rhythm 2";
      if (src.rhythmLabel.includes("Rhythm 3")) printRhythm = "Rhythm 3";
      if (src.rhythmLabel.includes("Rhythm 4")) printRhythm = "Rhythm 4";
  
      const W = 720;
      const rows = [
        ["Rhythm", printRhythm],
        ["Metronome", `${src.bpm} bpm`],
        ["Beats Played", String(src.beats)],
        ["Average Score", avgText],
        ["Avg ms Accuracy", avgMsText],
        ["Best Accuracy", bestText],
      ];
  
      const rowH = 58;
      const baseContentH = 340; 
      const H = baseContentH + (rows.length * (rowH + 14)) + 80; 
      const dpr = window.devicePixelRatio || 1;
  
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
  
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
  
      const pad = 34;
      const cardX = pad, cardY = pad, cardW = W - pad * 2, cardH = H - pad * 2;
  
      ctx.fillStyle = "#f9f9f9";
      drawRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
  
      const titleImg = await new Promise(res => { const img = new Image(); img.onload = ()=>res(img); img.onerror = ()=>res(null); img.src = "images/title.png"; });
      let yCursor = cardY + 26;
  
      if (titleImg) {
        const imgMaxW = Math.min(520, cardW - 40);
        const imgMaxH = 92;
        const r = Math.min(imgMaxW / titleImg.width, imgMaxH / titleImg.height);
        const dw = titleImg.width * r, dh = titleImg.height * r;
        ctx.drawImage(titleImg, (W - dw)/2, yCursor, dw, dh);
        yCursor += imgMaxH + 32;
      }
  
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = "800 18px Arial, Helvetica, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("www.eartraininglab.com", W / 2, yCursor);
      yCursor += 36;
  
      ctx.fillStyle = "#111";
      ctx.font = "700 26px Arial, Helvetica, sans-serif";
      ctx.fillText("Score Card", W / 2, yCursor);
      yCursor += 30;
  
      if (name) {
        ctx.font = "800 18px Arial, Helvetica, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.70)";
        ctx.fillText(`Name: ${name}`, W / 2, yCursor);
        yCursor += 22;
      } else {
        yCursor += 12;
      }
  
      ctx.textAlign = "left";
      const rowX = cardX + 26;
      const rowW = cardW - 52;
  
      for (const [k, v] of rows) {
        ctx.fillStyle = "#ffffff";
        drawRoundRect(ctx, rowX, yCursor, rowW, rowH, 14);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.16)";
        ctx.stroke();
  
        ctx.fillStyle = "rgba(0,0,0,0.70)";
        ctx.font = "900 18px Arial, Helvetica, sans-serif";
        ctx.fillText(k, rowX + 16, yCursor + 33);
  
        ctx.fillStyle = "#111";
        ctx.font = "900 22px Arial, Helvetica, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(v, rowX + rowW - 16, yCursor + 37);
        ctx.textAlign = "left";
  
        yCursor += rowH + 14;
      }
  
      ctx.textAlign = "center";
      ctx.font = "800 14px Arial, Helvetica, sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText("Keep The Beat! - www.eartraininglab.com", W / 2, cardY + cardH - 24);
  
      const fileBase = name ? `${name.replace(/\s+/g, "_")}_scorecard` : "scorecard";
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileBase}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    }
  
    // Bind the download buttons
    downloadScoreBtn?.addEventListener("click", async () => {
      await playUiSound(selectBuf);
      const prev = localStorage.getItem(LS_KEY_NAME) || "";
      const name = window.prompt("Enter your name for the score card:", prev) ?? "";
      const trimmed = String(name).trim();
      if (trimmed) localStorage.setItem(LS_KEY_NAME, trimmed);
      await downloadScoreCardPng(trimmed);
    });
  
    summaryDownload?.addEventListener("click", async () => {
      await playUiSound(selectBuf);
      // Download directly reading the input (no window.prompt!)
      const name = modalPlayerNameInput?.value || "";
      await downloadScoreCardPng(name);
    });
  
    // ---------------- Core Logic ----------------
    function resetStateToIdle() {
      started = false; paused = false;
      stopScheduler(); stopAllAudio(0.06);
  
      nextBeatTimeSec = 0; globalBeatIndex = 0; lastEvaluatedBeatIdx = -1;
      beatTimeline.length = 0; hitTimeline.length = 0;
      scoreState.beats = 0; scoreState.last = null; scoreState.totalScore = 0; scoreState.avg = 0;
      scoreState.totalAvgErrMs = 0; scoreState.avgErrMs = 0; scoreState.bestErrMs = Infinity;
  
      summarySnapshot = null;
      hasEverHit = false; lastInputTimeSec = -Infinity; trackingActive = false; trackingStartBeatIdx = -1;
  
      setScoreUI(); setFeedbackGlow(null);
      setPhase("Ready", "Press <strong>Begin Game</strong> to start.");
      setFeedback("Press <strong>Begin Game</strong> to start.");
      beatDots.forEach((d) => d.classList.remove("on"));
      
      if(pauseBtn) pauseBtn.textContent = "Pause (Space)";
      setControls(); postHeightNow();
    }
  
    async function beginGame() {
      await preloadAudio();
      await resumeAudioIfNeeded();
      const ctx = ensureAudio(); if (!ctx) return;
  
      started = true; paused = false;
      nextBeatTimeSec = ctx.currentTime + 0.10;
      globalBeatIndex = 0; lastEvaluatedBeatIdx = -1;
      beatTimeline.length = 0; hitTimeline.length = 0;
  
      scoreState.beats = 0; scoreState.last = null; scoreState.totalScore = 0; scoreState.avg = 0;
      scoreState.totalAvgErrMs = 0; scoreState.avgErrMs = 0; scoreState.bestErrMs = Infinity;
  
      summarySnapshot = null;
      hasEverHit = false; lastInputTimeSec = -Infinity; trackingActive = false; trackingStartBeatIdx = -1;
  
      setScoreUI(); setFeedbackGlow(null);
      setPhase("Starting", "Find the beat…");
      showNoRecentInput();
      setControls(); startScheduler();
    }
  
    async function restartGame() {
      stopAllAudio(0.06);
      stopScheduler();
      await beginGame();
    }
  
    async function togglePause() {
      if (!started) return;
      const ctx = ensureAudio(); if (!ctx) return;
      if (!paused) {
        paused = true; if(pauseBtn) pauseBtn.textContent = "Continue";
        setPhase("Paused", "Press <strong>Continue</strong> (or <strong>Space</strong>) to resume.");
        setFeedback("Paused."); setControls();
        try { await ctx.suspend(); } catch {}
        return;
      }
      try { await ctx.resume(); } catch {}
      paused = false; if(pauseBtn) pauseBtn.textContent = "Pause (Space)"; setControls();
    }
  
    // ---------------- Events Hookups ----------------
    function syncBpmInputs(from) {
      if(!from) return;
      const v = clamp(Number(from.value), 40, 140);
      if(bpmRange && bpmRange.value !== String(v)) bpmRange.value = String(v); 
      if(bpmNum && bpmNum.value !== String(v)) bpmNum.value = String(v);
      if(introBpmRange && introBpmRange.value !== String(v)) introBpmRange.value = String(v); 
      if(introBpmNum && introBpmNum.value !== String(v)) introBpmNum.value = String(v);
      const ctx = ensureAudio();
      if (ctx && started && !paused) {
        nextBeatTimeSec = Math.max(nextBeatTimeSec, ctx.currentTime + 0.05);
      }
    }
  
    bpmRange?.addEventListener("input", () => syncBpmInputs(bpmRange));
    bpmNum?.addEventListener("input", () => syncBpmInputs(bpmNum));
    introBpmRange?.addEventListener("input", () => syncBpmInputs(introBpmRange));
    introBpmNum?.addEventListener("input", () => syncBpmInputs(introBpmNum));
  
    beginBtn?.addEventListener("click", async () => {
      await playUiSound(selectBuf);
      if (!started) {
        await beginGame();
      } else {
        // Ends game and shows summary
        returnToIntroAfterSummary = true;
        showSummary();
        resetStateToIdle();
      }
    });
  
    pauseBtn?.addEventListener("click", togglePause);
  
    bindImmediatePad(kickBtn, "K");
    bindImmediatePad(snareBtn, "S");
  
    document.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const isTypingTarget = e.target instanceof Element && !!e.target.closest("input, textarea, select, [contenteditable='true']");
      if (e.code === "Space" && !isTypingTarget) {
        e.preventDefault(); togglePause(); return;
      }
      if (!started || paused) return;
      if (e.code === "ArrowLeft") { e.preventDefault(); registerHit("K"); return; }
      if (e.code === "ArrowRight") { e.preventDefault(); registerHit("S"); return; }
    });
  
    const savedName = localStorage.getItem(LS_KEY_NAME) || "";
    if (modalPlayerNameInput) modalPlayerNameInput.value = savedName.slice(0, 32);
  
    // Default BPM 90
    if(bpmRange) bpmRange.value = "90"; 
    if(bpmNum) bpmNum.value = "90";
    if(introBpmRange) introBpmRange.value = "90"; 
    if(introBpmNum) introBpmNum.value = "90";
    syncBpmInputs(bpmNum);
    resetStateToIdle();
  })();