import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { chrome } from '../../lib/materials.js'
import { HEX } from '../../lib/palette.js'
import { range, band, damp, clamp, smoother, lerp, rng } from '../../lib/math.js'
import { reveal } from '../../lib/dom.js'
import { skillGroups, skillLinks, allSkills } from '../../content.js'
import { STAR_VERT, STAR_FRAG, LINE_VERT, LINE_FRAG, FIELD_VERT, FIELD_FRAG, RETICLE_VERT, RETICLE_FRAG, MASTER_VERT, MASTER_FRAG } from './shaders.js'
import './style.css'

// WORLD 10 · STACK: a technology constellation charted like a star map.
// Five ecosystems (content.skillGroups) float in 3D, each held by a thin chrome armillary.
// Straight constellation lines tie a group together; long faint arcs (content.skillLinks) cross between groups.
// Hovering a star lights its ecosystem and pulses its cross-links out toward the technologies it works with.

const G = skillGroups.length
const PER = 8
const N = G * PER // 40, baked into the shaders
const RING_R = 12.5

// ecosystem centres: a horseshoe around the origin, varied in height and radius so parallax reveals depth
const ANG = [-1.1, 0.0, 1.1, 2.2, 3.45]
const RAD = [44, 41, 47, 42, 48]
const HGT = [9, 19, -1, 5, -15]
const CENTERS = ANG.map((a, g) => new THREE.Vector3(Math.sin(a) * RAD[g], HGT[g], Math.cos(a) * RAD[g]))

// scroll keys: overview → 5 ecosystems → pulled-back exit
const CAM_AZ = [0.62, 0.55, 0.6, 0.55, -0.55]
const CAM_EL = [0.3, -0.1, -0.16, 0.24, 0.2]
const KEYS = [0, 0.15, 0.29, 0.43, 0.57, 0.71, 1]
const HOLD = 0.035

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _mi = new THREE.Matrix4()
const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _size = new THREE.Vector2()
const _cam = new THREE.Vector3()

function poseParams(i, aspect) {
  const wide = aspect < 1 ? 1.35 : 1
  if (i === 0) return { t: _tgt0, az: -1.9, el: 0.36, d: 162 * wide, shift: aspect < 1 ? 0 : 24 }
  if (i === 6) return { t: _tgt0, az: 4.75, el: 0.62, d: 215 * wide, shift: 0 }
  const g = i - 1
  return { t: CENTERS[g], az: ANG[g] + CAM_AZ[g], el: CAM_EL[g], d: 50 * wide, shift: aspect < 1 ? 0 : 7 }
}
const _tgt0 = new THREE.Vector3(0, 1, 0)
const _pa = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 }
const _right = new THREE.Vector3()

