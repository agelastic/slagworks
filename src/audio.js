// Sound effects and music, all synthesised at run time.
//
// Sample data is computed in plain JS into Float32Arrays (no audio files, no AudioContext needed),
// wrapped in AudioBuffers on first use and played through a small Web Audio graph:
//
//   sfx voice: buffer -> gain (-> stereo pan) -> sfx bus  --\
//   music:     hits + drone loop -> track gain -> music bus --> compressor -> soft clip -> out
//
//   const audio = createAudio()          // no AudioContext yet
//   audio.unlock()                       // call inside a user gesture; safe to call repeatedly
//   audio.setListener(x, y, yaw); audio.play('rivet_fire'); audio.play('door_open', { x, y })
//   audio.setMusic(0..3 | null); audio.setSfxVolume(0..1); audio.setMusicVolume(0..1)
//   audio.suspend(); audio.resume()      // full stop of the audio clock (use for hidden pages)

import { SOUND_IDS, MUSIC_TRACK_COUNT, DEFAULT_SETTINGS } from './config.js';
import { createRng } from './core/rng.js';

// ---------------------------------------------------------------- synthesis toolkit

const TAU = Math.PI * 2;
let sr = 44100;   // rate the generators render at (the drone loops switch it to 22050)
let seed = 1;

// White noise in [-1, 1), deterministic per sound.
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed | 0) / 2147483648;
}
const rnd01 = () => rnd() * 0.5 + 0.5;
const val = (v, x) => (typeof v === 'function' ? v(x) : v);

// Wave shapes take the phase in cycles.
const sin = (p) => Math.sin(TAU * p);
const saw = (p) => 2 * (p - Math.floor(p + 0.5));
const sqr = (p) => (p - Math.floor(p) < 0.5 ? 1 : -1);
const tri = (p) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1;

// Generators are closures called once per sample with the time in seconds.
// freq and index may be numbers or functions of time.
function osc(freq, wave = sin) {
  let p = 0;
  return (t) => {
    p += val(freq, t) / sr;
    return wave(p);
  };
}

function fm(freq, ratio, index) {
  let pc = 0;
  let pm = 0;
  return (t) => {
    const f = val(freq, t);
    pc += f / sr;
    pm += (f * ratio) / sr;
    return Math.sin(TAU * pc + val(index, t) * Math.sin(TAU * pm));
  };
}

