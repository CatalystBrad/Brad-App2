/* Catalyst Arcade — shared audio, haptics & settings engine */
(function () {
  var KEY_MUTE = "catalyst_muted";
  var ctx = null, master = null, musicGain = null, seqTimer = null, seqStep = 0;
  var muted = localStorage.getItem(KEY_MUTE) === "1";
  var musicName = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function resume() { if (ensure() && ctx.state === "suspended") ctx.resume(); }
  function now() { return ctx ? ctx.currentTime : 0; }

  function tone(o) {
    if (!ensure() || muted) return;
    resume();
    var osc = ctx.createOscillator(), g = ctx.createGain(), t = now();
    osc.type = o.type || "square";
    var dur = o.dur || 0.15;
    osc.frequency.setValueAtTime(o.f0 || 440, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + dur);
    var vol = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function noise(o) {
    if (!ensure() || muted) return;
    resume();
    var dur = o.dur || 0.1;
    var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.freq || 400;
    var g = ctx.createGain(); g.gain.value = o.vol == null ? 0.15 : o.vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }
  function chime(freqs, step, type) {
    if (!ensure() || muted) return;
    freqs.forEach(function (f, i) {
      setTimeout(function () { tone({ type: type || "sine", f0: f, dur: 0.28, vol: 0.22 }); }, i * step * 1000);
    });
  }
  function haptic(p) { try { if (!muted && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  var SFX = {
    rotate: function () { tone({ type: "square", f0: 520, f1: 360, dur: 0.08, vol: 0.16 }); haptic(8); },
    undo:   function () { tone({ type: "square", f0: 300, f1: 460, dur: 0.08, vol: 0.14 }); },
    hint:   function () { tone({ type: "sine", f0: 880, dur: 0.12, vol: 0.16 }); haptic(6); },
    win:    function () { chime([523, 659, 784, 1047, 1319], 0.1); haptic([20, 40, 30]); },
    jump:   function () { tone({ type: "square", f0: 320, f1: 640, dur: 0.15, vol: 0.18 }); haptic(10); },
    land:   function () { noise({ dur: 0.08, vol: 0.12, freq: 320 }); },
    step:   function () { noise({ dur: 0.03, vol: 0.04, freq: 900 }); },
    capture:function () { tone({ type: "triangle", f0: 720, f1: 1250, dur: 0.12, vol: 0.24 }); tone({ type: "square", f0: 1000, f1: 1600, dur: 0.1, vol: 0.1 }); haptic(15); },
    combo:  function (n) { tone({ type: "triangle", f0: 600 + n * 90, dur: 0.12, vol: 0.2 }); },
    levelup:function () { chime([392, 523, 659, 784, 1047], 0.09, "triangle"); haptic([10, 30, 10, 30]); },
    select: function () { tone({ type: "sine", f0: 660, dur: 0.08, vol: 0.14 }); haptic(6); },
    fail:   function () { tone({ type: "sawtooth", f0: 200, f1: 120, dur: 0.25, vol: 0.18 }); }
  };

  var PATTERNS = {
    calm: { bpm: 84, notes: [[262],[330],[392],[330],[294],[349],[440],[349]] },
    chase:{ bpm: 124, notes: [[131,262],null,[196],null,[165,330],null,[196],null,[147,294],null,[220],null,[165,330],null,[247],null] }
  };
  function musicNote(f, dur) {
    if (!ensure()) return;
    var o = ctx.createOscillator(), g = ctx.createGain(), t = now();
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + dur);
  }
  function startMusic(name) {
    if (!ensure()) return;
    resume();
    if (musicName === name && seqTimer) return;
    stopMusic();
    musicName = name;
    var pat = PATTERNS[name]; if (!pat) return;
    musicGain.gain.cancelScheduledValues(now());
    musicGain.gain.linearRampToValueAtTime(muted ? 0 : 0.1, now() + 0.6);
    var stepDur = 60 / pat.bpm / 2;
    seqStep = 0;
    seqTimer = setInterval(function () {
      if (!muted) {
        var ns = pat.notes[seqStep % pat.notes.length];
        if (ns) ns.forEach(function (f) { musicNote(f, stepDur); });
      }
      seqStep++;
    }, stepDur * 1000);
  }
  function stopMusic() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    if (musicGain) { try { musicGain.gain.linearRampToValueAtTime(0, now() + 0.3); } catch (e) {} }
    musicName = null;
  }

  function setMuted(m) {
    muted = m;
    localStorage.setItem(KEY_MUTE, m ? "1" : "0");
    if (master) master.gain.value = m ? 0 : 0.85;
    if (musicGain) musicGain.gain.value = m ? 0 : (seqTimer ? 0.1 : 0);
    document.querySelectorAll("[data-mute]").forEach(function (b) { b.textContent = m ? "🔇" : "🔊"; });
  }
  function bindMute(el) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    el.setAttribute("data-mute", "1");
    el.textContent = muted ? "🔇" : "🔊";
    el.addEventListener("click", function () { resume(); setMuted(!muted); if (!muted) SFX.select(); });
  }

  // Resume the audio context on the first user gesture (autoplay policies).
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, resume, { once: true, passive: true });
  });

  // Register the service worker for installable / offline support (best-effort).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  // ---- Catalyst brand (matched to catalystservicesuk.com) ----
  var BRAND = { purple: "#7C3AED", magenta: "#E0218A", deep: "#2A1745", orange: "#F5821F", teal: "#29B6A8", navy: "#160d28" };
  // Vibrant multi-colour pinwheel mark (the four-segment Catalyst icon).
  var MARK = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
    '<g transform="translate(50,50)">' +
      '<g transform="rotate(45)"><rect x="-8" y="-46" width="16" height="40" rx="8" fill="#E0218A"/></g>' +
      '<g transform="rotate(135)"><rect x="-8" y="-46" width="16" height="40" rx="8" fill="#F5821F"/></g>' +
      '<g transform="rotate(225)"><rect x="-8" y="-46" width="16" height="40" rx="8" fill="#29B6A8"/></g>' +
      '<g transform="rotate(315)"><rect x="-8" y="-46" width="16" height="40" rx="8" fill="#7C3AED"/></g>' +
    '</g></svg>';

  // Builds a brand lockup (colour mark + wordmark) into a container element.
  function mountBrand(el, opts) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    opts = opts || {};
    var size = opts.size || 32, fs = opts.fontSize || 16;
    var sub = opts.sub == null ? "SERVICES UK" : opts.sub;
    el.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:9px">' +
        '<span style="width:' + size + 'px;height:' + size + 'px;display:inline-block;filter:drop-shadow(0 4px 10px rgba(124,58,237,.45))">' + MARK + '</span>' +
        '<span style="font-weight:900;letter-spacing:.4px;font-size:' + fs + 'px;line-height:1.02;color:#fff">Catalyst' +
          (sub ? '<span style="display:block;font-weight:600;font-size:' + Math.max(8, fs*0.55) + 'px;letter-spacing:2.6px;color:#b6a6d6;margin-top:1px">' + sub + '</span>' : '') +
        '</span>' +
      '</span>';
  }

  window.Arcade = {
    sfx: SFX, haptic: haptic, resume: resume,
    startMusic: startMusic, stopMusic: stopMusic,
    bindMute: bindMute, setMuted: setMuted,
    isMuted: function () { return muted; },
    BRAND: BRAND, MARK: MARK, mountBrand: mountBrand
  };
})();
