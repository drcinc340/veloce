/**
 * VELOCE Kids — WebAudio Cartoon Sound Effects & Rainbow Confetti Engine
 * Zero external audio assets required; unlocks cleanly on first iOS/Android tap.
 */
(function (global) {
  let audioCtx = null;

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Unlock audio context automatically on first user gesture (crucial on iOS Safari)
  ['pointerdown', 'touchstart', 'click'].forEach(evt => {
    global.addEventListener(evt, () => { ensureCtx(); }, { once: true, passive: true });
  });

  function playTone({ freq = 440, endFreq = null, type = 'sine', duration = 0.14, gainVal = 0.14, delay = 0 } = {}) {
    const ctx = ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainVal, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playNoise({ duration = 0.18, gainVal = 0.12, highpass = 800, lowpass = 5000, delay = 0 } = {}) {
    const ctx = ensureCtx();
    if (!ctx) return;
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;

    const gain = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
  }

  const KidsSFX = {
    unlock: ensureCtx,
    pop() {
      playTone({ freq: 520, endFreq: 180, type: 'sine', duration: 0.085, gainVal: 0.22 });
      playTone({ freq: 760, endFreq: 1120, type: 'triangle', duration: 0.06, gainVal: 0.12, delay: 0.03 });
    },
    boing() {
      playTone({ freq: 210, endFreq: 640, type: 'sine', duration: 0.22, gainVal: 0.18 });
      playTone({ freq: 420, endFreq: 320, type: 'triangle', duration: 0.14, gainVal: 0.1, delay: 0.16 });
    },
    coin() {
      playTone({ freq: 988, type: 'sine', duration: 0.09, gainVal: 0.16, delay: 0 });
      playTone({ freq: 1319, type: 'sine', duration: 0.24, gainVal: 0.16, delay: 0.075 });
    },
    sparkle() {
      [587, 740, 880, 1175, 1480].forEach((f, i) => {
        playTone({ freq: f, type: 'triangle', duration: 0.12, gainVal: 0.1, delay: i * 0.045 });
      });
    },
    sizzle() {
      playNoise({ duration: 0.42, gainVal: 0.12, highpass: 2400, lowpass: 8000 });
      playTone({ freq: 330, endFreq: 660, type: 'sine', duration: 0.18, gainVal: 0.08, delay: 0.05 });
    },
    roar() {
      playTone({ freq: 145, endFreq: 68, type: 'sawtooth', duration: 0.42, gainVal: 0.16 });
      playTone({ freq: 112, endFreq: 55, type: 'triangle', duration: 0.45, gainVal: 0.14, delay: 0.05 });
      playNoise({ duration: 0.35, gainVal: 0.1, highpass: 180, lowpass: 1100, delay: 0.04 });
    },
    splash() {
      playNoise({ duration: 0.32, gainVal: 0.14, highpass: 650, lowpass: 3800 });
      playTone({ freq: 480, endFreq: 260, type: 'sine', duration: 0.15, gainVal: 0.1 });
    },
    horn() {
      playTone({ freq: 293, type: 'sawtooth', duration: 0.16, gainVal: 0.12, delay: 0 });
      playTone({ freq: 392, type: 'sawtooth', duration: 0.28, gainVal: 0.13, delay: 0.12 });
    },
    fanfare() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => {
        playTone({ freq: f, type: 'triangle', duration: i === 3 ? 0.36 : 0.12, gainVal: 0.16, delay: i * 0.095 });
      });
    },
    gentleNudge() {
      playTone({ freq: 392, endFreq: 330, type: 'sine', duration: 0.15, gainVal: 0.11, delay: 0 });
      playTone({ freq: 330, endFreq: 392, type: 'sine', duration: 0.16, gainVal: 0.1, delay: 0.14 });
    },
    applause() {
      [0, 0.07, 0.14, 0.22, 0.3].forEach(d => {
        playNoise({ duration: 0.08, gainVal: 0.09, highpass: 1200, lowpass: 4500, delay: d });
      });
      playTone({ freq: 784, type: 'triangle', duration: 0.14, gainVal: 0.11, delay: 0.06 });
      playTone({ freq: 1046, type: 'triangle', duration: 0.25, gainVal: 0.13, delay: 0.18 });
    },
    rocket() {
      playNoise({ duration: 0.52, gainVal: 0.13, highpass: 250, lowpass: 3500 });
      playTone({ freq: 180, endFreq: 880, type: 'sawtooth', duration: 0.5, gainVal: 0.11 });
    },
    playByName(name) {
      if (name && typeof this[name] === 'function') this[name]();
      else this.sparkle();
    }
  };

  function launchConfetti(count = 28) {
    let layer = document.getElementById('kidsConfettiLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'kidsConfettiLayer';
      layer.className = 'confetti-layer';
      document.body.appendChild(layer);
    }
    const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c', '#ec4899'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      const x = 10 + Math.random() * 80;
      const dx = (Math.random() - 0.5) * 260;
      const rot = Math.round((Math.random() - 0.5) * 720);
      const size = 8 + Math.random() * 8;
      piece.style.left = `${x}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.width = `${size}px`;
      piece.style.height = `${size * (Math.random() > 0.5 ? 1.5 : 0.9)}px`;
      piece.style.setProperty('--dx', `${dx}px`);
      piece.style.setProperty('--rot', `${rot}deg`);
      piece.style.animationDelay = `${Math.random() * 0.18}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 1450);
    }
  }

  global.KidsSFX = KidsSFX;
  global.launchKidsConfetti = launchConfetti;
})(window);
