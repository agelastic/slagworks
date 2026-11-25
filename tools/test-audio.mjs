// Audio checks.
//
//   node tools/test-audio.mjs [--out dir] [--wav] [--sheets] [--no-browser] [--realtime]
//
// Node part: imports src/audio.js, checks createAudio() without a context is harmless, synthesises
// every buffer and prints duration / peak / RMS / spectral balance. --sheets writes spectrogram
// contact sheets (PNG), --wav writes one WAV per sound for listening.
// Browser part (headless Chrome): renders every sound id and 8 s of every music track through an
// OfflineAudioContext and asserts non-silent, no NaN, peak below 1.0; checks panning, distance
// cut-off, retrigger limit and a worst-case stack. --sheets adds a sheet of the rendered tracks.
// --realtime also runs a live AudioContext (unlock by click, music, suspend/resume, interruption).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_IDS, MUSIC_TRACK_COUNT } from '../src/config.js';
import { createAudio, synth, SYNTH_IDS } from '../src/audio.js';
import { createSurface, fillRect, setPx, drawText } from '../src/core/pix.js';
import { writePNG } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'out', 'audio');

let failures = 0;
function check(ok, msg) {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
  return ok;
}

// ---------------------------------------------------------------- node part

{
  const audio = createAudio();
  audio.play('rivet_fire');
  audio.play('door_open', { x: 3, y: 4 });
  audio.setListener(1, 2, 0.5);
  audio.setMusic(1);
  audio.setMusicVolume(0.3);
  audio.setSfxVolume(0.3);
  audio.suspend();
  audio.resume();
  audio.setMusic(null);
  console.log('createAudio() without a context: ok');
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const N = 2048;
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

// Magnitude spectrum of the frame centred on sample `at`.
function spectrum(data, at) {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = at - N / 2 + i;
    re[i] = s >= 0 && s < data.length ? data[s] * hann[i] : 0;
  }
  fft(re, im);
  const mag = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / (N / 4);
  return mag;
}

const BANDS = [[0, 120], [120, 500], [500, 2000], [2000, 8000], [8000, 24000]];

function analyse(id) {
  const t0 = performance.now();
  const { data, rate } = synth(id);
  const ms = performance.now() - t0;
  let peak = 0, sum = 0, nan = 0, dc = 0;
  for (const v of data) {
    if (!Number.isFinite(v)) nan++;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
    dc += v;
  }
  // loudest 50 ms window
  const win = Math.round(rate * 0.05);
  let acc = 0, loud = 0;
  for (let i = 0; i < data.length; i++) {
    acc += data[i] * data[i];
    if (i >= win) acc -= data[i - win] * data[i - win];
    loud = Math.max(loud, acc / win);
  }
  // the same through a rough phone-speaker model: 24 dB/oct high-pass at 300 Hz
  const hpf = [0, 0].map(() => {
    const g = Math.tan((Math.PI * 300) / rate), k = Math.SQRT2;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    let s1 = 0, s2 = 0;
    return (x) => {
      const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      return x - k * v1 - v2;
    };
  });
  const small = Float32Array.from(data, (v) => hpf[1](hpf[0](v)));
  let phone = 0;
  acc = 0;
  for (let i = 0; i < small.length; i++) {
    acc += small[i] * small[i];
    if (i >= win) acc -= small[i - win] * small[i - win];
    phone = Math.max(phone, acc / win);
  }
  const bands = BANDS.map(() => 0);
  let cen = 0, tot = 0;
  for (let at = 0; at < data.length; at += N / 2) {
    const mag = spectrum(data, at);
    for (let b = 1; b < N / 2; b++) {
      const f = (b * rate) / N, p = mag[b] * mag[b];
      cen += f * p;
      tot += p;
      bands[BANDS.findIndex(([lo, hi]) => f >= lo && f < hi)] += p;
    }
  }
  return {
    id, data, rate, ms, nan, peak, dur: data.length / rate,
    rms: Math.sqrt(sum / data.length), loud: Math.sqrt(loud), phone: Math.sqrt(phone), dc: dc / data.length,
    centroid: tot ? cen / tot : 0, bands: bands.map((b) => (tot ? b / tot : 0)),
  };
}

