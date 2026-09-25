export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const invLerp = (a, b, v) => clamp((v - a) / (b - a))
/** 0..1 as p goes a→b (clamped). The workhorse for scroll choreography. */
export const range = (p, a, b) => clamp((p - a) / (b - a))
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10) }
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3)
export const easeIn = (t) => clamp(t) ** 3
/** Rise over [a,b], hold, fall over [c,d]. */
export const band = (p, a, b, c, d) => Math.min(range(p, a, b), 1 - range(p, c, d))
/** Frame-rate independent exponential smoothing. lambda ~ 4 (slow) .. 20 (snappy). */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt))
/** Deterministic PRNG so layouts are identical on every load. */
export function rng(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
