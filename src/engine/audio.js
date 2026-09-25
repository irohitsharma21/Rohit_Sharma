// Generative soundscape. Pure Web Audio synthesis: no files, no requests, no libraries.
//
//   import { Soundscape } from './audio.js'
//   this.audio = new Soundscape(this)      // after boot
//   this.audio.update(dt)                  // every frame
//
// Sound is ON by default but only *armed*: browsers block audio until a user gesture, so the
// AudioContext is created on the first pointerdown / keydown / touch and then fades in from
// silence over ~7 s. Toggle: the SOUND button (bottom right) or the M key. The choice persists.
//
// Two layers:
//  1. BED (persistent, a few dozen cheap nodes): an evolving D-dorian pad, sub, server-room air,
//     brown-noise rumble, a sine "tone bank", sparse data glints, the flight whoosh, and a
//     ping-pong delay for space. Each world tints the bed; tints crossfade over ~2 s.
//  2. WORLD FX (lazy): each world has a small module with its own nodes (siren, voices, fans...)
//     built when that world (or the next one mid-flight) becomes active and torn down (stop +
//     disconnect) ~4 s after it goes inactive. Story events are tied to the world's scroll
//     progress p: continuous parameters are pure functions of p (reversible when scrubbing);
//     one-shots fire on forward threshold crossings with hysteresis + cooldown.
//
//   bed ──────────────┐
//   world fx (×≤2) ───┤→ mix → startFade → gate (mute / tab hidden) → master → limiter → analyser → out
//   one-shots ────────┘      ↘ sends → ping-pong delay (dark feedback) → mix
//
// Everything is in D (dorian / minor), so worlds and events never clash.

import { clamp, damp, smoothstep, lerp } from '../lib/math.js'

const STORE = 'rs.sound'
const MASTER = 0.15
const MASTER_REDUCED = 0.09
const FADE_IN = 7
const TICK = 1 / 30
const TEARDOWN_AFTER = 4

// ---- pitches (Hz) ----
const D1 = 36.71, D2 = 73.42, A2 = 110, D3 = 146.83, F3 = 174.61, G3 = 196, A3 = 220, C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392, A4 = 440
const C5 = 523.25, D5 = 587.33, E5 = 659.26, F5 = 698.46, G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, F6 = 1396.91, A6 = 1760, C7 = 2093, D7 = 2349.32

// Story cue positions (world scroll progress p), read from each world's choreography.
// Kept in one place so they can follow the visuals if a world's timing changes.
export const CUES = {
  hero: { core: [0.3, 0.85] }, // camera threads the rings (0.1-0.55), crosses the core ~0.67, "inside" 0.5-0.85
  voice: { speech: [0, 0.2], stt: [0.17, 0.33], llm: [0.33, 0.52], tool: 0.55, tts: [0.66, 0.88] }, // front: STT .17-.24, LLM .33-.40, port .50-.55, TTS .66-.72
  realtime: { active: [0.07, 0.86] }, // the chased request is visible ~0.07-0.84
  siren: {
    // ambulance z (m from the intersection centre) vs p, from siren/index.js
    z: [[0, 300], [0.1, 232], [0.2, 172], [0.35, 114], [0.45, 82], [0.58, 55], [0.66, 43], [0.76, 30], [0.84, 17], [0.9, 0], [0.95, -24], [1, -56]],
    gate: [0.7, 0.715, 0.73], preempt: 0.75, pass: [0.8, 0.88], // passes the camera on screen-left ~0.84
  },
  meetai: { talk: [0, 0.24], brief: 0.283, email: 0.606, calPick: 0.724, calDock: 0.786 },
  continuum: { drop: 0.372, ring: 0.508, line: 0.53, caller: [0.535, 0.63], rejoin: 0.77, agent: 0.8 },
  knowledge: { chunks: [0.405, 0.455], topk: 8, waves: [0.4, 0.6, 0.7, 0.86] },
  infra: { land: [0.45, 0.92], cluster: 0.67, words: [0.86, 0.995], nWords: 10 },
  runbook: { type: [[0.07, 0.19, 28], [0.33, 0.46, 48], [0.52, 0.64, 10]], enter: 0.2, play: 0.74, run: 0.76, lines: [0.78, 0.9, 10], done: 0.905 },
  shieldx: { stages: [0.16, 0.28, 0.4, 0.52, 0.64, 0.76], threats: [0.16, 0.5], policy: [0.6, 0.82], loop: 9, open: 0.17, close: 0.34, blocked: 0.77 },
  signals: { arrive: [0.07, 0.32, 0.57], locks: [0.1875, 0.4375, 0.6875] }, // LOCKED flips ~.181 / .431 / .681
  experience: { stages: [0.12, 0.27, 0.42, 0.57, 0.72], scale: [0.41, 0.5], lanes: 30, final: 0.86 },
  skills: { keys: [0.15, 0.29, 0.43, 0.57, 0.71] },
  finale: { resolve: 0.66 },
}
// finale: 38 link completions (13 core, 12 chain, 13 cross), from finale/index.js (prog = p + 0.02, DRAW 0.065)
const FINALE_LINKS = (() => {
  const a = [], DT = 0.47 / 13
  for (let i = 0; i < 13; i++) a.push(0.015 + i * DT - 0.01 + 0.065 - 0.02)
  for (let i = 1; i < 13; i++) a.push(0.015 + i * DT + 0.012 + 0.065 - 0.02)
  for (let k = 0; k < 13; k++) a.push(0.495 + k * 0.01 + 0.065 - 0.02)
  return a.sort((x, y) => x - y)
})()
const pieceLin = (pts, p) => { if (p <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (p <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (p - a) / (b - a) } return pts[pts.length - 1][1] }

// pad voices: [freq, type, detune(cents), level]
const PAD = [[D2, 'sawtooth', -7, 0.16], [D2, 'sawtooth', 6, 0.16], [A2, 'sawtooth', 3, 0.12], [D3, 'triangle', -3, 0.34], [F3, 'triangle', 4, 0.26], [C4, 'triangle', -5, 0.16], [E4, 'sine', 2, 0.12], [G3, 'triangle', 0, 0.2]]
// tone bank: fixed pitches, per-world gains only (no glides on crossfades)
const TONES = [A3, D4, F4, A4, D5, A5, E5]
const TONE_PAN = [-0.45, 0.35, -0.2, 0.25, -0.6, 0.6, 0.05]

const KEYS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'pad', 'cut', 'sub', 'air', 'airCut', 'brown', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 'glint', 'glass', 'shimmer']
const BASE = { p0: 1, p1: 1, p2: 1, p3: 0.6, p4: 0, p5: 0, p6: 0, p7: 0, pad: 1, cut: 560, sub: 0.15, air: 0.35, airCut: 1000, brown: 0, t0: 0, t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0, glint: 0.05, glass: 0, shimmer: 0 }

const ss = smoothstep
const inR = (p, r) => p >= r[0] && p <= r[1]
/** Rise over [a,b], hold, fall over [c,d]. */
const band = (p, a, b, c, d) => Math.min(ss(a, b, p), 1 - ss(c, d, p))

/** Per-world bed tint as a function of p. Missing keys fall back to BASE. */
const TINT = {
  hero: (p) => { const g = ss(0, 0.55, p); return { p3: 0.7, cut: 380 + 600 * g, sub: 0.2 + 0.25 * g, air: 0.4, glint: 0.04 + 0.04 * g } },
  voice: () => ({ p4: 0.8, cut: 620, air: 0.28, sub: 0.1, glint: 0.03 }),
  realtime: () => ({ p5: 0.7, p4: 0.3, cut: 600, air: 0.35, glint: 0.03 }),
  siren: () => ({ p3: 0.3, p4: 0.7, pad: 0.7, cut: 420, air: 0.25, sub: 0.08, glint: 0.01 }),
  meetai: () => ({ p0: 0.4, p1: 0.4, p3: 0.9, p4: 0.8, p5: 0.5, pad: 0.75, cut: 820, air: 0.2, airCut: 650, sub: 0.05, glint: 0.02 }),
  continuum: () => ({ p4: 0.2, p6: 0.8, pad: 0.8, cut: 620, air: 0.3, glint: 0.02 }),
  knowledge: () => ({ p4: 0.6, p5: 0.6, p6: 0.5, cut: 800, glass: 0.3, air: 0.3, glint: 0.02 }),
  infra: () => ({ p2: 0.7, p3: 0.3, pad: 0.7, cut: 340, air: 0.35, airCut: 1500, sub: 0.15, glint: 0.01 }),
  runbook: () => ({ p2: 0.6, p3: 0.2, pad: 0.55, cut: 300, air: 0.16, airCut: 800, sub: 0.05, glint: 0.01 }),
  shieldx: () => ({ p3: 0.3, p7: 0.8, cut: 400, air: 0.28, sub: 0.1, glint: 0.01 }),
  signals: () => ({ pad: 0.6, p3: 0.5, cut: 480, air: 0.25, airCut: 1800, glint: 0.01 }),
  experience: (p) => ({ p4: 0.8, cut: 460 + 700 * p, sub: 0.15 + 0.3 * p, t0: 0.8 * ss(0.11, 0.2, p), t1: 0.7 * ss(0.26, 0.35, p), t3: 0.6 * ss(0.56, 0.65, p), t4: 0.5 * ss(0.71, 0.8, p), glint: 0.03 }),
  skills: () => ({ p0: 0.5, p1: 0.5, p3: 0.8, p5: 0.6, p6: 0.7, cut: 1050, shimmer: 1.3, air: 0.42, airCut: 3200, sub: 0.05, glint: 0.03 }),
  finale: (p) => { const b = ss(0.45, 0.73, p); return { p3: 0.9, p4: 0.9, p5: 0.7, p6: 0.6, cut: 850 + 650 * b, sub: 0.3 + 0.3 * b, t0: 0.4 + 0.5 * b, t1: 0.35 + 0.45 * b, t2: 0.3 + 0.4 * b, t3: 0.3 + 0.4 * b, t4: 0.2 + 0.4 * b, t5: 0.15 * b, t6: 0.35 * b, air: 0.32, glint: 0.06 + 0.08 * b } },
}

