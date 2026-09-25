import * as THREE from 'three'
import { rng } from '../../lib/math.js'
import { POINT_FRAG } from '../../lib/glsl.js'

// Luminous "signatures": one small abstract emblem per environment, drawn at that world's offset.
// All emblems share one LineSegments and one Points draw (per-vertex world id + uniform arrays
// for reveal / highlight), billboarded in view space with a gentle 3D sway.

const ICE = [0.75, 0.9, 1.0], CYAN = [0.38, 0.85, 1.0], BLUE = [0.18, 0.49, 1.0], WHITE = [0.92, 0.95, 1.0]
const AMBER = [1.0, 0.71, 0.28], GREEN = [0.24, 0.9, 0.63], RED = [1.0, 0.3, 0.37]

function builder() {
  const L = { pos: [], anim: [], col: [] }
  const P = { pos: [], anim: [], col: [], size: [] }
  const seg = (a, b, c = ICE, an = -1, bn = -1) => { L.pos.push(...a, ...b); L.anim.push(an, bn); L.col.push(...c, ...c) }
  const pt = (a, size = 3, c = WHITE, an = -1) => { P.pos.push(...a); P.anim.push(an); P.col.push(...c); P.size.push(size) }
  const loop = (fn, n, c = ICE, animFn = null) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n
      seg(fn(t0), fn(t1), c, animFn ? animFn(t0) : -1, animFn ? animFn(t1) : -1)
    }
  }
  const circle = (r, n = 64, c = ICE, tilt = 0, y = 0) => loop((t) => {
    const a = t * Math.PI * 2
    return [Math.cos(a) * r, Math.sin(a) * r * Math.cos(tilt) + y, Math.sin(a) * r * Math.sin(tilt)]
  }, n, c)
  return { L, P, seg, pt, loop, circle }
}

