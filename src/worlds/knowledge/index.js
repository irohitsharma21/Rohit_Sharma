import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { chrome, smokedGlass } from '../../lib/materials.js'
import { HEX } from '../../lib/palette.js'
import { band, clamp, damp, lerp, range, rng } from '../../lib/math.js'
import { reveal } from '../../lib/dom.js'
import { projects, experience, skillGroups } from '../../content.js'
import { buildGraph, hopField, CONCEPTS } from './graph.js'
import { CHUNK_VERT, HUB_VERT, POINT_FRAG_SRC, FIBRE_VERT, FIBRE_FRAG, FLOW_VERT, FLOW_FRAG, HAZE_VERT, HAZE_FRAG, CONE_VERT, CONE_FRAG } from './shaders.js'
import './style.css'

// WORLD 05: the AI knowledge network. A living embedding space: thousands of chunks clustered into
// concept galaxies, a fibre graph between hubs, activation waves that propagate hop by hop from
// whatever the visitor touches, and the RAG story told by scroll: embed, retrieve, reason + act, reveal.

const TOPK = 8
const Q_TARGET = new THREE.Vector3(63, 27, 36) // where the query embeds: between RAG and Semantic Search
const CONE_DEG = 8.5
const TOOLS = [
  { name: 'QDRANT', d: [0.95, 0.55, 0.35] },
  { name: 'MONGODB', d: [-0.9, 0.45, 0.6] },
  { name: 'CALENDAR', d: [0.25, -0.75, 0.95] },
  { name: 'REDIS', d: [-0.45, 0.95, -0.55] },
  { name: 'WEBSOCKETS', d: [0.7, -0.35, -0.95] },
]
const SAT_R = 16

// Camera keyframes: [p, pos, target, fov]
const KEYS = [
  [0.0, [-100, 62, 212], [14, -2, -8], 40],
  [0.14, [-44, 44, 176], [28, 4, 0], 40],
  [0.3, [8, 36, 122], [40, 18, 24], 42],
  [0.42, [28, 42, 100], [60, 24, 34], 42],
  [0.52, [46, 38, 92], [44, 18, 22], 44],
  [0.62, [22, 22, 66], [8, 4, 6], 44],
  [0.71, [-8, 18, 62], [0, 1, 0], 44],
  [0.8, [-50, 28, 56], [-12, 2, 2], 46],
  [0.9, [-64, 92, 170], [0, -4, -6], 46],
  [1.0, [-30, 190, 280], [6, -12, -14], 46],
]
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()
function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  for (let i = 0; i < 3; i++) {
    const a = p0[i], b = p1[i], c = p2[i], d = p3[i]
    out.setComponent(i, 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3))
  }
  return out
}