function tintOf(id, p, out) {
  const f = TINT[id]
  const t = f ? f(p) : null
  for (const k of KEYS) out[k] = t && t[k] != null ? t[k] : BASE[k]
  return out
}

function noiseBuffer(ctx, seconds, brown) {
  const sr = ctx.sampleRate, L = Math.floor(sr * seconds), F = Math.floor(sr * 0.15)
  const g = new Float32Array(L + F)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
  for (let i = 0; i < g.length; i++) {
    const w = Math.random() * 2 - 1
    if (brown) { last = (last + 0.02 * w) / 1.02; g[i] = last * 3.5 }
    else {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
      g[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926
    }
  }
  const buf = ctx.createBuffer(1, L, sr)
  const d = buf.getChannelData(0)
  for (let i = 0; i < L; i++) d[i] = i < F ? g[i] * (i / F) + g[L + i] * (1 - i / F) : g[i] // seamless loop
  return buf
}

const pick = (a) => a[(Math.random() * a.length) | 0]
const rnd = (a, b) => a + Math.random() * (b - a)

// vowel formants [F1, F2, F3]
const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [300, 2250, 3000], [570, 840, 2410], [320, 870, 2240], [500, 1500, 2500], [660, 1700, 2400]]

// ================================================================== world FX kit
/** Node factory for one world module. Everything it creates is stopped/disconnected on dispose. */
class Kit {
  constructor(s) {
    this.s = s; this.c = s.ctx
    this.nodes = []; this.srcs = []; this.trig = {}; this.edges = {}
    this.out = this.gain(0); this.out.connect(s.mix)
    this.wet = this.gain(0); this.wet.connect(s.send)
    this.dry = this.gain(1); this.dry.connect(this.out)
    this.fxs = this.gain(1); this.fxs.connect(this.wet)
  }
  reg(n) { this.nodes.push(n); return n }
  gain(v = 0) { const g = this.c.createGain(); g.gain.value = v; return this.reg(g) }
  filter(type, f, q = 0.7) { const b = this.c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return this.reg(b) }
  pan(v = 0) { const p = this.c.createStereoPanner(); p.pan.value = v; return this.reg(p) }
  osc(type, f) { const o = this.c.createOscillator(); o.type = type; o.frequency.value = f; o.start(this.c.currentTime + 0.01); this.srcs.push(o); return this.reg(o) }
  noise(brown = false) { const n = this.c.createBufferSource(); n.buffer = brown ? this.s.brownBuf : this.s.pinkBuf; n.loop = true; n.start(this.c.currentTime + 0.01, Math.random() * 5); this.srcs.push(n); return this.reg(n) }
  shaper(k = 3) {
    const w = this.c.createWaveShaper(), n = 512, curve = new Float32Array(n)
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k) }
    w.curve = curve; w.oversample = '2x'; return this.reg(w)
  }
  /** Route a node to the module's dry path and (optionally) the delay. */
  toOut(n, send = 0) { n.connect(this.dry); if (send) { const g = this.gain(send); n.connect(g).connect(this.fxs) } return n }
  set(param, v, tau = 0.06) { param.setTargetAtTime(v, this.c.currentTime, tau) }
  /** Fires fn once when p crosses th going forward; re-arms below th - hyst; honours a cooldown. Never fires on entry. */
  cross(key, p, th, fn, cool = 1.5, hyst = 0.025) {
    let s = this.trig[key]
    if (!s) s = this.trig[key] = { armed: p < th, last: -99 }
    const now = this.c.currentTime
    if (s.armed && p >= th) { s.armed = false; if (now - s.last >= cool) { s.last = now; fn(now) } }
    else if (!s.armed && p < th - hyst) s.armed = true
  }
  /** Scroll-linked counter: fn(now, i) once per forward increment of n (rate-limited); silent when scrubbing back. */
  count(key, n, fn, gap = 0.035) {
    let s = this.trig[key]
    if (!s) s = this.trig[key] = { v: n, last: -99 }
    const now = this.c.currentTime
    if (n < s.v) s.v = n
    else if (n > s.v && now - s.last >= gap) { s.last = now; fn(now, s.v); s.v = n - s.v > 6 ? n : s.v + 1 }
  }
  /** Clock-synced loop event: fires when the monotonic cycle position u passes phase th (once per cycle). */
  loop(key, u, th, fn) {
    const n = Math.floor(u - th)
    const s = this.trig[key]
    if (!s) { this.trig[key] = { n }; return }
    if (n > s.n) { s.n = n; fn(this.c.currentTime) } else if (n < s.n) s.n = n
  }
  /** Boolean edge detector: returns 'on' / 'off' on change (first call only records state). */
  edge(key, on) { const prev = this.edges[key]; this.edges[key] = on; if (prev == null || prev === on) return null; return on ? 'on' : 'off' }
  /** One-shot helpers routed through this module (so they follow its crossfade weight). */
  blip(f, t, o = {}) { this.s.blip(f, t, { ...o, dest: this.dry, sendDest: this.fxs }) }
  tick(t, o = {}) { this.s.noiseTick(t, { ...o, dest: this.dry, sendDest: this.fxs }) }
  sweep(t, o = {}) { this.s.noiseSweep(t, { ...o, dest: this.dry, sendDest: this.fxs }) }
  thump(t, o = {}) { this.s.thump(t, { ...o, dest: this.dry }) }
  dispose() {
    for (const s of this.srcs) { try { s.stop() } catch { /* not started */ } }
    for (const n of this.nodes) { try { n.disconnect() } catch { /* already */ } }
    this.nodes.length = 0; this.srcs.length = 0
  }
}

/**
 * Abstract formant voice: glottal-ish sawtooth (+breath) → 3 formant bandpasses → syllable envelope → level.
 * No words: syllables with vowel targets, declining intonation, pauses between phrases.
 */
function makeVoice(kit, { f0 = D3, scale = 1, level = 0.5, breath = 0.05, chorus = false, quant = null, smooth = 0.035, dest = null, send = 0.15 } = {}) {
  const src = kit.osc('sawtooth', f0)
  const pre = kit.gain(1)
  src.connect(pre)
  const vib = kit.osc('sine', rnd(4.5, 5.6)), va = kit.gain(chorus ? 9 : 5)
  vib.connect(va).connect(src.detune)
  let src2 = null
  if (chorus) { src2 = kit.osc('sawtooth', f0); src2.detune.value = 9; va.connect(src2.detune); src2.connect(pre) }
  const nz = kit.noise(), ng = kit.gain(breath); nz.connect(ng).connect(pre)
  const env = kit.gain(0), lvl = kit.gain(0)
  const fs = [[1, 7], [0.5, 10], [0.2, 12]].map(([g, q], i) => { const f = kit.filter('bandpass', VOWELS[0][i] * scale, q); const gg = kit.gain(g * 3.2); pre.connect(f).connect(gg).connect(env); return f })
  env.connect(lvl)
  if (dest) lvl.connect(dest); else kit.toOut(lvl, send)
  return { kit, src, src2, env, lvl, fs, f0, scale, level, quant, smooth, next: 0, left: 0, pos: 0, len: 1, phraseEnd: 0, speaking: false }
}