// State variable filter. mode 0 low-pass, 1 band-pass (unity peak gain), 2 high-pass.
function svf(mode, freq, q) {
  const k = 1 / q;
  const dyn = typeof freq === 'function';
  let a1 = 0, a2 = 0, a3 = 0, s1 = 0, s2 = 0, n = 0;
  const tune = (f) => {
    const g = Math.tan((Math.PI * Math.min(Math.max(f, 15), sr * 0.45)) / sr);
    a1 = 1 / (1 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  };
  if (!dyn) tune(freq);
  return (x, t) => {
    if (dyn && (n++ & 15) === 0) tune(freq(t));
    const v3 = x - s2;
    const v1 = a1 * s1 + a2 * v3;
    const v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1;
    s2 = 2 * v2 - s2;
    return mode === 0 ? v2 : mode === 1 ? k * v1 : x - k * v1 - v2;
  };
}
const lp = (f, q = 0.707) => svf(0, f, q);
const bp = (f, q = 1) => svf(1, f, q);
const hp = (f, q = 0.707) => svf(2, f, q);

// Envelopes and sweeps.
const dec = (t, tau) => Math.exp(-t / tau);
const ar = (t, a, tau) => (t < a ? t / a : Math.exp(-(t - a) / tau));
const gate = (t, len, a = 0.003, r = 0.01) => (t < a ? t / a : t < len ? 1 : Math.max(0, 1 - (t - len) / r));
const hump = (t, len) => (t < len ? Math.sin((Math.PI * t) / len) : 0);
const xp = (a, b, d) => (t) => a * Math.pow(b / a, t < d ? t / d : 1);

const buf = (dur) => new Float32Array(Math.ceil(dur * sr));

function render(dur, fn) {
  const out = buf(dur);
  for (let i = 0; i < out.length; i++) out[i] = fn(i / sr);
  return out;
}

function add(out, src, at = 0, gain = 1) {
  const o = Math.round(at * sr);
  const n = Math.min(src.length, out.length - o);
  for (let i = 0; i < n; i++) out[o + i] += src[i] * gain;
  return out;
}

// Mixes pieces [samples, startSeconds, gain] into a new buffer.
function mix(dur, pieces) {
  const out = buf(dur);
  for (const [src, at = 0, gain = 1] of pieces) add(out, src, at, gain);
  return out;
}

// Small baked reverb: four damped combs into two allpasses. Short sizes ring like a steel tank.
function room(x, wet, size = 1, decay = 0.75) {
  const acc = new Float32Array(x.length);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const line = new Float32Array(Math.round((ms * size * sr) / 1000));
    let p = 0;
    let damp = 0;
    for (let i = 0; i < x.length; i++) {
      const y = line[p];
      damp += (y - damp) * 0.5;
      line[p] = x[i] + damp * decay;
      acc[i] += y;
      if (++p === line.length) p = 0;
    }
  }
  for (const ms of [5, 1.7]) {
    const line = new Float32Array(Math.round((ms * sr) / 1000));
    let p = 0;
    for (let i = 0; i < x.length; i++) {
      const z = line[p];
      const w = acc[i] + 0.7 * z;
      line[p] = w;
      acc[i] = z - 0.7 * w;
      if (++p === line.length) p = 0;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += acc[i] * wet * 0.3;
  return x;
}

// Normalise to the given peak, optionally through a tanh drive, and fade the last few ms.
function finish(x, level, drive = 0) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const k = peak > 0 ? 1 / peak : 0;
  const norm = drive ? level / Math.tanh(drive) : level;
  for (let i = 0; i < x.length; i++) x[i] = (drive ? Math.tanh(x[i] * k * drive) : x[i] * k) * norm;
  const fade = Math.min(x.length, Math.round(0.008 * sr));
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  return x;
}

// ---------------------------------------------------------------- shared voices

// Mechanical click: band of noise plus a short metallic tick.
function clack(f, q = 2) {
  const b = bp(f, q);
  const o = fm(f * 0.45, 3.3, (t) => 4 * dec(t, 0.01));
  return render(0.08, (t) => b(rnd()) * dec(t, 0.012) * 2.5 + o(t) * dec(t, 0.02) * 0.6);
}

// Struck metal: inharmonic partials with their own decays plus a noise tick.
function clang(f, len, ratios = [1, 1.52, 2.76, 3.41, 5.4, 6.83]) {
  const parts = ratios.map((r, i) => [osc(f * r), 1 / (1 + i * 0.6), len / (1 + i * 0.7)]);
  const tick = hp(2500);
  return render(len * 4, (t) => {
    let v = tick(rnd()) * dec(t, 0.004) * 0.8;
    for (const [o, a, d] of parts) v += o() * a * dec(t, d);
    return v;
  });
}

// Low body hit.
function thud(f0, f1, len) {
  const o = osc(xp(f0, f1, len * 0.7));
  const l = lp(f0 * 3);
  return render(len * 5, (t) => o(t) * dec(t, len) + l(rnd()) * dec(t, len * 0.4) * 2);
}

function blip(f, len, wave = tri) {
  const o = osc(f, wave);
  const h = osc((t) => val(f, t) * 2);
  return render(len * 5, (t) => (o(t) + h(t) * 0.25) * ar(t, 0.004, len));
}

function bell(f, len) {
  const o = fm(f, 3.51, (t) => 2.2 * dec(t, len * 0.5));
  const u = osc(f * 2);
  return render(len * 5, (t) => (o(t) + u() * 0.25) * ar(t, 0.002, len));
}

// Detuned saw stab through a closing filter.
function stab(f, len, cut = 2200) {
  const a = osc(f, saw);
  const b = osc(f * 1.006, saw);
  const c = osc(f * 0.5, sqr);
  const l = lp(xp(cut, cut * 0.25, len), 1.6);
  return render(len * 4, (t) => l(a() + b() + c() * 0.5, t) * ar(t, 0.005, len));
}

function steam(dur, f, a, tau, flutter = 0) {
  const h = hp(f, 0.9);
  let fl = 1;
  return render(dur, (t) => {
    if (flutter && rnd01() < 0.012) fl = 1 - flutter * rnd01();
    return h(rnd()) * ar(t, a, tau) * fl;
  });
}

// Liquid: a stream of short rising sine blips. rate, fLo and fHi may be functions of progress 0..1.
function bubbles(dur, rate, fLo, fHi) {
  const out = buf(dur);
  for (let t = 0; t < dur - 0.06;) {
    const p = t / dur;
    const lo = val(fLo, p);
    const f = lo * Math.pow(val(fHi, p) / lo, rnd01());
    const len = 0.018 + 0.03 * rnd01();
    const o = osc(xp(f, f * 1.7, len));
    add(out, render(len, (u) => o(u) * Math.sin((Math.PI * u) / len)), t, 0.4 + 0.6 * rnd01());
    t += (0.3 + 1.4 * rnd01()) / val(rate, p);
  }
  return out;
}

// Explosion: crack, pitched boom, low rumble and a decaying crackle of debris.
function blast(dur, size = 1) {
  const boom = osc(xp(88 / size, 26, 0.5 * size));
  const boom2 = osc(xp(54 / size, 21, 0.6 * size));
  const rum = lp(xp(520, 70, 0.8 * size), 0.9);
  const mid = bp(xp(1100, 260, 0.35 * size), 0.8);
  const deb = hp(2400);
  let c = 0;
  return render(dur, (t) => {
    const n = rnd();
    if (rnd01() < 0.006 * dec(t, 0.45 * size)) c = rnd();
    c *= 0.86;
    return n * dec(t, 0.005)
      + (boom(t) + 0.7 * boom2(t)) * ar(t, 0.004, 0.4 * size) * 1.1
      + rum(n, t) * ar(t, 0.008, 0.45 * size) * 5
      + mid(n, t) * dec(t, 0.13 * size) * 1.8
      + deb(c) * 1.3;
  });
}

// Heavy motor running for `run` seconds, pitch from f0 to f1, with gear rattle and rumble.
function motor(dur, run, f0, f1) {
  const a = osc(xp(f0, f1, run), saw);
  const b = osc(xp(f0 * 1.51, f1 * 1.51, run), sqr);
  const l = lp(xp(f0 * 6, f1 * 8, run), 2);
  const rattle = osc(27, (p) => (p - Math.floor(p) < 0.3 ? 1 : 0.4));
  const rum = lp(190);
  return render(dur, (t) => (l((a(t) + 0.5 * b(t)) * rattle(), t) * 0.9 + rum(rnd()) * 2.2) * gate(t, run, 0.05, 0.08));
}

function door(opening) {
  const out = mix(0.98, [
    [motor(0.8, 0.62, opening ? 52 : 86, opening ? 88 : 50)],
    [thud(opening ? 120 : 92, opening ? 55 : 36, opening ? 0.05 : 0.09), 0.63, opening ? 1.1 : 1.7],
    [clang(opening ? 310 : 205, opening ? 0.08 : 0.14), 0.63, opening ? 0.3 : 0.5],
    opening ? [steam(0.4, 4500, 0.015, 0.1), 0, 0.4] : [steam(0.3, 3800, 0.01, 0.07), 0.65, 0.3],
  ]);
  return room(out, 0.25, 0.7, 0.6);
}

// Scrapper voice: short FM chirp with a scratch of noise.
function chirp(f0, f1, len, index = 2.5) {
  const o = fm(xp(f0, f1, len), 1.41, index);
  const s = bp(f0 * 1.3, 3);
  return render(len + 0.012, (t) => (o(t) + s(rnd()) * 0.6) * gate(t, len, 0.002, 0.01));
}

// Gunner voice: ring-modulated saw through two formants, hard gated.
function bark(f0, f1, len, formant) {
  const o = osc(xp(f0, f1, len), saw);
  const ring = osc(f0 * 0.37, sqr);
  const a = bp(formant, 3);
  const b = bp(formant * 2.3, 4);
  return render(len + 0.03, (t) => {
    const x = o(t) * (0.6 + 0.4 * ring());
    return Math.tanh((a(x) * 1.5 + b(x) * 0.8 + x * 0.15) * 3) * gate(t, len, 0.003, 0.012);
  });
}

// Hauler voice: detuned saws with a rough 23 Hz shudder, a sub and a metal creak on top.
function groan(dur, f, env) {
  const a = osc(f, saw);
  const b = osc((t) => f(t) * 1.012, saw);
  const sub = osc((t) => f(t) * 0.5);
  const rough = osc(23);
  const l = lp((t) => 260 + 520 * env(t), 2.5);
  const creak = fm((t) => f(t) * 9.3, 1.37, 3);
  return render(dur, (t) => {
    const e = env(t);
    const x = (a(t) + b(t)) * (0.65 + 0.35 * rough());
    return (Math.tanh(l(x, t) * 2) * 0.8 + sub(t) * 0.6 + creak(t) * 0.08 * e) * e;
  });
}

// Overseer voice: stack of detuned saws (root, fifth, octave) over a sub, filtered and driven.
function horn(dur, f, env, cut) {
  const os = [1, 1.007, 0.9931, 1.4983, 2.011].map((r) => osc((t) => f(t) * r, saw));
  const sub = osc((t) => f(t) * 0.5);
  const l = lp(cut, 1.8);
  const trem = osc(5.3);
  return render(dur, (t) => {
    let x = 0;
    for (const o of os) x += o(t);
    return (Math.tanh(l(x * 0.25, t) * 2.5) + sub(t) * 0.5) * env(t) * (0.88 + 0.12 * trem());
  });
}

// Bolt projectile zap: ring-modulated falling saw.
function zap(f0, f1, len, ringHz) {
  const o = osc(xp(f0, f1, len), saw);
  const r = osc(ringHz);
  const b = bp(xp(f0, f1 * 2, len), 0.8);
  const h = hp(3000);
  return render(len * 2.2, (t) => b(o(t) * (0.5 + 0.5 * r()), t) * ar(t, 0.002, len * 0.55) * 1.5 + h(rnd()) * dec(t, 0.004) * 0.6);
}

// Player voice: saw through three formants.
function grunt(dur, f0, f1, tau) {
  const sweep = xp(f0, f1, dur * 0.7);
  let j = 0;
  const o = osc((t) => {
    j += (rnd() * 0.08 - j) * 0.01;
    return sweep(t) * (1 + j);
  }, saw);
  const a = bp(xp(760, 520, dur), 5);
  const b = bp(xp(1250, 900, dur), 6);
  const c = bp(2500, 6);
  return render(dur, (t) => {
    const x = o(t) + rnd() * 0.25;
    return Math.tanh((a(x, t) * 2 + b(x, t) * 1.4 + c(x) * 0.5) * 2) * ar(t, 0.012, tau);
  });
}

// ---------------------------------------------------------------- sound effects

// id -> [peak level, drive, random pitch spread per play, builder]
const SFX = {
  wrench_swing: [0.3, 0, 0.1, () => {
    const b = bp((t) => 450 + 1500 * hump(t, 0.24), 1.6);
    const b2 = bp(xp(2400, 5200, 0.22), 2);
    return render(0.26, (t) => {
      const n = rnd();
      return (b(n, t) + 0.35 * b2(n, t)) * hump(t, 0.25) ** 1.5;
    });
  }],

  wrench_hit: [0.6, 1.5, 0.08, () => room(mix(0.55, [
    [thud(190, 70, 0.05), 0, 1.2],
    [clang(560, 0.13), 0, 0.7],
  ]), 0.2, 0.5, 0.55)],

  rivet_fire: [0.6, 1.6, 0.05, () => {
    const crack = hp(1800);
    const body = osc(xp(340, 80, 0.07));
    const ping = fm(1450, 2.76, (t) => 3 * dec(t, 0.02));
    const air = bp(2600, 1.2);
    const low = lp(900);
    return render(0.34, (t) => {
      const n = rnd();
      return crack(n) * dec(t, 0.012) * 1.1
        + low(n) * dec(t, 0.03) * 2
        + body(t) * dec(t, 0.05) * 0.9
        + ping(t) * dec(t, 0.035) * 0.25
        + air(n) * ar(t, 0.01, 0.07) * 0.5;
    });
  }],

  scatter_fire: [0.95, 2.6, 0.04, () => {
    const sub = osc(xp(150, 36, 0.14));
    const mid = osc(xp(260, 55, 0.1), saw);
    const body = lp(xp(5200, 320, 0.25), 0.8);
    const tail = lp(750);
    return room(render(1.05, (t) => {
      const n = rnd();
      return n * dec(t, 0.008) * 0.9
        + body(n, t) * dec(t, 0.09) * 2.2
        + sub(t) * dec(t, 0.13) * 1.1
        + mid(t) * dec(t, 0.05) * 0.45
        + tail(n) * ar(t, 0.02, 0.2) * 1.6;
    }), 0.3, 1.2, 0.7);
  }],

  scatter_pump: [0.34, 0, 0.04, () => {
    const s = bp(xp(700, 1500, 0.13), 3);
    return mix(0.4, [
      [clack(1900), 0, 0.9],
      [render(0.14, (t) => s(rnd(), t) * hump(t, 0.14)), 0.03, 1.2],
      [clack(1300), 0.17, 1],
      [thud(160, 90, 0.02), 0.17, 0.5],
    ]);
  }],

  bolt_fire: [0.5, 1.4, 0.06, () => {
    const tick = hp(3500);
    const snap = osc(xp(1100, 260, 0.03), sqr);
    const body = osc(xp(240, 90, 0.04));
    const ping = fm(2300, 1.41, 2);
    return render(0.12, (t) => tick(rnd()) * dec(t, 0.006) * 1.1
      + snap(t) * dec(t, 0.014) * 0.35
      + body(t) * dec(t, 0.025) * 0.8
      + ping(t) * dec(t, 0.012) * 0.2);
  }],

  launcher_fire: [0.75, 1.6, 0.04, () => {
    const thump = osc(xp(125, 42, 0.12));
    const tube = osc(xp(175, 105, 0.08));
    const low = lp(600);
    const whoosh = bp(xp(350, 2600, 0.32), 1.4);
    const jet = hp(4200);
    return render(0.8, (t) => {
      const n = rnd();
      return thump(t) * dec(t, 0.1) * 1.2
        + tube(t) * dec(t, 0.05) * 0.5
        + low(n) * dec(t, 0.04) * 3
        + whoosh(n, t) * ar(t, 0.06, 0.2) * 1.6
        + jet(n) * ar(t, 0.1, 0.22) * 0.16;
    });
  }],

  explode: [1, 2.2, 0.08, () => room(blast(1.9), 0.35, 1.4, 0.72)],

  dry_fire: [0.26, 0, 0.04, () => mix(0.1, [[clack(1500, 3), 0, 1], [clack(2100, 3), 0.035, 0.5]])],

  weapon_switch: [0.32, 0, 0.04, () => {
    const o = osc(xp(180, 520, 0.09), saw);
    const l = lp(1500);
    return mix(0.26, [
      [render(0.11, (t) => l(o(t)) * hump(t, 0.1)), 0, 0.35],
      [clack(1100), 0.11, 1],
      [thud(140, 80, 0.02), 0.11, 0.5],
    ]);
  }],

  ricochet: [0.26, 0, 0.3, () => {
    const f = (t) => (2500 * Math.exp(-t * 7) + 850) * (1 + 0.035 * Math.sin(TAU * 41 * t));
    const o = osc(f);
    const o2 = osc((t) => f(t) * 2.41);
    const spark = hp(5000);
    return render(0.42, (t) => (o(t) + o2(t) * 0.3) * ar(t, 0.003, 0.1) + spark(rnd()) * dec(t, 0.004));
  }],

  door_open: [0.5, 1.2, 0.03, () => door(true)],
  door_close: [0.55, 1.2, 0.03, () => door(false)],

  lift_move: [0.42, 1.2, 0.03, () => {
    const chain = bp(2100, 4);
    const out = motor(1.32, 1.14, 46, 49);
    const ticks = render(1.32, (t) => chain(rnd()) * Math.exp(-((t * 13) % 1) * 9) * gate(t, 1.14, 0.08, 0.14));
    return room(mix(1.32, [[out], [ticks, 0, 1.4], [thud(120, 60, 0.03), 0, 0.8]]), 0.2, 0.7, 0.6);
  }],

  lift_stop: [0.55, 1.4, 0.04, () => room(mix(0.6, [
    [thud(110, 45, 0.07), 0, 1.3],
    [clang(260, 0.12), 0, 0.5],
    [steam(0.4, 3500, 0.01, 0.09), 0.03, 0.35],
  ]), 0.25, 0.8, 0.6)],

  switch: [0.4, 0, 0, () => mix(0.32, [
    [clack(1700), 0, 1],
    [thud(200, 120, 0.015), 0, 0.5],
    [blip(620, 0.03, sqr), 0.05, 0.22],
    [blip(930, 0.045, sqr), 0.12, 0.22],
  ])],

  locked: [0.4, 1.5, 0, () => {
    const a = osc(98, saw);
    const b = osc(147, sqr);
    const l = lp(1400);
    const buzz = render(0.25, (t) => l(a() + b() * 0.6) * (gate(t, 0.08, 0.003, 0.01) + (t > 0.13 ? gate(t - 0.13, 0.09, 0.003, 0.01) : 0)));
    return mix(0.3, [[buzz], [clack(900), 0, 0.5]]);
  }],

  secret: [0.42, 0, 0, () => room(mix(1.3, [
    [bell(587.33, 0.14), 0, 1],
    [bell(880, 0.14), 0.09, 0.9],
    [bell(1046.5, 0.14), 0.18, 0.8],
    [bell(1318.5, 0.3), 0.27, 0.8],
    [blip(293.66, 0.3, sin), 0.27, 0.5],
  ]), 0.4, 1.5, 0.75)],

  pickup_item: [0.3, 0, 0, () => mix(0.2, [[blip(880, 0.025), 0, 1], [blip(1320, 0.03), 0.055, 1]])],

  pickup_ammo: [0.34, 0, 0, () => mix(0.22, [
    [clang(1900, 0.02), 0, 0.5],
    [blip(523.25, 0.022), 0, 1],
    [blip(659.25, 0.03), 0.05, 1],
  ])],

  pickup_weapon: [0.45, 1.3, 0, () => mix(0.6, [
    [clack(1200), 0, 0.9],
    [thud(150, 80, 0.025), 0, 0.7],
    [stab(196, 0.12), 0.05, 0.5],
    [blip(392, 0.03, sqr), 0.07, 0.25],
    [blip(523.25, 0.03, sqr), 0.14, 0.25],
    [blip(784, 0.07, sqr), 0.21, 0.3],
  ])],

  pickup_key: [0.36, 0, 0, () => mix(0.7, [
    [bell(1568, 0.07), 0, 1],
    [bell(2093, 0.07), 0.08, 1],
    [bell(3136, 0.12), 0.16, 1],
  ])],

  pickup_health: [0.36, 0, 0, () => {
    const v = (t) => 783.99 * (1 + 0.006 * Math.sin(TAU * 7 * t));
    return mix(0.42, [[blip(523.25, 0.04, sin), 0, 1], [blip(v, 0.075, sin), 0.08, 1]]);
  }],

  pickup_armor: [0.36, 0, 0, () => {
    const note = (f, len) => {
      const o = fm(f, 1.5, (t) => 1.6 * dec(t, len));
      return render(len * 5, (t) => o(t) * ar(t, 0.003, len));
    };
    return mix(0.34, [[clang(660, 0.03), 0, 0.5], [note(330, 0.03), 0, 1], [note(494, 0.05), 0.07, 1]]);
  }],

  player_pain: [0.5, 0, 0.06, () => mix(0.34, [[grunt(0.32, 165, 100, 0.08)], [thud(140, 60, 0.03), 0, 0.9]])],

  player_death: [0.6, 0, 0, () => {
    const tone = osc(xp(1000, 180, 0.7), sqr);
    const l = lp(2400);
    const alarm = render(1.1, (t) => l(tone(t)) * (t < 0.3 ? ((t * 10) % 1 < 0.5 ? 1 : 0) : dec(t - 0.3, 0.25)));
    return room(mix(1.6, [
      [grunt(1.1, 175, 58, 0.36)],
      [thud(100, 40, 0.1), 0, 1],
      [alarm, 0.35, 0.16],
    ]), 0.25, 1.2, 0.7);
  }],

  floor_burn: [0.3, 0, 0.1, () => {
    const s = bp(1500, 1);
    return mix(0.36, [
      [steam(0.36, 3800, 0.005, 0.1, 0.9)],
      [render(0.2, (t) => s(rnd()) * dec(t, 0.04)), 0, 0.8],
    ]);
  }],

  slag_spit: [0.45, 1.3, 0.08, () => {
    const b = bp(xp(1900, 420, 0.07), 2);
    const o = osc(xp(430, 130, 0.08));
    const out = render(0.32, (t) => b(rnd(), t) * ar(t, 0.004, 0.05) * 2 + o(t) * dec(t, 0.05));
    return add(out, bubbles(0.2, 30, 300, 900), 0.04, 0.35);
  }],

  slag_hit: [0.48, 1.3, 0.08, () => {
    const l = lp(xp(2600, 420, 0.08));
    return mix(0.5, [
      [render(0.3, (t) => l(rnd(), t) * dec(t, 0.05) * 3)],
      [thud(110, 60, 0.03), 0, 0.8],
      [steam(0.46, 4000, 0.01, 0.12, 0.8), 0.02, 0.5],
    ]);
  }],

  bolt_shot: [0.42, 0, 0.06, () => zap(2300, 320, 0.11, 183)],

  bolt_hit: [0.42, 0, 0.1, () => {
    const h = hp(2600);
    const buzz = osc(140, sqr);
    const car = osc(1900);
    return mix(0.24, [
      [render(0.2, (t) => h(rnd()) * dec(t, 0.012) + buzz() * car() * dec(t, 0.035) * 0.6)],
      [clang(1200, 0.02), 0, 0.3],
    ]);
  }],

  level_end: [0.5, 1.2, 0, () => room(mix(2.4, [
    [stab(73.42, 0.6, 1400), 0, 1],
    [stab(110, 0.6, 1400), 0, 0.7],
    [stab(293.66, 0.1), 0, 0.5],
    [stab(349.23, 0.1), 0.15, 0.5],
    [stab(440, 0.1), 0.3, 0.5],
    [stab(587.33, 0.4, 3000), 0.45, 0.7],
    [stab(146.83, 0.5, 1800), 0.45, 0.8],
    [clang(294, 0.25), 0.45, 0.35],
    [thud(90, 40, 0.1), 0.45, 0.8],
  ]), 0.35, 1.6, 0.78)],

  menu_move: [0.2, 0, 0, () => {
    const o = osc(700, sqr);
    const l = lp(2500);
    return mix(0.07, [[render(0.06, (t) => l(o()) * dec(t, 0.012))], [clack(2600, 3), 0, 0.25]]);
  }],

  menu_select: [0.3, 0, 0, () => mix(0.3, [
    [clack(1600), 0, 0.35],
    [blip(660, 0.025, sqr), 0, 0.5],
    [blip(990, 0.05, sqr), 0.06, 0.5],
  ])],

  // scrapper: skittery chirps
  scrapper_alert: [0.38, 0, 0.1, () => {
    const out = buf(0.5);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const f = 1700 + 500 * rnd01() + i * 170;
      add(out, chirp(f, f * 1.7, 0.03 + 0.012 * rnd01()), t, 0.8);
      t += 0.045 + 0.035 * rnd01();
    }
    for (let i = 0; i < 12; i++) add(out, clack(3600, 4), 0.01 + i * 0.033 + 0.01 * rnd01(), 0.12);
    return out;
  }],

  scrapper_attack: [0.42, 0, 0.1, () => mix(0.22, [
    [clack(3200, 4), 0, 1],
    [chirp(2700, 1500, 0.05), 0.01, 0.8],
    [clack(2600, 4), 0.07, 1],
    [chirp(3100, 3900, 0.03), 0.08, 0.6],
  ])],

  scrapper_pain: [0.38, 0, 0.12, () => mix(0.2, [[chirp(3400, 1300, 0.12, 5)], [clack(2400, 3), 0, 0.5]])],

  scrapper_death: [0.44, 0, 0.08, () => {
    const out = buf(0.75);
    const l = lp(1800);
    let t = 0;
    for (let i = 0; i < 8; i++) {
      const f = 2900 * Math.pow(0.78, i);
      add(out, chirp(f, f * 0.7, 0.03 + i * 0.004, 3), t, 0.9 - i * 0.05);
      t += 0.04 + i * 0.012;
    }
    add(out, render(0.2, (u) => l(rnd()) * dec(u, 0.04) * 2), 0.5, 0.8);
    add(out, clang(700, 0.05), 0.5, 0.5);
    return out;
  }],

  // gunner: clipped servo bark
  gunner_alert: [0.46, 0, 0.06, () => {
    const whine = osc(xp(500, 1150, 0.3));
    return mix(0.44, [
      [bark(215, 180, 0.085, 950)],
      [bark(160, 118, 0.13, 720), 0.125, 1],
      [render(0.32, (t) => whine(t) * gate(t, 0.3, 0.02, 0.02)), 0, 0.1],
    ]);
  }],

  gunner_attack: [0.55, 2, 0.05, () => {
    const crack = hp(1200);
    const o = osc(xp(300, 110, 0.05), sqr);
    const l = lp(1800);
    return mix(0.22, [
      [render(0.2, (t) => {
        const n = rnd();
        return crack(n) * dec(t, 0.01) + o(t) * dec(t, 0.04) * 0.7 + l(n) * dec(t, 0.05) * 1.5;
      })],
      [clack(1000), 0.05, 0.3],
    ]);
  }],

  gunner_pain: [0.44, 0, 0.08, () => mix(0.24, [[bark(265, 150, 0.1, 1200)], [clang(900, 0.03), 0, 0.4]])],

  gunner_death: [0.5, 0, 0.05, () => {
    const o = osc(xp(210, 38, 0.75), saw);
    const ring = osc(xp(78, 14, 0.75), sqr);
    const a = bp(xp(1000, 300, 0.75), 3);
    const b = bp(xp(2300, 700, 0.75), 4);
    const whine = osc(xp(1400, 200, 0.7));
    const stutter = osc(xp(16, 5, 0.75), sqr);
    const voice = render(0.8, (t) => {
      const x = o(t) * (0.6 + 0.4 * ring(t));
      const v = Math.tanh((a(x, t) * 1.5 + b(x, t) * 0.8 + x * 0.15) * 3) * (0.65 + 0.35 * stutter(t));
      return (v + whine(t) * 0.12) * gate(t, 0.74, 0.004, 0.05);
    });
    return room(mix(1.1, [
      [voice],
      [thud(100, 45, 0.06), 0.78, 1.3],
      [clang(380, 0.1), 0.78, 0.5],
      [clack(1400), 0.84, 0.5],
    ]), 0.2, 0.9, 0.6);
  }],

  // spitter: wet hiss and gurgle
  spitter_alert: [0.44, 0, 0.08, () => {
    const boiler = fm(118, 1.83, 2);
    return mix(0.75, [
      [bubbles(0.62, 26, 180, 700)],
      [steam(0.7, 3000, 0.15, 0.2, 0.5), 0, 0.5],
      [render(0.6, (t) => boiler(t) * ar(t, 0.05, 0.25)), 0, 0.35],
    ]);
  }],

  spitter_attack: [0.46, 1.2, 0.08, () => mix(0.45, [
    [bubbles(0.26, 42, (p) => 250 + 500 * p, (p) => 700 + 900 * p)],
    [thud(260, 110, 0.03), 0.22, 1.2],
    [steam(0.2, 2200, 0.004, 0.05), 0.22, 0.8],
  ])],

  spitter_pain: [0.42, 0, 0.1, () => {
    const boiler = fm(240, 1.83, 3);
    return mix(0.3, [
      [steam(0.3, 2500, 0.004, 0.07, 0.4)],
      [bubbles(0.2, 34, 500, 1400), 0.02, 0.8],
      [render(0.25, (t) => boiler(t) * dec(t, 0.05)), 0, 0.6],
    ]);
  }],

  spitter_death: [0.52, 1.2, 0.06, () => {
    const boiler = fm(xp(160, 50, 0.8), 1.83, 3);
    return room(mix(1.2, [
      [steam(1.1, 2600, 0.01, 0.38, 0.6), 0, 0.9],
      [bubbles(1, (p) => 34 - 24 * p, (p) => 500 - 380 * p, (p) => 1100 - 850 * p), 0.05, 0.9],
      [thud(130, 40, 0.1), 0.04, 1.2],
      [render(1, (t) => boiler(t) * dec(t, 0.35)), 0, 0.6],
    ]), 0.25, 1, 0.65);
  }],

  // hauler: deep hydraulic groan
  hauler_alert: [0.58, 0, 0.05, () => room(mix(1.15, [
    [groan(1.1, (t) => 50 + 26 * hump(t, 1.05) ** 2, (t) => (t < 0.14 ? t / 0.14 : t < 0.6 ? 1 : dec(t - 0.6, 0.14)))],
    [steam(0.4, 3000, 0.02, 0.12), 0, 0.2],
  ]), 0.25, 1.1, 0.65)],

  hauler_attack: [0.65, 2, 0.05, () => {
    const l = lp(700);
    return room(mix(0.6, [
      [steam(0.16, 2500, 0.1, 0.02), 0, 0.5],
      [thud(105, 40, 0.08), 0.13, 1.5],
      [clang(230, 0.14), 0.13, 0.55],
      [render(0.2, (t) => l(rnd()) * dec(t, 0.04) * 3), 0.13, 1],
    ]), 0.25, 0.8, 0.6);
  }],

  hauler_pain: [0.52, 0, 0.06, () => {
    const creak = fm(xp(900, 600, 0.2), 2.7, 4);
    return mix(0.4, [
      [groan(0.38, xp(88, 52, 0.25), (t) => ar(t, 0.01, 0.1))],
      [render(0.3, (t) => creak(t) * dec(t, 0.07)), 0, 0.3],
    ]);
  }],

  hauler_death: [0.7, 1.5, 0.04, () => room(mix(1.9, [
    [groan(1.3, xp(72, 24, 1.2), (t) => (t < 0.03 ? t / 0.03 : t < 0.5 ? 1 : dec(t - 0.5, 0.3)))],
    [clang(520, 0.05), 0.3, 0.25],
    [clang(410, 0.06), 0.56, 0.3],
    [clang(300, 0.07), 0.8, 0.35],
    [blast(0.8, 0.55), 1.05, 1.1],
    [clang(170, 0.22), 1.05, 0.6],
  ]), 0.3, 1.3, 0.7)],

  // overseer: huge detuned drone horn
  overseer_alert: [0.8, 1.5, 0, () => {
    const f = (t) => (t < 1.05 ? 49 + 6 * Math.min(t / 0.2, 1) : 46.25) * (t > 1.7 ? 1 - (t - 1.7) * 0.12 : 1);
    const env = (t) => (t < 0.15 ? t / 0.15 : t < 0.98 ? 1 : t < 1.08 ? 0.45 + 0.55 * Math.abs(t - 1.03) / 0.05 : t < 1.75 ? 1 : dec(t - 1.75, 0.16));
    return room(horn(2.4, f, env, (t) => 260 + 2000 * env(t) * Math.min(1, t * 3 + 0.3)), 0.35, 1.6, 0.78);
  }],

  overseer_attack: [0.62, 1.5, 0.04, () => mix(0.5, [
    [horn(0.22, () => 82.4, (t) => gate(t, 0.13, 0.01, 0.07), 2600)],
    [zap(1700, 250, 0.07, 110), 0.04, 0.5],
    [zap(1500, 220, 0.07, 110), 0.12, 0.5],
    [zap(1300, 200, 0.08, 110), 0.2, 0.5],
  ])],

  overseer_pain: [0.62, 1.5, 0.05, () => mix(0.45, [
    [horn(0.42, (t) => (48 + 16 * dec(t, 0.12)) * (1 + 0.1 * Math.sin(TAU * 17 * t)), (t) => ar(t, 0.01, 0.13), 2200)],
    [clang(300, 0.08), 0, 0.4],
  ])],

  overseer_death: [1, 2, 0, () => {
    const f = (t) => 58 * Math.pow(19 / 58, Math.min(t / 2.6, 1)) * (1 + 0.02 * t * t * Math.sin(TAU * (9 + 5 * t) * t));
    const env = (t) => (t < 0.05 ? t / 0.05 : t < 2.3 ? 1 - 0.25 * (t / 2.3) : 0.75 * dec(t - 2.3, 0.22));
    return room(mix(3.6, [
      [horn(3.3, f, env, (t) => 2400 * Math.pow(0.15, Math.min(t / 2.6, 1)) + 200)],
      [blast(0.6, 0.4), 0.35, 0.5],
      [blast(0.6, 0.45), 0.92, 0.55],
      [blast(0.7, 0.4), 1.5, 0.6],
      [blast(0.7, 0.5), 1.95, 0.65],
      [blast(1.2, 0.9), 2.45, 1.5],
      [clang(140, 0.3), 2.45, 0.5],
    ]), 0.35, 1.6, 0.76);
  }],
};

