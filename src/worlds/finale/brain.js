import * as THREE from 'three'
import { rng } from '../../lib/math.js'
import { POINT_FRAG } from '../../lib/glsl.js'

// The faint particle structure that surrounds every system at the end. Two hemispheres of points
// sampled on deformed ellipsoids, concentrated on ridged-noise "gyri", a flattened medial wall with
// a fissure, a callosal bridge, and fibre bundles fanning from the core to the cortex. It is meant
// to read as a computational universe first and only hint at a brain on a second look.

// Classic improved Perlin noise (deterministic permutation).
function makeNoise(seed) {
  const r = rng(seed)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a, b, t) => a + (b - a) * t
  const grad = (h, x, y, z) => {
    h &= 15
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
  }
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
    const u = fade(x), v = fade(y), w = fade(z)
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    )
  }
}

export const BRAIN = { cx: 700, rx: 1420, ryTop: 1320, ryBot: 760, rz: 2560, y0: 60, gap: 46 }

export function buildBrain(quality) {
  const low = quality === 'low'
  const nCortex = low ? 15000 : 30000
  const nFibre = low ? 4200 : 8400
  const nDust = low ? 1400 : 2800
  const N = nCortex + nFibre + nDust
  const pos = new Float32Array(N * 3)
  const seed = new Float32Array(N)
  const dist = new Float32Array(N)
  const kind = new Float32Array(N)
  const ridge = new Float32Array(N)
  const r = rng(1107)
  const noise = makeNoise(77)
  const B = BRAIN
  const RMAX = 3000
  let n = 0
  const put = (x, y, z, k, rd) => {
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z
    seed[n] = r(); kind[n] = k; ridge[n] = rd
    dist[n] = Math.min(1, Math.hypot(x, y * 1.2, z) / RMAX)
    n++
  }

  // ---- cortex: two hemispheres, points pulled onto ridges of a folded surface ----
  let guard = 0
  while (n < nCortex && guard++ < nCortex * 30) {
    const side = r() < 0.5 ? -1 : 1
    // random direction
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    let dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th)
    const zN = dz
    // frontal lobe slightly narrower, temporal bulge low and lateral, flatter base
    let rx = B.rx * (1 - 0.1 * Math.max(0, zN)) * (1 + 0.1 * Math.max(0, -dy) * (1 - Math.abs(zN)))
    let ry = dy > 0 ? B.ryTop * (1 - 0.14 * zN * zN) : B.ryBot
    let rz = B.rz * (dy < 0 ? 0.93 : 1)
    let x = dx * rx, y = dy * ry, z = dz * rz
    // gyri: ridged noise; density concentrates on the ridges, sulci stay dark
    const f = 1 / 420
    const px = x + side * 3000, py = y, pz = z
    const nv = noise(px * f, py * f, pz * f) + 0.45 * noise(px * f * 2.1 + 7, py * f * 2.1, pz * f * 2.1)
    const rd = 1 - Math.min(1, Math.abs(nv) * 1.6)
    if (r() > 0.08 + 0.92 * Math.pow(rd, 2.6)) continue
    const disp = (rd - 0.6) * 70
    const inv = 1 / Math.hypot(dx, dy, dz)
    x += dx * inv * disp; y += dy * inv * disp; z += dz * inv * disp
    x = side * B.cx + x
    // medial wall: flatten and thin out where the hemispheres face each other
    if (side * x < B.gap) {
      if (r() > 0.28) continue
      x = side * (B.gap + r() * 26)
    }
    put(x, y + B.y0, z, 0, rd)
  }
  while (n < nCortex) put((r() - 0.5) * 4000, (r() - 0.5) * 1000, (r() - 0.5) * 5000, 2, 0)

  // ---- fibres: callosal bridge + bundles fanning from the core to the cortex ----
  const nCall = Math.floor(nFibre * 0.3)
  const end = nCortex + nFibre
  let arcs = 0
  while (n < nCortex + nCall) {
    const z = (r() * 2 - 1) * 1500 * (arcs % 2 ? 1 : 0.8)
    arcs++
    const w = 760 + r() * 260, top = 420 + r() * 160 - Math.abs(z) * 0.08
    const per = 34
    for (let i = 0; i < per && n < nCortex + nCall; i++) {
      const t = i / (per - 1)
      const a = (t * 2 - 1)
      const x = a * w
      const y = B.y0 + 120 + (1 - a * a) * top - Math.pow(Math.abs(a), 3) * 180
      put(x + (r() - 0.5) * 18, y + (r() - 0.5) * 18, z + (r() - 0.5) * 30, 1, 0.6)
    }
  }
  while (n < end) {
    // one bundle: a curved path from near the core to a point on a hemisphere, fanning out
    const side = r() < 0.5 ? -1 : 1
    const u = r() * 1.6 - 0.6, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    const ex = side * B.cx + s * Math.cos(th) * B.rx * 0.92
    const ey = B.y0 + u * (u > 0 ? B.ryTop : B.ryBot) * 0.92
    const ez = s * Math.sin(th) * B.rz * 0.92
    const cxp = ex * 0.35, cyp = ey * 0.1 + 260 * (r() - 0.3), czp = ez * 0.55
    const per = 60 + Math.floor(r() * 50)
    for (let i = 0; i < per && n < end; i++) {
      const t = Math.pow(r(), 0.8)
      const it = 1 - t
      const x = it * it * 0 + 2 * it * t * cxp + t * t * ex
      const y = it * it * 0 + 2 * it * t * cyp + t * t * ey
      const z = it * it * 0 + 2 * it * t * czp + t * t * ez
      const spread = 10 + t * t * 120
      if (t < 0.06) continue
      put(x + (r() - 0.5) * spread, y + (r() - 0.5) * spread, z + (r() - 0.5) * spread, 1, 0.3 + 0.7 * t)
    }
  }
  // ---- dust: a very faint wide field, so the structure floats in a volume ----
  while (n < N) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    const R = 2600 + Math.pow(r(), 0.7) * 5200
    put(s * Math.cos(th) * R, u * R * 0.55, s * Math.sin(th) * R, 2, r())
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  g.setAttribute('aD', new THREE.BufferAttribute(dist, 1))
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1))
  g.setAttribute('aRidge', new THREE.BufferAttribute(ridge, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uPx: { value: 800 }, uAlpha: { value: 1 }, uHot: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aSeed; attribute float aD; attribute float aKind; attribute float aRidge;
      uniform float uTime, uReveal, uPx, uAlpha, uHot;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        float br = sin(uTime*0.35 + aSeed*6.2831);
        p += normalize(p + vec3(0.001)) * br * (aKind > 1.5 ? 18.0 : 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dz = -mv.z;
        float front = uReveal * 1.3 - aD;
        float vis = smoothstep(0.0, 0.22, front);
        float wave = (1.0 - smoothstep(0.0, 0.12, abs(front - 0.08))) * step(0.001, uReveal) * (1.0 - smoothstep(0.85, 1.0, uReveal));
        // sparse "firing": a few points flash at any moment
        float fire = pow(max(0.0, sin(aSeed*917.0 + uTime*(0.25 + aSeed*0.5))), 60.0);
        // a slow sweep of activity travelling front to back
        float sweep = pow(0.5 + 0.5*sin(p.z*0.0014 + p.x*0.0004 - uTime*0.55), 12.0);
        float sz; float base; vec3 col;
        if (aKind < 0.5) { sz = 9.0; base = 0.12 + 0.3*aRidge; col = mix(vec3(0.42,0.56,0.78), vec3(0.72,0.86,1.0), aRidge); }
        else if (aKind < 1.5) { sz = 8.0; base = 0.2 + 0.16*aRidge; col = vec3(0.22,0.46,1.0); }
        else { sz = 7.0; base = 0.12; col = vec3(0.5,0.62,0.8); }
        sz *= 0.7 + 0.6*aSeed;
        gl_PointSize = clamp(sz * uPx / dz, 1.0, 5.0);
        float near = smoothstep(120.0, 900.0, dz);
        vA = vis * near * uAlpha * (base + wave*0.55 + fire*1.6 + sweep*0.22*(1.0-step(1.5,aKind)) + uHot*0.05);
        vC = col * (1.0 + fire*2.2 + wave*0.8);
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
      ${POINT_FRAG}
      void main(){ float a = softPoint(gl_PointCoord) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  pts.renderOrder = 1
  return pts
}