/** Schedule this voice's syllables up to `ahead`. Returns true while a phrase is in progress. */
function talk(v, now, ahead, { pause = [0.3, 0.9], syl = [5, 13] } = {}) {
  if (v.next < now) v.next = now + 0.02
  const c = v.kit.c
  while (v.next < ahead) {
    const t = v.next
    if (v.left <= 0) {
      if (v.speaking) { v.env.gain.setTargetAtTime(0, t, 0.06); v.speaking = false; v.next = t + rnd(pause[0], pause[1]); v.phraseEnd = t; continue }
      v.left = v.len = Math.round(rnd(syl[0], syl[1])); v.speaking = true
    }
    const dur = rnd(0.1, 0.24)
    const i = v.len - v.left // position in phrase → declination
    let semis = 2.5 - (i / Math.max(1, v.len)) * 4 + rnd(-1.4, 1.4)
    if (v.left === 1 && Math.random() < 0.3) semis += 3 // occasional rising end
    let f = v.f0 * Math.pow(2, semis / 12)
    if (v.quant) { let best = v.quant[0]; for (const q of v.quant) if (Math.abs(Math.log(q / f)) < Math.abs(Math.log(best / f))) best = q; f = best }
    v.src.frequency.setTargetAtTime(f, t, v.quant ? 0.06 : 0.04)
    v.src2?.frequency.setTargetAtTime(f, t, 0.06)
    const vw = pick(VOWELS)
    for (let k = 0; k < 3; k++) v.fs[k].frequency.setTargetAtTime(vw[k] * v.scale, t, v.smooth)
    const a = v.level * rnd(0.55, 1)
    v.env.gain.setTargetAtTime(a, t, 0.022)
    v.env.gain.setTargetAtTime(a * (v.quant ? 0.55 : 0.18), t + dur * 0.6, 0.04)
    v.next = t + dur
    v.left--
  }
  return v.speaking
}
function hush(v) { if (!v) return; v.env.gain.setTargetAtTime(0, v.kit.c.currentTime, 0.05); v.left = 0; v.speaking = false; v.next = 0 }