// ---------------------------------------------------------------- music instruments

const INSTRUMENTS = {
  m_kick: [1, 2, () => {
    const o = osc(xp(165, 44, 0.09));
    const knock = lp(1100);
    const tick = hp(3000);
    return render(0.42, (t) => o(t) * dec(t, 0.15) + knock(rnd()) * dec(t, 0.018) * 2 + tick(rnd()) * dec(t, 0.003) * 0.5);
  }],
  m_slam: [1, 1.8, () => {
    const n = bp(1300, 0.9);
    const o = osc(xp(210, 170, 0.05));
    const m = fm(330, 2.76, 2);
    return room(render(0.5, (t) => n(rnd()) * dec(t, 0.08) * 2.5 + o(t) * dec(t, 0.06) + m(t) * dec(t, 0.05) * 0.3), 0.5, 0.9, 0.6);
  }],
  m_hat: [1, 0, () => {
    const h = hp(7000);
    return render(0.08, (t) => h(rnd()) * dec(t, 0.016));
  }],
  m_clank: [1, 0, () => room(mix(0.7, [[clang(430, 0.12)]]), 0.3, 0.6, 0.7)],
  m_tom: [1, 1.5, () => {
    const o = osc(xp(150, 85, 0.1));
    const n = bp(380, 2);
    return render(0.45, (t) => o(t) * dec(t, 0.13) + n(rnd()) * dec(t, 0.04) * 1.5);
  }],
  m_steam: [1, 0, () => steam(0.45, 3000, 0.16, 0.06, 0.4)],
  // A1 (55 Hz); pitched by playback rate
  m_bass: [1, 2, () => {
    const a = osc(55, saw);
    const b = osc(55.4, saw);
    const c = osc(27.5, sqr);
    const l = lp(xp(1700, 240, 0.13), 2.2);
    return render(0.7, (t) => l(a() + b() * 0.7 + c() * 0.5, t) * ar(t, 0.004, 0.24));
  }],
  // A4 (440 Hz); pitched by playback rate
  m_lead: [1, 0, () => {
    const f = (t) => 440 * (1 + 0.007 * Math.min(t / 0.6, 1) * Math.sin(TAU * 5.2 * t));
    const o = fm(f, 2.005, (t) => 0.5 + 0.5 * Math.min(t, 1));
    const u = osc((t) => f(t) * 2.997);
    return render(2.8, (t) => (o(t) + u(t) * 0.12) * ar(t, 0.09, 0.8));
  }],
};