console.log('\nid                 dur    peak   rms    loud50 phone50 centroid  sub/low/mid/high/air %   synth ms');
const results = [];
let totalMs = 0, totalSec = 0;
for (const id of SYNTH_IDS) {
  const r = analyse(id);
  results.push(r);
  totalMs += r.ms;
  totalSec += r.dur;
  console.log(`${id.padEnd(18)} ${r.dur.toFixed(2).padStart(5)}  ${r.peak.toFixed(3)}  ${r.rms.toFixed(3)}  ${r.loud.toFixed(3)}  ${r.phone.toFixed(3)}  ${String(Math.round(r.centroid)).padStart(6)}   ${r.bands.map((b) => String(Math.round(b * 100)).padStart(3)).join(' ')}      ${r.ms.toFixed(1).padStart(6)}`);
  check(r.nan === 0, `${id}: ${r.nan} non-finite samples`);
  check(r.peak > 0.05 && r.peak <= 1.0001, `${id}: peak ${r.peak}`);
  check(Math.abs(r.dc) < 0.02, `${id}: dc offset ${r.dc}`);
  check(Math.abs(r.data[r.data.length - 1]) < 0.01 || id.startsWith('m_drone'), `${id}: does not end at zero`);
}
console.log(`total ${totalSec.toFixed(1)} s of audio synthesised in ${totalMs.toFixed(0)} ms`);
for (const id of SOUND_IDS) check(SYNTH_IDS.includes(id), `missing synth for ${id}`);

// Drone loops must be seamless: the wrap step should look like any other sample step.
for (const r of results.filter((x) => x.id.startsWith('m_drone'))) {
  let maxStep = 0;
  for (let i = 1; i < r.data.length; i++) maxStep = Math.max(maxStep, Math.abs(r.data[i] - r.data[i - 1]));
  const wrap = Math.abs(r.data[0] - r.data[r.data.length - 1]);
  check(wrap <= maxStep * 1.05, `${r.id}: loop seam step ${wrap.toFixed(4)} vs max ${maxStep.toFixed(4)}`);
}

// ---- spectrogram sheets

const PALETTE = [[4, 4, 12], [30, 20, 90], [130, 30, 130], [230, 90, 40], [255, 200, 70], [255, 255, 240]];
function heat(t) {
  const x = Math.min(0.9999, Math.max(0, t || 0)) * (PALETTE.length - 1);
  const i = Math.floor(x), f = x - i;
  return PALETTE[i].map((c, k) => Math.round(c + (PALETTE[i + 1][k] - c) * f));
}

function panel(r, pxPerSec, h) {
  const w = Math.max(70, Math.ceil(r.dur * pxPerSec));
  const waveH = 28;
  const s = createSurface(w, h + waveH + 9, [16, 16, 22]);
  drawText(s, `${r.id} ${r.dur.toFixed(2)}`, 1, 1, '#e8e0c0');
  const fLo = 40, fHi = Math.min(18000, r.rate / 2);
  for (let x = 0; x < w; x++) {
    const at = Math.round((x / pxPerSec) * r.rate);
    if (at >= r.data.length) break;
    const mag = spectrum(r.data, at);
    for (let y = 0; y < h; y++) {
      const f0 = fLo * Math.pow(fHi / fLo, (h - 1 - y) / h), f1 = fLo * Math.pow(fHi / fLo, (h - y) / h);
      const b0 = Math.max(1, Math.floor((f0 * N) / r.rate)), b1 = Math.max(b0 + 1, Math.ceil((f1 * N) / r.rate));
      let m = 0;
      for (let b = b0; b < b1 && b < N / 2; b++) m = Math.max(m, mag[b]);
      const db = 20 * Math.log10(m + 1e-9);
      setPx(s, x, 8 + y, heat((db + 72) / 66));
    }
    // waveform envelope for this column
    const a = at, b = Math.min(r.data.length, Math.round(((x + 1) / pxPerSec) * r.rate));
    let lo = 0, hi = 0;
    for (let i = a; i < b; i++) {
      lo = Math.min(lo, r.data[i]);
      hi = Math.max(hi, r.data[i]);
    }
    const mid = 8 + h + 1 + waveH / 2;
    for (let y = Math.round(mid - hi * waveH / 2); y <= Math.round(mid - lo * waveH / 2); y++) setPx(s, x, y, [120, 220, 150]);
  }
  // frequency guides at 100 Hz, 1 kHz, 10 kHz
  for (const f of [100, 1000, 10000]) {
    const y = 8 + Math.round(h - 1 - (Math.log(f / fLo) / Math.log(fHi / fLo)) * h);
    for (let x = 0; x < w; x += 4) setPx(s, x, y, [90, 90, 110]);
  }
  return s;
}