// ================================================================== world FX modules
// Each: (kit, s) => ({ update(p, dt, now, ahead) }) — p is that world's progress.
const FX = {
  // Deep core hum that intensifies as the camera enters the core; an ignition swell when audio first starts here.
  hero(kit, s) {
    const C = CUES.hero
    const hum = kit.gain(0), lp = kit.filter('lowpass', 160, 0.9)
    ;[[D1, 1], [D2, 0.6], [A2, 0.22], [D3, 0.08]].forEach(([f, v]) => { const o = kit.osc(f < 60 ? 'sine' : 'triangle', f); const g = kit.gain(v); o.connect(g).connect(lp) })
    lp.connect(hum); kit.toOut(hum, 0.1)
    const wob = kit.osc('sine', 0.18), wa = kit.gain(40); wob.connect(wa).connect(lp.frequency)
    if (s.ctx.currentTime - s.startedAt < 2.5) { // ignition: noise riser into a soft open-fifth bloom
      const t = s.ctx.currentTime + 0.8
      kit.sweep(t, { from: 140, to: 1400, dur: 5.5, gain: 0.05, q: 1.6, attack: 4.2, send: 0.6 })
      kit.blip(D3, t + 4.6, { gain: 0.05, attack: 1.2, decay: 5, send: 0.6, partials: [[1, 1], [1.5, 0.5], [2, 0.3]] })
    }
    return {
      update(p) {
        const core = ss(C.core[0], C.core[1], p)
        kit.set(hum.gain, 0.05 + 0.15 * core, 0.2)
        kit.set(lp.frequency, 130 + 320 * core, 0.2)
      },
    }
  },

  // SPEECH (formant voice) → STT (tokenising click rain) → LLM (processing swell) → TOOL CALL (lock-in) → TTS (musical voice).
  voice(kit) {
    const C = CUES.voice
    const human = makeVoice(kit, { f0: A2 * 1.02, level: 0.38, breath: 0.07, send: 0.12 })
    const tts = makeVoice(kit, { f0: D3, scale: 1.08, level: 0.34, breath: 0.02, chorus: true, quant: [A2, 130.81, D3, F3, G3, A3], smooth: 0.07, send: 0.35 })
    const llm = kit.gain(0), llp = kit.filter('lowpass', 300, 1.2)
    ;[[D3, 'sawtooth', -6], [A3, 'sawtooth', 5], [F4, 'triangle', 0]].forEach(([f, t, d]) => { const o = kit.osc(t, f); o.detune.value = d; const g = kit.gain(0.25); o.connect(g).connect(llp) })
    const llfo = kit.osc('sine', 0.35), lla = kit.gain(160); llfo.connect(lla).connect(llp.frequency)
    llp.connect(llm); kit.toOut(llm, 0.3)
    return {
      update(p, dt, now, ahead) {
        const sp = band(p, -1, 0, C.speech[1] - 0.04, C.speech[1] + 0.02)
        kit.set(human.lvl.gain, sp, 0.15)
        if (sp > 0.02) talk(human, now, ahead); else if (human.speaking) hush(human)
        const st = band(p, C.stt[0], C.stt[0] + 0.03, C.stt[1] - 0.04, C.stt[1])
        if (st > 0.05 && Math.random() < st * 26 * dt) kit.blip(pick([A5, C6, D6, E6, G5 * 2]), now + 0.02 + Math.random() * 0.03, { gain: 0.03, attack: 0.001, decay: 0.035, pan: rnd(-0.8, 0.8), send: 0.2 })
        const lm = band(p, C.llm[0], C.llm[0] + 0.06, C.llm[1] - 0.05, C.llm[1])
        kit.set(llm.gain, lm * 0.22, 0.25)
        kit.set(llp.frequency, 260 + 1200 * lm * ss(C.llm[0], C.llm[1], p), 0.3)
        kit.cross('tool', p, C.tool, (t) => {
          kit.tick(t + 0.02, { gain: 0.09, freq: 4200, q: 2, dur: 0.02 })
          kit.thump(t + 0.03, { f: 190, to: 80, gain: 0.22, dur: 0.12 })
          kit.tick(t + 0.075, { gain: 0.07, freq: 2600, q: 3, dur: 0.02 })
          kit.blip(D5, t + 0.09, { gain: 0.035, attack: 0.004, decay: 0.5, send: 0.4, partials: [[1, 1], [2, 0.3]] })
        })
        const ts = band(p, C.tts[0] - 0.02, C.tts[0] + 0.02, C.tts[1] - 0.02, C.tts[1] + 0.04)
        kit.set(tts.lvl.gain, ts, 0.2)
        if (ts > 0.02) talk(tts, now, ahead, { pause: [0.35, 0.8], syl: [4, 9] }); else if (tts.speaking) hush(tts)
      },
    }
  },

  // Request tick → delayed reply tock (round trip), humanised.
  realtime(kit) {
    const C = CUES.realtime
    let next = 0
    return {
      update(p, dt, now, ahead) {
        const on = inR(p, C.active)
        if (next < now) next = now + 0.05
        while (next < ahead) {
          const pan = rnd(-0.7, 0.7), rtt = rnd(0.08, 0.26), g = on ? 1 : 0.4
          kit.blip(A6, next, { gain: 0.03 * g, attack: 0.001, decay: 0.045, pan, send: 0.2 })
          kit.blip(D6, next + rtt, { gain: 0.024 * g, attack: 0.002, decay: 0.08, pan: -pan * 0.6, send: 0.35 })
          next += Math.random() < 0.2 ? rnd(0.9, 1.6) : on ? rnd(0.28, 0.6) : rnd(0.8, 1.4)
        }
      },
    }
  },

  // Realistic wail through a horn (waveshaper + bandpass): approaches with the ambulance, doppler drop as it
  // passes the camera on the left, then away. Traffic hum under it; gate ticks; a clunk at preemption.
  siren(kit) {
    const C = CUES.siren
    const tr = kit.gain(0), tlp = kit.filter('lowpass', 320, 0.6)
    kit.noise(true).connect(tlp).connect(tr)
    const hiss = kit.filter('bandpass', 750, 0.6), hg = kit.gain(0.12); kit.noise().connect(hiss).connect(hg).connect(tr)
    const tam = kit.osc('sine', 0.07), tamg = kit.gain(0.04); tam.connect(tamg).connect(hg.gain)
    kit.toOut(tr, 0.15)
    const osc = kit.osc('sawtooth', 660)
    const lfo = kit.osc('sine', 0.27), lfoA = kit.gain(220) // wail 440 <-> 880 Hz (A4..A5)
    lfo.connect(lfoA).connect(osc.frequency)
    const drive = kit.gain(1.4), sh = kit.shaper(2.5)
    const horn = kit.filter('bandpass', 1150, 0.9), air = kit.filter('lowpass', 900, 0.5)
    const pn = kit.pan(-0.1), g = kit.gain(0)
    osc.connect(drive).connect(sh).connect(horn).connect(air).connect(g).connect(pn)
    kit.toOut(pn, 0)
    const far = kit.gain(0); g.connect(far).connect(kit.fxs) // distance -> more reflections
    return {
      update(p) {
        kit.set(tr.gain, 0.4 + 0.15 * band(p, 0.1, 0.3, 0.85, 1), 0.3)
        const z = pieceLin(C.z, p)
        const near = 1 / (1 + Math.abs(z) / 22) // 0.07 far ... 1 at the intersection
        const passT = ss(C.pass[0], C.pass[1], p)
        kit.set(g.gain, 0.01 + 0.15 * near * ss(0, 0.08, p), 0.12)
        kit.set(air.frequency, 650 + 5500 * near * near, 0.15)
        kit.set(far.gain, 0.55 * (1 - near) + 0.08, 0.2)
        kit.set(osc.detune, lerp(70, -85, passT), 0.08) // doppler: ~+70 c approaching, ~-85 c receding
        const side = band(p, C.pass[0] - 0.06, C.pass[0] + 0.02, C.pass[1] - 0.01, C.pass[1] + 0.05)
        kit.set(pn.pan, lerp(-0.12, 0.15, passT) - 0.55 * side, 0.12) // head-on, slightly left -> passes on the left -> ahead
        C.gate.forEach((th, i) => kit.cross('gate' + i, p, th, (t) => kit.blip([D6, F6, A6][i], t + 0.02, { gain: 0.02, attack: 0.002, decay: 0.12, send: 0.2 })))
        kit.cross('preempt', p, C.preempt, (t) => {
          kit.thump(t + 0.02, { f: 120, to: 60, gain: 0.2, dur: 0.14 })
          kit.tick(t + 0.02, { gain: 0.08, freq: 900, q: 1.2, dur: 0.04 })
          kit.tick(t + 0.1, { gain: 0.05, freq: 2400, q: 2.5, dur: 0.02 })
        })
      },
    }
  },

  // Room tone + three formant voices taking turns; chime at the private cue, "sent" whoosh, calendar pick + drop.
  meetai(kit) {
    const C = CUES.meetai
    const room = kit.gain(0.1), rlp = kit.filter('lowpass', 420, 0.5)
    kit.noise(true).connect(rlp).connect(room); kit.toOut(room, 0.1)
    const wall = kit.filter('lowpass', 1500, 0.4), wg = kit.gain(0)
    wall.connect(wg); kit.toOut(wg, 0.35)
    const voices = [[A2, 0.95, 0.5, -0.5], [D3 * 1.12, 1.15, 0.45, 0.45], [F3 * 1.2, 1.22, 0.4, 0.05]].map(([f0, scale, level, pan]) => {
      const pn = kit.pan(pan); pn.connect(wall)
      const v = makeVoice(kit, { f0, scale, level, dest: pn }); v.lvl.gain.value = 1; return v
    })
    let cur = 0, gapUntil = 0
    return {
      update(p, dt, now, ahead) {
        kit.set(wg.gain, (0.3 + 0.7 * band(p, -1, 0, C.talk[1] - 0.06, C.talk[1] + 0.06)) * 0.6, 0.3)
        if (now > gapUntil) {
          const v = voices[cur]
          const busy = talk(v, now, ahead, { pause: [0.2, 0.4], syl: [5, 14] })
          if (!busy && v.phraseEnd) { v.phraseEnd = 0; cur = (cur + 1 + (Math.random() < 0.3 ? 1 : 0)) % 3; gapUntil = now + rnd(0.1, 0.6) }
        }
        kit.cross('brief', p, C.brief, (t) => {
          kit.blip(F5, t + 0.02, { gain: 0.05, attack: 0.004, decay: 1.4, send: 0.6, pan: 0.3, partials: [[1, 1], [2, 0.2], [3, 0.06]] })
          kit.blip(A5, t + 0.16, { gain: 0.045, attack: 0.004, decay: 1.8, send: 0.7, pan: 0.35, partials: [[1, 1], [2, 0.2], [3, 0.06]] })
        })
        kit.cross('email', p, C.email, (t) => kit.sweep(t + 0.02, { from: 500, to: 3800, dur: 0.6, gain: 0.07, q: 1.4, attack: 0.35, panFrom: -0.4, panTo: 0.7, send: 0.5 }))
        kit.cross('calPick', p, C.calPick, (t) => kit.tick(t + 0.02, { gain: 0.04, freq: 2600, q: 3, dur: 0.018 }))
        kit.cross('calDock', p, C.calDock, (t) => {
          kit.tick(t + 0.02, { gain: 0.06, freq: 1800, q: 2, dur: 0.02 })
          kit.blip(D5, t + 0.03, { gain: 0.05, attack: 0.002, decay: 0.18, send: 0.3, partials: [[1, 1], [2.7, 0.2]] })
          kit.thump(t + 0.03, { f: 220, to: 140, gain: 0.08, dur: 0.08 })
        })
      },
    }
  },

  // Live call (line tone + two voices through a phone band) -> CALL DROP (cut, then only the room) ->
  // callback ring -> caller speaks -> agent rejoins (join tone) -> agent voice resumes.
  continuum(kit) {
    const C = CUES.continuum
    const phone = kit.filter('bandpass', 1100, 0.55), line = kit.gain(0)
    const lineTone = kit.osc('sine', A4), ltg = kit.gain(0.04); lineTone.connect(ltg).connect(line)
    phone.connect(line); kit.toOut(line, 0.12)
    const agent = makeVoice(kit, { f0: D3 * 1.1, scale: 1.1, level: 0.6, dest: phone, breath: 0.04 })
    const caller = makeVoice(kit, { f0: A2 * 1.05, scale: 0.97, level: 0.6, dest: phone, breath: 0.05 })
    agent.lvl.gain.value = 1; caller.lvl.gain.value = 1
    let lastP = -1, turn = 0
    return {
      update(p, dt, now, ahead) {
        const prev = lastP; lastP = p
        const live = p < C.drop
        const lineOn = live || p >= C.line
        if (prev >= 0 && prev < C.drop && p >= C.drop) { // line cut: click + short digital crunch
          const t = now + 0.01
          kit.tick(t, { gain: 0.1, freq: 1400, q: 0.8, dur: 0.03 })
          for (let i = 0; i < 3; i++) kit.tick(t + 0.05 + i * 0.045, { gain: 0.05, freq: rnd(900, 2600), q: 4, dur: 0.02 })
        }
        kit.cross('ring', p, C.ring, (t) => { for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) kit.blip(i % 2 ? F5 : D5, t + 0.05 + r * 0.9 + i * 0.05, { gain: 0.025, attack: 0.003, decay: 0.06, send: 0.2 }) }, 3)
        kit.cross('rejoin', p, C.rejoin, (t) => [D5, A5, D6].forEach((f, i) => kit.blip(f, t + 0.05 + i * 0.16, { gain: 0.035, attack: 0.01, decay: 0.3, send: 0.35 })), 3)
        kit.set(line.gain, lineOn ? 0.9 : 0, lineOn ? 0.35 : 0.012)
        // who talks: live call = turn taking; callback = the caller; after rejoin = the agent
        let who = null
        if (live && p < C.drop - 0.01) who = turn ? caller : agent
        else if (inR(p, C.caller)) who = caller
        else if (p >= C.agent) who = agent
        for (const v of [agent, caller]) if (v !== who && v.speaking) hush(v)
        if (who) { const busy = talk(who, now, ahead, { pause: [0.3, 0.7], syl: [4, 11] }); if (!busy && who.phraseEnd && live) { who.phraseEnd = 0; turn = 1 - turn } }
      },
    }
  },

  // A glassy chime per top-k chunk as retrieval lights them; synaptic crackles for propagation waves.
  knowledge(kit) {
    const C = CUES.knowledge
    const notes = [D6, A5, F6, C6, E6, A6, D5 * 2, G5 * 2]
    let nextIdle = 0
    const crackle = (t, amp = 1) => { for (let i = 0; i < 12; i++) kit.tick(t + i * rnd(0.04, 0.09), { gain: 0.02 * amp * rnd(0.4, 1) * (1 - i / 14), freq: rnd(1500, 5200), q: 6, dur: 0.012, pan: rnd(-0.9, 0.9) }) }
    return {
      update(p, dt, now) {
        const n = Math.floor(C.topk * ss(C.chunks[0], C.chunks[1], p) + 1e-6)
        kit.count('chunks', n, (t, i) => kit.blip(notes[i % notes.length], t + 0.02, { gain: 0.04, attack: 0.003, decay: 2.4, pan: rnd(-0.7, 0.7), send: 0.8, partials: [[1, 1], [2, 0.22], [3, 0.08], [4.2, 0.03]] }), 0.06)
        C.waves.forEach((th, i) => kit.cross('wave' + i, p, th, (t) => crackle(t + 0.02, 1.4), 1.2))
        if (nextIdle < now) { if (nextIdle) crackle(now + 0.02, 0.6 + ss(0.8, 1, p) * 0.6); nextIdle = now + (p > 0.8 ? rnd(1.4, 2.9) : rnd(2.6, 4.1)) }
      },
    }
  },

  // Datacenter fans (clearly audible) + hum in A; relay clicks synced to the build landings (every 2.4 s on the
  // world clock); a quiet deploy chime reaching the cluster; soft ticks as the closing line appears word by word.
  infra(kit, s) {
    const C = CUES.infra
    const fan = kit.gain(0), flp = kit.filter('lowpass', 520, 0.6)
    kit.noise(true).connect(flp).connect(fan)
    const whr = kit.filter('bandpass', 380, 0.8), wg = kit.gain(0.5); kit.noise().connect(whr).connect(wg).connect(fan)
    const blade = kit.osc('sine', 23), bg = kit.gain(0.12); blade.connect(bg).connect(wg.gain) // blade-pass flutter
    const hum = kit.filter('lowpass', 420, 0.6), hg = kit.gain(0.1)
    ;[[55, 'sine', 1], [110, 'sine', 0.5], [165, 'triangle', 0.2], [220, 'sine', 0.08]].forEach(([f, t, v]) => { const o = kit.osc(t, f); const g = kit.gain(v); o.connect(g).connect(hum) })
    hum.connect(hg).connect(fan)
    kit.toOut(fan, 0.08)
    return {
      update(p) {
        const inside = ss(0.22, 0.4, p) * (1 - ss(0.84, 0.98, p))
        kit.set(fan.gain, 0.22 + 0.2 * inside, 0.3)
        const T = s.engine.t || 0
        if (T > 15.7) kit.loop('land', (T - 15.7) / 2.4, 0, (t) => {
          const a = band(p, C.land[0], C.land[0] + 0.08, C.land[1] - 0.06, C.land[1]); if (a < 0.05) return
          const pan = rnd(-0.6, 0.6)
          kit.tick(t + 0.02, { gain: 0.05 * a, freq: rnd(1800, 3000), q: 3, dur: 0.018, pan })
          kit.tick(t + 0.02 + rnd(0.03, 0.06), { gain: 0.035 * a, freq: rnd(1200, 1900), q: 3, dur: 0.015, pan })
        })
        kit.cross('deploy', p, C.cluster, (t) => [D5, F5, A5, D6].forEach((f, i) => kit.blip(f, t + 0.03 + i * 0.12, { gain: 0.035, attack: 0.006, decay: 1.4, send: 0.6, partials: [[1, 1], [2, 0.2], [3, 0.05]] })), 3)
        const words = Math.floor(C.nWords * ss(C.words[0], C.words[1], p) + 1e-6)
        kit.count('words', words, (t) => kit.tick(t + 0.01, { gain: 0.03, freq: rnd(2600, 3400), q: 3, dur: 0.02 }), 0.05)
      },
    }
  },

  // One soft key tick per character typed (command, description, search); enter; play press; RUN; output
  // lines; success chime on "done · 4 services up".
  runbook(kit) {
    const C = CUES.runbook
    const key = (t, big) => {
      kit.tick(t + Math.random() * 0.012, { gain: (big ? 0.08 : 0.07) * rnd(0.7, 1), freq: big ? rnd(1100, 1500) : rnd(2200, 3600), q: big ? 1.5 : 2.5, dur: big ? 0.04 : 0.025, pan: rnd(-0.25, 0.25) })
      kit.thump(t + 0.004, { f: big ? 150 : 240, to: 120, gain: 0.03, dur: 0.03 })
    }
    return {
      update(p) {
        C.type.forEach(([a, b, n], i) => kit.count('type' + i, Math.floor(n * ss(a, b, p) + 1e-6), (t) => key(t + 0.01, Math.random() < 0.12), 0.035))
        kit.cross('enter', p, C.enter, (t) => key(t + 0.01, true))
        kit.cross('play', p, C.play, (t) => { kit.tick(t + 0.01, { gain: 0.06, freq: 1300, q: 1.5, dur: 0.04 }); kit.thump(t + 0.01, { f: 200, to: 110, gain: 0.06, dur: 0.06 }) })
        kit.cross('run', p, C.run, (t) => kit.blip(A4, t + 0.02, { gain: 0.03, attack: 0.004, decay: 0.3, send: 0.3 }))
        kit.count('lines', Math.floor(C.lines[2] * ss(C.lines[0], C.lines[1], p) + 1e-6), (t) => kit.tick(t + 0.01, { gain: 0.025, freq: 3200, q: 4, dur: 0.012 }), 0.05)
        kit.cross('done', p, C.done, (t) => { kit.blip(A5, t + 0.03, { gain: 0.04, attack: 0.004, decay: 0.7, send: 0.5 }); kit.blip(D6, t + 0.14, { gain: 0.035, attack: 0.004, decay: 1.3, send: 0.6 }) }, 2)
      },
    }
  },

  // Low alert pulse while threats are detected/correlated; stage-change ticks; and, synced to the world's 9 s
  // policy loop (engine clock): iris "shhk" as the gate blades open/close, a muted buzz for BLOCKED.
  shieldx(kit, s) {
    const C = CUES.shieldx
    const env = kit.gain(0), lvl = kit.gain(0), lp = kit.filter('lowpass', 240, 0.8)
    ;[[D2, 1], [A2, 0.45], [D3, 0.12]].forEach(([f, v]) => { const o = kit.osc('sine', f); const g = kit.gain(v); o.connect(g).connect(lp) })
    lp.connect(env).connect(lvl); kit.toOut(lvl, 0.15)
    let nextBeat = 0
    return {
      update(p, dt, now, ahead) {
        const th = band(p, C.threats[0] - 0.04, C.threats[0], C.threats[1], C.threats[1] + 0.06)
        kit.set(lvl.gain, 0.05 + 0.17 * th, 0.2)
        if (nextBeat < now) nextBeat = now + 0.05
        while (nextBeat < ahead) {
          const g = env.gain, t = nextBeat
          g.setTargetAtTime(1, t, 0.012); g.setTargetAtTime(0, t + 0.07, 0.1)
          g.setTargetAtTime(0.55, t + 0.28, 0.012); g.setTargetAtTime(0, t + 0.34, 0.13)
          nextBeat += th > 0.5 ? 0.85 : 1.2
        }
        C.stages.forEach((st, i) => kit.cross('st' + i, p, st, (t) => kit.blip(D6, t + 0.02, { gain: 0.018, attack: 0.002, decay: 0.1, send: 0.25 }), 0.6))
        const pol = band(p, C.policy[0], C.policy[0] + 0.04, C.policy[1] - 0.04, C.policy[1])
        const u = (s.engine.t || 0) / C.loop
        const iris = (t, open) => {
          kit.sweep(t + 0.02, { from: open ? 900 : 4200, to: open ? 4200 : 900, dur: 0.22, gain: 0.08 * pol, q: 2, attack: 0.03, send: 0.25 })
          kit.tick(t + 0.23, { gain: 0.07 * pol, freq: 1500, q: 2, dur: 0.03 })
          kit.thump(t + 0.23, { f: 160, to: 90, gain: 0.09 * pol, dur: 0.08 })
        }
        kit.loop('open', u, C.open, (t) => { if (pol > 0.05) iris(t, true) })
        kit.loop('close', u, C.close, (t) => { if (pol > 0.05) iris(t, false) })
        kit.loop('blocked', u, C.blocked, (t) => { if (pol > 0.05) for (let i = 0; i < 2; i++) kit.blip(A2, t + 0.03 + i * 0.2, { type: 'sawtooth', gain: 0.07 * pol, attack: 0.008, decay: 0.14, send: 0.1, lp: 700 }) })
      },
    }
  },

  // Radio static that swells while each carrier is acquired and clears as it locks (the carriers are bed tones).
  signals(kit) {
    const C = CUES.signals
    const st = kit.gain(0), bp = kit.filter('bandpass', 1800, 0.7), hp = kit.filter('highpass', 400, 0.5)
    kit.noise().connect(hp).connect(bp).connect(st)
    const fl = kit.osc('sine', 7.3), fg = kit.gain(0.25); fl.connect(fg).connect(st.gain) // crackle flutter
    kit.toOut(st, 0.2)
    return {
      update(p, dt, now) {
        let clear = 0, search = 0
        C.locks.forEach((l, i) => { clear += ss(l - 0.05, l, p); search = Math.max(search, band(p, C.arrive[i], C.arrive[i] + 0.03, l - 0.05, l)) })
        kit.set(st.gain, (0.05 + 0.3 * search) * (1 - clear / 4), 0.1)
        kit.set(bp.frequency, 1200 + 900 * Math.sin(now * 0.7), 0.3)
        if (Math.random() < (0.5 + search * 10) * dt) kit.tick(now + 0.02, { gain: 0.03 * rnd(0.3, 1), freq: rnd(1500, 5000), q: 5, dur: 0.01, pan: rnd(-0.6, 0.6) })
      },
    }
  },

  // Machinery powering up: a servo whir per stage; at SCALE a ratchet tick per lane (30) while a turbine spins up.
  experience(kit) {
    const C = CUES.experience
    const tb = kit.gain(0), tlp = kit.filter('lowpass', 600, 0.8)
    const t1 = kit.osc('sawtooth', 60), t2 = kit.osc('triangle', 120)
    const tn = kit.filter('bandpass', 400, 3), tng = kit.gain(0.35); kit.noise().connect(tn).connect(tng).connect(tb)
    const g1 = kit.gain(0.3), g2 = kit.gain(0.25); t1.connect(g1).connect(tlp); t2.connect(g2).connect(tlp); tlp.connect(tb)
    kit.toOut(tb, 0.2)
    return {
      update(p) {
        C.stages.forEach((th, i) => kit.cross('stage' + i, p, th - 0.005, (t) => {
          const f0 = [D3, F3, A3, D4, F4][i]
          kit.s.whir(t + 0.02, { f: f0, to: f0 * 2, dur: 0.6, gain: 0.05, dest: kit.dry, sendDest: kit.fxs })
          kit.thump(t + 0.65, { f: 110, to: 70, gain: 0.08, dur: 0.1 })
        }))
        kit.count('lanes', Math.floor(C.lanes * ss(C.scale[0], C.scale[1], p) + 1e-6), (t, i) => kit.tick(t + 0.01, { gain: 0.03, freq: 1800 + i * 40, q: 4, dur: 0.012 }), 0.03)
        const sc = ss(C.scale[0], C.scale[1], p), on = band(p, C.scale[0] - 0.03, C.scale[0] + 0.01, 0.97, 1.05)
        const f = D2 * Math.pow(2, sc * 2) // D2 -> D4 as the lanes spin up
        kit.set(t1.frequency, f, 0.12); kit.set(t2.frequency, f * 1.5, 0.12)
        kit.set(tn.frequency, 300 + 2400 * sc, 0.12)
        kit.set(tlp.frequency, 300 + 2200 * sc, 0.15)
        kit.set(tb.gain, on * (0.06 + 0.16 * sc) * (1 - 0.4 * ss(C.scale[1] + 0.05, C.final, p)), 0.15)
        kit.cross('final', p, C.final, (t) => [D4, A4, D5, F5].forEach((fr, i) => kit.blip(fr, t + 0.05 + i * 0.09, { gain: 0.025, attack: 0.2, decay: 3, send: 0.7, pan: [-0.5, 0.5, -0.2, 0.2][i] })), 3)
      },
    }
  },

  // A soft glass note when the focused ecosystem changes.
  skills(kit) {
    const C = CUES.skills
    return {
      update(p) {
        C.keys.forEach((k, i) => kit.cross('k' + i, p, k - 0.04, (t) => kit.blip([D6, F6, A5, C6, E6][i], t + 0.02, { gain: 0.03, attack: 0.004, decay: 2, send: 0.8, pan: rnd(-0.5, 0.5), partials: [[1, 1], [2, 0.2], [3, 0.06]] }), 0.8))
      },
    }
  },

  // A soft chime per link completed (38, rate-limited); a wide chord swell as the name resolves.
  finale(kit) {
    const C = CUES.finale
    const notes = [D5, F5, A5, C6, D6, E6, A5, F5, D6, A6, C6, E6]
    return {
      update(p) {
        let n = 0; while (n < FINALE_LINKS.length && FINALE_LINKS[n] <= p) n++
        kit.count('links', n, (t, i) => kit.blip(notes[i % notes.length], t + 0.02, { gain: 0.018, attack: 0.01, decay: 2, pan: rnd(-0.8, 0.8), send: 0.8, partials: [[1, 1], [2, 0.15]] }), 0.07)
        kit.cross('resolve', p, C.resolve, (t) => [D3, A3, D4, F4, A4, E5].forEach((f, i) => kit.blip(f, t + 0.05 + i * 0.07, { gain: 0.03, attack: 0.9, decay: 6, send: 0.8, pan: [-0.7, 0.7, -0.35, 0.35, -0.15, 0.15][i], partials: [[1, 1], [2, 0.12]] })), 4)
      },
    }
  },
}