// Seamless 8 s drone loop at 22050 Hz: beating sine partials, filtered saws and machine-room air.
function drone(d) {
  const L = 8;
  const X = 1;
  sr = 22050;
  const q = (f) => Math.round(f * L) / L;   // whole cycles per loop
  const parts = d.parts.map(([r, a], i) => [osc(q(d.f * r)), osc(q(d.f * r) + (1 + (i % 3)) / L), a]);
  const s1 = osc(q(d.f), saw);
  const s2 = osc(q(d.f * d.saw) + 1 / L, saw);
  const l = lp((t) => d.cut * (1 + 0.6 * Math.sin((TAU * t) / L)), 2);
  const air = bp(d.air, 1.5);
  const raw = render(L + X, (t) => {
    let v = 0;
    for (const [a, b, g] of parts) v += (a() + b()) * g;
    v = v * 0.3 + l((s1() + s2()) * 0.5, t) * (0.6 + 0.4 * Math.sin((TAU * 2 * t) / L + 1));
    v += air(rnd()) * d.noise * (0.6 + 0.4 * Math.sin((TAU * 3 * t) / L));
    return Math.tanh(v * 1.2);
  });
  const n = L * sr;
  const out = raw.slice(0, n);
  for (let i = 0; i < X * sr; i++) {
    const a = i / (X * sr);
    out[i] = raw[i] * a + raw[n + i] * (1 - a);
  }
  sr = 44100;
  return out;
}

