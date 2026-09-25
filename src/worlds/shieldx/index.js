import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { chrome, graphite, smokedGlass, glow } from '../../lib/materials.js'
import { range, band, smoother, lerp, damp, rng, clamp } from '../../lib/math.js'
import { reveal, tag, linkChip } from '../../lib/dom.js'
import { projects } from '../../content.js'
import { X, flowMaterial, floorMaterial, paneMaterial, threadMaterial, poolMaterial, coreMaterial } from './shaders.js'
import './style.css'

// SHIELDX (world code comes from meta)
// The detection-and-response pipeline built as one physical filter, left to right:
// INGEST → DETECT → CORRELATE → ATT&CK → ANALYST → POLICY → RESPOND.
// A torrent of replayed network flows pours in; two detector planes flag a few; flagged flows are pulled into
// incident clusters; incidents map onto an ATT&CK technique grid; a glass analyst core only accepts evidence-linked
// threads; a deny-by-default aperture lets one action through and blocks another; the allowed one executes inside
// a sealed sandbox and both decisions are written to an audit strip.

const SX = projects.shieldx
const FLOOR_Y = -16
const STAGE_X = [X.ingest, X.detect, X.correlate, X.attack, X.analyst, X.policy, X.respond]
const STAGE_P = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82]
const INC = [new THREE.Vector3(-45, 8.5, -5), new THREE.Vector3(-40, -1.5, 6), new THREE.Vector3(-48, -9.5, -2)]
// Illustrative public MITRE ATT&CK technique ids (cells only; not claims about specific detections).
const TECH = [
  { id: 'T1046', col: 8, row: 1, inc: 0 },
  { id: 'T1110', col: 5, row: 3, inc: 1 },
  { id: 'T1498', col: 11, row: 2, inc: 2 },
  { id: 'T1190', col: 1, row: 4, inc: 1 },
]
const GRID = { cols: 12, rows: 7, cell: 2.05, gap: 0.42 }
const LOOP = 9 // seconds, policy/respond cycle

// camera keyframes: p, position, target, fov
const KEYS = [
  [0.0, [-232, 34, 104], [-142, -2, -8], 42],
  [0.1, [-204, 14, 74], [-152, 0, -4], 40],
  [0.22, [-122, 7, 40], [-86, 0, -2], 40],
  [0.34, [-78, 7, 46], [-46, -0.5, -1], 40],
  [0.46, [-22, 5, 50], [2, 0, -6], 40],
  [0.58, [20, 5, 34], [43, 0.5, 0], 40],
  [0.7, [54, 6, 38], [86, 0.5, -2], 40],
  [0.82, [100, 8, 52], [133, -1.5, 2], 40],
  [1.0, [-6, 104, 250], [-14, 10, -6], 44],
]

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _ray = new THREE.Ray()
const _hit = new THREE.Vector3()
const _m = new THREE.Matrix4()

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t
  for (const k of ['x', 'y', 'z']) {
    out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
  }
  return out
}

/** Line segments along a list of polylines, with aT (0→1 along each) and aSeed (per polyline). */
function threadGeometry(lines) {
  const pos = [], t = [], s = []
  lines.forEach((pts, li) => {
    for (let i = 0; i < pts.length - 1; i++) {
      pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)
      t.push(i / (pts.length - 1), (i + 1) / (pts.length - 1))
      s.push(li * 0.37, li * 0.37)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(s, 1))
  return g
}
const arc = (a, b, lift, n = 36) => new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(lift), b).getPoints(n)

function segGeometry(arr) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  return g
}
const lineMat = (color, opacity, intensity = 1) => new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })

