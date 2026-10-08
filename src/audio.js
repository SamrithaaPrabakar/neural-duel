// Tiny synthesized SFX engine — plain WebAudio, no sound files.
// Everything is an oscillator or filtered noise burst with a short envelope.

let actx = null;
let master = null;
let muted = false;

function ctx() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = 0.5;
    master.connect(actx.destination);
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.5;
}
export function isMuted() { return muted; }

function tone({ freq = 440, duration = 0.12, type = "square", volume = 0.25, slideTo = null, delay = 0 }) {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  const t0 = c.currentTime + delay;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noiseBurst({ duration = 0.15, volume = 0.3, filterFreq = 1200, filterType = "bandpass", delay = 0 }) {
  const c = ctx();
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const gain = c.createGain();
  const t0 = c.currentTime + delay;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

export const sfx = {
  unlock() { ctx(); },

  swingLight() { tone({ freq: 1200, slideTo: 500, duration: 0.09, type: "triangle", volume: 0.18 }); },
  swingHeavy() { tone({ freq: 700, slideTo: 200, duration: 0.22, type: "sawtooth", volume: 0.2 }); },

  hitLight() {
    noiseBurst({ duration: 0.1, volume: 0.35, filterFreq: 1800 });
    tone({ freq: 180, duration: 0.12, type: "square", volume: 0.2 });
  },
  hitHeavy() {
    noiseBurst({ duration: 0.18, volume: 0.4, filterFreq: 900 });
    tone({ freq: 90, duration: 0.22, type: "square", volume: 0.3 });
  },
  block() {
    tone({ freq: 2200, duration: 0.08, type: "square", volume: 0.2 });
    noiseBurst({ duration: 0.06, volume: 0.15, filterFreq: 3000 });
  },
  parry() {
    tone({ freq: 1800, slideTo: 2600, duration: 0.14, type: "square", volume: 0.3 });
    tone({ freq: 2600, duration: 0.1, type: "square", volume: 0.2, delay: 0.05 });
  },
  dash() { tone({ freq: 300, slideTo: 900, duration: 0.14, type: "sine", volume: 0.15 }); },

  special() {
    tone({ freq: 220, slideTo: 1400, duration: 0.45, type: "sawtooth", volume: 0.25 });
    noiseBurst({ duration: 0.4, volume: 0.25, filterFreq: 2000 });
  },
  meterFull() { tone({ freq: 900, duration: 0.08, type: "square", volume: 0.2 }); tone({ freq: 1200, duration: 0.1, type: "square", volume: 0.2, delay: 0.08 }); },

  roundWin() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.14, type: "square", volume: 0.22, delay: i * 0.09 }));
  },
  roundLose() {
    [400, 320, 250, 180].forEach((f, i) => tone({ freq: f, duration: 0.18, type: "sawtooth", volume: 0.2, delay: i * 0.1 }));
  },

  menuClick() { tone({ freq: 700, duration: 0.05, type: "square", volume: 0.15 }); },
  menuConfirm() { tone({ freq: 700, slideTo: 1100, duration: 0.1, type: "square", volume: 0.2 }); },
};