const SHAPES = {
  hero(b) {
    b.circle(0.95, 72, ICE)
    b.circle(0.62, 56, CYAN, 1.1)
    b.circle(0.62, 56, BLUE, -1.1)
    b.pt([0, 0, 0], 9, WHITE)
  },
  voice(b) {
    // waveform ring: radius modulated by a travelling wave in the shader (anim = angle)
    b.loop((t) => { const a = t * Math.PI * 2; return [Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0] }, 120, CYAN, (t) => t * Math.PI * 2)
    b.circle(0.46, 48, BLUE)
    b.circle(1.02, 72, [0.3, 0.4, 0.55])
    b.pt([0, 0, 0], 6, WHITE)
  },
  realtime(b) {
    const nodes = [[0, 0, 0]]
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; nodes.push([Math.cos(a) * 0.85, Math.sin(a) * 0.85, (i % 2 ? 0.3 : -0.3)]) }
    for (let i = 1; i < 7; i++) { b.seg(nodes[0], nodes[i], BLUE); b.seg(nodes[i], nodes[i % 6 + 1], ICE) }
    b.seg(nodes[1], nodes[4], [0.3, 0.45, 0.7]); b.seg(nodes[2], nodes[5], [0.3, 0.45, 0.7])
    nodes.forEach((n, i) => b.pt(n, i ? 5 : 8, i ? CYAN : WHITE))
  },
  siren(b) {
    b.circle(0.9, 72, ICE)
    b.circle(0.26, 32, CYAN)
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a)
      b.seg([c * 0.5, s * 0.5, 0], [c * 1.2, s * 1.2, 0], ICE)
    }
    // corner brackets: the detection box
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 ? 1 : -1, sy = i < 2 ? 1 : -1, q = 0.52, l = 0.18
      b.seg([sx * q, sy * q, 0], [sx * (q - l), sy * q, 0], CYAN)
      b.seg([sx * q, sy * q, 0], [sx * q, sy * (q - l), 0], CYAN)
    }
    b.pt([0, 0, 0], 7, AMBER)
  },
  meetai(b) {
    b.circle(0.42, 48, BLUE)
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      b.pt([c * 0.86, s * 0.86, 0], 6, i === 2 ? CYAN : WHITE)
      // a small shoulder arc under each participant
      b.loop((t) => { const q = a + (t - 0.5) * 1.2; return [Math.cos(q) * 1.04, Math.sin(q) * 1.04, 0] }, 6, [0.45, 0.6, 0.8])
    }
    b.pt([0, 0, 0], 5, CYAN)
  },
  continuum(b) {
    // a call thread that drops, and reconnects through a small crystalline memory lattice
    const y0 = -0.42
    const thread = (x0, x1) => b.loop((t) => { const x = x0 + (x1 - x0) * t; return [x, y0 + Math.sin(x * 9) * 0.06, 0] }, 18, ICE)
    thread(-1.05, -0.16); thread(0.16, 1.05)
    b.pt([-0.16, y0 + Math.sin(-0.16 * 9) * 0.06, 0], 4, AMBER)
    b.pt([0.16, y0 + Math.sin(0.16 * 9) * 0.06, 0], 4, GREEN)
    // octahedral lattice
    const cy = 0.34, R = 0.34
    const V = [[R, cy, 0], [-R, cy, 0], [0, cy + R, 0], [0, cy - R, 0], [0, cy, R], [0, cy, -R]]
    const E = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]]
    E.forEach(([a, c]) => b.seg(V[a], V[c], CYAN))
    V.forEach((v) => b.pt(v, 3.5, WHITE))
    // resume path: drop point -> memory -> resumed point
    b.seg([-0.16, y0 + Math.sin(-0.16 * 9) * 0.06, 0], V[3], [0.35, 0.5, 0.8])
    b.seg(V[3], [0.16, y0 + Math.sin(0.16 * 9) * 0.06, 0], [0.35, 0.5, 0.8])
  },
  knowledge(b) {
    const r = rng(505)
    const pts = []
    for (let i = 0; i < 420; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 0.95 * Math.cbrt(r())
      const p = [s * Math.cos(th) * R, u * R, s * Math.sin(th) * R]
      pts.push(p)
      b.pt(p, 1.6 + r() * 2.2, r() < 0.12 ? CYAN : ICE)
    }
    for (let i = 0; i < 40; i++) {
      const a = pts[Math.floor(r() * pts.length)]
      let best = null, bd = 1e9
      for (let j = 0; j < 60; j++) { const q = pts[Math.floor(r() * pts.length)]; const d = Math.hypot(a[0] - q[0], a[1] - q[1], a[2] - q[2]); if (d > 0.05 && d < bd) { bd = d; best = q } }
      if (best) b.seg(a, best, BLUE)
    }
  },
  infra(b) {
    for (let k = -1; k <= 1; k++) {
      const x = k * 0.55, w = 0.2, h = 0.85
      b.seg([x - w, -h, 0], [x + w, -h, 0]); b.seg([x + w, -h, 0], [x + w, h, 0]); b.seg([x + w, h, 0], [x - w, h, 0]); b.seg([x - w, h, 0], [x - w, -h, 0])
      for (let j = 1; j < 7; j++) { const y = -h + j * (2 * h / 7); b.seg([x - w, y, 0], [x + w, y, 0], [0.3, 0.42, 0.6]) }
      for (let j = 0; j < 7; j++) { const y = -h + (j + 0.5) * (2 * h / 7); if ((j + k * 3) % 3 !== 1) b.pt([x + w * 0.62, y, 0], 3, (j + k) % 5 === 0 ? AMBER : GREEN) }
    }
  },
  runbook(b) {
    const w = 0.95, h = 0.68
    b.seg([-w, -h, 0], [w, -h, 0]); b.seg([w, -h, 0], [w, h, 0]); b.seg([w, h, 0], [-w, h, 0]); b.seg([-w, h, 0], [-w, -h, 0])
    b.seg([-w, h - 0.2, 0], [w, h - 0.2, 0], [0.35, 0.45, 0.6])
    b.seg([-0.6, 0.18, 0], [-0.3, -0.05, 0], CYAN); b.seg([-0.3, -0.05, 0], [-0.6, -0.28, 0], CYAN)
    b.seg([-0.14, -0.28, 0], [0.22, -0.28, 0], WHITE)
    for (let i = 0; i < 3; i++) b.pt([-w + 0.14 + i * 0.12, h - 0.1, 0], 2.6, i === 0 ? RED : i === 1 ? AMBER : GREEN)
  },
  shieldx(b) {
    // hex lattice shield: seven cells, alerts converge on one incident at the centre
    const hex = (cx, cy, r, c) => b.loop((t) => { const a = t * Math.PI * 2 + Math.PI / 6; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0] }, 6, c)
    hex(0, 0, 1.0, ICE)
    const s = 0.3, d = s * Math.sqrt(3)
    hex(0, 0, s * 0.96, CYAN)
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2
      const x = Math.cos(a) * d, y = Math.sin(a) * d
      hex(x, y, s * 0.96, BLUE)
      b.pt([x, y, 0], 3, i % 3 === 0 ? AMBER : ICE)
      b.seg([x * 1.0, y * 1.0, 0], [x * 0.35, y * 0.35, 0], [0.35, 0.5, 0.75])
    }
    b.pt([0, 0, 0], 7, RED)
  },
  signals(b) {
    for (let i = 0; i < 3; i++) b.pt([(i - 1) * 0.5, -0.52, 0], 7, i === 1 ? CYAN : WHITE)
    for (let k = 1; k <= 3; k++) {
      const R = 0.3 * k + 0.1
      b.loop((t) => { const a = Math.PI * (0.22 + 0.56 * t); return [Math.cos(a) * R, Math.sin(a) * R - 0.52, 0] }, 20, k === 1 ? CYAN : k === 2 ? ICE : [0.4, 0.55, 0.78])
    }
  },
  experience(b) {
    b.seg([0, -1.25, 0], [0, 1.25, 0], ICE)
    for (let i = 0; i < 5; i++) {
      const y = -1 + i * 0.5
      b.loop((t) => { const a = t * Math.PI * 2; return [Math.cos(a) * 0.5, y, Math.sin(a) * 0.5] }, 40, i === 4 ? CYAN : BLUE)
      b.pt([0, y, 0], 5, i === 4 ? CYAN : WHITE)
    }
  },
  skills(b) {
    const r = rng(1010)
    const pts = []
    for (let i = 0; i < 70; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 0.25 + 0.8 * Math.sqrt(r())
      const p = [s * Math.cos(th) * R, u * R * 0.8, s * Math.sin(th) * R * 0.6]
      pts.push(p)
      b.pt(p, 1.5 + Math.pow(r(), 3) * 7, r() < 0.2 ? CYAN : WHITE)
    }
    for (let i = 0; i < 12; i++) b.seg(pts[i], pts[i + 1], [0.35, 0.5, 0.8])
  },
}