export default class ShieldXWorld extends World {
  static height = 320

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0034
    this.bloom = 0.8
    this.exposure = 1.0
    this.parallax = 0.8
  }

  async init() {
    const low = this.ctx.quality === 'low'
    const g = this.group
    this.low = low
    this.px = Math.min(devicePixelRatio || 1, low ? 1.25 : 1.75)
    this.labels = [] // { l, stage, base, face }
    this.shaderMats = []
    const r = rng(2017)

    // ---------------------------------------------------------------- floor + spine
    this.floorMat = floorMaterial()
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(620, 420), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(-20, FLOOR_Y, 0)
    floor.renderOrder = -2
    g.add(floor)
    this.shaderMats.push(this.floorMat)

    const spineMat = graphite({ color: new THREE.Color('#3a424d'), roughness: 0.5, envMapIntensity: 0.35 })
    const spine = new THREE.Mesh(new THREE.BoxGeometry(X.respond - X.ingest + 70, 0.12, 0.3), spineMat)
    spine.position.set((X.respond + X.ingest) / 2 - 10, FLOOR_Y + 0.07, 17)
    g.add(spine)
    const ticks = []
    STAGE_X.forEach((x) => ticks.push(x, FLOOR_Y + 0.2, 17.3, x, FLOOR_Y + 0.2, 21.5))
    for (let x = X.ingest - 44; x < X.respond + 24; x += 4) ticks.push(x, FLOOR_Y + 0.2, 17.3, x, FLOOR_Y + 0.2, 18.2)
    g.add(new THREE.LineSegments(segGeometry(ticks), lineMat(HEX.chrome, 0.35)))
    SX.pipeline.forEach((name, i) => {
      const l = new Label(`${String(i + 1).padStart(2, '0')}  ${name}`, { height: 0.9, color: HEX.chrome, tracking: 0.22 })
      l.rotation.x = -Math.PI / 2
      l.position.set(STAGE_X[i] + 0.6, FLOOR_Y + 0.22, 20.6)
      g.add(l)
      this.addLabel(l, i, 0.8, false)
      const n = new Label(SX.pipelineNotes[i].toUpperCase(), { height: 0.55, color: HEX.smoke, tracking: 0.18 })
      n.rotation.x = -Math.PI / 2
      n.position.set(STAGE_X[i] + 0.6, FLOOR_Y + 0.22, 22.2)
      g.add(n)
      this.addLabel(n, i, 0.7, false)
    })

    // ---------------------------------------------------------------- flow torrent
    this.buildFlow(low, r)

    // ---------------------------------------------------------------- stages
    this.buildIngest()
    this.buildDetect(r)
    this.buildCorrelate()
    this.buildAttack()
    this.buildAnalyst()
    this.buildPolicy()
    this.buildRespond()

    // contact shadows under the hardware
    const shadowGeo = new THREE.PlaneGeometry(1, 1)
    const shadow = poolMaterial('#000000', 0.75)
    ;[[X.ingest - 12, 40, 34], [X.detect, 34, 30], [X.policy, 30, 26], [X.respond, 34, 30], [X.analyst, 26, 26]].forEach(([x, w, d]) => {
      const m = new THREE.Mesh(shadowGeo, shadow)
      m.rotation.x = -Math.PI / 2
      m.scale.set(w, d, 1)
      m.position.set(x, FLOOR_Y + 0.05, 0)
      g.add(m)
    })
    const lightGeo = new THREE.PlaneGeometry(1, 1)
    const pool = poolMaterial(new THREE.Color(HEX.cyan).lerp(new THREE.Color(HEX.blue), 0.35).multiplyScalar(0.1), 1, true)
    ;[[X.detect, 26], [X.correlate - 2, 34], [X.analyst, 22], [X.respond, 26]].forEach(([x, s]) => {
      const m = new THREE.Mesh(lightGeo, pool)
      m.rotation.x = -Math.PI / 2
      m.scale.set(s, s, 1)
      m.position.set(x, FLOOR_Y + 0.08, 0)
      g.add(m)
    })

    // state
    this.pt = new THREE.Vector3(0, 0, 999)
    this.ptrOn = 0
    this.hoverKey = null
    this.hoverInc = -1
    this.hoverIncS = -1
    this.flowT = 0
    this.lastFlowTxt = 0
    this.cycle = -1
    this.audit = []
    this.pushAudit('BOOT', 'policy loaded · deny by default')
  }

  addLabel(l, stage, base = 1, face = true) {
    l.material.opacity = base
    this.labels.push({ l, stage, base, face })
    return l
  }

  buildFlow(low, r) {
    const N = low ? 11000 : 22000
    const seeds = new Float32Array(N * 4), kinds = new Float32Array(N * 2), pos = new Float32Array(N * 3)
    let flagged = 0
    for (let i = 0; i < N; i++) {
      seeds.set([r(), r(), r(), r()], i * 4)
      const f = r() < 0.03
      const k = f ? 1 + (flagged++ % 3) : 0
      kinds[i * 2] = k
      kinds[i * 2 + 1] = r()
    }
    this.flagged = flagged
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
    geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 2))
    this.flowMat = flowMaterial(this.px)
    this.flowMat.uniforms.uC0.value.copy(INC[0])
    this.flowMat.uniforms.uC1.value.copy(INC[1])
    this.flowMat.uniforms.uC2.value.copy(INC[2])
    const pts = new THREE.Points(geo, this.flowMat)
    pts.frustumCulled = false
    pts.renderOrder = 2
    this.group.add(pts)
  }

  // INGEST: chrome intake rings that funnel the replayed flows into the duct
  buildIngest() {
    const g = this.group
    const ringMat = chrome({ roughness: 0.18 })
    const rings = [[X.ingest - 30, 17.5, 0.55], [X.ingest - 16, 14, 0.45], [X.ingest - 2, 10.5, 0.4], [X.detect - 16, 6.4, 0.32]]
    this.rings = rings.map(([x, rad, tube]) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 16, 120), ringMat)
      m.rotation.y = Math.PI / 2
      m.scale.set(1, 0.82, 1)
      m.position.x = x
      g.add(m)
      return m
    })
    // hairline glow on the inner lip of each ring
    const lip = lineMat(HEX.cyan, 0.5, 1.4)
    rings.forEach(([x, rad]) => {
      const c = new THREE.EllipseCurve(0, 0, rad - 0.6, (rad - 0.6) * 0.82).getPoints(120).map((p) => new THREE.Vector3(x + 0.3, p.y, p.x))
      g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), lip))
    })
    const t = new Label('FLOW', { height: 0.9, color: HEX.cyan, tracking: 0.3 })
    t.position.set(X.ingest - 16, 13.4, 2)
    g.add(t); this.addLabel(t, 0)
    const d = new Label(SX.dataset.toUpperCase(), { height: 0.6, color: HEX.chrome, tracking: 0.2 })
    d.position.set(X.ingest - 16, 12.2, 2)
    g.add(d); this.addLabel(d, 0)
    this.flowLabel = new Label('FLOWS REPLAYED  0', { height: 0.6, color: HEX.smoke, tracking: 0.18 })
    this.flowLabel.position.set(X.ingest - 16, 11.1, 2)
    g.add(this.flowLabel); this.addLabel(this.flowLabel, 0)
  }

  // DETECT: an XGBoost lattice of shallow trees and an isolation field of axis-aligned cuts
  buildDetect(r) {
    const g = this.group
    const W = 22, H = 17
    const xa = X.detect - 5, xb = X.detect + 5
    const frame = chrome({ roughness: 0.22 })
    const bar = (x, y, z, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, sy, sz), frame); m.position.set(x, y, z); g.add(m) }
    for (const x of [xa, xb]) {
      bar(x, H / 2, 0, 0.35, W + 0.35); bar(x, -H / 2, 0, 0.35, W + 0.35)
      bar(x, 0, W / 2, H, 0.35); bar(x, 0, -W / 2, H, 0.35)
      // pylons to the floor
      const ph = -H / 2 - FLOOR_Y, py = (FLOOR_Y - H / 2) / 2
      bar(x, py, W / 2 - 1.5, ph, 0.35)
      bar(x, py, -W / 2 + 1.5, ph, 0.35)
    }
    this.panes = []
    for (const [x, c, spd] of [[xa, HEX.cyan, 0.3], [xb, HEX.blue, 0.22]]) {
      const m = paneMaterial(c)
      m.uniforms.uSpeed.value = spd
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W, H), m)
      p.rotation.y = Math.PI / 2
      p.position.x = x
      g.add(p)
      this.shaderMats.push(m)
      this.panes.push(p)
    }
    // XGBoost: four shallow trees (a boosted ensemble) etched into the first pane
    const tr = []
    const toW = (u, v) => [xa + 0.05, v, u]
    const tree = (cu, cv, w, h, depth) => {
      const nodes = [[cu, cv + h / 2]]
      for (let d = 0; d < depth; d++) {
        const next = []
        const dx = w / Math.pow(2, d + 2), dy = h / depth
        for (const [u, v] of nodes) {
          if (d > 0 && r() < 0.18) continue // pruned leaf
          for (const s of [-1, 1]) {
            const nu = u + s * dx, nv = v - dy
            tr.push(...toW(u, v), ...toW(nu, nv))
            next.push([nu, nv])
          }
        }
        nodes.length = 0; nodes.push(...next)
      }
    }
    ;[[-5.2, 3.6], [5.2, 3.6], [-5.2, -4.2], [5.2, -4.2]].forEach(([u, v]) => tree(u, v, 9, 6, 3))
    g.add(new THREE.LineSegments(segGeometry(tr), lineMat(HEX.cyan, 0.55, 1.1)))
    // isolation field: recursive random cuts; one outlier is isolated in a handful of cuts
    const iso = [], hot = []
    const out = [3.4, 2.6]
    const cut = (u0, u1, v0, v1, d, onPath) => {
      if (d > 5 || (u1 - u0) < 1.2 || (v1 - v0) < 1.2) {
        if (onPath) hot.push([u0, u1, v0, v1])
        return
      }
      const ax = d % 2 === 0
      const s = ax ? lerp(u0, u1, 0.25 + r() * 0.5) : lerp(v0, v1, 0.25 + r() * 0.5)
      if (ax) iso.push(xb + 0.05, v0, s, xb + 0.05, v1, s); else iso.push(xb + 0.05, s, u0, xb + 0.05, s, u1)
      if (ax) { cut(u0, s, v0, v1, d + 1, onPath && out[0] < s); cut(s, u1, v0, v1, d + 1, onPath && out[0] >= s) }
      else { cut(u0, u1, v0, s, d + 1, onPath && out[1] < s); cut(u0, u1, s, v1, d + 1, onPath && out[1] >= s) }
    }
    cut(-W / 2, W / 2, -H / 2, H / 2, 0, true)
    g.add(new THREE.LineSegments(segGeometry(iso), lineMat(HEX.blue, 0.32, 1.2)))
    const hv = []
    hot.forEach(([u0, u1, v0, v1]) => {
      const x = xb + 0.08
      hv.push(x, v0, u0, x, v0, u1, x, v0, u1, x, v1, u1, x, v1, u1, x, v1, u0, x, v1, u0, x, v0, u0)
    })
    this.isoHot = new THREE.LineSegments(segGeometry(hv), lineMat(HEX.amber, 0.9, 1.6))
    g.add(this.isoHot)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), glow(HEX.amber, 2.4))
    dot.position.set(xb + 0.1, out[1], out[0])
    g.add(dot)
    this.isoDot = dot

    const l1 = new Label('XGBOOST', { height: 0.75, color: HEX.chrome, tracking: 0.26 })
    l1.position.set(xa, H / 2 + 1.8, 0); g.add(l1); this.addLabel(l1, 1)
    const l2 = new Label('ISOLATION FOREST', { height: 0.75, color: HEX.chrome, tracking: 0.26 })
    l2.position.set(xb, H / 2 + 1.8, 0); g.add(l2); this.addLabel(l2, 1)
    const l3 = new Label('ANOMALY', { height: 0.55, color: HEX.amber, tracking: 0.26 })
    l3.position.set(xb + 0.2, out[1] + 1.1, out[0]); g.add(l3); this.addLabel(l3, 1)
    const l4 = new Label('DETECT · SCORE', { height: 0.55, color: HEX.smoke, tracking: 0.24 })
    l4.position.set(xa, H / 2 + 0.8, 0); g.add(l4); this.addLabel(l4, 1)
  }

  // CORRELATE: three incident shells that flagged flows are pulled into
  buildCorrelate() {
    const g = this.group
    this.incRings = []
    const circle = new THREE.EllipseCurve(0, 0, 1, 1).getPoints(96).map((p) => new THREE.Vector3(p.x, p.y, 0))
    const cg = new THREE.BufferGeometry().setFromPoints(circle)
    const tickG = segGeometry([0, 1.12, 0, 0, 1.4, 0, 0, -1.12, 0, 0, -1.4, 0, 1.12, 0, 0, 1.4, 0, 0, -1.12, 0, 0, -1.4, 0, 0])
    INC.forEach((c, i) => {
      const grp = new THREE.Group()
      grp.position.copy(c)
      const mat = lineMat(i === 1 ? HEX.red : HEX.amber, 0.5, 1.2)
      const ring = new THREE.LineLoop(cg, mat)
      ring.scale.setScalar(3.8)
      grp.add(ring)
      const ticks = new THREE.LineSegments(tickG, mat)
      ticks.scale.setScalar(3.8)
      grp.add(ticks)
      g.add(grp)
      const l = new Label(`INCIDENT ${String(i + 1).padStart(2, '0')}`, { height: 0.6, color: i === 1 ? '#ff8a95' : '#ffcf85', tracking: 0.24 })
      l.position.set(c.x + 4.4, c.y + 2.8, c.z)
      g.add(l); this.addLabel(l, 2)
      this.incRings.push({ grp, mat, ring })
    })
    const l = new Label('CORRELATE · ALERTS → INCIDENTS', { height: 0.62, color: HEX.chrome, tracking: 0.22 })
    l.position.set(X.correlate - 6, 16.5, 0)
    g.add(l); this.addLabel(l, 2)
  }

  // ATT&CK: a thin technique matrix; each incident lights a technique cell
  buildAttack() {
    const g = this.group
    const { cols, rows, cell, gap } = GRID
    const W = cols * (cell + gap) - gap, H = rows * (cell + gap) - gap
    const root = new THREE.Group()
    root.position.set(X.attack + 2, 0.5, -8)
    root.rotation.y = -0.32
    g.add(root)
    this.matrix = root
    const cellAt = (c, r2, out = new THREE.Vector3()) => out.set(-W / 2 + cell / 2 + c * (cell + gap), H / 2 - cell / 2 - r2 * (cell + gap), 0)
    // plate
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.4, H + 3.6), smokedGlass({ opacity: 0.5, color: 0x070b10 }))
    plate.position.set(0, 0.5, -0.12)
    root.add(plate)
    const cellsMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false, toneMapped: false })
    const cells = new THREE.InstancedMesh(new THREE.PlaneGeometry(cell, cell), cellsMat, cols * rows)
    const col = new THREE.Color()
    const lit = new Map(TECH.map((t) => [t.col + t.row * cols, t]))
    let n = 0
    for (let r2 = 0; r2 < rows; r2++) for (let c = 0; c < cols; c++) {
      cellAt(c, r2, _a)
      _m.makeTranslation(_a.x, _a.y, 0)
      cells.setMatrixAt(n, _m)
      const t = lit.get(n)
      if (t) col.set(t.inc === 1 ? HEX.red : HEX.amber).multiplyScalar(0.32)
      else col.setRGB(0.009, 0.014, 0.02).multiplyScalar(0.7 + ((c * 7 + r2 * 13) % 5) * 0.16)
      cells.setColorAt(n, col)
      n++
    }
    cells.instanceColor.needsUpdate = true
    root.add(cells)
    // cell outlines
    const ol = []
    for (let r2 = 0; r2 < rows; r2++) for (let c = 0; c < cols; c++) {
      cellAt(c, r2, _a); const h = cell / 2
      ol.push(_a.x - h, _a.y - h, 0.01, _a.x + h, _a.y - h, 0.01, _a.x - h, _a.y + h, 0.01, _a.x + h, _a.y + h, 0.01)
    }
    root.add(new THREE.LineSegments(segGeometry(ol), lineMat(HEX.cyan, 0.12)))
    // tactic header ticks
    const hd = []
    for (let c = 0; c < cols; c++) { cellAt(c, 0, _a); hd.push(_a.x - cell / 2, H / 2 + 0.6, 0, _a.x + cell / 2, H / 2 + 0.6, 0) }
    root.add(new THREE.LineSegments(segGeometry(hd), lineMat(HEX.cyan, 0.5, 1.2)))
    // lit cell frames + ids
    const fr = []
    this.techLabels = []
    TECH.forEach((t) => {
      cellAt(t.col, t.row, _a); const h = cell / 2 + 0.12
      fr.push(_a.x - h, _a.y - h, 0.03, _a.x + h, _a.y - h, 0.03, _a.x + h, _a.y - h, 0.03, _a.x + h, _a.y + h, 0.03,
        _a.x + h, _a.y + h, 0.03, _a.x - h, _a.y + h, 0.03, _a.x - h, _a.y + h, 0.03, _a.x - h, _a.y - h, 0.03)
      const l = new Label(t.id, { height: 0.5, color: '#ffffff', weight: 600, tracking: 0.06, align: 'center' })
      l.position.set(_a.x, _a.y, 0.06)
      root.add(l); this.addLabel(l, 3, 1, false)
      this.techLabels.push(l)
    })
    this.techFrame = new THREE.LineSegments(segGeometry(fr), lineMat(HEX.amber, 0.9, 1.7))
    root.add(this.techFrame)
    const l = new Label('MITRE ATT&CK · TECHNIQUE MAP', { height: 0.62, color: HEX.chrome, tracking: 0.22 })
    l.position.set(-W / 2, H / 2 + 1.6, 0)
    root.add(l); this.addLabel(l, 3, 1, false)
    const l2 = new Label('ILLUSTRATIVE TECHNIQUE IDS', { height: 0.4, color: HEX.smoke, tracking: 0.2, align: 'right' })
    l2.position.set(W / 2, -H / 2 - 1.1, 0)
    root.add(l2); this.addLabel(l2, 3, 0.9, false)

    // incident → technique threads (world space)
    root.updateMatrixWorld(true)
    g.updateMatrixWorld(true)
    const lines = TECH.map((t) => {
      cellAt(t.col, t.row, _a).add(new THREE.Vector3(0, 0, 0.05))
      const end = _a.clone().applyMatrix4(root.matrix)
      const start = INC[t.inc].clone()
      return arc(start, end, new THREE.Vector3(0, 6 + t.row, 4))
    })
    this.incThread = threadMaterial(HEX.amber, { intensity: 1.2 })
    const th = new THREE.LineSegments(threadGeometry(lines), this.incThread)
    th.frustumCulled = false
    g.add(th)
    this.shaderMats.push(this.incThread)
  }

  // ANALYST: a smoked-glass core that only takes threads anchored to evidence
  buildAnalyst() {
    const g = this.group
    const C = new THREE.Vector3(X.analyst, 0.5, 0)
    this.coreC = C
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(5.6, 1), smokedGlass({ opacity: 0.4, flatShading: true, color: 0x0a1119, envMapIntensity: 0.55, clearcoatRoughness: 0.18 }))
    shell.position.copy(C)
    g.add(shell)
    this.shell = shell
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(5.62, 1)), lineMat(HEX.chrome, 0.28))
    edges.position.copy(C)
    g.add(edges)
    this.shellEdges = edges
    this.coreMat = coreMaterial()
    const core = new THREE.Mesh(new THREE.SphereGeometry(2.1, 32, 24), this.coreMat)
    core.position.copy(C)
    g.add(core)
    this.shaderMats.push(this.coreMat)
    // chrome cradle ring
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.14, 12, 120), chrome({ roughness: 0.22, envMapIntensity: 0.65 }))
    cradle.position.copy(C)
    cradle.rotation.set(Math.PI / 2 - 0.12, 0, 0.1)
    g.add(cradle)
    this.cradle = cradle
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, C.y - FLOOR_Y - 7, 16), graphite())
    post.position.set(C.x, (FLOOR_Y + C.y - 7) / 2, C.z)
    g.add(post)

    // evidence nodes on the intake side
    const ev = [[-11, 5.5, 3], [-12.5, 0.5, -3], [-10.5, -4.8, 4.5], [-8, 8.5, -5], [-13.5, -6.5, -3.5]]
    // evidence: dark machined blocks with a lit edge cage (data you can point at), not bare grey cubes
    const evMat = graphite({ color: new THREE.Color('#161c24'), roughness: 0.32, metalness: 0.9, envMapIntensity: 0.55 })
    const evGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8)
    const evEdge = new THREE.EdgesGeometry(evGeo)
    const evEdgeMat = lineMat(HEX.cyan, 0.7, 1.1)
    const lines = []
    this.evidence = ev.map(([dx, dy, dz], i) => {
      const m = new THREE.Mesh(evGeo, evMat)
      m.position.set(C.x + dx, C.y + dy, C.z + dz)
      m.rotation.set(0.6, 0.8, 0)
      m.add(new THREE.LineSegments(evEdge, evEdgeMat))
      g.add(m)
      const start = m.position.clone()
      const end = C.clone().add(_b.set(dx, dy, dz).normalize().multiplyScalar(2.2))
      lines.push(arc(start, end, new THREE.Vector3(0, 0.8, 0), 24))
      if (i < 3) {
        const l = new Label(i === 0 ? 'EVIDENCE' : `E·0${i + 1}`, { height: 0.42, color: HEX.chrome, tracking: 0.2, align: 'right' })
        l.position.set(m.position.x - 1, m.position.y + 0.9, m.position.z)
        g.add(l); this.addLabel(l, 4)
      }
      return m
    })
    // claim, out the far side
    const claim = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), glow(HEX.ice, 2.2))
    claim.position.set(C.x + 11, C.y + 1.5, C.z + 1)
    g.add(claim)
    this.claim = claim
    lines.push(arc(C.clone().add(new THREE.Vector3(2.2, 0.3, 0.2)), claim.position.clone(), new THREE.Vector3(0, 1.2, 0), 24))
    this.evThread = threadMaterial(HEX.cyan, { intensity: 1.6 })
    const th = new THREE.LineSegments(threadGeometry(lines), this.evThread)
    th.frustumCulled = false
    g.add(th)
    this.shaderMats.push(this.evThread)
    const lc = new Label('CLAIM · GROUNDED', { height: 0.46, color: HEX.ice, tracking: 0.22 })
    lc.position.set(claim.position.x + 1.2, claim.position.y + 0.1, claim.position.z)
    g.add(lc); this.addLabel(lc, 4)
    // an ungrounded thread: no evidence anchor, stopped at the glass
    const ua = new THREE.Vector3(C.x + 5, C.y - 9, C.z + 8)
    const ub = C.clone().add(_b.set(0.45, -0.75, 0.6).normalize().multiplyScalar(6.1))
    this.ungrounded = threadMaterial(HEX.smoke, { intensity: 1, dash: 1 })
    const ut = new THREE.LineSegments(threadGeometry([arc(ua, ub, new THREE.Vector3(1, 0, 0), 20)]), this.ungrounded)
    ut.frustumCulled = false
    g.add(ut)
    this.shaderMats.push(this.ungrounded)
    const x = new THREE.LineSegments(segGeometry([-0.4, -0.4, 0, 0.4, 0.4, 0, -0.4, 0.4, 0, 0.4, -0.4, 0]), lineMat(HEX.red, 1, 1.8))
    x.position.copy(ub)
    g.add(x)
    this.rejectX = x
    const lu = new Label('UNGROUNDED · REJECTED', { height: 0.32, color: '#ff8a95', tracking: 0.2 })
    lu.position.set(ua.x + 0.8, ua.y - 0.5, ua.z)
    g.add(lu); this.addLabel(lu, 4)
    const la = new Label('ANALYST · LLM', { height: 0.62, color: HEX.chrome, tracking: 0.24, align: 'center' })
    la.position.set(C.x, C.y + 9.6, C.z)
    g.add(la); this.addLabel(la, 4)
    const lb = new Label('VERIFIED EVIDENCE ONLY', { height: 0.42, color: HEX.smoke, tracking: 0.22, align: 'center' })
    lb.position.set(C.x, C.y + 8.7, C.z)
    g.add(lb); this.addLabel(lb, 4)
  }

  // POLICY: a chrome aperture that stays shut unless an action is explicitly allowed
  buildPolicy() {
    const g = this.group
    const P = new THREE.Vector3(X.policy, 0.5, 0)
    this.gateC = P
    const housing = graphite({ color: new THREE.Color('#1c222a'), metalness: 0.85, roughness: 0.34, envMapIntensity: 0.9, side: THREE.DoubleSide })
    const ann = new THREE.RingGeometry(6.6, 12.5, 96, 1)
    for (const dx of [-0.45, 0.45]) {
      const m = new THREE.Mesh(ann, housing)
      m.rotation.y = Math.PI / 2
      m.position.set(P.x + dx, P.y, P.z)
      g.add(m)
    }
    for (const [rad, tube] of [[12.5, 0.5], [6.6, 0.32]]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 16, 128), chrome({ roughness: 0.1 }))
      t.rotation.y = Math.PI / 2
      t.position.copy(P)
      g.add(t)
    }
    // blades: nine sectors between the two plates that retract radially when an action is allowed
    const B = 9
    this.blades = new THREE.Group()
    this.blades.position.copy(P)
    this.blades.rotation.y = Math.PI / 2
    g.add(this.blades)
    const bladeMat = chrome({ color: new THREE.Color('#9aa5b2'), roughness: 0.24, envMapIntensity: 1.0, side: THREE.DoubleSide })
    const seamMat = lineMat(HEX.cyan, 0.22, 1.2)
    this.bladeList = []
    const BR = 7.4, span = (Math.PI * 2) / B
    for (let i = 0; i < B; i++) {
      const th0 = i * span
      const geo = new THREE.CircleGeometry(BR, 10, th0 + 0.01, span - 0.02)
      const m = new THREE.Mesh(geo, bladeMat)
      m.userData.dir = new THREE.Vector2(Math.cos(th0 + span / 2), Math.sin(th0 + span / 2))
      m.rotateOnAxis(new THREE.Vector3(m.userData.dir.x, m.userData.dir.y, 0), 0.09)
      const seam = new THREE.LineSegments(segGeometry([0, 0, 0.02, Math.cos(th0) * BR, Math.sin(th0) * BR, 0.02, 0, 0, -0.02, Math.cos(th0) * BR, Math.sin(th0) * BR, -0.02]), seamMat)
      m.add(seam)
      this.blades.add(m)
      this.bladeList.push(m)
    }
    this.seamMat = seamMat
    // pylon
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, P.y - FLOOR_Y - 12.5, 3), graphite())
    post.position.set(P.x, (FLOOR_Y + P.y - 12.5) / 2, P.z)
    g.add(post)
    // status lamp ring (inner lip) coloured by decision
    this.lampMat = lineMat(HEX.cyan, 0.8, 1.6)
    const lip = new THREE.EllipseCurve(0, 0, 6.2, 6.2).getPoints(96).map((p) => new THREE.Vector3(P.x - 0.55, P.y + p.y, P.z + p.x))
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(lip), this.lampMat))
    // action tokens
    this.tokA = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), glow(HEX.cyan, 2.6))
    this.tokB = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), glow(HEX.amber, 2.2))
    this.tokBMat = this.tokB.material
    g.add(this.tokA, this.tokB)
    const ld = new Label('DENY BY DEFAULT', { height: 0.66, color: HEX.chrome, tracking: 0.26, align: 'center' })
    ld.position.set(P.x, P.y + 15, P.z)
    g.add(ld); this.addLabel(ld, 5)
    this.lAllow = new Label('ALLOWED · EXPLICIT RULE', { height: 0.5, color: '#9ff5cf', tracking: 0.22, align: 'center' })
    this.lAllow.position.set(P.x, P.y + 13.8, P.z)
    g.add(this.lAllow)
    this.lBlock = new Label('BLOCKED · NO ALLOW RULE', { height: 0.5, color: '#ff8a95', tracking: 0.22, align: 'center' })
    this.lBlock.position.set(P.x, P.y + 13.8, P.z)
    g.add(this.lBlock)
    const lp = new Label('POLICY', { height: 0.5, color: HEX.smoke, tracking: 0.26, align: 'center' })
    lp.position.set(P.x, P.y + 16.2, P.z)
    g.add(lp); this.addLabel(lp, 5)
  }

  // RESPOND: a sealed glass chamber where the allowed action runs (simulated), plus the audit strip
  buildRespond() {
    const g = this.group
    const S = new THREE.Vector3(X.respond, 0, 0)
    this.boxC = S
    const box = new THREE.BoxGeometry(18, 13, 13)
    const glass = new THREE.Mesh(box, smokedGlass({ opacity: 0.2, color: 0x070b10, envMapIntensity: 0.45, clearcoatRoughness: 0.15 }))
    glass.position.copy(S)
    g.add(glass)
    this.boxEdgeMat = lineMat(HEX.chrome, 0.5, 1)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.boxEdgeMat)
    edges.position.copy(S)
    g.add(edges)
    // chrome corner caps
    const capGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7)
    const capMat = chrome({ roughness: 0.22, envMapIntensity: 0.7 })
    for (const sx of [-9, 9]) for (const sy of [-6.5, 6.5]) for (const sz of [-6.5, 6.5]) {
      const c = new THREE.Mesh(capGeo, capMat)
      c.position.set(S.x + sx, S.y + sy, S.z + sz)
      g.add(c)
    }
    // plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(21, 0.8, 16), graphite({ color: new THREE.Color('#101318'), metalness: 0.35, roughness: 0.55, envMapIntensity: 0.3 }))
    plinth.position.set(S.x, S.y - 6.5 - 0.4, S.z)
    g.add(plinth)
    const legs = new THREE.Mesh(new THREE.BoxGeometry(14, S.y - 7.3 - FLOOR_Y, 9), graphite({ color: new THREE.Color('#0d1015') }))
    legs.position.set(S.x, (FLOOR_Y + S.y - 7.3) / 2, S.z)
    g.add(legs)
    // contained execution pulse
    this.pulseMat = lineMat(HEX.cyan, 0, 1.6)
    const pulse = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)), this.pulseMat)
    pulse.position.set(S.x + 2.5, S.y - 4.25, S.z - 1)
    g.add(pulse)
    this.pulse = pulse
    // the simulated host the allowed action is executed against
    const host = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.4, 5.2), graphite({ color: new THREE.Color('#1a2029'), roughness: 0.3, metalness: 0.9 }))
    host.position.set(S.x + 2.5, S.y - 4.25, S.z - 1)
    g.add(host)
    const slits = []
    for (let i = 0; i < 5; i++) { const y = S.y - 5.8 + i * 0.75; slits.push(S.x + 0.88, y, S.z - 3, S.x + 0.88, y, S.z + 0.4) }
    this.hostMat = lineMat(HEX.cyan, 0.6, 1.4)
    g.add(new THREE.LineSegments(segGeometry(slits), this.hostMat))
    const lh = new Label('SIM HOST', { height: 0.38, color: HEX.smoke, tracking: 0.22, align: 'center' })
    lh.position.set(S.x + 2.5, S.y - 1.3, S.z - 1)
    g.add(lh); this.addLabel(lh, 6)
    // inner floor grid of the chamber
    const gr = []
    for (let i = -8; i <= 8; i += 2) gr.push(S.x + i, S.y - 6.45, -6.3, S.x + i, S.y - 6.45, 6.3)
    for (let i = -6; i <= 6; i += 2) gr.push(S.x - 8.8, S.y - 6.45, i, S.x + 8.8, S.y - 6.45, i)
    g.add(new THREE.LineSegments(segGeometry(gr), lineMat(HEX.cyan, 0.14, 1)))
    const ls = new Label('SANDBOX', { height: 0.66, color: HEX.chrome, tracking: 0.26 })
    ls.position.set(S.x - 9, S.y + 8.4, S.z + 6.5)
    g.add(ls); this.addLabel(ls, 6)
    const ls2 = new Label('SIMULATED ACTIONS · ISOLATED', { height: 0.42, color: HEX.smoke, tracking: 0.2 })
    ls2.position.set(S.x - 9, S.y + 7.5, S.z + 6.5)
    g.add(ls2); this.addLabel(ls2, 6)

    // audit strip: a glass plate tilted toward the viewer in front of the chamber
    const strip = new THREE.Group()
    strip.position.set(S.x + 23.5, -3.2, 6)
    strip.rotation.y = -0.62
    g.add(strip)
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(24, 5.6), smokedGlass({ opacity: 0.55, color: 0x060a0f }))
    strip.add(plate)
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(24, 5.6)), lineMat(HEX.chrome, 0.3))
    strip.add(rim)
    const la = new Label('AUDIT', { height: 0.48, color: HEX.cyan, tracking: 0.3 })
    la.position.set(-11.4, 2.05, 0.02)
    strip.add(la); this.addLabel(la, 6, 1, false)
    this.auditLabel = new Label(' ', { height: 0.44, color: HEX.chrome, tracking: 0.1, lineHeight: 1.6 })
    this.auditLabel.position.set(-11.4, 0.1, 0.02)
    strip.add(this.auditLabel)
    this.addLabel(this.auditLabel, 6, 1, false)
  }

  pushAudit(verdict, text) {
    const s = Math.floor(this.ctx.time || 0)
    const ts = `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    this.audit.push(`${ts}  ${verdict.padEnd(6, ' ')} ${text}`)
    if (this.audit.length > 3) this.audit.shift()
    this.auditLabel?.setText(this.audit.join('\n'))
  }

  // ---------------------------------------------------------------- overlay
  mount(el) {
    this.el = el
    const full = SX.full.split(': ')[1] || SX.full
    el.innerHTML = `
      <div class="w-head sx-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">${SX.name}</h2>
        <p class="sx-full">${full}</p>
        <p class="w-lede">${SX.summary}</p>
        <p class="sx-ctx"><i></i>${SX.context}</p>
        <div class="sx-links">${linkChip('Live demo', SX.demo)}</div>
      </div>
      <div class="sx-stages fx" aria-hidden="true">
        <div class="sx-track">${SX.pipeline.map((s, i) => `<span class="sx-st" data-i="${i}"><b>${String(i + 1).padStart(2, '0')}</b><em>${s}</em></span>`).join('')}</div>
        <div class="sx-now"><span class="sx-now-k"></span><span class="sx-now-v"></span></div>
      </div>
      <div class="sx-end fx">
        <p class="sx-note">${SX.note}</p>
        <div class="sx-tags">${SX.stack.map(tag).join('')}${tag(SX.dataset)}</div>
        <div class="sx-links">${linkChip('Open the ShieldX demo', SX.demo)}</div>
      </div>`
    this.ui = {
      head: this.$('.sx-head'), stages: this.$('.sx-stages'), end: this.$('.sx-end'),
      st: this.$$('.sx-st'), nowK: this.$('.sx-now-k'), nowV: this.$('.sx-now-v'),
    }
    this.stageIdx = -1
  }

  cameraAt(p, out) {
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++
    const k0 = KEYS[Math.max(0, i - 1)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)]
    let t = clamp((p - k1[0]) / (k2[0] - k1[0]))
    t = lerp(t, smoother(t), 0.55)
    _a.fromArray(k0[1]); _b.fromArray(k1[1]); _c.fromArray(k2[1]); _d.fromArray(k3[1])
    catmull(_a, _b, _c, _d, t, out.pos)
    _a.fromArray(k0[2]); _b.fromArray(k1[2]); _c.fromArray(k2[2]); _d.fromArray(k3[2])
    catmull(_a, _b, _c, _d, t, out.target)
    out.fov = lerp(k1[3], k2[3], t)
    const aspect = this.ctx.camera.aspect
    if (aspect < 1) {
      _a.subVectors(out.pos, out.target).multiplyScalar(1.35)
      out.pos.copy(out.target).add(_a)
      out.fov += 14
    }
  }

  update(p, dt, t, k) {
    const cam = this.ctx.camera
    const u = this.flowMat.uniforms
    u.uTime.value = t
    for (const m of this.shaderMats) m.uniforms.uTime.value = t

    // ---------------- pointer: deflect nearby packets, readouts over incidents / hardware
    const active = k === 0 && this.active
    let key = null, val = '', inc = -1
    if (active && !this.ctx.isMobile) {
      const ray = this.localRay(_ray)
      if (ray.intersectPlane(_plane, _hit)) { this.pt.lerp(_hit, this.ptrOn < 0.01 ? 1 : 1 - Math.exp(-18 * dt)) }
      this.ptrOn = damp(this.ptrOn, 1, 4, dt)
      for (let i = 0; i < INC.length; i++) {
        if (ray.distanceSqToPoint(INC[i]) < 4.4 * 4.4) { inc = i; key = `INCIDENT 0${i + 1}`; val = `${Math.round(this.flagged / 3)} correlated alerts`; break }
      }
      if (!key && ray.distanceSqToPoint(this.coreC) < 42) { key = 'ANALYST'; val = 'reasons over verified evidence only' }
      else if (!key && ray.distanceSqToPoint(this.gateC) < 130) { key = 'POLICY'; val = 'deny by default · explicit allow only' }
      else if (!key && ray.distanceSqToPoint(this.boxC) < 90) { key = 'SANDBOX'; val = 'simulated response · audited' }
      else if (!key && ray.distanceSqToPoint(_a.set(X.detect, 0, 0)) < 100) { key = 'DETECT'; val = 'XGBoost + Isolation Forest' }
    } else this.ptrOn = damp(this.ptrOn, 0, 6, dt)
    u.uPtr.value.copy(this.pt)
    u.uPtrOn.value = this.ptrOn
    const hk = key ? key + val : null
    if (hk !== this.hoverKey) { this.hoverKey = hk; this.ctx.cursor.hover(key, val, this) }
    this.hoverIncS = inc
    u.uHover.value = inc

    // ---------------- incident rings: breathe, face camera, brighten on hover
    this.incRings.forEach((r, i) => {
      faceCamera(r.grp, cam)
      const hv = inc === i ? 1 : 0
      r.hv = damp(r.hv || 0, hv, 8, dt)
      r.grp.scale.setScalar(1 + 0.03 * Math.sin(t * 1.3 + i * 2) + r.hv * 0.18)
      r.mat.opacity = 0.35 + 0.15 * Math.sin(t * 2 + i) + r.hv * 0.4
    })

    // ---------------- detect: the isolated outlier blinks as the scan passes
    const blink = 0.6 + 0.4 * Math.sin(t * 3.2)
    this.isoHot.material.opacity = 0.5 + 0.45 * blink
    this.isoDot.scale.setScalar(0.8 + 0.4 * blink)
    this.rings.forEach((m, i) => { m.rotation.x = t * 0.05 * (i % 2 ? -1 : 1) })

    // ---------------- ATT&CK: lit cells pulse; threads grow in as the camera reaches the stage
    this.techFrame.material.opacity = 0.6 + 0.35 * Math.sin(t * 2.4)
    this.incThread.uniforms.uGrow.value = smoother(range(p, 0.28, 0.44)) * 1.001 + (k > 0 ? 0 : 0)

    // ---------------- analyst
    this.shell.rotation.y = t * 0.08
    this.shellEdges.rotation.y = t * 0.08
    this.cradle.rotation.z = 0.1 + t * 0.12
    this.claim.rotation.y = t * 0.9
    this.evidence.forEach((m, i) => { m.rotation.y = t * 0.4 + i })
    const ground = smoother(range(p, 0.48, 0.58))
    this.evThread.uniforms.uGrow.value = 0.05 + ground * 0.96
    this.coreMat.uniforms.uLevel.value = 0.35 + ground * 0.55
    this.ungrounded.uniforms.uOpacity.value = 0.6
    this.rejectX.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2))
    faceCamera(this.rejectX, cam)

    // ---------------- policy + respond cycle (ambient loop)
    this.policyCycle(t, dt)

    // ---------------- flows counter (running telemetry, ~6 Hz)
    if (t - this.lastFlowTxt > 0.16) {
      this.lastFlowTxt = t
      const n = Math.floor(t * 2380 + 184000)
      this.flowLabel.setText(`FLOWS REPLAYED  ${n.toLocaleString('en-US')}`)
    }

    // ---------------- labels: nearest stage is fully present, others recede
    const sf = this.stageF(p)
    for (const e of this.labels) {
      const near = clamp(1 - Math.abs(sf - e.stage) * 0.9)
      // standing labels belong to their stage only (no half-visible, cropped text from neighbours); floor labels keep a trace
      e.l.opacity = e.base * (e.face ? near * near : 0.18 + 0.82 * near) * (k > 0 ? smoother(k) : 1)
      if (e.face) faceCamera(e.l, cam)
    }
    faceCamera(this.lAllow, cam); faceCamera(this.lBlock, cam)

    this.floorMat.uniforms.uTime.value = t

    // ---------------- overlay
    if (!this.ui) return
    reveal(this.ui.head, k > 0 ? smoother(range(k, 0.75, 1)) : band(p, -1, 0, 0.07, 0.13))
    reveal(this.ui.stages, k > 0 ? 0 : band(p, 0.05, 0.1, 0.9, 0.96))
    reveal(this.ui.end, k > 0 ? 0 : band(p, 0.86, 0.92, 2, 3))
    const idx = Math.round(clamp(sf, 0, 6))
    if (idx !== this.stageIdx) {
      this.stageIdx = idx
      this.ui.st.forEach((s, i) => { s.classList.toggle('is-on', i === idx); s.classList.toggle('is-past', i < idx) })
      this.ui.nowK.textContent = SX.pipeline[idx]
      this.ui.nowV.textContent = SX.pipelineNotes[idx]
    }
  }

  /** Fractional stage index at scroll p. */
  stageF(p) {
    if (p <= STAGE_P[0]) return 0
    for (let i = 0; i < STAGE_P.length - 1; i++) if (p < STAGE_P[i + 1]) return i + (p - STAGE_P[i]) / (STAGE_P[i + 1] - STAGE_P[i])
    return 6 + (p - STAGE_P[6]) / 0.18
  }

  policyCycle(t, dt) {
    const reduced = this.ctx.reducedMotion
    const c = (t % LOOP) / LOOP
    const cyc = Math.floor(t / LOOP)
    const P = this.gateC, S = this.boxC
    // token A: approaches, gate opens (explicit allow), passes, executes in the sandbox
    const aT = c < 0.2 ? smoother(range(c, 0.02, 0.18)) * 0.37 : 0.37 + smoother(range(c, 0.24, 0.43)) * 0.63
    const ax = c < 0.2 ? lerp(P.x - 30, P.x - 4, aT / 0.37) : lerp(P.x - 4, S.x, (aT - 0.37) / 0.63)
    const aVis = band(c, 0.0, 0.03, 0.5, 0.56)
    this.tokA.position.set(ax, P.y + Math.sin(aT * Math.PI) * 0.6, 0)
    this.tokA.scale.setScalar(Math.max(0.001, aVis))
    this.tokA.rotation.y = t * 1.6
    const open = band(c, 0.17, 0.23, 0.34, 0.42)
    this.open = damp(this.open || 0, open, 7, dt)
    // token B: approaches, gate stays closed, stopped and marked
    const bT = smoother(range(c, 0.55, 0.72))
    const bx = lerp(P.x - 30, P.x - 1.8, bT)
    const hit = range(c, 0.76, 0.8)
    const bVis = band(c, 0.55, 0.58, 0.92, 0.98)
    this.tokB.position.set(bx - Math.sin(hit * Math.PI) * 0.8, P.y, 0)
    this.tokB.scale.setScalar(Math.max(0.001, bVis))
    this.tokB.rotation.y = t * 1.6
    this.tokBMat.color.set(c > 0.77 ? HEX.red : HEX.amber).multiplyScalar(c > 0.77 ? 2.4 : 2.2)
    // blades
    const o = reduced ? this.open : this.open
    this.blades.rotation.z = o * 0.45
    for (const b of this.bladeList) b.position.set(b.userData.dir.x * o * 4.8, b.userData.dir.y * o * 4.8, 0)
    // gate lamp
    const blocked = band(c, 0.77, 0.79, 0.9, 0.95)
    const allowed = band(c, 0.18, 0.23, 0.42, 0.48)
    this.lampMat.color.set(blocked > 0.01 ? HEX.red : allowed > 0.01 ? HEX.green : HEX.cyan).multiplyScalar(1.3 + blocked + allowed * 0.5)
    this.lampMat.opacity = 0.35 + 0.55 * Math.max(blocked, allowed)
    const near = clamp(1 - Math.abs(this.stageF(this.p) - 5) * 0.6)
    this.lAllow.opacity = allowed * (0.3 + 0.7 * near)
    this.lBlock.opacity = blocked * (0.3 + 0.7 * near)
    // sandbox execution: a contained pulse expands to the walls and the frame flashes
    const ex = range(c, 0.44, 0.62)
    this.pulse.scale.setScalar(2 + ex * 4.2)
    this.pulse.rotation.y = t * 0.5
    this.pulseMat.opacity = ex > 0 && ex < 1 ? (1 - ex) * 0.85 : 0
    const flash = band(c, 0.44, 0.47, 0.5, 0.6)
    this.hostMat.color.set(HEX.cyan).lerp(COLOR.green, flash).multiplyScalar(1.4 + flash)
    this.boxEdgeMat.color.set(HEX.chrome).lerp(COLOR.cyan, flash).multiplyScalar(1 + flash * 0.8)
    this.boxEdgeMat.opacity = 0.45 + flash * 0.45
    // audit entries on each decision
    const phase = c < 0.45 ? 0 : c < 0.78 ? 1 : 2
    if (this.cycle !== cyc * 3 + phase) {
      const prev = this.cycle
      this.cycle = cyc * 3 + phase
      if (prev >= 0) {
        if (phase === 1) this.pushAudit('ALLOW', 'response action → sandbox (simulated)')
        else if (phase === 2) this.pushAudit('DENY', 'response action · no allow rule')
      }
    }
  }
}