// ---------------------------------------------------------------- music tracks

const _ = null;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

// 16 steps per bar. perc lanes: [instrument, pattern, level, rate, echo send]; pattern digits are
// velocities, '.' is a rest. bass and lead are scale degrees; root is semitones above A.
// prog shifts the bass by scale degrees per bar.
const TRACKS = [
  { // slow and steady, D minor
    bpm: 96, root: 5, scale: AEOLIAN, prog: [0, 0, 0, 0, 0, 0, -2, -1],
    perc: [
      ['m_kick', '9.....7...9.....9.....7...9...6.', 0.9, 1, 0],
      ['m_slam', '........9...............9.....4.', 0.5, 1, 1],
      ['m_hat', '..6...6...6...6.', 0.14, 1, 0],
      ['m_clank', '......5....................5..3.', 0.28, 1, 1],
      ['m_clank', '..........................6.....', 0.3, 0.5, 1],
    ],
    bass: [0, _, _, 0, _, _, 0, _, _, _, 0, _, _, _, 2, _, 0, _, _, 0, _, _, 0, _, _, _, 0, _, 4, _, -1, _],
    bassLen: 0.2, bassLevel: 0.55, ghost: 0.04, lead: 0.4, leadLevel: 0.2,
    drone: { f: 73.42, saw: 1.5, parts: [[1, 1], [1.5, 0.5], [2, 0.5], [3, 0.25], [4.02, 0.15]], cut: 420, air: 300, noise: 0.5, level: 0.3 },
  },
  { // driving, E phrygian
    bpm: 118, root: 7, scale: PHRYGIAN, prog: [0, 0, 0, 0, 0, 0, 1, 1],
    perc: [
      ['m_kick', '9...9...9...9...9...9...9...9...9...9...9...9...9...9...9..79.7.', 0.9, 1, 0],
      ['m_slam', '....9.......9...', 0.5, 1, 0],
      ['m_hat', '4.7.4.7.4.7.4.74', 0.14, 1, 0],
      ['m_clank', '.......5..5.......5....5......5.', 0.24, 1.26, 1],
      ['m_clank', '...................4......4.....', 0.26, 0.63, 1],
    ],
    bass: [0, 0, 7, 0, 0, 7, 0, 0, 0, 0, 7, 0, 2, 0, 7, 1],
    bassLen: 0.07, bassLevel: 0.5, ghost: 0.08, lead: 0.3, leadLevel: 0.18,
    drone: { f: 82.41, saw: 2, parts: [[1, 1], [1.0667, 0.2], [1.5, 0.5], [2, 0.4], [4, 0.15]], cut: 520, air: 420, noise: 0.6, level: 0.26 },
  },
  { // spacious and eerie, C sharp harmonic minor
    bpm: 84, root: 4, scale: HARMONIC, prog: [0, 0, -2, -2, 0, 0, 3, 4],
    perc: [
      ['m_kick', '9...............9.........7.....', 0.9, 1, 0],
      ['m_slam', '........8.......', 0.45, 0.85, 1],
      ['m_steam', '....................5...........', 0.22, 1, 1],
      ['m_hat', '..4...4...4...4.', 0.1, 1, 0],
      ['m_clank', '......6.......................6.', 0.3, 0.75, 1],
      ['m_clank', '...........................3....', 0.2, 2, 1],
      ['m_tom', '............................6.5.', 0.4, 0.8, 1],
    ],
    bass: [0, _, _, _, _, _, _, _, 0, _, _, _, _, _, 4, _],
    bassLen: 0.45, bassLevel: 0.55, ghost: 0.03, lead: 0.75, leadLevel: 0.24,
    drone: { f: 69.3, saw: 1.2, parts: [[1, 1], [1.2, 0.4], [1.5, 0.5], [2.4, 0.3], [3, 0.2], [4.8, 0.12]], cut: 360, air: 600, noise: 0.7, level: 0.34 },
  },
  { // aggressive, F phrygian, with a two-note alarm
    bpm: 132, root: 8, scale: PHRYGIAN, prog: [0, 0, 0, 0, 2, 2, 1, 1],
    perc: [
      ['m_kick', '9..9..9...9.9...9..9..9..9..9.9.', 0.9, 1, 0],
      ['m_slam', '....9.......9.......9.......9.97', 0.55, 1.1, 0],
      ['m_hat', '7.4.7.4.7.4.7.44', 0.14, 1, 0],
      ['m_clank', '..6...6...6...6.', 0.22, 1.5, 0],
      ['m_clank', '..........5.....................', 0.26, 0.56, 1],
      ['m_tom', '................................................................................................................74..6.5.', 0.45, 1, 0],
    ],
    bass: [0, 0, 7, 0, 0, 7, 0, 0, 7, 0, 0, 7, 0, 1, 0, 7],
    bassLen: 0.06, bassLevel: 0.5, ghost: 0.1, lead: 0.2, leadLevel: 0.16,
    motif: [[0, 7], [8, 8]],
    drone: { f: 87.31, saw: 1.4142, parts: [[1, 1], [1.4142, 0.35], [2, 0.5], [2.83, 0.2], [4, 0.15]], cut: 600, air: 500, noise: 0.6, level: 0.26 },
  },
];