export default class KnowledgeWorld extends World {
  static height = 420

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0016
    this.bloom = 0.9
    this.exposure = 1.0
    this.parallax = 0.7
  }

  async init() {
    const low = this.ctx.quality === 'low'
    const g = (this.g = buildGraph({ chunks: low ? 5600 : 12000, hubs: low ? 190 : 320 }))
    const r = rng(77)
    this.hops = new Float32Array(g.H)

    // ---- shared uniforms
    const hopData = new Float32Array(g.H * 4).fill(1e4)
    this.hopTex = new THREE.DataTexture(hopData, g.H, 1, THREE.RGBAFormat, THREE.FloatType)
    this.hopTex.minFilter = this.hopTex.magFilter = THREE.NearestFilter
    this.hopTex.needsUpdate = true
    this.hopData = hopData
    const U = (this.U = {
      uTime: { value: 0 }, uHop: { value: this.hopTex }, uWaveT: { value: new THREE.Vector4(-99, -99, -99, -99) }, uWaveA: { value: new THREE.Vector4() },
      uSpeed: { value: 3.6 }, uRayO: { value: new THREE.Vector3(0, 0, 1e4) }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uPtr: { value: 0 },
      uBreath: { value: 0.3 }, uFocus: { value: 120 }, uAperture: { value: 1 }, uPx: { value: 800 }, uHaze: { value: 0.004 }, uFade: { value: 1 },
    })
    this.slotAge = [0, 0, 0, 0]

    // ---- query + top-k (computed once; cosine = angle from the origin, like a real embedding space)
    const qDir = (this.qDir = Q_TARGET.clone().normalize())
    const N = g.N, P = g.cPos
    const QL = (this.QL = Q_TARGET.length())
    const cand = []
    for (let i = 0; i < N; i++) {
      _a.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
      const l = _a.length()
      if (l < QL - 30 || l > QL + 10) continue
      cand.push([_a.dot(qDir) / l, i])
    }
    cand.sort((x, y) => y[0] - x[0])
    // spread the k winners a little so they read as separate chunks
    const top = []
    for (const [cs, i] of cand) {
      _a.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
      if (top.every((t) => t.pos.distanceTo(_a) > 3.2)) top.push({ i, cs, pos: _a.clone() })
      if (top.length === TOPK) break
    }
    this.top = top
    const coneCos = Math.cos(THREE.MathUtils.degToRad(CONE_DEG))
    top.forEach((t, k) => { t.score = (0.91 - k * 0.013 - (k > 3 ? 0.01 : 0)).toFixed(2) })

    // ---- chunks
    {
      const geo = new THREE.BufferGeometry()
      const hub = new Float32Array(N), rand = new Float32Array(N * 4), col = new Float32Array(N * 3)
      for (let i = 0; i < N; i++) {
        hub[i] = g.cHub[i]
        const bright = r() < 0.06 ? 1.8 : 0.55 + r() * 0.55
        rand.set([r(), 0.55 + Math.pow(r(), 3) * 1.1, r(), 0], i * 4)
        const t = CONCEPTS[g.cCluster[i]].tint
        col.set([t[0] * bright, t[1] * bright, t[2] * bright], i * 3)
      }
      top.forEach((t, k) => { rand[t.i * 4 + 3] = k + 1; rand[t.i * 4 + 1] = 1.3 })
      this.chunkRand = rand
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3))
      geo.setAttribute('aHub', new THREE.BufferAttribute(hub, 1))
      geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4))
      geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3))
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uSize: { value: 0.5 }, uBase: { value: 0.95 }, uQDir: { value: qDir }, uConeCos: { value: coneCos }, uCone: { value: 0 }, uTopK: { value: 0 }, uHover: { value: -1 }, uNamed: { value: 0 } },
        vertexShader: CHUNK_VERT, fragmentShader: POINT_FRAG_SRC, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const pts = new THREE.Points(geo, mat)
      pts.frustumCulled = false
      this.group.add(pts)
      this.chunkMat = mat
    }

    // ---- hubs
    {
      const H = g.H
      const pos = new Float32Array(H * 3), hub = new Float32Array(H), rand = new Float32Array(H * 4), col = new Float32Array(H * 3)
      this.deg = new Uint16Array(H)
      g.edges.forEach(([a, b]) => { this.deg[a]++; this.deg[b]++ })
      for (let i = 0; i < H; i++) {
        pos.set(g.hubPos[i], i * 3); hub[i] = i
        const named = g.hubName[i] ? 1 : 0
        rand.set([r(), named ? 2.1 : 0.9 + Math.min(this.deg[i], 6) * 0.1, 0, named], i * 4)
        const t = CONCEPTS[g.hubCluster[i]].tint, b = named ? 2.2 : 1.1
        col.set([t[0] * b, t[1] * b, t[2] * b], i * 3)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('aHub', new THREE.BufferAttribute(hub, 1))
      geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4))
      geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3))
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uSize: { value: 0.8 }, uBase: { value: 0.7 }, uQDir: { value: qDir }, uConeCos: { value: coneCos }, uCone: { value: 0 }, uTopK: { value: 0 }, uHover: { value: -1 }, uNamed: { value: 1 } },
        vertexShader: HUB_VERT, fragmentShader: POINT_FRAG_SRC, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const pts = new THREE.Points(geo, mat)
      pts.frustumCulled = false
      this.group.add(pts)
      this.hubMat = mat
      this.hubV = g.hubPos.map((p) => new THREE.Vector3(...p))
    }

    // ---- fibres (curved hub-hub edges) + dendrites (chunk -> hub)
    {
      const pos = [], hubs = [], info = [], jit = []
      const seg = low ? 6 : 10
      const push = (p, ha, hb, t, seed, hj, kind, jx) => { pos.push(p.x, p.y, p.z); hubs.push(ha, hb); info.push(t, seed, hj, kind); jit.push(jx, 0, 0) }
      for (const [a, b, kind] of g.edges) {
        const A = this.hubV[a], B = this.hubV[b]
        const L = A.distanceTo(B)
        _c.subVectors(B, A)
        _d.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(_c).normalize().multiplyScalar(L * (kind === 1 ? 0.18 : 0.12) * (0.4 + r()))
        const M = _b.addVectors(A, B).multiplyScalar(0.5).add(_d).clone()
        const n = Math.max(2, Math.min(seg * (kind === 1 ? 2 : 1), Math.ceil(L / 5)))
        const seed = r()
        let prev = A.clone(), pt = 0
        for (let s = 1; s <= n; s++) {
          const t = s / n, u = 1 - t
          const cur = new THREE.Vector3().copy(A).multiplyScalar(u * u).addScaledVector(M, 2 * u * t).addScaledVector(B, t * t)
          push(prev, a, b, pt, seed, 0, kind, 0); push(cur, a, b, t, seed, 0, kind, 0)
          prev = cur; pt = t
        }
      }
      const every = low ? 7 : 5
      const rnd = this.chunkRand
      for (let i = 0; i < N; i += every) {
        const h = g.cHub[i]
        const hA = this.hubV[h]
        _a.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
        if (_a.distanceTo(hA) > 9) continue
        push(hA, h, h, 0, 0, 0, 3, rnd[i * 4]); push(_a, h, h, 1, 0, 0.4 + rnd[i * 4 + 2] * 0.8, 3, rnd[i * 4])
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('aHubs', new THREE.Float32BufferAttribute(hubs, 2))
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4))
      geo.setAttribute('aJit', new THREE.Float32BufferAttribute(jit, 3))
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uBaseA: { value: 1 } }, vertexShader: FIBRE_VERT, fragmentShader: FIBRE_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const lines = new THREE.LineSegments(geo, mat)
      lines.frustumCulled = false
      this.group.add(lines)
      this.fibreMat = mat
      this.edgeCount = g.edges.length
    }

    // ---- haze
    {
      const n = low ? 18 : 30
      const pos = new Float32Array(n * 3), meta = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const C = CONCEPTS[Math.floor(r() * CONCEPTS.length)]
        pos.set([C.c[0] + (r() - 0.5) * 60, C.c[1] + (r() - 0.5) * 30, C.c[2] + (r() - 0.5) * 60], i * 3)
        meta.set([55 + r() * 45, 0.022 + r() * 0.03, r() * 6.28, 0], i * 4)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4))
      const mat = new THREE.ShaderMaterial({ uniforms: { uPx: U.uPx, uTime: U.uTime, uFade: U.uFade }, vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      const pts = new THREE.Points(geo, mat)
      pts.frustumCulled = false
      pts.renderOrder = -1
      this.group.add(pts)
    }

    // ---- LLM core (the LLMs hub, at the origin): smoked glass shell, chrome gyroscope rings, inner chrome core, glow
    {
      const core = (this.core = new THREE.Group())
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), smokedGlass({ opacity: 0.32, flatShading: true }))
      const inner = (this.coreInner = new THREE.Mesh(new THREE.OctahedronGeometry(1.25, 0), chrome({ roughness: 0.1 })))
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.12, 1)), new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.ice).multiplyScalar(0.5), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
      this.rings = [5.4, 6.3].map((rad, i) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.045, 8, 160), chrome())
        m.rotation.set(Math.PI / 2 + (i ? 0.5 : -0.35), i ? 0.4 : 0, 0)
        core.add(m); return m
      })
      core.add(shell, inner, edges)
      this.coreGlow = this.makeGlow(HEX.cyan, 16)
      core.add(this.coreGlow)
      this.group.add(core)
      this.coreEdges = edges
    }

    // ---- tool satellites + arcs
    {
      this.sats = TOOLS.map((T, i) => {
        const pos = new THREE.Vector3(...T.d).normalize().multiplyScalar(SAT_R)
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), chrome())
        m.position.copy(pos)
        const glow = this.makeGlow(HEX.cyan, 1.8)
        glow.position.copy(pos)
        this.group.add(m, glow)
        const ctrl = pos.clone().multiplyScalar(0.5).add(new THREE.Vector3(...T.d).cross(new THREE.Vector3(0, 1, 0.2)).normalize().multiplyScalar(6))
        return { pos, mesh: m, glow, ctrl, name: T.name, lane: i }
      })
      const pts = []
      this.sats.forEach((s) => {
        let prev = new THREE.Vector3()
        for (let j = 1; j <= 24; j++) {
          const t = j / 24, u = 1 - t
          const c = new THREE.Vector3().addScaledVector(s.ctrl, 2 * u * t).addScaledVector(s.pos, t * t)
          pts.push(prev.x, prev.y, prev.z, c.x, c.y, c.z); prev = c
        }
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      this.arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(0.9), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      this.group.add(new THREE.LineSegments(geo, this.arcMat))
    }

    // ---- retrieval: query axis, cone, top-k beams
    {
      const H = Q_TARGET.length() + 34, rad = Math.tan(THREE.MathUtils.degToRad(CONE_DEG)) * H
      const cg = new THREE.ConeGeometry(rad, H, 48, 1, true)
      cg.translate(0, -H / 2, 0)
      const cm = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uTime: U.uTime }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      const cone = (this.cone = new THREE.Mesh(cg, cm))
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), qDir)
      cone.frustumCulled = false
      this.group.add(cone)
      const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), qDir.clone().multiplyScalar(H + 20)])
      this.axisMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.ice).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      this.group.add(new THREE.Line(axis, this.axisMat))
      const bp = []
      top.forEach((t) => bp.push(Q_TARGET.x, Q_TARGET.y, Q_TARGET.z, t.pos.x, t.pos.y, t.pos.z))
      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3))
      this.beamMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      this.group.add(new THREE.LineSegments(bg, this.beamMat))
      // instrument rings around the axis: the similarity threshold drawn as a circle at the query's depth
      const ringPts = []
      ;[this.QL - 22, this.QL, this.QL + 18].forEach((d) => {
        const rr = Math.tan(THREE.MathUtils.degToRad(CONE_DEG)) * d
        const u = new THREE.Vector3(0, 1, 0).cross(qDir).normalize(), v = qDir.clone().cross(u)
        for (let j = 0; j < 96; j++) {
          const a0 = j / 96 * Math.PI * 2, a1 = (j + 1) / 96 * Math.PI * 2
          for (const aa of [a0, a1]) ringPts.push(qDir.x * d + (u.x * Math.cos(aa) + v.x * Math.sin(aa)) * rr, qDir.y * d + (u.y * Math.cos(aa) + v.y * Math.sin(aa)) * rr, qDir.z * d + (u.z * Math.cos(aa) + v.z * Math.sin(aa)) * rr)
        }
      })
      const rg = new THREE.BufferGeometry()
      rg.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3))
      this.ringMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(1.1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      this.group.add(new THREE.LineSegments(rg, this.ringMat))
      this.qGlow = this.makeGlow(HEX.ice, 4)
      this.qGlow.position.copy(Q_TARGET)
      this.group.add(this.qGlow)
    }

    // ---- story particles
    {
      const starts = [], ends = [], ctrls = [], metas = []
      const add = (s, e, c, phase, kind, lane, size) => { starts.push(s.x, s.y, s.z); ends.push(e.x, e.y, e.z); ctrls.push(c.x, c.y, c.z); metas.push(phase, kind, lane, size) }
      const O = new THREE.Vector3()
      top.forEach((t, k) => {
        const c = t.pos.clone().multiplyScalar(0.5).add(new THREE.Vector3((r() - 0.5) * 16, 10 + r() * 12, (r() - 0.5) * 16))
        const n = low ? 18 : 34
        for (let j = 0; j < n; j++) add(t.pos, O, c, j / n + r() * 0.02, 0, k, 0.22 + r() * 0.16)
      })
      this.sats.forEach((s, i) => {
        for (let j = 0; j < 14; j++) { const f = j / 14; add(O, s.pos, s.ctrl, f, 1, i, 0.42 - f * 0.2); add(s.pos, O, s.ctrl, f, 2, i, 0.34 - f * 0.16) }
      })
      const qStart = Q_TARGET.clone().add(new THREE.Vector3(-26, 44, 80))
      for (let j = 0; j < 18; j++) add(qStart, Q_TARGET, Q_TARGET, j / 18, 3, 0, j === 0 ? 1.6 : 0.9 - j * 0.03)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3))
      geo.setAttribute('aStart', new THREE.Float32BufferAttribute(starts, 3))
      geo.setAttribute('aCtrl', new THREE.Float32BufferAttribute(ctrls, 3))
      geo.setAttribute('aMeta', new THREE.Float32BufferAttribute(metas, 4))
      const mat = (this.flowMat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uStream: { value: 0 }, uTool: { value: 0 }, uQuery: { value: 0 }, uQVis: { value: 0 }, uPx: U.uPx, uHaze: U.uHaze, uFade: U.uFade },
        vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      const pts = new THREE.Points(geo, mat)
      pts.frustumCulled = false
      this.group.add(pts)
    }

    // ---- labels (constant screen size, face the camera)
    this.labels = []
    const mk = (text, anchor, o = {}) => {
      const grp = new THREE.Group()
      const l = new Label(text, { height: 1, color: o.color || HEX.chrome, tracking: 0.16, ...o })
      l.position.set(o.dx ?? 0.9, o.dy ?? 0.1, 0)
      grp.add(l)
      grp.position.copy(anchor)
      this.group.add(grp)
      const e = { grp, label: l, anchor: grp.position, px: o.px || 10, op: 0, target: 0 }
      this.labels.push(e)
      return e
    }
    this.named = CONCEPTS.map((C, i) => {
      const hi = g.byName[C.name]
      const e = mk(C.name.toUpperCase(), this.hubV[hi], { px: 10.5 })
      if (i === 0) e.grp.position.set(0, 7.4, 0)
      return { hub: hi, e }
    })
    this.topLabels = top.map((t, k) => mk(`[${k + 1}] ${t.score}`, t.pos, { px: 9, color: HEX.ice }))
    this.satLabels = this.sats.map((s) => mk(`TOOL · ${s.name}`, s.pos, { px: 9, color: HEX.ice, dx: 2.1 }))
    this.qLabel = mk('QUERY  →  EMBED', Q_TARGET, { px: 10, color: HEX.white, dx: 1.1, dy: 0.6 })
    this.coneLabel = mk(`COSINE ≥ ${Math.cos(THREE.MathUtils.degToRad(CONE_DEG)).toFixed(3)}  ·  TOP-K ${TOPK}`, qDir.clone().multiplyScalar(Q_TARGET.length() + 30), { px: 9, color: HEX.cyan })

    // state
    this.hover = -1; this.hoverT = -9; this.lastDown = false; this.idleNext = 2; this.lastP = -1
    this.camLocal = new THREE.Vector3(); this.ray = new THREE.Ray(); this.tmp = new THREE.Vector3()
    this.pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 }
    this.dbuf = new THREE.Vector2()
    this.ptrAmt = 0
    this.roT = 0
    // first wave so the network is alive on arrival
    this.fire(g.byName['RAG'], 0.8, -0.5)
  }

  makeGlow(color, size) {
    if (!KnowledgeWorld._glowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128
      const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64)
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128)
      KnowledgeWorld._glowTex = new THREE.CanvasTexture(c)
    }
    const m = new THREE.SpriteMaterial({ map: KnowledgeWorld._glowTex, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })
    const s = new THREE.Sprite(m)
    s.scale.setScalar(size)
    s.userData.base = new THREE.Color(color)
    return s
  }

  /** Start an activation wave from hub `src` in the oldest slot. */
  fire(src, amp, dtOffset = 0) {
    const t = this.U.uTime.value + dtOffset
    let slot = 0
    for (let i = 1; i < 4; i++) if (this.slotAge[i] < this.slotAge[slot]) slot = i
    this.slotAge[slot] = t
    hopField(this.g, src, this.hops)
    const d = this.hopData
    for (let i = 0; i < this.g.H; i++) d[i * 4 + slot] = this.hops[i]
    this.hopTex.needsUpdate = true
    this.U.uWaveT.value.setComponent(slot, t)
    this.U.uWaveA.value.setComponent(slot, amp)
    this.lastWave = { t, src }
  }

  mount(el) {
    const genai = skillGroups.find((s) => s.id === 'genai')?.items || []
    const meet = projects.meetai
    const pipe = experience.bullets.find((b) => /tool calling/i.test(b)) || ''
    el.innerHTML = `
      <div class="w-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">Knowledge<br>Network</h2>
        <p class="w-lede">LLMs, RAG and tool-calling agents, drawn as the embedding space they reason over.</p>
      </div>
      <div class="kn-stage">
        <div class="kn-s fx" data-s="0"><span class="kn-i">01 / 04</span><h3>Embeddings</h3><p>Documents split into chunks; every chunk becomes a vector, and related meaning settles into the same region of space.</p></div>
        <div class="kn-s fx" data-s="1"><span class="kn-i">02 / 04</span><h3>Semantic Search <em>· Qdrant</em></h3><p>A query is embedded and the nearest chunks by cosine similarity are retrieved. In ${meet.name}: cited semantic search across all meetings.</p></div>
        <div class="kn-s fx" data-s="2"><span class="kn-i">03 / 04</span><h3>Agents <em>· Tool Calling · MCP</em></h3><p>${pipe}</p></div>
        <div class="kn-s fx" data-s="3"><span class="kn-i">04 / 04</span><h3>One living system</h3><p class="kn-tags">${genai.map((s) => `<span>${s}</span>`).join('')}</p></div>
      </div>
      <div class="kn-ro">
        <div class="kn-g fx" data-g="0"><div><i>CHUNKS</i><b>${this.g.N.toLocaleString('en-US')}</b></div><div><i>CONCEPTS</i><b>${this.g.H}</b></div><div><i>FIBRES</i><b>${this.edgeCount}</b></div></div>
        <div class="kn-g fx" data-g="1"><div><i>TOP-K</i><b>${TOPK}</b></div><div><i>COSINE</i><b class="kn-cos">0.91</b></div><div><i>INDEX</i><b>HNSW</b></div></div>
        <div class="kn-g fx" data-g="2"><div><i>CONTEXT</i><b>${TOPK} CHUNKS</b></div><div><i>TOOL CALLS</i><b class="kn-tc">0</b></div><div><i>PROTOCOL</i><b>MCP</b></div></div>
        <div class="kn-g fx" data-g="3"><div><i>WAVE</i><b class="kn-hop">HOP 00</b></div><div><i>ACTIVE</i><b class="kn-act">0</b></div><div><i>STATE</i><b class="kn-ok">LIVE</b></div></div>
      </div>
      <div class="kn-ans fx"><span class="kn-ak">GENERATED ANSWER · CITED</span>
        <p><sup>[1]</sup>The fix ships Friday, owner confirmed</p>
        <p><sup>[3]</sup>Two action items went to the host</p>
        <p><sup>[6]</sup>The demo moves to next week's call</p></div>
      <svg class="kn-wires fx" aria-hidden="true">${[0, 1, 2].map(() => '<path/><circle r="4"/>').join('')}</svg>
      <div class="kn-hint fx"><span></span>HOVER A NODE TO PROPAGATE · CLICK TO FIRE</div>`
    this.dom = {
      head: this.$('.w-head'), stages: this.$$('.kn-s'), groups: this.$$('.kn-g'), hint: this.$('.kn-hint'),
      ans: this.$('.kn-ans'), wires: this.$('.kn-wires'), cites: this.$$('.kn-ans sup'), paths: this.$$('.kn-wires path'), dots: this.$$('.kn-wires circle'),
      cos: this.$('.kn-cos'), tc: this.$('.kn-tc'), hop: this.$('.kn-hop'), act: this.$('.kn-act'),
    }
  }

  cameraAt(p, out) {
    p = clamp(p)
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++
    const k0 = KEYS[Math.max(0, i - 1)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)]
    const t = range(p, k1[0], k2[0])
    const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65
    catmull(out.pos, k0[1], k1[1], k2[1], k3[1], e)
    catmull(out.target, k0[2], k1[2], k2[2], k3[2], e)
    out.fov = lerp(k1[3], k2[3], e)
    const asp = this.ctx.camera.aspect
    if (asp < 1) { out.fov = Math.min(72, out.fov / Math.max(0.55, asp) * 0.82); out.pos.multiplyScalar(1.05) }
  }

  update(p, dt, t, k) {
    const U = this.U, g = this.g
    U.uTime.value = t
    const cam = this.ctx.camera
    const P = this.ctx.pointer
    const live = k === 0

    // ---- optics: pixel scale, focus follows the scripted target, haze
    this.ctx.renderer.getDrawingBufferSize(this.dbuf)
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
    U.uPx.value = this.dbuf.y / (2 * tanH)
    this.cameraAt(p, this.pose)
    this.localCamera(this.camLocal)
    const focus = this.camLocal.distanceTo(this.pose.target)
    U.uFocus.value = damp(U.uFocus.value, focus, 4, dt)
    const inside = band(p, 0.12, 0.3, 0.8, 0.92)
    U.uAperture.value = damp(U.uAperture.value, lerp(0.45, 1.0, inside), 3, dt)
    U.uHaze.value = lerp(0.0036, 0.0062, inside)
    this.chunkMat.uniforms.uBase.value = lerp(1.35, 0.95, inside)
    U.uBreath.value = damp(U.uBreath.value, 0.25 + range(p, 0.8, 1) * 0.9, 2, dt)

    // ---- pointer ray in local space + proximity strength
    this.localRay(this.ray)
    U.uRayO.value.copy(this.ray.origin); U.uRayD.value.copy(this.ray.direction)
    const recent = P.moved && t - P.lastMove < 4
    this.ptrAmt = damp(this.ptrAmt, live && recent && !this.ctx.isMobile ? 1 : (P.down ? 1 : 0), 3, dt)
    U.uPtr.value = this.ptrAmt

    // ---- hub picking: project the few hundred hubs, nearest to the cursor in pixels
    let best = -1, bd = Infinity, clickBest = -1, cbd = Infinity
    const hw = innerWidth / 2, hh = innerHeight / 2
    const off = this.group.position
    if (live && P.moved) {
      for (let i = 0; i < g.H; i++) {
        const v = this.tmp.copy(this.hubV[i]).add(off).project(cam)
        if (v.z > 1 || v.z < -1) continue
        const dx = (v.x - P.x) * hw, dy = (v.y - P.y) * hh
        const d2 = dx * dx + dy * dy
        const rad = g.hubName[i] ? 28 : 15
        if (d2 < rad * rad && d2 < bd) { bd = d2; best = i }
        if (d2 < 90 * 90 && d2 < cbd) { cbd = d2; clickBest = i }
      }
    }
    if (best !== this.hover) {
      this.hover = best
      if (best >= 0) {
        const nm = g.hubName[best], cl = CONCEPTS[g.hubCluster[best]].name
        if (nm) this.ctx.cursor.hover('CONCEPT', `${nm} · ${this.deg[best]} links · propagating`, this)
        else this.ctx.cursor.hover(`NODE ${String(best).padStart(4, '0')}`, `${cl} · ${this.deg[best]} links`, this)
        if (t - this.hoverT > 0.9) { this.fire(best, 1.1); this.hoverT = t }
      } else this.ctx.cursor.hover(null, null, this)
    }
    this.hubMat.uniforms.uHover.value = best
    if (P.down && !this.lastDown && live && clickBest >= 0) { this.fire(clickBest, 2.0); this.hoverT = t }
    this.lastDown = P.down

    // ---- scripted waves at story beats (scroll crossings) + idle ambient waves
    const beats = [[0.4, 'Semantic Search', 1.4], [0.6, 'LLMs', 1.6], [0.7, 'Tool Calling', 1.3], [0.86, 'LLMs', 1.5]]
    if (this.lastP >= 0 && live) for (const [bp, nm, a] of beats) if ((this.lastP < bp) !== (p < bp)) this.fire(g.byName[nm], a)
    this.lastP = p
    if (t > this.idleNext) {
      const rr = Math.random()
      this.fire(Math.floor(rr * g.H), 0.55 + range(p, 0.8, 1) * 0.6)
      this.idleNext = t + (p > 0.8 ? 1.4 : 2.6) + Math.random() * 1.5
    }

    // ---- story
    const qIn = range(p, 0.3, 0.39)
    const coneOn = band(p, 0.33, 0.4, 0.58, 0.66)
    const topOn = band(p, 0.38, 0.44, 0.74, 0.8)
    const stream = band(p, 0.55, 0.6, 0.78, 0.86)
    const tools = band(p, 0.61, 0.67, 0.82, 0.88)
    const sats = band(p, 0.56, 0.64, 0.84, 0.9)
    this.chunkMat.uniforms.uCone.value = coneOn
    this.chunkMat.uniforms.uTopK.value = topOn
    // while the cited answer is on screen, the retrieval geometry steps back so its hairlines read
    const ansOn = band(p, 0.45, 0.49, 0.58, 0.62) * (innerWidth < 720 ? 0 : 1)
    const quiet = 1 - ansOn * 0.55
    this.cone.material.uniforms.uA.value = coneOn * quiet
    this.cone.visible = coneOn > 0.001
    this.axisMat.opacity = coneOn * 0.5 * quiet
    this.ringMat.opacity = coneOn * 0.16 * (1 - ansOn * 0.7)
    this.beamMat.opacity = band(p, 0.4, 0.45, 0.58, 0.64) * 0.55 * quiet
    const F = this.flowMat.uniforms
    F.uQuery.value = qIn; F.uQVis.value = band(p, 0.3, 0.31, 0.6, 0.66); F.uStream.value = stream; F.uTool.value = tools
    this.arcMat.opacity = tools * 0.22 + sats * 0.05
    this.glowSet(this.qGlow, F.uQVis.value * (qIn > 0.98 ? 1 : 0.2) * (0.9 + 0.1 * Math.sin(t * 5)))

    // LLM core: context fills as chunks stream in
    const ctxFill = stream * (0.6 + 0.4 * Math.sin(t * 2.2) ** 2)
    this.glowSet(this.coreGlow, 0.3 + ctxFill * 0.55 + tools * 0.15)
    this.coreGlow.scale.setScalar(8 + ctxFill * 4)
    this.rings[0].rotation.z = t * 0.25; this.rings[1].rotation.z = -t * 0.18
    this.rings[0].rotation.x = Math.PI / 2 - 0.35 + Math.sin(t * 0.3) * 0.1
    this.coreInner.rotation.set(t * 0.4, t * 0.6, 0)
    this.coreEdges.material.opacity = 0.25 + ctxFill * 0.4
    for (const s of this.sats) {
      const cyc = (t * 0.23 + s.lane * 0.371) % 1
      const hit = Math.exp(-(((cyc - 0.25) / 0.03) ** 2)) + Math.exp(-(((cyc - 0.47) / 0.03) ** 2)) * 0.6
      // a satellite passing close to the lens must not flare across the frame
      const near = clamp((s.pos.distanceTo(this.camLocal) - 14) / 26)
      this.glowSet(s.glow, ((0.12 + hit * 0.6) * tools + sats * 0.1) * near)
      s.mesh.visible = sats > 0.01
      s.mesh.scale.setScalar(Math.max(0.001, sats) * (1 + hit * tools * 0.3))
      s.mesh.rotation.y = t * 0.5 + s.lane
    }

    // ---- labels
    const kpx = 2 * tanH / innerHeight
    const lab = band(p, -1, 0, 0.9, 0.98)
    this.named.forEach((n, i) => {
      const hot = this.hover === n.hub ? 1 : 0
      n.e.hot = hot
      n.e.target = (0.62 + hot * 0.38) * lab * (i === 0 ? 1 - stream * 0.6 : 1)
      n.e.label.material.color.setScalar(1 + hot * 0.6)
    })
    this.topLabels.forEach((e, i) => { e.target = band(p, 0.41 + i * 0.006, 0.45 + i * 0.006, 0.6, 0.66) * 0.95 })
    this.satLabels.forEach((e) => { e.target = sats * 0.85 })
    this.qLabel.target = band(p, 0.31, 0.34, 0.42, 0.47)
    this.coneLabel.target = band(p, 0.38, 0.42, 0.56, 0.62) * 0.9
    // declutter: a label yields to a higher-priority one it would overlap on screen
    const order = this.labelOrder ??= [this.qLabel, this.coneLabel, ...this.topLabels, ...this.satLabels, ...this.named.map((n) => n.e)]
    const hw2 = innerWidth / 2, hh2 = innerHeight / 2
    for (let i = 0; i < order.length; i++) {
      const e = order[i]
      if (e.target <= 0.01) { e.sx = -1e4; continue }
      const v = this.tmp.copy(e.anchor).add(this.group.position).project(cam)
      e.sx = v.z > 1 ? -1e4 : v.x * hw2; e.sy = v.y * hh2
      if (e.hot) continue
      for (let j = 0; j < i; j++) {
        const o = order[j]
        if (o.sx < -9e3) continue
        if (Math.abs(o.sy - e.sy) < 15 && e.sx - o.sx > -120 && e.sx - o.sx < 150) { e.target = 0; e.sx = -1e4; break }
      }
    }
    for (const e of this.labels) {
      e.op = damp(e.op, e.target, 6, dt)
      const d = this.tmp.copy(e.anchor).sub(this.camLocal).length()
      const near = clamp((d - 6) / 10)
      e.label.opacity = e.op * near
      e.grp.visible = e.label.visible
      if (!e.grp.visible) continue
      e.grp.scale.setScalar(e.px * d * kpx)
      faceCamera(e.grp, cam)
    }

    // ---- overlay
    if (this.dom) {
      const D = this.dom
      reveal(D.head, band(p, -1, 0, 0.12, 0.2) * (k > 0 ? range(k, 0.5, 1) : 1))
      const sb = [band(p, 0.02, 0.07, 0.25, 0.3), band(p, 0.31, 0.36, 0.52, 0.56), band(p, 0.57, 0.62, 0.78, 0.82), band(p, 0.84, 0.89, 0.955, 0.99)]
      D.stages.forEach((el, i) => reveal(el, sb[i]))
      const gb = [band(p, 0.04, 0.09, 0.25, 0.3), band(p, 0.4, 0.45, 0.54, 0.57), band(p, 0.62, 0.67, 0.8, 0.83), band(p, 0.86, 0.9, 0.955, 0.99)]
      D.groups.forEach((el, i) => reveal(el, gb[i]))
      const av = band(p, 0.45, 0.49, 0.58, 0.62) * (innerWidth < 720 ? 0 : 1)
      reveal(D.ans, av); reveal(D.wires, av, 0)
      if (av > 0) this.wireCites(D)
      reveal(D.hint, band(p, 0.05, 0.1, 0.96, 1.01) * (this.ctx.isMobile ? 0 : 1))
      this.roT += dt
      if (this.roT > 0.14) {
        this.roT = 0
        if (gb[1] > 0) D.cos.textContent = (0.91 - Math.random() * 0.004).toFixed(3)
        if (gb[2] > 0) {
          let n = 0
          for (let i = 0; i < TOOLS.length; i++) n += Math.floor(t * 0.23 + i * 0.371)
          D.tc.textContent = String(n)
        }
        if (gb[3] > 0 && this.lastWave) {
          const front = Math.max(0, (t - this.lastWave.t) * U.uSpeed.value)
          D.hop.textContent = `HOP ${String(Math.min(99, Math.floor(front))).padStart(2, '0')}`
          const w = U.uWaveA.value, T = U.uWaveT.value
          let a = 0
          for (let i = 0; i < 4; i++) a += w.getComponent(i) * Math.exp(-(t - T.getComponent(i)) * 0.26)
          D.act.textContent = String(Math.round(clamp(a / 3) * g.H))
        }
      }
    }
  }

  // Hairlines from each citation marker back to the exact retrieved chunk it came from.
  wireCites(D) {
    const cam = this.ctx.camera, off = this.group.position
    const ks = [0, 2, 5]
    D.cites.forEach((el, i) => {
      const rc = el.getBoundingClientRect()
      const sx = rc.left - 6, sy = rc.top + rc.height * 0.55
      const v = this.tmp.copy(this.top[ks[i]].pos).add(off).project(cam)
      const path = D.paths[i], dot = D.dots[i]
      if (v.z > 1) { path.setAttribute('d', ''); return }
      const ex = (v.x + 1) / 2 * innerWidth, ey = (1 - v.y) / 2 * innerHeight
      const mx = (sx + ex) / 2
      path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} C${(mx + 30).toFixed(1)} ${sy.toFixed(1)} ${(mx - 30).toFixed(1)} ${ey.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
      dot.setAttribute('cx', ex.toFixed(1)); dot.setAttribute('cy', ey.toFixed(1))
    })
  }

  glowSet(s, v) {
    s.material.opacity = clamp(v, 0, 1)
    s.material.color.copy(s.userData.base).multiplyScalar(1 + Math.max(0, v - 1) * 1.5)
    s.visible = v > 0.003
  }

  onLeave() { this.ctx.cursor.hover(null, null, this); this.hover = -1 }
}