// ================================================================== the soundscape
export class Soundscape {
  constructor(engine) {
    this.engine = engine
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
    this.reduced = !!engine?.ctx?.reducedMotion
    this.muted = false
    try { this.muted = localStorage.getItem(STORE) === 'off' } catch { /* storage blocked */ }
    this.started = false
    this.hidden = typeof document !== 'undefined' && document.hidden
    this.acc = 0; this.barAcc = 0; this.life = 0
    this.cur = tintOf('hero', 0, {})
    this._a = {}; this._b = {}; this._t = {}
    this.locks = [0, 0, 0]
    this.mods = new Map()
    this.voices = 0
    this.lastHover = 0
    this.bars = [0, 0, 0, 0]
    if (!this.supported) return
    this.buildToggle()
    this.bind()
  }

  // ------------------------------------------------------------------ UI
  buildToggle() {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sound-toggle'
    b.setAttribute('data-magnetic', '0.3')
    b.innerHTML = '<span class="st-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="st-label">SOUND</span>'
    b.addEventListener('click', (e) => { e.preventDefault(); this.toggle() })
    document.body.appendChild(b)
    this.el = b
    this.barEls = [...b.querySelectorAll('.st-bars i')]
    this.syncUi()
  }

  syncUi() {
    if (!this.el) return
    const state = this.muted ? 'off' : this.started ? 'on' : 'armed'
    this.el.dataset.state = state
    this.el.setAttribute('aria-pressed', String(!this.muted))
    const label = this.muted ? 'Sound off. Press to turn on (M)' : this.started ? 'Sound on. Press to mute (M)' : 'Sound armed. Starts on your first interaction (M)'
    this.el.setAttribute('aria-label', label)
    this.el.title = label
  }