const SFX_IDS = Object.keys(SFX);
const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);
const DRONE_IDS = TRACKS.map((_t, i) => `m_drone${i}`);

// Every buffer the module can produce: sound effects, music instruments, drone loops.
export const SYNTH_IDS = [...SFX_IDS, ...INSTRUMENT_IDS, ...DRONE_IDS];

// Renders one buffer. Pure and deterministic; runs in Node.
export function synth(id) {
  seed = 0x9e3779b9;
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed, 31) + id.charCodeAt(i)) | 0;
  seed = seed || 1;
  if (SFX[id]) {
    const [level, drive, , make] = SFX[id];
    return { data: finish(make(), level, drive), rate: 44100 };
  }
  if (INSTRUMENTS[id]) {
    const [level, drive, make] = INSTRUMENTS[id];
    return { data: finish(make(), level, drive), rate: 44100 };
  }
  const data = drone(TRACKS[Number(id.slice(7))].drone);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = 0; i < data.length; i++) data[i] /= peak;
  return { data, rate: 22050 };
}

// ---------------------------------------------------------------- engine

const MAX_DISTANCE = 20;      // positional sounds are inaudible beyond this
const RETRIGGER = 0.04;       // seconds before the same id may play again
const MUSIC_TRIM = 0.7;
const FADE = 1.5;             // music cross-fade, seconds
const LOOKAHEAD = 0.4;        // seconds of music scheduled ahead of the audio clock
const TICK_MS = 100;