export function buildEmblems(entries, uniforms) {
  const L = { pos: [], ctr: [], wid: [], anim: [], col: [] }
  const P = { pos: [], ctr: [], wid: [], anim: [], col: [], size: [] }
  entries.forEach((e, wi) => {
    const b = builder()
    ;(SHAPES[e.id] || SHAPES.hero)(b)
    const c = e.center
    for (let i = 0; i < b.L.pos.length / 3; i++) { L.ctr.push(c.x, c.y, c.z); L.wid.push(wi) }
    L.pos.push(...b.L.pos); L.anim.push(...b.L.anim); L.col.push(...b.L.col)
    for (let i = 0; i < b.P.pos.length / 3; i++) { P.ctr.push(c.x, c.y, c.z); P.wid.push(wi) }
    P.pos.push(...b.P.pos); P.anim.push(...b.P.anim); P.col.push(...b.P.col); P.size.push(...b.P.size)
  })
  const geo = (D, pts) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(D.pos, 3))
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(D.ctr, 3))
    g.setAttribute('aWid', new THREE.Float32BufferAttribute(D.wid, 1))
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(D.anim, 1))
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(D.col, 3))
    if (pts) g.setAttribute('aSize', new THREE.Float32BufferAttribute(D.size, 1))
    return g
  }
  const vert = (pts) => /* glsl */`
    attribute vec3 aCenter; attribute float aWid; attribute float aAnim; attribute vec3 aColor; ${pts ? 'attribute float aSize;' : ''}
    uniform float uTime, uGrow, uDpr, uR, uHalfH;
    uniform float uRev[${entries.length}]; uniform float uHi[${entries.length}];
    varying vec3 vColor; varying float vA;
    void main(){
      int id = int(aWid + 0.5);
      float rev = uRev[id]; float hi = uHi[id];
      vec3 o = position;
      if (aAnim >= 0.0) {
        float k = 1.0 + 0.2*sin(aAnim*10.0 - uTime*3.4)*(0.55 + 0.45*sin(aAnim*2.0 + uTime*1.3));
        o.xy *= k;
      }
      float a = sin(uTime*0.32 + aWid*1.7)*0.5 + hi*sin(uTime*1.4)*0.25;
      float c = cos(a), s = sin(a);
      o = vec3(c*o.x + s*o.z, o.y, -s*o.x + c*o.z);
      float sc = uR * uGrow * (0.55 + 0.45*rev) * (1.0 + 0.25*hi);
      vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
      mv.xyz += o * sc;
      gl_Position = projectionMatrix * mv;
      ${pts ? 'float projR = sc * projectionMatrix[1][1] / max(1.0, -mv.z) * uHalfH; gl_PointSize = aSize * uDpr * clamp(projR / 24.0, 0.45, 1.2) * (1.0 + hi*0.5);' : ''}
      vColor = aColor * (1.0 + hi*1.1);
      vA = rev * (0.62 + 0.38*hi);
    }`
  const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms }
  const lines = new THREE.LineSegments(geo(L, false), new THREE.ShaderMaterial({
    ...common, vertexShader: vert(false),
    fragmentShader: /* glsl */`varying vec3 vColor; varying float vA; void main(){ if (vA < 0.002) discard; gl_FragColor = vec4(vColor*1.25, vA*0.8); }`,
  }))
  const points = new THREE.Points(geo(P, true), new THREE.ShaderMaterial({
    ...common, vertexShader: vert(true),
    fragmentShader: /* glsl */`varying vec3 vColor; varying float vA; ${POINT_FRAG}
      void main(){ float a = softPoint(gl_PointCoord) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vColor*1.8, a); }`,
  }))
  lines.frustumCulled = points.frustumCulled = false
  lines.renderOrder = points.renderOrder = 4
  return { lines, points }
}