function sheet(name, ids, pxPerSec = 220) {
  const panels = ids.map((id) => panel(results.find((r) => r.id === id), pxPerSec, 120));
  const maxW = 1400;
  let x = 2, y = 2, rowH = 0;
  const places = [];
  for (const p of panels) {
    if (x + p.w > maxW && x > 2) {
      x = 2;
      y += rowH + 4;
      rowH = 0;
    }
    places.push([p, x, y]);
    x += p.w + 4;
    rowH = Math.max(rowH, p.h);
  }
  const W = Math.min(maxW, Math.max(...places.map(([p, px]) => px + p.w)) + 2);
  const out = createSurface(W, y + rowH + 2, [40, 40, 50]);
  for (const [p, px, py] of places) {
    for (let j = 0; j < p.h; j++) {
      for (let i = 0; i < p.w && px + i < W; i++) {
        const o = (j * p.w + i) * 4;
        setPx(out, px + i, py + j, [p.data[o], p.data[o + 1], p.data[o + 2]]);
      }
    }
  }
  fillRect(out, 0, 0, 1, 1, [40, 40, 50]);
  const file = path.join(outDir, `spec-${name}.png`);
  writePNG(file, out);
  console.log(`wrote ${file}`);
}

if (flag('--sheets')) {
  const pick = (re) => SYNTH_IDS.filter((id) => re.test(id));
  sheet('weapons', pick(/^(wrench|rivet|scatter|bolt_fire|launcher|explode|dry|weapon|ricochet)/));
  sheet('world', pick(/^(door|lift|switch|locked|secret|level_end|menu)/));
  sheet('pickups-player', pick(/^(pickup|player|floor|slag|bolt_shot|bolt_hit)/));
  sheet('scrapper-gunner', pick(/^(scrapper|gunner)/));
  sheet('spitter-hauler', pick(/^(spitter|hauler)/));
  sheet('overseer', pick(/^overseer/), 180);
  sheet('instruments', pick(/^m_(?!drone)/));
  sheet('drones', pick(/^m_drone/), 100);
}

function wav(channels, rate) {
  const n = channels[0].length, ch = channels.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + (i * ch + c) * 2);
  }
  return b;
}

if (flag('--wav')) {
  fs.mkdirSync(path.join(outDir, 'wav'), { recursive: true });
  for (const r of results) fs.writeFileSync(path.join(outDir, 'wav', `${r.id}.wav`), wav([r.data], r.rate));
  console.log(`wrote ${results.length} wav files to ${path.join(outDir, 'wav')}`);
}

// ---------------------------------------------------------------- browser part