// The compressor adds a fixed make-up gain for these settings; POST undoes it and sets the level
// going into the clipper.
const COMP = { threshold: -12, knee: 10, ratio: 5, attack: 0.003, release: 0.14 };
const POST = 0.5;

// Soft clip: linear up to 0.5, then tanh towards 0.97. The curve spans inputs of -2..2.
const CLIP_CURVE = (() => {
  const n = 2049;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= 0.5 ? a : 0.5 + 0.47 * Math.tanh((a - 0.5) / 0.47));
  }
  return c;
})();

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

export function createAudio(opts = {}) {
  let ctx = opts.context || null;
  const offline = !!ctx && typeof ctx.startRendering === 'function';

  let sfxBus = null;
  let musicBus = null;
  let sfxVol = DEFAULT_SETTINGS.sfx;
  let musicVol = DEFAULT_SETTINGS.music;
  let lx = 0, ly = 0, lyaw = 0;
  let held = false;             // suspend() was called and resume() has not been yet

  const pcm = new Map();        // id -> { data, rate }, synthesised but not yet an AudioBuffer
  const buffers = new Map();    // id -> AudioBuffer
  const lastPlay = new Map();   // id -> context time of the last play

  let wantTrack = null;
  let track = null;             // playing track state
  let timer = null;

  function buildGraph() {
    const comp = ctx.createDynamicsCompressor();
    for (const k of Object.keys(COMP)) comp[k].value = COMP[k];
    const post = ctx.createGain();
    post.gain.value = POST;
    const clip = ctx.createWaveShaper();
    clip.curve = CLIP_CURVE;
    comp.connect(post);
    post.connect(clip);
    clip.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxVol;
    sfxBus.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicVol * MUSIC_TRIM;
    musicBus.connect(comp);
  }

  function buffer(id) {
    let b = buffers.get(id);
    if (!b) {
      const { data, rate } = pcm.get(id) || synth(id);
      pcm.delete(id);
      b = ctx.createBuffer(1, data.length, rate);
      b.getChannelData(0).set(data);
      buffers.set(id, b);
    }
    return b;
  }

  // Synthesise everything in small slices so the first play of a sound does not hitch.
  function warm() {
    const order = ['menu_move', 'menu_select', ...SYNTH_IDS];
    let i = 0;
    const tick = () => {
      while (i < order.length && (pcm.has(order[i]) || buffers.has(order[i]))) i++;
      if (i >= order.length) return;
      pcm.set(order[i], synth(order[i]));
      setTimeout(tick, 12);
    };
    setTimeout(tick, 150);
  }

  function wake() {
    if (ctx && !held && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  }

  function unlock() {
    if (!ctx) {
      // 'playback' keeps sound on when the ring/silent switch is set to silent.
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch { /* not supported */ }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
      buildGraph();
      // iOS interrupts the context (calls, Siri, app switch) and does not always restart it.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (ctx.state === 'running') ctx.suspend().catch(() => {});
        } else wake();
      });
      for (const ev of ['touchend', 'click', 'keydown']) {
        document.addEventListener(ev, wake, { capture: true, passive: true });
      }
      syncMusic();
    }
    if (offline) return;
    wake();
    if (!unlock.done) {
      // Starting a source inside the gesture is what older iOS versions need.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
      unlock.done = true;
    }
  }

  function suspend() {
    held = true;
    stopTimer();
    if (ctx && !offline && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  function resume() {
    held = false;
    if (!ctx || offline) return;
    wake();
    startTimer();
  }

  function setListener(x, y, yaw) {
    lx = x;
    ly = y;
    lyaw = yaw;
  }

  function play(id, { x, y, volume = 1 } = {}) {
    if (!ctx || !SFX[id]) return;
    if (!offline && ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (lastPlay.get(id) ?? -1) < RETRIGGER) return;
    let gain = volume;
    let pan = 0;
    const positional = x != null && y != null;
    if (positional) {
      const dx = x - lx;
      const dy = y - ly;
      const d = Math.hypot(dx, dy);
      if (d >= MAX_DISTANCE) return;
      gain *= (1 - (d / MAX_DISTANCE) ** 2) / (1 + d / 4);
      // The listener's right-hand side is yaw + 90 degrees.
      if (d > 0.001) pan = ((dy * Math.cos(lyaw) - dx * Math.sin(lyaw)) / d) * 0.85 * Math.min(1, d);
    }
    if (!(gain > 0.001)) return;
    lastPlay.set(id, now);
    const src = ctx.createBufferSource();
    src.buffer = buffer(id);
    const spread = SFX[id][2];
    if (spread && !offline) src.playbackRate.value = 1 + (Math.random() - 0.5) * spread;
    const g = ctx.createGain();
    src.connect(g);
    if (positional && ctx.createStereoPanner) {
      // The equal-power panner is 3 dB down per channel at centre; make up for it so that a
      // centred positional sound is as loud as an unpanned one.
      g.gain.value = gain * Math.SQRT2;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(sfxBus);
    } else {
      g.gain.value = gain;
      g.connect(sfxBus);
    }
    src.start();
  }

  function setSfxVolume(v) {
    sfxVol = clamp01(v);
    if (sfxBus) sfxBus.gain.value = sfxVol;
  }

  function setMusicVolume(v) {
    musicVol = clamp01(v);
    if (musicBus) musicBus.gain.value = musicVol * MUSIC_TRIM;
    syncMusic();
  }

  function setMusic(index) {
    wantTrack = index == null ? null : ((index % MUSIC_TRACK_COUNT) + MUSIC_TRACK_COUNT) % MUSIC_TRACK_COUNT;
    syncMusic();
  }

  // ---- music

  // Makes the playing track match the request; nothing plays while the music volume is 0.
  function syncMusic() {
    if (!ctx) return;
    const target = musicVol > 0 ? wantTrack : null;
    if ((track ? track.index : null) === target) return;
    const now = ctx.currentTime;
    if (track) stopTrack(track, now);
    track = target == null ? null : startTrack(target, now);
    if (track && !held) startTimer();
    else stopTimer();
  }

  function startTrack(index, now) {
    const def = TRACKS[index];
    const stepDur = 60 / def.bpm / 4;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + FADE);
    out.connect(musicBus);

    // Tempo-synced echo for the lanes that ask for it.
    const send = ctx.createGain();
    send.gain.value = 0.5;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = stepDur * 3;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    send.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(out);

    const loop = ctx.createBufferSource();
    loop.buffer = buffer(`m_drone${index}`);
    loop.loop = true;
    const loopGain = ctx.createGain();
    loopGain.gain.value = def.drone.level;
    loop.connect(loopGain);
    loopGain.connect(out);
    loop.start(now);

    return { index, def, stepDur, out, send, feedback, loop, start: now, step: 0, next: now + 0.08, rng: null };
  }

  function stopTrack(tr, now) {
    const level = Math.min(1, (now - tr.start) / FADE);
    tr.out.gain.cancelScheduledValues(now);
    tr.out.gain.setValueAtTime(level, now);
    tr.out.gain.linearRampToValueAtTime(0, now + FADE);
    tr.loop.onended = () => {
      tr.feedback.disconnect();
      tr.out.disconnect();
    };
    tr.loop.stop(now + FADE + 0.05);
  }

  function hit(tr, id, time, level, rate, send, len) {
    const src = ctx.createBufferSource();
    src.buffer = buffer(id);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = level;
    if (len) g.gain.setTargetAtTime(0, time + len, 0.04);
    src.connect(g);
    g.connect(tr.out);
    if (send) g.connect(tr.send);
    src.start(time);
  }

  // Playback rate for a scale degree above the track root.
  function pitch(def, degree) {
    const oct = Math.floor(degree / 7);
    return 2 ** ((def.root + def.scale[degree - oct * 7] + 12 * oct) / 12);
  }

  function stepTrack(tr, step, time) {
    const d = tr.def;
    const s = step & 15;
    const bar = step >> 4;
    if (s === 0 || !tr.rng) tr.rng = createRng((tr.index + 1) * 7919 + bar * 104729);
    const rng = tr.rng;

    for (const [id, pattern, level, rate, send] of d.perc) {
      const v = pattern.charCodeAt(step % pattern.length) - 48;
      if (v > 0) hit(tr, id, time, (level * v) / 9, rate, send);
      else if (id === 'm_hat' && rng.chance(d.ghost)) hit(tr, id, time, level * 0.4, 1.25, 0);
    }

    const degree = d.bass[step % d.bass.length];
    if (degree !== null) {
      const shift = d.prog[bar % d.prog.length];
      hit(tr, 'm_bass', time, d.bassLevel * (s % 4 === 0 ? 1 : 0.8), pitch(d, degree + shift), 0, d.bassLen);
    }

    // Fill into the top of every eight-bar cycle.
    if (bar % 8 === 7 && s >= 12 && rng.chance(0.7)) hit(tr, 'm_tom', time, 0.4, 1.3 - (s - 12) * 0.13, 1);

    if (s !== 0) return;
    // Lead: an occasional short phrase wandering along the scale, placed for the whole bar.
    if (d.motif && bar % 4 >= 2) {
      for (const [at, deg] of d.motif) hit(tr, 'm_lead', time + at * tr.stepDur, d.leadLevel, pitch(d, deg), 1, 0.3);
    } else if (rng.chance(d.lead)) {
      let deg = rng.pick([0, 2, 4, 7]);
      let at = rng.pick([0, 0, 4]);
      for (let n = rng.int(1, 3); n > 0 && at < 16; n--) {
        hit(tr, 'm_lead', time + at * tr.stepDur, d.leadLevel, pitch(d, deg), 1);
        deg = Math.min(9, Math.max(-2, deg + rng.pick([-2, -1, 1, 2])));
        at += rng.pick([4, 6, 8]);
      }
    }
  }

  // Schedules every step that starts before `until` (context time). The timer calls this with
  // a short lookahead; offline tests call it once with the length of the render.
  function scheduleMusic(until) {
    const tr = track;
    if (!tr) return;
    const now = ctx.currentTime;
    if (tr.next < now) {
      // The timer stalled (hidden tab, long frame): drop the missed steps instead of bunching them.
      const missed = Math.ceil((now - tr.next) / tr.stepDur);
      tr.step += missed;
      tr.next += missed * tr.stepDur;
    }
    while (tr.next < until) {
      stepTrack(tr, tr.step, tr.next);
      tr.step++;
      tr.next += tr.stepDur;
    }
  }

  function startTimer() {
    if (timer !== null || offline || !track) return;
    const tick = () => {
      if (ctx.state === 'running') scheduleMusic(ctx.currentTime + LOOKAHEAD);
    };
    timer = setInterval(tick, TICK_MS);
    tick();
  }

  function stopTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  if (ctx) buildGraph();
  if (!offline) warm();

  return {
    unlock, suspend, resume, setListener, play, setMusic, setSfxVolume, setMusicVolume,
    _scheduleMusic: scheduleMusic,
  };
}

// SOUND_IDS in config.js is the contract; this fails loudly at import if the two drift apart.
for (const id of SOUND_IDS) if (!SFX[id]) throw new Error(`audio: no synth for sound id ${id}`);