  bind() {
    const arm = (e) => {
      if (this.started || this.muted) { if (this.started && !this.muted && this.ctx?.state !== 'running' && !this.hidden) this.resume(); return }
      if (e.target?.closest?.('.sound-toggle')) return // the toggle's own click decides
      if (navigator.userActivation && !navigator.userActivation.isActive) return // not a real activation (e.g. touchstart on mobile Chrome)
      this.start()
    }
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'click']) addEventListener(t, arm, { capture: true, passive: true })
    addEventListener('keydown', (e) => {
      const t = e.target
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'm' || e.key === 'M') && !e.repeat) { this.toggle(); return }
      arm(e)
    }, { capture: true })
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      if (!this.started) return
      if (!this.hidden && !this.muted) this.resume()
      this.gate(this.hidden ? 0.5 : 1.5)
    })
    // micro-interactions
    const SEL = 'a, button, [data-magnetic]'
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return
      const el = e.target?.closest?.(SEL)
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return
      this.uiTick()
    }, { passive: true })
    document.addEventListener('click', (e) => {
      const el = e.target?.closest?.(SEL)
      if (el && !el.classList.contains('sound-toggle')) this.uiConfirm()
    }, { passive: true })
  }

  /** Toggle sound. When armed but not yet running, a press means "yes, play". */
  toggle() {
    if (!this.supported) return
    if (!this.started) { this.setMuted(false); return }
    this.setMuted(!this.muted)
  }

  /** Mute / unmute with a ~1 s ramp. Persists the choice. */
  setMuted(m) {
    if (!this.supported) return
    this.muted = !!m
    try { localStorage.setItem(STORE, this.muted ? 'off' : 'on') } catch { /* storage blocked */ }
    if (!this.muted && !this.started) this.start()
    else if (this.started) {
      if (!this.muted) this.resume()
      this.gate(1)
      if (!this.muted) this.uiConfirm(true)
    }
    this.syncUi()
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.started || !this.supported) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      this.ctx = new AC({ latencyHint: 'playback' })
      this.build()
    } catch {
      this.supported = false
      if (this.el) this.el.style.display = 'none'
      return
    }
    this.started = true
    const now = this.ctx.currentTime
    this.startedAt = now
    // slow, eased fade-in from silence
    const curve = new Float32Array(64)
    for (let i = 0; i < 64; i++) { const x = i / 63; curve[i] = Math.pow(x * x * (3 - 2 * x), 1.6) }
    this.fade.gain.setValueAtTime(0, now)
    try { this.fade.gain.setValueCurveAtTime(curve, now + 0.05, FADE_IN) } catch { this.fade.gain.linearRampToValueAtTime(1, now + FADE_IN) }
    this.gate(0.05)
    this.resume()
    this.syncUi()
  }

  resume() {
    clearTimeout(this._susp)
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {})
  }

  /** Ramp the mute/visibility gate; suspends the context once silent to save CPU. */
  gate(dur) {
    if (!this.ctx) return
    const target = !this.muted && !this.hidden ? 1 : 0
    const g = this.gateGain.gain, now = this.ctx.currentTime
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now)
    else { const v = g.value; g.cancelScheduledValues(now); g.setValueAtTime(v, now) }
    g.linearRampToValueAtTime(target, now + dur)
    clearTimeout(this._susp)
    if (!target) this._susp = setTimeout(() => { if ((this.muted || this.hidden) && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}) }, dur * 1000 + 250)
  }

  // ------------------------------------------------------------------ bed graph
  build() {
    const c = this.ctx
    const G = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g }
    const F = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b }
    const O = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; return o }
    const sources = []
    const S = (n) => { sources.push(n); return n }
    this.pinkBuf = noiseBuffer(c, 6, false)
    this.brownBuf = noiseBuffer(c, 6, true)

    // output chain
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.75
    this.analyser.minDecibels = -100; this.analyser.maxDecibels = -35
    this.fbuf = new Uint8Array(this.analyser.frequencyBinCount)
    const lim = c.createDynamicsCompressor()
    lim.threshold.value = -18; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = 0.004; lim.release.value = 0.3
    this.master = G(this.reduced ? MASTER_REDUCED : MASTER)
    this.gateGain = G(0)
    this.fade = G(0)
    this.mix = G(1)
    this.mix.connect(this.fade).connect(this.gateGain).connect(this.master).connect(lim).connect(this.analyser).connect(c.destination)

    // space: ping-pong delay with a darkening loop
    this.send = G(1)
    const dl = c.createDelay(1), dr = c.createDelay(1)
    dl.delayTime.value = 0.37; dr.delayTime.value = 0.53
    const dark = F('lowpass', 2400), fb = G(0.42), x = G(0.9), wet = G(0.5)
    const pl = c.createStereoPanner(), pr = c.createStereoPanner(); pl.pan.value = -0.7; pr.pan.value = 0.7
    this.send.connect(dark).connect(dl)
    dl.connect(x).connect(dr); dr.connect(fb).connect(dark)
    dl.connect(pl).connect(wet); dr.connect(pr).connect(wet)
    wet.connect(this.mix)

    // pad
    this.padDetune = S(c.createConstantSource()); this.padDetune.offset.value = 0
    this.padFilter = F('lowpass', 400, 0.9)
    this.padOut = G(0.35)
    this.padFilter.connect(this.padOut).connect(this.mix)
    this.padV = PAD.map(([f, type, det]) => {
      const o = S(O(type, f)); o.detune.value = det
      this.padDetune.connect(o.detune)
      const g = G(0); o.connect(g).connect(this.padFilter)
      return { o, g, det, drift: 0 }
    })
    const lfo = S(O('sine', 0.045)), lfoAmt = G(110)
    lfo.connect(lfoAmt).connect(this.padFilter.frequency)
    const padSend = G(0.22); this.padOut.connect(padSend).connect(this.send)

    // sub
    const sub = S(O('sine', D1)), sub2 = S(O('sine', D2)), sub2g = G(0.35)
    this.subGain = G(0)
    sub.connect(this.subGain); sub2.connect(sub2g).connect(this.subGain)
    this.subGain.connect(this.mix)

    // noise beds
    const pink = S(c.createBufferSource()); pink.buffer = this.pinkBuf; pink.loop = true
    const brown = S(c.createBufferSource()); brown.buffer = this.brownBuf; brown.loop = true
    this.airLP = F('lowpass', 1000, 0.5)
    this.airGain = G(0)
    pink.connect(F('highpass', 140, 0.5)).connect(this.airLP).connect(this.airGain).connect(this.mix)
    this.whBP = F('bandpass', 400, 1.3)
    this.whGain = G(0)
    pink.connect(this.whBP).connect(this.whGain).connect(this.mix)
    this.whGain.connect(this.send)
    this.brownGain = G(0)
    brown.connect(F('lowpass', 420, 0.6)).connect(this.brownGain).connect(this.mix)

    // tone bank
    this.toneBus = G(1)
    const tLP = F('lowpass', 2600, 0.5)
    this.toneBus.connect(tLP).connect(this.mix); tLP.connect(this.send)
    this.tones = TONES.map((f, i) => {
      const o = S(O('sine', f)), g = G(0), p = c.createStereoPanner()
      p.pan.value = TONE_PAN[i]
      o.connect(g).connect(p).connect(this.toneBus)
      return { o, g }
    })

    // one-shot bus
    this.fx = G(1)
    this.fx.connect(this.mix)

    const t0 = c.currentTime + 0.02
    sources.forEach((s) => s.start(t0))
  }

  // ------------------------------------------------------------------ one-shots (self-disconnecting)
  _done(nodes, first) {
    this.voices++
    first.onended = () => { this.voices--; for (const n of nodes) { try { n.disconnect() } catch { /* already */ } } }
  }

  /** Soft sine blip (optionally with partials / lowpass). */
  blip(freq, t, { gain = 0.03, attack = 0.015, decay = 1.2, pan = 0, send = 0.5, partials = null, type = 'sine', lp = 0, dest = null, sendDest = null } = {}) {
    if (this.voices > 40) return
    const c = this.ctx
    const env = c.createGain(), p = c.createStereoPanner(), sg = c.createGain()
    p.pan.value = clamp(pan, -1, 1); sg.gain.value = send
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain, t + attack)
    env.gain.setTargetAtTime(0, t + attack, decay / 4.5)
    const nodes = [env, p, sg]
    let head = env
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.7; f.connect(env); head = f; nodes.push(f) }
    env.connect(p); p.connect(dest || this.fx); if (send) p.connect(sg).connect(sendDest || this.send)
    const oscs = (partials || [[1, 1]]).map(([m, v]) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq * m
      nodes.push(o)
      if (v === 1) { o.connect(head); return o }
      const pg = c.createGain(); pg.gain.value = v; o.connect(pg).connect(head); nodes.push(pg); return o
    })
    const end = t + attack + decay + 0.1
    oscs.forEach((o) => { o.start(t); o.stop(end) })
    this._done(nodes, oscs[0])
  }

  /** Soft filtered-noise tick (key / click / crackle). */
  noiseTick(t, { gain = 0.03, freq = 3000, q = 3, dur = 0.035, pan = 0, dest = null } = {}) {
    if (this.voices > 40) return
    const c = this.ctx
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), env = c.createGain(), p = c.createStereoPanner()
    src.buffer = this.pinkBuf
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q
    p.pan.value = clamp(pan, -1, 1)
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain * (1 + q * 0.35), t + 0.002)
    env.gain.setTargetAtTime(0, t + 0.003, dur / 4)
    src.connect(bp).connect(env).connect(p).connect(dest || this.fx)
    src.start(t, Math.random() * 5, dur + 0.05)
    this._done([src, bp, env, p], src)
  }

  /** Noise through a sweeping bandpass (whoosh / riser / iris). */
  noiseSweep(t, { from = 400, to = 3000, dur = 0.6, gain = 0.06, q = 1.4, attack = 0.3, panFrom = 0, panTo = 0, send = 0.3, dest = null, sendDest = null } = {}) {
    if (this.voices > 40) return
    const c = this.ctx
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), env = c.createGain(), p = c.createStereoPanner(), sg = c.createGain()
    src.buffer = this.pinkBuf; src.loop = true
    bp.type = 'bandpass'; bp.Q.value = q
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur)
    p.pan.setValueAtTime(panFrom, t); p.pan.linearRampToValueAtTime(panTo, t + dur)
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(gain * 2.2, t + attack)
    env.gain.setTargetAtTime(0, t + attack, Math.max(0.03, (dur - attack) / 3))
    sg.gain.value = send
    src.connect(bp).connect(env).connect(p).connect(dest || this.fx)
    if (send) p.connect(sg).connect(sendDest || this.send)
    src.start(t, Math.random() * 5); src.stop(t + dur + 0.6)
    this._done([src, bp, env, p, sg], src)
  }

  /** Low pitched-down sine thump (mechanical weight). */
  thump(t, { f = 160, to = 70, gain = 0.1, dur = 0.1, dest = null } = {}) {
    if (this.voices > 40) return
    const c = this.ctx
    const o = c.createOscillator(), env = c.createGain()
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(to, t + dur)
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + 0.004); env.gain.setTargetAtTime(0, t + 0.01, dur / 3)
    o.connect(env).connect(dest || this.fx)
    o.start(t); o.stop(t + dur + 0.25)
    this._done([o, env], o)
  }

  /** Servo whir: a gliding filtered saw. */
  whir(t, { f = 200, to = 400, dur = 0.5, gain = 0.05, dest = null, sendDest = null } = {}) {
    if (this.voices > 40) return
    const c = this.ctx
    const o = c.createOscillator(), bp = c.createBiquadFilter(), env = c.createGain(), sg = c.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8)
    bp.type = 'bandpass'; bp.Q.value = 2.5
    bp.frequency.setValueAtTime(f * 3, t); bp.frequency.exponentialRampToValueAtTime(to * 3, t + dur * 0.8)
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + 0.06); env.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.12)
    sg.gain.value = 0.3
    o.connect(bp).connect(env).connect(dest || this.fx); env.connect(sg).connect(sendDest || this.send)
    o.start(t); o.stop(t + dur + 0.5)
    this._done([o, bp, env, sg], o)
  }

  live() { return this.started && !this.muted && !this.hidden && this.ctx && this.ctx.state === 'running' }

  uiTick() {
    if (!this.live()) return
    const now = this.ctx.currentTime
    if (now - this.lastHover < 0.07) return
    this.lastHover = now
    this.blip(D6, now + 0.005, { gain: 0.045, attack: 0.003, decay: 0.06, send: 0.15, pan: (this.engine.pointer?.x || 0) * 0.5 })
  }

  uiConfirm(force) {
    if (!this.ctx || (!force && !this.live())) return
    const now = this.ctx.currentTime + 0.01
    this.blip(D5, now, { gain: 0.05, attack: 0.006, decay: 0.45, send: 0.4 })
    this.blip(A5, now + 0.07, { gain: 0.035, attack: 0.006, decay: 0.6, send: 0.5 })
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (!this.supported || !this.el) return
    if (!this.live()) { this.drawBars(dt, true); return }
    this.acc += dt
    if (this.acc >= TICK) { try { this.control(Math.min(this.acc, 0.1)) } catch (e) { if (!this._warned) { this._warned = true; console.warn('[audio]', e) } } this.acc = 0 }
    this.drawBars(dt, false)
  }

  set(param, v, tau = 0.06) { param.setTargetAtTime(v, this.ctx.currentTime, tau) }

  control(dt) {
    const e = this.engine, c = this.ctx, now = c.currentTime
    const st = e.state || { index: 0, p: 0, k: 0 }
    const worlds = e.worlds || []
    const idA = worlds[st.index]?.meta?.id || 'hero'
    const idB = st.k > 0 ? worlds[st.index + 1]?.meta?.id || idA : idA
    const p = st.p || 0, k = st.k || 0
    const ek = k * k * (3 - 2 * k)
    const A = tintOf(idA, p, this._a), B = tintOf(idB, 0, this._b), T = this._t
    for (const key of KEYS) T[key] = A[key] + (B[key] - A[key]) * ek
    const cur = this.cur
    for (const key of KEYS) cur[key] = damp(cur[key], T[key], 1.6, dt) // ~2 s crossfade

    this.life = clamp((now - this.startedAt) / 14)
    const warp = this.reduced ? 0 : clamp(e.warpAmount || 0)
    this.ptr = damp(this.ptr || 0, clamp((e.pointer?.speed || 0) / 3), 3, dt)
    this.vel = damp(this.vel || 0, clamp(Math.abs(e.lenis?.velocity || 0) / 40), 3, dt)

    // ---- bed ----
    for (let i = 0; i < 8; i++) {
      const v = this.padV[i]
      this.set(v.g.gain, cur['p' + i] * PAD[i][3], 0.1)
      v.drift = clamp(v.drift + (Math.random() - 0.5) * 0.8, -6, 6) // slow random detune walk
      this.set(v.o.detune, v.det + v.drift, 0.8)
    }
    this.set(this.padOut.gain, cur.pad * 0.35)
    const cut = cur.cut * (0.35 + 0.65 * smoothstep(0, 1, this.life)) + this.ptr * 260 + warp * 600 + this.vel * 120
    this.set(this.padFilter.frequency, clamp(cut, 120, 5000), 0.12)
    this.set(this.padDetune.offset, warp * 45, 0.15)
    this.set(this.subGain.gain, cur.sub * 0.3, 0.15)
    this.set(this.airGain.gain, cur.air * 0.1 * (1 + this.vel * 0.5), 0.15)
    this.set(this.airLP.frequency, cur.airCut * (1 + this.vel * 0.3), 0.2)
    this.set(this.brownGain.gain, cur.brown * 0.16, 0.2)
    // flights: filtered whoosh swelling with warp, sweeping up across the flight
    this.set(this.whGain.gain, Math.pow(warp, 1.6) * 0.28, 0.08)
    this.set(this.whBP.frequency, 260 * Math.pow(2, k * 3.3), 0.08)

    // signals: bed carriers search (detuned, wobbling) and lock to a pure sine at each achievement
    const sigW = (idA === 'signals' ? 1 - ek : 0) + (idB === 'signals' ? ek : 0)
    const pS = idA === 'signals' ? p : 0
    const sig = [0, 0, 0]
    CUES.signals.locks.forEach((th, i) => {
      const lock = ss(th - 0.05, th, pS)
      if (lock > 0.97 && this.locks[i] <= 0.97 && sigW > 0.5) this.blip(TONES[3 + i] * 2, now + 0.02, { gain: 0.03, attack: 0.01, decay: 1.8, send: 0.8 })
      this.locks[i] = lock
      const a0 = CUES.signals.arrive[i], presence = 0.15 + 0.85 * ss(a0, a0 + 0.075, pS)
      const wob = (1 - lock) * (38 * Math.sin(now * 1.3 + i * 2.1) + 17 * Math.sin(now * 4.1 + i))
      this.set(this.tones[3 + i].o.detune, wob * sigW, 0.05)
      sig[i] = presence * (0.35 + 0.65 * lock) * [1, 0.85, 0.65][i]
    })
    for (let i = 0; i < this.tones.length; i++) {
      let g = cur['t' + i]
      if (i >= 3 && i <= 5 && sigW > 0) g = lerp(g, sig[i - 3], sigW)
      this.set(this.tones[i].g.gain, g * 0.034 * (0.5 + 0.5 * this.life), 0.12)
    }

    // ambient glint streams
    const r = Math.random
    if (r() < cur.glint * dt) this.blip(pick([D5, F5, A5, C6, D6, E6]), now + 0.03 + r() * 0.05, { gain: 0.026, attack: 0.02, decay: 1.8, pan: (r() - 0.5) * 1.2, send: 0.65 })
    if (r() < cur.glass * dt) this.blip(pick([A5, C6, D6, E6, F6, A6]), now + 0.03, { gain: 0.024, attack: 0.004, decay: 2.8, pan: (r() - 0.5) * 1.4, send: 0.85, partials: [[1, 1], [2, 0.22], [3, 0.08], [4.2, 0.03]] })
    if (r() < cur.shimmer * dt) this.blip(pick([D6, E6, A6, C7, D7]), now + 0.03, { gain: 0.01, attack: 0.03, decay: 1.1, pan: (r() - 0.5) * 1.8, send: 0.9 })

    // ---- world FX modules: build lazily, crossfade by flight weight, tear down when idle ----
    const ahead = now + 0.12
    const want = idA === idB ? [[idA, 1, p]] : [[idA, 1 - ek, p], [idB, ek, 0]]
    for (const [id, w, wp] of want) {
      if (!FX[id]) continue
      let m = this.mods.get(id)
      if (!m) {
        const kit = new Kit(this)
        try { m = { kit, api: FX[id](kit, this), last: now } } catch (err) { kit.dispose(); throw err }
        this.mods.set(id, m)
      }
      m.last = now; m.w = w
      const lvl = w * (0.4 + 0.6 * this.life)
      this.set(m.kit.out.gain, lvl, 0.35); this.set(m.kit.wet.gain, lvl, 0.35)
      m.api.update(wp, dt, now, ahead)
    }
    for (const [id, m] of this.mods) {
      if (m.last === now) continue
      if (m.w !== 0) { m.w = 0; this.set(m.kit.out.gain, 0, 0.4); this.set(m.kit.wet.gain, 0, 0.4) }
      if (now - m.last > TEARDOWN_AFTER) { m.kit.dispose(); this.mods.delete(id) }
    }
  }

  // ------------------------------------------------------------------ level meter
  drawBars(dt, flat) {
    this.barAcc += dt
    if (this.barAcc < 1 / 30) return
    const step = this.barAcc; this.barAcc = 0
    const lv = [0, 0, 0, 0]
    if (!flat && this.analyser) {
      const d = this.fbuf
      this.analyser.getByteFrequencyData(d)
      const bands = [[0, 2], [2, 5], [5, 12], [12, 40]], gainW = [1, 1.15, 1.45, 2.2]
      for (let b = 0; b < 4; b++) {
        let s = 0; const [a, z] = bands[b]
        for (let i = a; i < z; i++) s += d[i]
        lv[b] = clamp((s / (z - a) / 255) * gainW[b] * 1.25)
      }
    }
    for (let b = 0; b < 4; b++) {
      const v = damp(this.bars[b], lv[b], flat ? 6 : 14, step)
      if (Math.abs(v - this.bars[b]) > 0.004 || (flat && this.bars[b] !== 0)) {
        this.bars[b] = v < 0.003 ? 0 : v
        this.barEls[b].style.transform = `scaleY(${(0.18 + 0.82 * this.bars[b]).toFixed(3)})`
      }
    }
  }

  dispose() {
    clearTimeout(this._susp)
    for (const m of this.mods.values()) m.kit.dispose()
    this.mods.clear()
    this.el?.remove()
    try { this.ctx?.close() } catch { /* already closed */ }
    this.supported = false
  }
}