if (!flag('--no-browser')) {
  const { startServer } = await import('./serve.mjs');
  const { launchBrowser, desktopPage } = await import('./browser.mjs');
  const server = await startServer(root, 0);
  const browser = await launchBrowser();
  try {
    const page = await desktopPage(browser, { width: 800, height: 600 });
    await page.goto(`${server.url}tools/test-audio.html`);
    await page.waitForFunction(() => window.ready === true);

    console.log('\noffline render through the full graph (default volumes)');
    console.log('id                 peak    rms     loud50');
    for (const id of SOUND_IDS) {
      const r = await page.evaluate((i) => window.renderSound(i), id);
      console.log(`${id.padEnd(18)} ${r.peak.toFixed(3)}   ${r.rms.toFixed(4)}  ${r.loud.toFixed(3)}`);
      check(r.nan === 0, `${id}: NaN in offline render`);
      check(r.peak > 0.01, `${id}: silent in offline render (peak ${r.peak})`);
      check(r.peak < 1, `${id}: clips in offline render (peak ${r.peak})`);
    }

    console.log('\nmusic, 8 s per track');
    console.log('track  peak    rms     quietest/loudest 0.5 s rms   L/R rms');
    for (let i = 0; i < MUSIC_TRACK_COUNT; i++) {
      const r = await page.evaluate((t) => window.renderMusic(t, 8), i);
      console.log(`${i}      ${r.peak.toFixed(3)}   ${r.rms.toFixed(4)}  ${r.minWin.toFixed(4)} / ${r.maxWin.toFixed(4)}           ${r.rmsL.toFixed(4)} / ${r.rmsR.toFixed(4)}`);
      check(r.nan === 0, `music ${i}: NaN`);
      check(r.rms > 0.01, `music ${i}: silent (rms ${r.rms})`);
      check(r.peak < 1, `music ${i}: clips (peak ${r.peak})`);
      check(r.minWin > 0.003, `music ${i}: has a silent gap after the fade-in`);
      if (flag('--wav') || flag('--sheets')) {
        const secs = flag('--wav') ? 24 : 12;
        const pcm = (await page.evaluate(([t, n]) => window.renderMusicPcm(t, n), [i, secs])).map((c) => Float32Array.from(c));
        if (flag('--wav')) fs.writeFileSync(path.join(outDir, 'wav', `music${i}.wav`), wav(pcm, 44100));
        results.push({ id: `music${i}`, data: pcm[0], rate: 44100, dur: secs });
      }
    }
    if (flag('--sheets')) sheet('music', results.filter((r) => r.id.startsWith('music')).map((r) => r.id), 110);

    const misc = await page.evaluate(() => window.miscChecks());
    console.log('\nmisc', JSON.stringify(misc, null, 1));
    check(misc.silentMusic.peak === 0, 'music volume 0 is not silent');
    check(misc.nullMusic.peak === 0, 'setMusic(null) is not silent');
    check(misc.right.r > misc.right.l * 2, 'sound on the right is not louder on the right');
    check(misc.left.l > misc.left.r * 2, 'sound on the left is not louder on the left');
    check(misc.ahead.l > 0 && Math.abs(misc.ahead.l - misc.ahead.r) < misc.ahead.l * 0.05, 'sound ahead is not centred');
    check(misc.turned.l > misc.turned.r * 2, 'listener yaw is ignored by the pan');
    check(Math.abs(misc.offCentre.rms - misc.ahead.rms) < misc.ahead.rms * 0.02, 'level jumps between centred and just off-centre');
    check(Math.abs(misc.onListener.peak - misc.volumeFull.peak) < 1e-4, 'positional sound at the listener differs from an unpanned one');
    check(misc.far.peak === 0, 'sound beyond 20 units is audible');
    check(misc.near.peak > misc.mid.peak && misc.mid.peak > misc.distant.peak && misc.distant.peak > 0, 'distance attenuation is not monotonic');
    check(Math.abs(misc.twice.peak - misc.once.peak) < 1e-6, 'retrigger within 40 ms was not suppressed');
    check(misc.unknown.peak === 0, 'unknown id made sound');
    check(misc.stack.nan === 0 && misc.stack.peak < 1, `stacked sounds clip (peak ${misc.stack.peak})`);
    check(misc.volumeHalf.peak < misc.volumeFull.peak * 0.7, 'play volume option has no effect');
    check(misc.sfxZero.peak === 0, 'sfx volume 0 is not silent');
    check(misc.constructed === 0, 'an AudioContext was created before unlock()');

    if (flag('--realtime')) {
      await page.mouse.click(200, 200);
      const rt = await page.evaluate(() => window.realtime());
      console.log('\nrealtime', JSON.stringify(rt, null, 1));
      check(rt.constructedAfterUnlock === 1, 'unlock() did not create exactly one context');
      check(rt.state === 'running', `context state ${rt.state}`);
      check(rt.sfxRms > 0.001, 'no realtime sfx output');
      check(rt.musicQuiet < 3, `realtime music had ${rt.musicQuiet} quiet windows`);
      check(rt.afterZero < 1e-4, `music audible after volume 0 (${rt.afterZero})`);
      check(rt.afterSuspend === 'suspended' && rt.afterResume === 'running', 'suspend/resume state');
      check(rt.crossfadeQuiet < 3, `cross-fade had ${rt.crossfadeQuiet} quiet windows`);
      check(rt.audioSession === 'playback', `navigator.audioSession.type is ${rt.audioSession}`);
      check(rt.interruptedResumes >= 1, 'a gesture did not resume an interrupted context');
    }
    check(page.errors.length === 0, `page errors: ${page.errors.join(' | ')}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall audio checks passed');
process.exit(failures ? 1 : 0);