export default class SkillsWorld extends World {
  static height = 400

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0021
    this.bloom = 0.8
    this.exposure = 1.05
    this.parallax = 0.7
  }

  async init() {
    const low = this.ctx.quality === 'low'
    const R = rng(1010)
    this.rig = new THREE.Group()
    this.group.add(this.rig)

    // ---------- stars ----------
    this.names = []; this.groupOf = []; this.pos = []
    const index = new Map()
    skillGroups.forEach((grp, g) => grp.items.forEach((name) => { index.set(name, this.names.length); this.names.push(name); this.groupOf.push(g) }))
    this.index = index
    const links = skillLinks.map(([a, b]) => [index.get(a), index.get(b)]).filter(([a, b]) => a != null && b != null)
    this.degree = new Array(N).fill(0)
    this.neighbours = Array.from({ length: N }, () => [])
    links.forEach(([a, b]) => { this.degree[a]++; this.degree[b]++; this.neighbours[a].push(b); this.neighbours[b].push(a) })

    for (let g = 0; g < G; g++) {
      const c = CENTERS[g]
      const ids = []; for (let j = 0; j < PER; j++) ids.push(g * PER + j)
      // hub = most linked technology in the ecosystem
      const hub = ids.reduce((h, i) => (this.degree[i] > this.degree[h] ? i : h), ids[0])
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.28, R() * 6.28, R() * 6.28))
      let k = 0
      const pts = ids.map((i) => {
        if (i === hub) return new THREE.Vector3((R() - 0.5), (R() - 0.5), (R() - 0.5))
        const n = PER - 1, kk = k++
        const y = 1 - (kk + 0.5) / n * 2, r = Math.sqrt(1 - y * y), phi = kk * 2.39996
        const p = new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).applyQuaternion(rot)
        p.y *= 0.6
        p.multiplyScalar(6 + R() * 3.8)
        // lean toward the ecosystems this technology links out to, so arcs leave from the right side
        const lean = new THREE.Vector3()
        this.neighbours[i].forEach((o) => { if (this.groupOf[o] !== g) lean.add(_v.copy(CENTERS[this.groupOf[o]]).sub(c).normalize()) })
        if (lean.lengthSq() > 0) p.addScaledVector(lean.normalize(), 3)
        return p
      })
      // relax so no two stars crowd each other
      for (let it = 0; it < 40; it++) {
        for (let a = 0; a < PER; a++) for (let b = a + 1; b < PER; b++) {
          _v.subVectors(pts[a], pts[b]); const d = _v.length()
          if (d < 5.2) { _v.multiplyScalar((5.2 - d) / (d + 1e-3) * 0.5); if (ids[a] !== hub) pts[a].add(_v); if (ids[b] !== hub) pts[b].sub(_v) }
        }
        pts.forEach((p, a) => { if (ids[a] !== hub && p.length() > 10.5) p.setLength(10.5) })
      }
      ids.forEach((i, a) => { this.pos[i] = pts[a].add(c) })
      this.hubOf ??= []; this.hubOf[g] = hub
    }
    this.isHub = this.names.map((_, i) => (this.hubOf.includes(i) ? 1 : 0))

    const sg = new THREE.BufferGeometry()
    const sp = new Float32Array(N * 3), sIdx = new Float32Array(N), sHub = new Float32Array(N), sSeed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      sp.set([this.pos[i].x, this.pos[i].y, this.pos[i].z], i * 3)
      sIdx[i] = i; sHub[i] = this.isHub[i] ? 1 : Math.min(0.45, this.degree[i] * 0.12); sSeed[i] = R() * 100
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    sg.setAttribute('aIdx', new THREE.BufferAttribute(sIdx, 1))
    sg.setAttribute('aHub', new THREE.BufferAttribute(sHub, 1))
    sg.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 1))
    this.lvl = new Float32Array(N).fill(1)
    this.act = new Float32Array(N)
    this.lvlT = new Float32Array(N).fill(1)
    this.actT = new Float32Array(N)
    const shared = { uLvl: { value: this.lvl }, uAct: { value: this.act }, uTime: { value: 0 }, uDpr: { value: 1 } }
    this.shared = shared
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: shared, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.stars.frustumCulled = false
    this.stars.renderOrder = 5
    this.rig.add(this.stars)

    // ---------- constellation lines (intra) + long arcs (cross) in one LineSegments ----------
    const edges = [] // [a, b, kind]
    for (let g = 0; g < G; g++) {
      // minimum spanning tree over the ecosystem: the constellation figure
      const ids = []; for (let j = 0; j < PER; j++) ids.push(g * PER + j)
      const inT = new Set([ids[0]])
      while (inT.size < PER) {
        let best = null, bd = Infinity
        for (const a of inT) for (const b of ids) if (!inT.has(b)) { const d = this.pos[a].distanceToSquared(this.pos[b]); if (d < bd) { bd = d; best = [a, b] } }
        inT.add(best[1]); edges.push([best[0], best[1], 0])
      }
    }
    links.forEach(([a, b]) => {
      const same = this.groupOf[a] === this.groupOf[b]
      if (same && edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return
      edges.push([a, b, same ? 0 : 1])
    })
    this.crossCount = new Array(G).fill(0)
    links.forEach(([a, b]) => { if (this.groupOf[a] !== this.groupOf[b]) { this.crossCount[this.groupOf[a]]++; this.crossCount[this.groupOf[b]]++ } })
    this.linkCount = new Array(G).fill(0)
    links.forEach(([a, b]) => { this.linkCount[this.groupOf[a]]++; if (this.groupOf[a] !== this.groupOf[b]) this.linkCount[this.groupOf[b]]++ })

    const lp = [], lt = [], la = [], lb = [], lk = []
    const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), C = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3()
    edges.forEach(([a, b, kind]) => {
      P0.copy(this.pos[a]); P1.copy(this.pos[b])
      const segs = kind ? 48 : 10
      const dist = P0.distanceTo(P1)
      C.addVectors(P0, P1).multiplyScalar(0.5)
      if (kind) { const out = _v.copy(C).setY(C.y * 0.4).normalize(); C.addScaledVector(out, dist * 0.32); C.y += dist * 0.12 }
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs
        bez(P0, C, P1, t0, A); bez(P0, C, P1, t1, B)
        lp.push(A.x, A.y, A.z, B.x, B.y, B.z); lt.push(t0, t1); la.push(a, a); lb.push(b, b); lk.push(kind, kind)
      }
    })
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3))
    lg.setAttribute('aT', new THREE.Float32BufferAttribute(lt, 1))
    lg.setAttribute('aA', new THREE.Float32BufferAttribute(la, 1))
    lg.setAttribute('aB', new THREE.Float32BufferAttribute(lb, 1))
    lg.setAttribute('aKind', new THREE.Float32BufferAttribute(lk, 1))
    this.lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      uniforms: shared, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.lines.frustumCulled = false
    this.lines.renderOrder = 4
    this.rig.add(this.lines)

    // ---------- armillary per ecosystem ----------
    this.rings = []
    this.ringMats = []
    const torus = (r, tube) => new THREE.TorusGeometry(r, tube, 5, 180)
    const eqG = torus(RING_R, 0.038), meG = torus(RING_R * 0.985, 0.026), orG = torus(RING_R * 1.22, 0.018)
    const ticks = []
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * Math.PI * 2, major = i % 10 === 0, mid = i % 5 === 0
      const r0 = RING_R - 0.25, r1 = RING_R - (major ? 1.25 : mid ? 0.8 : 0.5)
      ticks.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1)
    }
    const tickG = new THREE.BufferGeometry(); tickG.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3))
    const tickM = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.chrome).multiplyScalar(0.55), transparent: true, opacity: 0.45, depthWrite: false })
    this.tickM = tickM
    for (let g = 0; g < G; g++) {
      const mat = chrome({ roughness: 0.22, envMapIntensity: 0.8, transparent: true, depthWrite: false })
      this.ringMats.push(mat)
      const frame = new THREE.Group()
      frame.position.copy(CENTERS[g])
      frame.quaternion.setFromEuler(new THREE.Euler((R() - 0.5) * 0.7, R() * 6.28, (R() - 0.5) * 0.7))
      const eq = new THREE.Mesh(eqG, mat); eq.rotation.x = Math.PI / 2
      const tk = new THREE.LineSegments(tickG, tickM)
      const gimbal = new THREE.Group()
      const me = new THREE.Mesh(meG, mat)
      gimbal.add(me)
      const orbit = new THREE.Group(); orbit.rotation.set(0.41 + R() * 0.2, 0, 0.3)
      const or = new THREE.Mesh(orG, mat); or.rotation.x = Math.PI / 2
      orbit.add(or)
      frame.add(eq, tk, gimbal, orbit)
      this.rig.add(frame)
      this.rings.push({ frame, gimbal, orbit, speed: 0.05 + R() * 0.04, phase: R() * 6.28 })
    }

    // ---------- master frame: a great graduated circle around the whole chart ----------
    {
      const pts = []
      const RR = 78
      for (let i = 0; i < 360; i++) {
        const a = i / 360 * Math.PI * 2, a2 = (i + 1) / 360 * Math.PI * 2
        pts.push(Math.cos(a) * RR, 0, Math.sin(a) * RR, Math.cos(a2) * RR, 0, Math.sin(a2) * RR)
        const len = i % 30 === 0 ? 3 : i % 10 === 0 ? 1.6 : i % 5 === 0 ? 0.9 : 0.45
        pts.push(Math.cos(a) * RR, 0, Math.sin(a) * RR, Math.cos(a) * (RR - len), 0, Math.sin(a) * (RR - len))
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      this.master = new THREE.LineSegments(g, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(HEX.chrome).multiplyScalar(0.13) } },
        vertexShader: MASTER_VERT, fragmentShader: MASTER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      this.master.frustumCulled = false
      this.master.rotation.set(0.12, 0, -0.05)
      this.master.position.y = -2
      this.rig.add(this.master)
      this.masterLabels = []
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2
        const l = new Label(String(i * 30).padStart(3, '0') + '°', { height: 1.1, color: HEX.smoke, align: 'center', opacity: 0.55 })
        l.position.set(Math.cos(a) * (RR + 3), 0, Math.sin(a) * (RR + 3))
        l.rotation.x = -Math.PI / 2
        l.rotation.z = -a - Math.PI / 2
        this.master.add(l)
        this.masterLabels.push(l)
      }
    }

    // ---------- labels ----------
    this.anchors = []
    for (let i = 0; i < N; i++) {
      const a = new THREE.Object3D()
      a.position.copy(this.pos[i])
      const hub = this.isHub[i]
      const l = new Label(this.names[i].toUpperCase(), { height: hub ? 0.5 : 0.42, color: hub ? HEX.white : HEX.chrome, weight: hub ? 500 : 400, tracking: 0.14 })
      l.position.set(hub ? 1.25 : 0.75, hub ? 0.5 : 0.28, 0)
      a.add(l)
      a.userData.label = l
      this.rig.add(a)
      this.anchors.push(a)
    }
    this.titles = []
    skillGroups.forEach((grp, g) => {
      const a = new THREE.Object3D()
      a.position.copy(CENTERS[g]).add(_v.set(0, RING_R + 2.6, 0))
      const t = new Label(grp.label, { height: 1.05, font: 'sans', weight: 400, tracking: 0.24, color: HEX.white, align: 'center' })
      const s = new Label(`ECO ${String(g + 1).padStart(2, '0')} · ${PER} NODES · ${this.crossCount[g]} CROSS-LINKS`, { height: 0.36, color: HEX.cyan, align: 'center', tracking: 0.2 })
      s.position.y = -1.05
      a.add(t, s)
      a.userData = { title: t, sub: s }
      this.rig.add(a)
      this.titles.push(a)
    })

    // ---------- reticle on the hovered star ----------
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: shared.uTime }, vertexShader: RETICLE_VERT, fragmentShader: RETICLE_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }))
    this.reticle.renderOrder = 12
    this.reticle.frustumCulled = false
    this.rig.add(this.reticle)

    // ---------- background starfield (deep shell) + dust (inside the chart) ----------
    const nField = low ? 2600 : 5200, nDust = low ? 1200 : 2400
    const fp = new Float32Array((nField + nDust) * 3), fs = new Float32Array(nField + nDust), ft = new Float32Array(nField + nDust)
    for (let i = 0; i < nField + nDust; i++) {
      const dust = i >= nField
      const u = R() * 2 - 1, ph = R() * 6.2832, s = Math.sqrt(1 - u * u)
      const r = dust ? 18 + Math.pow(R(), 0.7) * 95 : 280 + R() * 480
      fp.set([Math.cos(ph) * s * r, u * r * (dust ? 0.55 : 1), Math.sin(ph) * s * r], i * 3)
      fs[i] = dust ? -(0.4 + R() * 0.8) : 0.5 + Math.pow(R(), 7) * 3.2 // negative size marks dust
      ft[i] = R()
    }
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3))
    fg.setAttribute('aSize', new THREE.BufferAttribute(fs, 1))
    fg.setAttribute('aTemp', new THREE.BufferAttribute(ft, 1))
    this.field = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uDpr: shared.uDpr }, vertexShader: FIELD_VERT, fragmentShader: FIELD_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.field.frustumCulled = false
    this.group.add(this.field)

    // ---------- interaction state ----------
    this.focus = new Float32Array(G)
    this.rot = { x: 0, y: 0, vx: 0, vy: 0 }
    this.tilt = { x: 0, y: 0 }
    this.hoverStar = -1
    this.legendHover = -1
    this.lastPx = 0; this.lastPy = 0; this.lastP = 0
    this.screen = Array.from({ length: N }, () => new THREE.Vector3())
    this.pivot = new THREE.Vector3()
    this.hoverAmt = 0
    // screen-space label de-collision state
    this.lblO = new Float32Array(N); this.prio = new Float32Array(N); this.lblVis = new Float32Array(N).fill(1)
    this.lblDy = new Float32Array(N); this.lblDyT = new Float32Array(N)
    this.order = Array.from({ length: N }, (_, i) => i)
    this.rects = new Float32Array((N + G) * 4)
    this.byPrio = (a, b) => this.prio[b] - this.prio[a]
    this._uiDown = false
    this._onDown = (e) => { this._uiDown = !!e.target?.closest?.('a, button, nav, input, .interactive') }
    this._onUp = () => { this._uiDown = false }
    addEventListener('pointerdown', this._onDown, true)
    addEventListener('pointerup', this._onUp, true)
    addEventListener('pointercancel', this._onUp, true)
  }

  /**
   * Screen-space de-collision. Group titles are fixed obstacles; star names are placed greedily by priority
   * (hovered > traced > hub > focused ecosystem > degree). A name that would overlap tries a line above or
   * below; if both are taken it fades out instead of printing on top of another name.
   */
  declutter(cam, dt) {
    const W = innerWidth, H = innerHeight
    const k = H / (2 * Math.tan((cam.fov * Math.PI) / 360))
    this.rig.updateMatrixWorld(true)
    const R = this.rects
    let n = 0
    const place = (x0, y0, x1, y1) => { R[n * 4] = x0; R[n * 4 + 1] = y0; R[n * 4 + 2] = x1; R[n * 4 + 3] = y1; n++ }
    const hit = (x0, y0, x1, y1) => {
      for (let j = 0; j < n; j++) if (x0 < R[j * 4 + 2] && x1 > R[j * 4] && y0 < R[j * 4 + 3] && y1 > R[j * 4 + 1]) return true
      return false
    }
    const proj = (obj) => {
      _v.setFromMatrixPosition(obj.matrixWorld)
      const dist = _v.distanceTo(cam.position)
      _v.project(cam)
      if (_v.z > 1 || _v.z < -1) return 0
      return k / Math.max(dist, 1e-3) // px per world unit at that depth
    }
    for (let g = 0; g < G; g++) {
      const a = this.titles[g], t = a.userData.title
      if (t.opacity < 0.25) continue
      const ppu = proj(a); if (!ppu) continue
      const cx = (_v.x + 1) * 0.5 * W, cy = (1 - _v.y) * 0.5 * H
      const s = a.scale.x * ppu, hw = t.scale.x * 0.5 * s, hh = t.scale.y * 0.5 * s
      place(cx - hw, cy - hh, cx + hw, cy + hh)
    }
    this.order.sort(this.byPrio)
    for (const i of this.order) {
      const a = this.anchors[i], l = a.userData.label
      const o = this.lblO[i]
      let vis = 0
      if (o > 0.04) {
        const ppu = proj(a)
        if (ppu) {
          const cx = (_v.x + 1) * 0.5 * W, cy = (1 - _v.y) * 0.5 * H
          const s = a.scale.x * ppu
          const x0 = cx + l.position.x * s - 2, x1 = x0 + l.scale.x * s + 4
          const baseY = this.isHub[i] ? 0.5 : 0.28, hh = l.scale.y * 0.5 * s + 3
          const step = l.scale.y * 1.2
          const tries = [this.lblDyT[i], 0, step, -step]
          for (const dy of tries) {
            const cyL = cy - (baseY + dy) * s
            if (!hit(x0, cyL - hh, x1, cyL + hh)) { place(x0, cyL - hh, x1, cyL + hh); this.lblDyT[i] = dy; vis = 1; break }
          }
          if (!vis && i === this.hoverStar) vis = 1
        }
      }
      this.lblVis[i] = damp(this.lblVis[i], vis, vis ? 8 : 12, dt)
      this.lblDy[i] = damp(this.lblDy[i], this.lblDyT[i], 10, dt)
      l.position.y = (this.isHub[i] ? 0.5 : 0.28) + this.lblDy[i]
      l.opacity = o * this.lblVis[i]
    }
  }

  mount(el) {
    const groups = skillGroups.map((g, i) => `<button class="sk-lg-i" data-g="${i}" type="button"><i></i><span class="sk-n">${String(i + 1).padStart(2, '0')}</span><span class="sk-l">${g.label}</span><span class="sk-c">${String(g.items.length).padStart(2, '0')}</span></button>`).join('')
    const also = ['Programming', 'Core CS'].filter((k) => allSkills[k]).map((k) => `<span class="sk-also-k">${k}</span><span class="sk-also-v">${allSkills[k].join(' · ')}</span>`).join('')
    el.innerHTML = `
      <div class="w-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">Stack</h2>
        <p class="w-lede">Forty technologies in five ecosystems, charted by how they work together in the systems above.</p>
      </div>
      <nav class="sk-legend fx interactive" aria-label="Ecosystems">
        <div class="sk-lg-h">ECOSYSTEMS</div>
        ${groups}
        <div class="sk-hint">${this.ctx.isMobile ? 'tap a star to trace' : 'drag to explore · hover to trace'}</div>
      </nav>
      <div class="sk-also fx">${also}</div>`
    this.dom = {
      head: this.$('.w-head'), legend: this.$('.sk-legend'), also: this.$('.sk-also'),
      items: this.$$('.sk-lg-i'),
    }
    this.activeItem = -2
    this.dom.items.forEach((b) => {
      const g = +b.dataset.g
      b.addEventListener('pointerenter', () => { this.legendHover = g })
      b.addEventListener('pointerleave', () => { if (this.legendHover === g) this.legendHover = -1 })
      b.addEventListener('focus', () => { this.legendHover = g })
      b.addEventListener('blur', () => { if (this.legendHover === g) this.legendHover = -1 })
      b.addEventListener('click', () => this.ctx.goTo(this.meta.id, KEYS[g + 1]))
    })
  }

  /** Pose keyframe interpolation: spherical around a moving target, so the camera orbits between ecosystems. */
  pose(p, out) {
    const aspect = this.ctx.camera.aspect || 1.6
    let i = 0
    while (i < KEYS.length - 2 && p >= KEYS[i + 1]) i++
    const h0 = i === 0 ? 0.05 : HOLD, h1 = i + 1 === KEYS.length - 1 ? 0 : HOLD
    const e = smoother(range(p, KEYS[i] + h0, KEYS[i + 1] - h1))
    const A = poseParams(i, aspect), B = poseParams(i + 1, aspect)
    out.target.lerpVectors(A.t, B.t, e)
    const az = lerp(A.az, B.az, e), el = lerp(A.el, B.el, e)
    let d = lerp(A.d, B.d, e)
    if (i > 0 && i < 5) d += Math.sin(Math.PI * e) * 16 // breathe out between ecosystems
    const shift = lerp(A.shift, B.shift, e)
    out.pos.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(out.target)
    // push the subject right of centre (keeps the left third readable)
    _right.set(Math.cos(az), 0, -Math.sin(az))
    out.pos.addScaledVector(_right, -shift); out.target.addScaledVector(_right, -shift)
    out.fov = aspect < 1 ? 56 : 40
    return out
  }

  cameraAt(p, out) { this.pose(p, out) }

  update(p, dt, t, k) {
    const P = this.ctx.pointer
    const cam = this.ctx.camera
    const reduced = this.ctx.reducedMotion
    this.shared.uTime.value = t
    this.shared.uDpr.value = this.ctx.renderer.getPixelRatio()

    // ---------- overlay ----------
    if (this.dom) {
      reveal(this.dom.head, band(p, -1, 0, 0.07, 0.12))
      reveal(this.dom.legend, band(p, -1, 0.01, 0.95, 0.99))
      reveal(this.dom.also, band(p, 0.76, 0.82, 1.5, 2))
    }

    // ---------- ecosystem focus from scroll ----------
    let fsum = 0, best = -1, bestW = 0.5
    for (let g = 0; g < G; g++) {
      const w = 1 - smoother(Math.abs(p - KEYS[g + 1]) / 0.085)
      this.focus[g] = w; fsum += w
      if (w > bestW) { bestW = w; best = g }
    }
    const overview = clamp(1 - fsum)
    if (this.dom && best !== this.activeItem) {
      this.activeItem = best
      this.dom.items.forEach((b, i) => b.classList.toggle('is-active', i === best))
    }

    // ---------- drag with inertia, pointer tilt ----------
    const canDrag = !this.ctx.isMobile && k === 0 && !this._uiDown
    if (P.down && canDrag && this._wasDown) {
      const dx = P.x - this.lastPx, dy = P.y - this.lastPy
      this.rot.vy = damp(this.rot.vy, (dx / Math.max(dt, 1e-3)) * 1.5, 18, dt)
      this.rot.vx = damp(this.rot.vx, (-dy / Math.max(dt, 1e-3)) * 0.8, 18, dt)
    } else {
      const f = Math.exp(-2.4 * dt)
      this.rot.vx *= f; this.rot.vy *= f
    }
    this._wasDown = P.down && canDrag
    this.lastPx = P.x; this.lastPy = P.y
    this.rot.y += this.rot.vy * dt
    this.rot.x = clamp(this.rot.x + this.rot.vx * dt, -0.7, 0.7)
    if (Math.abs(p - this.lastP) > 1e-5 && !P.down) { // scrolling returns the instrument to its charted orientation
      this.rot.x = damp(this.rot.x, 0, 1.6, dt); this.rot.y = damp(this.rot.y, 0, 1.6, dt)
    }
    this.lastP = p
    const tiltAmt = reduced ? 0.3 : 1
    this.tilt.x = damp(this.tilt.x, -P.sy * 0.07 * tiltAmt, 3, dt)
    this.tilt.y = damp(this.tilt.y, P.sx * 0.11 * tiltAmt, 3, dt)

    this.pose(p, _pa)
    this.pivot.copy(_pa.target)
    _e.set(this.rot.x + this.tilt.x, this.rot.y + this.tilt.y, 0, 'YXZ')
    this.rig.quaternion.setFromEuler(_e)
    this.rig.position.copy(this.pivot).sub(_v.copy(this.pivot).applyQuaternion(this.rig.quaternion))
    this.rig.updateMatrix()
    _m.multiplyMatrices(this.group.matrixWorld, this.rig.matrix)
    _mi.copy(_m).invert()
    _cam.copy(cam.position).applyMatrix4(_mi) // camera in rig space

    // ---------- picking: nearest projected star within ~24 px ----------
    let hover = -1
    const W = innerWidth, H = innerHeight
    if (P.moved && k === 0 && this.active !== false) {
      const px = (P.x + 1) * 0.5 * W, py = (1 - P.y) * 0.5 * H
      const radius = this.ctx.isMobile ? 34 : 24
      let bd = radius * radius
      for (let i = 0; i < N; i++) {
        _v.copy(this.pos[i]).applyMatrix4(_m).project(cam)
        if (_v.z > 1 || _v.z < -1) continue
        const sx = (_v.x + 1) * 0.5 * W - px, sy = (1 - _v.y) * 0.5 * H - py
        let d = sx * sx + sy * sy
        if (i === this.hoverStar) d *= 0.6 // a little stickiness
        if (d < bd) { bd = d; hover = i }
      }
      // ignore stars under the overlay legend
      if (this.legendHover >= 0) hover = -1
    }
    if (hover !== this.hoverStar) {
      this.hoverStar = hover
      if (hover >= 0) {
        const n = this.degree[hover]
        this.ctx.cursor.hover(skillGroups[this.groupOf[hover]].label, `${this.names[hover]} · ${n ? n + (n === 1 ? ' link' : ' links') : 'core node'}`, this)
      } else this.ctx.cursor.hover(null, null, this)
    }

    // ---------- illumination targets ----------
    const hs = this.hoverStar, hg = hs >= 0 ? -1 : this.legendHover
    const tracing = hs >= 0 || hg >= 0
    for (let i = 0; i < N; i++) {
      const g = this.groupOf[i]
      let L = 0.3 + 0.7 * Math.max(this.focus[g], overview), A = 0
      if (hs >= 0) {
        if (i === hs) { L = 1.9; A = 1 } else if (this.neighbours[hs].includes(i)) L = 1.3
        else if (g === this.groupOf[hs]) L = 0.95
        else L = 0.14
      } else if (hg >= 0) {
        if (g === hg) { L = 1.2; A = 1 } else if (this.neighbours[i].some((o) => this.groupOf[o] === hg)) L = 1.0
        else L = 0.14
      }
      this.lvlT[i] = L; this.actT[i] = A
    }
    for (let i = 0; i < N; i++) {
      this.lvl[i] = damp(this.lvl[i], this.lvlT[i], 9, dt)
      this.act[i] = damp(this.act[i], this.actT[i], 7, dt)
    }
    this.hoverAmt = damp(this.hoverAmt, tracing ? 1 : 0, 6, dt)

    // ---------- labels ----------
    for (let i = 0; i < N; i++) {
      const a = this.anchors[i], l = a.userData.label
      const d = _v.copy(a.position).distanceTo(_cam)
      faceCamera(a, cam)
      a.scale.setScalar(clamp(d / 34, 0.85, 3.3))
      const g = this.groupOf[i], L = this.lvl[i]
      // in the overview only hubs keep names; in an ecosystem every star is named
      const traced = g === hg || (hs >= 0 && (g === this.groupOf[hs] || this.neighbours[hs].includes(i))) ? 1 : 0
      const named = Math.max(this.focus[g], this.isHub[i] ? 0.9 : 0, traced)
      const o = clamp((L - 0.12) / 0.9) * named
      this.lblO[i] = o * o * 0.95
      this.prio[i] = (i === hs ? 1000 : 0) + (traced ? 60 : 0) + this.isHub[i] * 40 + this.focus[g] * 30 + this.degree[i] * 2 + L
      const hot = i === hs ? 1 : 0, linked = hs >= 0 && hs !== i && this.neighbours[hs].includes(i) ? 1 : 0
      l.material.color.setRGB(1 + hot * 0.3 - linked * 0.25, 1 + hot * 0.3, 1 + hot * 0.3 + linked * 0.15)
    }
    for (let g = 0; g < G; g++) {
      const a = this.titles[g]
      const d = _v.copy(a.position).distanceTo(_cam)
      faceCamera(a, cam)
      a.scale.setScalar(clamp(d / 46, 0.8, 1.9))
      const on = tracing ? (g === hg || (hs >= 0 && g === this.groupOf[hs]) ? 1 : 0.08) : 0.06 + 0.94 * Math.max(this.focus[g], overview)
      a.userData.title.opacity = on * on * 0.95
      a.userData.sub.opacity = on * on * (0.3 + 0.6 * this.focus[g]) * (tracing ? 1.4 : 1)
      const rm = this.ringMats[g], ringOn = tracing ? (on > 0.5 ? 1 : 0.12) : 0.16 + 0.84 * Math.max(this.focus[g], overview)
      rm.opacity = damp(rm.opacity, ringOn, 6, dt)
      rm.envMapIntensity = damp(rm.envMapIntensity, tracing && on > 0.5 ? 1.1 : 0.45 + 0.3 * this.focus[g], 6, dt)
    }

    this.declutter(cam, dt)

    // ---------- instrument motion ----------
    const sp = reduced ? 0.25 : 1
    for (let g = 0; g < G; g++) {
      const r = this.rings[g]
      r.gimbal.rotation.y = r.phase + t * r.speed * sp
      r.orbit.rotation.y = -r.phase * 0.5 - t * r.speed * 0.6 * sp
    }
    this.master.rotation.y = t * 0.006 * sp

    // ---------- reticle ----------
    const ret = this.reticle
    const ro = ret.material.uniforms.uOpacity
    if (hs >= 0) {
      ret.position.copy(this.pos[hs])
      const d = _v.copy(ret.position).distanceTo(_cam)
      ret.scale.setScalar(d * 0.075)
      faceCamera(ret, cam)
    }
    ro.value = damp(ro.value, hs >= 0 ? 1 : 0, 10, dt)
    ret.visible = ro.value > 0.01
  }

  dispose() {
    removeEventListener('pointerdown', this._onDown, true)
    removeEventListener('pointerup', this._onUp, true)
    removeEventListener('pointercancel', this._onUp, true)
  }

  onLeave() {
    this.hoverStar = -1
    this.ctx.cursor.hover(null, null, this)
  }
}

function bez(a, c, b, t, out) {
  const u = 1 - t
  return out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z)
}
