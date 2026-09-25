// WORLD 05 · CONTINUUM: the voice agent that never starts from zero.
// Told physically, scroll-driven, in five beats:
//   1 LIVE CALL     a duplex thread (LiveKit WebRTC) between caller and agent; a cart docks beside it.
//   2 INTERRUPTION  the agent's TTS waveform is cut by a barge-in: the heard part stays solid, the unheard dissolves.
//   3 CALL DROP     the thread snaps; the task crystallises into a Qdrant memory shard + a MongoDB vault record.
//   4 CALLBACK      the caller rings back in Hindi; hybrid retrieval (dense + keyword, RRF) finds the English summary.
//   5 RESUMED       the thread rejoins, same cart, same language; the turn pipeline lights up as a physical chain.
// Built for StarForge 2026 (team build, winner). Facts come only from content.projects.continuum.
// Dialogue, cart items and session names are illustrative sample data.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { World } from '../../engine/World.js'
import { projects } from '../../content.js'
import { range, band, damp, smoother, easeOut, rng, clamp, lerp } from '../../lib/math.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { smokedGlass, graphite, chrome, glow } from '../../lib/materials.js'
import { Label, faceCamera } from '../../lib/label.js'
import { reveal, readout, tag, linkChip } from '../../lib/dom.js'
import {
  FLOOR_Y, floorMesh, contactShadow, strata, threadMat, threadGeometry, waveMat, ghostPoints,
  shardInstMat, heroShardMat, shardGeometry, latticeLines, nodePoints, beamLines, sweepPlane, buildVault, dust, crystalPoints,
} from './parts.js'
import './style.css'

const P = projects.continuum
const M = Object.fromEntries(P.metrics.map((m) => [m.label, m]))
const C = Object.fromEntries(P.contributions.map((c) => [c.label, c]))

// ---- layout (local space)
const CALLER = new THREE.Vector3(-20, 3, 0)
const X0 = -19.2, X1 = 21.4              // thread span (caller tip → agent aperture)
const AGENT = new THREE.Vector3(24, 1, 0) // housing centre (5 × 10 × 3.4)
const CART = new THREE.Vector3(12.5, -0.9, 6.8)
const WAVE = new THREE.Vector3(3.5, 8.3, 0)
const WAVE_W = 24, WAVE_H = 3
const LAT = new THREE.Vector3(-3, 10.5, -24)
const NX = 9, NY = 5, NZ = 4, SP = 3.3
const SLOT_IJK = [6, 2, 3]
const VAULT = new THREE.Vector3(22, FLOOR_Y + 2.3, 11)
const FORM = new THREE.Vector3(-0.2, 4.6, 0.4)

// ---- the agent's sentence, split where the caller barges in (illustrative)
const HEARD = 'Added atta, 5 kg. Shall I also'
const UNHEARD = ' apply your saved coupon and book delivery for 7 pm?'
const ITEMS = [
  { name: 'ATTA 5 KG', after: 'ATTA 5 KG  ×2' },
  { name: 'MILK 1 L' },
  { name: 'EGGS ×12' },
]
const BEATS = ['LIVE CALL', 'INTERRUPTION', 'CALL DROP', 'CALLBACK', 'RESUMED']
const BEAT_AT = [0, 0.19, 0.365, 0.51, 0.765]

// ---- camera keyframes [p, pos, target, fov]
const KEYS = [
  [0.0, [-31, 13.5, 45], [-1.5, 3.8, -5], 42],
  [0.1, [-9, 6.8, 27], [8, 2.6, 0.5], 38],
  [0.2, [2.5, 8.6, 34], [6, 4.8, 0], 38],
  [0.31, [1.5, 9, 33], [5.5, 4.7, 0], 38],
  [0.4, [-3, 8.8, 25], [-1, 5.3, -2], 40],
  [0.475, [-12, 17, 39], [11, 3, -1], 42],
  [0.56, [-30, 9.5, 21], [-9, 6, -10], 42],
  [0.61, [-21, 15, 17], [-2, 9, -18], 42],
  [0.66, [-7, 12.5, -1], [3, 9.6, -19], 42],
  [0.725, [8, 13, 38], [10, 2, 0], 42],
  [0.82, [-3, 7.5, 29], [3, 3, 0], 40],
  [0.92, [-3, 21, 52], [4, -3.8, -2], 40],
  [1.0, [-9, 38, 66], [0, 2, -8], 42],
]

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3()
function bez(out, a, c, b, t) {
  const u = 1 - t
  return out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z)
}

export default class ContinuumWorld extends World {
  static height = 480

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0068
    this.bloom = 0.85
    this.exposure = 1.0
    this.parallax = 0.8
    this.low = ctx.quality === 'low'
    this.S = {
      uTime: { value: 0 }, uFog: { value: this.fog }, uDim: { value: 1 }, uPx: { value: 1 },
      uGap: { value: 0 }, uRecoil: { value: 0 }, uDroop: { value: 0 }, uWhip: { value: 0 },
      uLinkL: { value: 1 }, uLinkR: { value: 1 }, uVoice: { value: 1 }, uBarge: { value: 0 }, uJoin: { value: 0 }, uFlash: { value: 0 },
      uMouse: { value: new THREE.Vector3(0, 100, 0) }, uHover: { value: 0 },
      uDense: { value: 0 }, uKwX: { value: -20 }, uKw: { value: 0 }, uFuse: { value: 0 }, uSlotGlow: { value: 0 },
      uVault: { value: 0 }, uLatOp: { value: 0 },
      uExt: { value: new THREE.Vector3((NX - 1) / 2 * SP + 2, (NY - 1) / 2 * SP + 2, (NZ - 1) / 2 * SP + 2) },
    }
    this.labels = []
    this._lastTick = -1
    this._beat = -1
    this._hit = new THREE.Vector3()
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(LAT.z + 6))
    this._mouseT = new THREE.Vector3(0, 100, 0)
    this.hoverAmt = 0
    this._col = new THREE.Color()
  }

  // ------------------------------------------------------------------ build
  async init() {
    const g = this.group
    this.S.uPx.value = Math.min(this.ctx.renderer.getPixelRatio(), 2)
    this.buildCameraPath()
    g.add(floorMesh(this.S))
    g.add(strata())
    this.buildCaller(g)
    this.buildAgent(g)
    this.buildThread(g)
    this.buildShock(g)
    this.buildCart(g)
    this.buildWave(g)
    this.buildLattice(g)
    this.buildVault(g)
    this.buildChain(g)
    this.buildLabels(g)
    g.add(dust(this.S, this.low ? 700 : 1500))
  }

  label(text, pos, o = {}) {
    const l = new Label(text, { height: 0.3, color: HEX.chrome, tracking: 0.16, ...o })
    l.position.copy(pos)
    l.userData.face = o.face !== false
    ;(o.parent || this.group).add(l)
    if (l.userData.face) this.labels.push(l)
    return l
  }

  buildCameraPath() {
    this.keyP = KEYS.map((k) => k[0])
    this.posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal')
    this.tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal')
    this.keyFov = KEYS.map((k) => k[3])
  }

  buildCaller(g) {
    const grp = new THREE.Group()
    grp.position.copy(CALLER)
    g.add(grp)
    const ch = chrome({ roughness: 0.12 })
    const gr = graphite({ color: 0x1a2029 })
    // stem + base: a small instrument standing on the floor
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, CALLER.y - FLOOR_Y - 0.4, 12), ch)
    stem.position.y = -(CALLER.y - FLOOR_Y) / 2 - 0.2
    grp.add(stem)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.28, 48), gr)
    base.position.y = FLOOR_Y - CALLER.y + 0.14
    grp.add(base)
    // the caller node: a horizontal capsule, the thread leaves from its tip
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 8, 24), gr)
    cap.rotation.z = Math.PI / 2
    grp.add(cap)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.16, 32, 1, true), ch)
    band.rotation.z = Math.PI / 2
    band.position.x = 0.2
    grp.add(band)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), glow(COLOR.ice, 3))
    tip.position.x = 0.85
    grp.add(tip)
    this.callerTip = tip
    // ring around the thread origin (YZ plane) + two ringing ripples
    const ringG = new THREE.TorusGeometry(1.0, 0.018, 8, 96)
    const ring = new THREE.Mesh(ringG, chrome())
    ring.rotation.y = Math.PI / 2
    ring.position.x = 0.9
    grp.add(ring)
    this.ripples = [0, 1].map(() => {
      const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.rotation.y = Math.PI / 2
      m.position.x = 0.9
      m.visible = false
      grp.add(m)
      return m
    })
    const sh = contactShadow(4, 4, 0.7)
    sh.position.x = CALLER.x; sh.position.z = CALLER.z
    g.add(sh)
  }

  buildAgent(g) {
    const grp = new THREE.Group()
    grp.position.copy(AGENT)
    g.add(grp)
    const Wd = 5, H = 10, D = 3.4
    const body = new THREE.Mesh(new RoundedBoxGeometry(Wd, H, D, 5, 0.32), graphite({ color: 0x161b22, roughness: 0.36, envMapIntensity: 0.8 }))
    grp.add(body)
    const ch = chrome()
    // chrome bands: the housing reads as precision hardware
    for (const y of [H / 2 - 1.1, -H / 2 + 0.9]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(Wd + 0.05, 0.08, D + 0.05), ch)
      b.position.y = y
      grp.add(b)
    }
    // aperture where the call terminates (faces the caller)
    const bez = new THREE.Mesh(new RoundedBoxGeometry(0.2, 3.2, 1.1, 2, 0.08), ch)
    bez.position.set(-Wd / 2 - 0.02, CALLER.y - AGENT.y, 0)
    grp.add(bez)
    const slitMat = glow(COLOR.cyan, 2.2, { transparent: true })
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 2.6), slitMat)
    slit.rotation.y = -Math.PI / 2
    slit.position.set(-Wd / 2 - 0.13, CALLER.y - AGENT.y, 0)
    grp.add(slit)
    this.slitMat = slitMat
    // speaker grille on the front face: the TTS voice leaves from here
    const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.055, 10), new THREE.MeshBasicMaterial({ color: 0x020304 }), 7 * 11)
    const m4 = new THREE.Matrix4()
    let n = 0
    for (let i = 0; i < 7; i++) for (let j = 0; j < 11; j++) {
      m4.makeTranslation(-1.2 + i * 0.4, 1.5 + j * 0.28 - 0.3, D / 2 + 0.005)
      holes.setMatrixAt(n++, m4)
    }
    grp.add(holes)
    // engraved achievement line (team build, StarForge 2026 winner): part of the machine, not a badge
    const eng = new Label('STARFORGE 2026 · WINNER\nTRACK 01 · VOXFORGE', { height: 0.24, color: HEX.chrome, tracking: 0.3, align: 'center', intensity: 0.62, lineHeight: 1.7 })
    eng.position.set(0, -2.55, D / 2 + 0.012)
    grp.add(eng)
    this.engrave = eng
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.018, 0.01), ch)
    inlay.position.set(0, -1.95, D / 2 + 0.01)
    grp.add(inlay)
    const inlay2 = inlay.clone(); inlay2.position.y = -3.25
    grp.add(inlay2)
    // status pip
    this.agentPip = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), glow(COLOR.green, 2))
    this.agentPip.position.set(Wd / 2 - 0.5, H / 2 - 0.6, D / 2 + 0.01)
    grp.add(this.agentPip)
    const sh = contactShadow(9, 7, 0.8)
    sh.position.set(AGENT.x, FLOOR_Y + 0.02, AGENT.z)
    g.add(sh)
  }

  buildThread(g) {
    const geo = threadGeometry(X0, X1, 0.04)
    const a = new THREE.Mesh(geo, threadMat(this.S, { x0: X0, x1: X1, r: 0.2, phase: 0, dir: 1, color: HEX.ice }))
    const b = new THREE.Mesh(geo, threadMat(this.S, { x0: X0, x1: X1, r: 0.2, phase: Math.PI, dir: -1, color: HEX.cyan }))
    const halo = new THREE.Mesh(threadGeometry(X0, X1, 0.42, 300), threadMat(this.S, { x0: X0, x1: X1, r: 0, phase: 0, dir: 1, color: HEX.blue, halo: true }))
    for (const m of [halo, a, b]) { m.position.y = CALLER.y; m.frustumCulled = false; g.add(m) }
  }

  buildShock(g) {
    // the snap: a pressure ring leaves the break point the instant the call drops
    const geo = new THREE.TorusGeometry(1, 0.006, 4, 160)
    this.shock = [HEX.ice, HEX.red, HEX.ice].map((c, i) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i === 1 ? 0.9 : 1.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.position.set((X0 + X1) / 2, CALLER.y, 0)
      m.visible = false
      g.add(m)
      return m
    })
  }

  buildCart(g) {
    const grp = new THREE.Group()
    grp.position.copy(CART)
    g.add(grp)
    const tray = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.14, 2.3, 2, 0.06), smokedGlass({ opacity: 0.5, color: 0x0a121a, envMapIntensity: 0.55, clearcoat: 0.4, roughness: 0.22 }))
    grp.add(tray)
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(5.6, 0.14, 2.3)), new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.ice).multiplyScalar(0.9), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))
    grp.add(edge)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CART.y - FLOOR_Y, 8), chrome())
    leg.position.y = -(CART.y - FLOOR_Y) / 2
    grp.add(leg)
    const sh = contactShadow(5, 3, 0.5)
    sh.position.set(CART.x, FLOOR_Y + 0.02, CART.z)
    g.add(sh)
    this.cartLabel = this.label('CART · 0 ITEMS', new THREE.Vector3(-2.8, -0.34, 1.3), { parent: grp, height: 0.24, color: HEX.smoke, face: false })
    this.cartLabel.rotation.x = -0.35
    // items
    const bgeo = new RoundedBoxGeometry(1.35, 0.8, 1.05, 2, 0.08)
    const egeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.35, 0.8, 1.05))
    this.items = ITEMS.map((it, i) => {
      const ig = new THREE.Group()
      const mat = smokedGlass({ opacity: 0.6, color: 0x0e1a26, envMapIntensity: 1.8 })
      const mesh = new THREE.Mesh(bgeo, mat)
      mesh.renderOrder = 3
      const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.ice).multiplyScalar(1.25), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
      const e = new THREE.LineSegments(egeo, lm)
      ig.add(mesh, e)
      const l = new Label(it.name, { height: 0.15, color: HEX.white, tracking: 0.12, align: 'center', intensity: 0.9 })
      l.position.set(0, 0.05, 0.54)
      ig.add(l)
      g.add(ig)
      return { g: ig, mat, lm, label: l, home: new THREE.Vector3(CART.x - 1.75 + i * 1.75, CART.y + 0.48, CART.z), dx: -1.3 + i * 1.3, it }
    })
  }

  buildWave(g) {
    // caption texture: text only in the lower band; bars are procedural in the shader
    const cw = 2048, chh = 256
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh
    const c2 = cv.getContext('2d')
    const full = HEARD + UNHEARD
    let px = 60
    const fnt = (s) => `300 ${s}px "Geist", "Inter", system-ui, sans-serif`
    c2.font = fnt(px)
    const pad = 24
    const wFull = c2.measureText(full).width
    px = Math.min(60, px * (cw - pad * 2) / wFull)
    c2.font = fnt(px)
    const wHeard = c2.measureText(HEARD).width
    const w2 = c2.measureText(full).width
    const x0 = (cw - w2) / 2
    c2.fillStyle = '#ffffff'
    c2.textBaseline = 'middle'
    c2.fillText(full, x0, chh * 0.8)
    this.cutU = (x0 + wHeard + px * 0.12) / cw
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = waveMat(this.S, tex)
    mat.uniforms.uCut.value = this.cutU
    const m = new THREE.Mesh(new THREE.PlaneGeometry(WAVE_W, WAVE_H), mat)
    m.position.copy(WAVE)
    m.renderOrder = 6
    m.frustumCulled = false
    g.add(m)
    this.wave = m
    this.ghost = ghostPoints(this.S, this.low ? 700 : 1600, WAVE_W, WAVE_H, this.cutU)
    this.ghost.position.copy(WAVE)
    g.add(this.ghost)
    // a thin chrome rule under the waveform connects it back to the agent
    const rule = new THREE.Mesh(new THREE.BoxGeometry(WAVE_W, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.chrome).multiplyScalar(0.35), transparent: true, opacity: 0 }))
    rule.position.set(WAVE.x, WAVE.y - WAVE_H / 2 - 0.1, 0)
    g.add(rule)
    this.waveRule = rule
    this.cutX = WAVE.x + (this.cutU - 0.5) * WAVE_W
  }

  buildLattice(g) {
    const lg = new THREE.Group()
    lg.position.copy(LAT)
    g.add(lg)
    this.lat = lg
    const nodes = []
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
      nodes.push(new THREE.Vector3((i - (NX - 1) / 2) * SP, (j - (NY - 1) / 2) * SP, (k - (NZ - 1) / 2) * SP))
    }
    const id = (i, j, k) => (i * NY + j) * NZ + k
    const slot = nodes[id(...SLOT_IJK)].clone()
    this.slotL = slot
    this.slotW = slot.clone().add(LAT)
    const lines = latticeLines(this.S, nodes, NX, NY, NZ)
    lines.material.uniforms.uSlot.value.copy(slot)
    lg.add(lines)
    lg.add(nodePoints(this.S, nodes))
    // other callers' memories: dim shards in cells
    const r = rng(2026)
    const count = this.low ? 90 : 150
    const geo = shardGeometry()
    const mesh = new THREE.InstancedMesh(geo, shardInstMat(this.S), count)
    const seed = new Float32Array(count), role = new Float32Array(count)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3()
    const placed = []
    for (let n = 0; n < count; n++) {
      let p
      do {
        const base = nodes[Math.floor(r() * nodes.length)]
        p = base.clone().add(new THREE.Vector3((r() - 0.5) * 2.2, (r() - 0.5) * 2.2, (r() - 0.5) * 2.2))
      } while (p.distanceTo(slot) < 1.6)
      placed.push(p)
      e.set((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7)
      q.setFromEuler(e)
      const s = 0.38 + r() * 0.42
      sc.set(s, s, s)
      m4.compose(pos.copy(p), q, sc)
      mesh.setMatrixAt(n, m4)
      seed[n] = r()
    }
    // roles: nearest neighbours of the slot are the dense (semantic) candidates; a few scattered ones are keyword hits
    const order = placed.map((p, i) => [p.distanceTo(slot), i]).sort((a, b) => a[0] - b[0])
    this.denseIdx = order.slice(0, 6).map((o) => o[1])
    this.denseIdx.forEach((i) => (role[i] = 1))
    const kw = [order[2][1], order[14][1], order[30][1], order[55][1], order[80][1]]
    kw.forEach((i) => (role[i] = role[i] === 1 ? 3 : 2))
    this.densePos = this.denseIdx.map((i) => placed[i])
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1))
    geo.setAttribute('aRole', new THREE.InstancedBufferAttribute(role, 1))
    mesh.frustumCulled = false
    lg.add(mesh)
    this.shards = mesh
    // the caller's own shard (flies in from the dropped call) + four isolation rings
    const hs = new THREE.Mesh(shardGeometry(), heroShardMat(this.S))
    hs.scale.setScalar(0)
    hs.frustumCulled = false
    g.add(hs)
    this.hero = hs
    this.cryst = crystalPoints(this.S, this.low ? 350 : 800, FORM, (X0 + X1) / 2, CALLER.y)
    g.add(this.cryst)
    this.rings = [1.25, 1.55, 1.85, 2.15].map((rad, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.012, 6, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      m.position.copy(this.slotW)
      m.userData.axis = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * 1.1), Math.sin(i * 0.6 + 1)).normalize()
      m.rotation.set(i * 0.8, i * 1.3, 0)
      m.visible = false
      g.add(m)
      return m
    })
    // query vector (callback) + retrieval beams + keyword sweep
    const qm = new THREE.Mesh(shardGeometry(), heroShardMat(this.S))
    qm.material.uniforms.uGlow.value = 1.6
    qm.scale.setScalar(0)
    g.add(qm)
    this.query = qm
    this.beams = beamLines(this.S, 1 + this.densePos.length)
    g.add(this.beams)
    this.sweep = sweepPlane(this.S, NY * SP + 1, NZ * SP + 1)
    lg.add(this.sweep)
  }

  buildVault(g) {
    const mats = {
      body: graphite({ color: 0x171c23, roughness: 0.38 }),
      chrome: chrome(),
      inner: graphite({ color: 0x0b0e12, roughness: 0.6 }),
      status: new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.green) }),
    }
    const v = buildVault(mats)
    v.group.position.copy(VAULT)
    v.group.rotation.y = -0.55
    v.group.updateMatrixWorld(true)
    g.add(v.group)
    this.vault = v
    this.vaultStatus = mats.status
    const sh = contactShadow(10, 8, 0.8)
    sh.position.set(VAULT.x, FLOOR_Y + 0.02, VAULT.z)
    g.add(sh)
  }

  buildChain(g) {
    // the turn pipeline as a physical chain inlaid in the floor beneath the call
    const n = P.pipeline.length
    const xs = P.pipeline.map((_, i) => -16.5 + (33 / (n - 1)) * i)
    this.chainX = xs
    const z = 2.4, y = FLOOR_Y + 0.12
    const puck = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.62, 0.7, 0.24, 40), graphite({ color: 0x1a2029 }), n)
    const ring = new THREE.InstancedMesh(new THREE.TorusGeometry(0.66, 0.035, 8, 48), chrome(), n)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    const one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3()
    xs.forEach((x, i) => {
      m4.makeTranslation(x, y, z); puck.setMatrixAt(i, m4)
      m4.compose(pv.set(x, y + 0.12, z), q, one); ring.setMatrixAt(i, m4)
    })
    g.add(puck, ring)
    // glowing caps: light as a pulse runs the pipeline
    const capGeo = new THREE.CircleGeometry(0.34, 32)
    const idx = new Float32Array(n).map((_, i) => i)
    capGeo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1))
    const capMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uP: { value: -1 }, uBase: { value: 0.25 }, uTime: this.S.uTime, uFog: this.S.uFog },
      vertexShader: /* glsl */`attribute float aIdx; uniform float uP, uBase, uTime; varying float vE; varying vec2 vUv; varying float vFogD;
        void main(){ vUv = uv; float d = uP - aIdx;
          vE = uBase*(0.7 + 0.3*sin(uTime*1.5 + aIdx)) + smoothstep(-0.2, 0.3, d)*0.9 + exp(-d*d*6.0)*2.2;
          vec4 mv = modelViewMatrix*instanceMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uFog; varying float vE; varying vec2 vUv; varying float vFogD;
        void main(){ float r = length(vUv-0.5)*2.0; float a = smoothstep(1.0, 0.2, r); float ring = smoothstep(0.08,0.0,abs(r-0.8));
          gl_FragColor = vec4(vec3(0.4,0.8,1.3)*(a*0.8+ring*0.6)*vE*exp(-uFog*uFog*vFogD*vFogD), 1.0); }`,
    })
    const caps = new THREE.InstancedMesh(capGeo, capMat, n)
    xs.forEach((x, i) => { m4.compose(pv.set(x, y + 0.125, z), q, one); caps.setMatrixAt(i, m4) })
    caps.frustumCulled = false
    g.add(caps)
    this.capMat = capMat
    // rail + flowing light between stations
    const rail = new THREE.Mesh(new THREE.BoxGeometry(33, 0.03, 0.06), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uP: { value: -1 }, uFog: this.S.uFog },
      vertexShader: /* glsl */`varying float vX; varying float vFogD; void main(){ vX = position.x; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime, uP, uFog; varying float vX; varying float vFogD;
        void main(){ float s = (vX + 16.5)/33.0*7.0; float lit = smoothstep(uP+0.2, uP-0.2, s);
          float flow = pow(0.5+0.5*sin(vX*1.4 - uTime*5.0), 8.0);
          float e = 0.12 + lit*(0.4 + flow*1.4) + exp(-pow((s-uP)*3.0,2.0))*2.0;
          gl_FragColor = vec4(vec3(0.4,0.75,1.3)*e*exp(-uFog*uFog*vFogD*vFogD), 1.0); }`,
    }))
    rail.position.set(0, y + 0.02, z)
    rail.frustumCulled = false
    g.add(rail)
    this.railMat = rail.material
    this.chainLabels = P.pipeline.map((t, i) => {
      const l = this.label(t, new THREE.Vector3(xs[i], y + 0.75, z), { height: 0.25, color: HEX.chrome, align: 'center', tracking: 0.14 })
      l.opacity = 0
      return l
    })
  }

  buildLabels(g) {
    const L = (t, p, o) => this.label(t, p, o)
    this.lCaller = L('CALLER · SESSION A', new THREE.Vector3(CALLER.x - 1.2, CALLER.y + 1.6, 0), { height: 0.26, align: 'center' })
    this.lAgent = L('AGENT', new THREE.Vector3(AGENT.x, AGENT.y + 5.9, 0), { height: 0.3, align: 'center' })
    this.lLink = L('LIVEKIT WEBRTC · DUPLEX', new THREE.Vector3(-12.5, CALLER.y + 1.0, 0), { height: 0.22, color: HEX.smoke })
    this.lLat = L('TURN 01 · 1.02 s', new THREE.Vector3(1.5, CALLER.y - 1.3, 0.4), { height: 0.24, color: HEX.chrome })
    this.lLatK = L('LATENCY', new THREE.Vector3(1.5, CALLER.y - 0.85, 0.4), { height: 0.18, color: HEX.cyan })
    // interruption
    this.lTTS = L('AGENT · TTS', new THREE.Vector3(WAVE.x - WAVE_W / 2, WAVE.y + WAVE_H / 2 + 0.25, 0), { height: 0.22, color: HEX.cyan, face: false })
    this.lHeard = L('HEARD', new THREE.Vector3(0, WAVE.y + WAVE_H / 2 + 0.25, 0), { height: 0.22, color: HEX.white, face: false, align: 'right' })
    this.lUnheard = L('NOT HEARD · DISCARDED', new THREE.Vector3(0, WAVE.y + WAVE_H / 2 + 0.25, 0), { height: 0.22, color: HEX.smoke, face: false })
    this.lRecon = L('STATE RECONCILED AGAINST WHAT THE CALLER ACTUALLY HEARD', new THREE.Vector3(WAVE.x - WAVE_W / 2, WAVE.y - WAVE_H / 2 - 0.45, 0), { height: 0.24, color: HEX.ice, face: false })
    this.lBarge = L('“Wait, make it two.”', new THREE.Vector3(CALLER.x + 0.5, CALLER.y + 3.1, 0), { height: 0.5, font: 'sans', weight: 300, tracking: 0, color: HEX.white, align: 'center' })
    // drop + memory
    this.lDrop = L('CALL DROPPED', new THREE.Vector3(1.1, CALLER.y + 4.6, 0), { height: 0.62, color: HEX.red, align: 'center', tracking: 0.22 })
    this.lDropSub = L('LIVEKIT · PARTICIPANT DISCONNECTED', new THREE.Vector3(1.1, CALLER.y + 3.85, 0), { height: 0.2, color: HEX.smoke, align: 'center' })
    this.lSum = L('TASK SUMMARY · EN\nunfinished checkout · atta ×2 · coupon not offered', new THREE.Vector3(), { height: 0.2, color: HEX.ice })
    this.lQdrant = L('QDRANT · SEMANTIC ROUTING', new THREE.Vector3(LAT.x - (NX - 1) / 2 * SP, LAT.y + (NY - 1) / 2 * SP + 1.4, LAT.z + 5), { height: 0.32, color: HEX.chrome })
    this.lIso = L('4 ISOLATION LAYERS · ' + M['CROSS-USER LEAKS'].value + ' CROSS-USER LEAKS', new THREE.Vector3(this.slotW.x, this.slotW.y - 2.7, this.slotW.z), { height: 0.22, color: HEX.cyan, align: 'center' })
    const vl = new THREE.Vector3(0, this.vault.H / 2 + 1.25, 0)
    this.lVault = L('MONGODB · AUTHORITATIVE STATE', vl, { height: 0.3, color: HEX.chrome, align: 'center', parent: this.vault.group })
    this.lRecord = L('cart · rev 4 · 3 items · lang hi', new THREE.Vector3(0, this.vault.H / 2 + 0.75, 0), { height: 0.22, color: HEX.smoke, align: 'center', parent: this.vault.group })
    // callback
    this.lHindi = L('मेरा अधूरा ऑर्डर पूरा करो।', new THREE.Vector3(CALLER.x + 1.5, CALLER.y + 3.2, 0), { height: 0.75, font: 'sans', weight: 400, tracking: 0, color: HEX.white, align: 'center' })
    this.lHindiSub = L('CALLER · SESSION B · HI', new THREE.Vector3(CALLER.x + 1.5, CALLER.y + 2.2, 0), { height: 0.2, color: HEX.smoke, align: 'center' })
    this.lXling = L('HI → EN · MULTILINGUAL EMBEDDING', new THREE.Vector3(), { height: 0.2, color: HEX.cyan })
    this.lRet = L('HYBRID · DENSE + KEYWORD · RRF\n' + M.RETRIEVAL.value + '  ·  ' + M.RETRIEVAL.note.split('·')[1].trim(), new THREE.Vector3(this.slotW.x + 2.6, this.slotW.y + 1.9, this.slotW.z), { height: 0.26, color: HEX.white })
    // resumed
    this.lResumed = L('RESUMED MID-TASK · SAME CART · SAME LANGUAGE', new THREE.Vector3(0, CALLER.y + 1.6, 0), { height: 0.26, color: HEX.ice, align: 'center' })
    this.lReply = L('जी, आपका कार्ट वैसा ही है।', new THREE.Vector3(12, CALLER.y + 3.3, 0), { height: 0.7, font: 'sans', weight: 400, tracking: 0, color: HEX.white, align: 'center' })
    this.lReplySub = L('AGENT · HI', new THREE.Vector3(12, CALLER.y + 2.35, 0), { height: 0.2, color: HEX.smoke, align: 'center' })
    for (const l of [this.lTTS, this.lHeard, this.lUnheard, this.lRecon, this.lBarge, this.lDrop, this.lDropSub, this.lSum, this.lIso, this.lVault, this.lRecord,
      this.lHindi, this.lHindiSub, this.lXling, this.lRet, this.lResumed, this.lReply, this.lReplySub]) l.opacity = 0
  }

  // ------------------------------------------------------------------ overlay
  mount(el) {
    this.el = el
    const contrib = (c, i) => `<div class="cn-c fx" data-c="${i}"><span class="cn-ck"><b></b>${c.label}</span><p>${c.text}</p></div>`
    el.innerHTML = `
      <div class="w-head cn-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">${P.name}</h2>
        <p class="w-lede">${P.tagline}</p>
        <p class="cn-ctx"><i></i>Built for ${P.context}</p>
      </div>
      <ol class="cn-beats fx">${BEATS.map((b, i) => `<li><span class="cn-bn">0${i + 1}</span><span class="cn-bt">${b}</span></li>`).join('')}</ol>
      ${[C['INTERRUPTION-AWARE STATE'], C['DUAL-STORE ISOLATION'], C['SEMANTIC TASK RESUMPTION']].map(contrib).join('')}
      <div class="cn-end fx">
        <div class="cn-ros">${P.metrics.map((m) => readout(m.label, m.value, m.note)).join('')}</div>
        <div class="cn-links">${linkChip('GitHub · hack_voice', P.github)}</div>
        <div class="cn-tags">${P.stack.map(tag).join('')}</div>
      </div>`
    this.dom = {
      head: this.$('.cn-head'), beats: this.$('.cn-beats'), beatLis: this.$$('.cn-beats li'),
      c: this.$$('.cn-c'), end: this.$('.cn-end'),
    }
  }

  // ------------------------------------------------------------------ camera
  cameraAt(p, out) {
    p = clamp(p)
    const K = this.keyP
    let i = 0
    while (i < K.length - 2 && p > K[i + 1]) i++
    const t0 = range(p, K[i], K[i + 1])
    const t = lerp(t0, smoother(t0), 0.55)
    const u = (i + t) / (K.length - 1)
    this.posCurve.getPoint(u, out.pos)
    this.tgtCurve.getPoint(u, out.target)
    let fov = lerp(this.keyFov[i], this.keyFov[i + 1], t)
    const asp = this.ctx.camera.aspect
    if (asp < 1) fov = Math.min(78, fov * (1 + (1 - asp) * 0.9))
    out.fov = fov
  }

  // ------------------------------------------------------------------ choreography
  update(p, dt, t, k = 0) {
    const S = this.S
    S.uTime.value = t

    // ---- beat 1 · live call
    const dead = range(p, 0.372, 0.39)
    const back = range(p, 0.53, 0.56)
    const rejoin = range(p, 0.76, 0.79)
    S.uLinkL.value = 1 - 0.72 * dead + 0.72 * back
    S.uLinkR.value = 1 - 0.72 * dead + 0.72 * rejoin
    S.uVoice.value = Math.max(band(p, -1, 0, 0.34, 0.372), band(p, 0.535, 0.55, 0.6, 0.63), band(p, 0.8, 0.83, 1.2, 1.3))

    // ---- beat 2 · interruption
    const waveOp = band(p, 0.165, 0.195, 0.335, 0.37)
    const play = Math.min(range(p, 0.185, 0.29), this.cutU)
    const diss = range(p, 0.24, 0.31)
    const wu = this.wave.material.uniforms
    wu.uOp.value = waveOp
    wu.uPlay.value = play
    wu.uDiss.value = diss
    this.wave.visible = waveOp > 0.001
    this.ghost.material.uniforms.uDiss.value = diss
    this.ghost.visible = diss > 0 && diss < 1 && waveOp > 0.001
    this.waveRule.material.opacity = waveOp * 0.8
    const bp = range(p, 0.212, 0.234)
    S.uBarge.value = bp > 0 && bp < 1 ? bp : 0
    this.lTTS.opacity = waveOp * 0.9
    const tagOp = band(p, 0.24, 0.26, 0.335, 0.365)
    this.lHeard.position.x = this.cutX - 0.25
    this.lUnheard.position.x = this.cutX + 0.25
    this.lHeard.opacity = tagOp
    this.lUnheard.opacity = tagOp * 0.85
    this.lRecon.opacity = band(p, 0.255, 0.28, 0.335, 0.365)
    this.lBarge.opacity = band(p, 0.205, 0.215, 0.3, 0.33)
    this.lBarge.position.set(lerp(X0 + 4, this.cutX - 3.5, easeOut(range(p, 0.205, 0.238))), CALLER.y + 1.5, 0.3)
    this.items[0].label.setText(p > 0.252 ? ITEMS[0].after : ITEMS[0].name)

    // ---- beat 3 · call drop
    const gapOpen = easeOut(range(p, 0.372, 0.4)) * (1 - smoother(range(p, 0.755, 0.79)))
    S.uGap.value = gapOpen * 0.075
    const relax = 1 - smoother(range(p, 0.53, 0.58))
    S.uRecoil.value = easeOut(range(p, 0.372, 0.41)) * relax
    S.uDroop.value = smoother(range(p, 0.376, 0.43)) * relax
    S.uWhip.value = Math.max(0, (p - 0.372) * 90)
    S.uFlash.value = band(p, 0.372, 0.374, 0.39, 0.41)
    S.uJoin.value = range(p, 0.785, 0.84)
    const dimB = band(p, 0.376, 0.405, 0.53, 0.585)
    S.uDim.value = 1 - dimB
    this.exposure = 1 - 0.2 * dimB
    for (let i = 0; i < 3; i++) {
      const sp = range(p, 0.372 + i * 0.003, 0.4 + i * 0.004)
      const m = this.shock[i]
      m.visible = sp > 0 && sp < 1
      m.scale.setScalar(0.3 + easeOut(sp) * (9 + i * 4))
      m.material.opacity = Math.pow(1 - sp, 3) * (i === 1 ? 0.45 : 0.7)
    }
    this.lDrop.opacity = band(p, 0.375, 0.38, 0.46, 0.49)
    this.lDropSub.opacity = this.lDrop.opacity * 0.9
    this.slitMat.color.copy(COLOR.cyan).multiplyScalar(0.4 + 1.8 * (1 - 0.8 * dead + 0.8 * rejoin))
    this.agentPip.material.color.copy(p > 0.372 && p < 0.785 ? COLOR.amber : COLOR.green).multiplyScalar(1.6)
    this.callerTip.material.color.copy(COLOR.ice).multiplyScalar(0.6 + 2.4 * S.uLinkL.value)

    // vault drawer + lock
    const v = this.vault
    const open = clamp(Math.max(range(p, 0.405, 0.425) - range(p, 0.47, 0.49), range(p, 0.672, 0.69) - range(p, 0.755, 0.772)))
    v.drawer.position.z = v.drawer.userData.closedZ + smoother(open) * 3.1
    const locked = range(p, 0.475, 0.5) - range(p, 0.66, 0.674)
    v.lock.rotation.z = -locked * Math.PI / 2
    const lockFlash = band(p, 0.49, 0.5, 0.52, 0.56)
    this.vaultStatus.color.copy(locked > 0.5 ? COLOR.green : COLOR.smoke).multiplyScalar(locked > 0.5 ? 0.9 + lockFlash * 2.5 : 0.5)
    S.uVault.value = locked * (0.5 + lockFlash)
    this.lVault.opacity = Math.max(band(p, 0.42, 0.45, 0.55, 0.58), band(p, 0.665, 0.685, 0.76, 0.78))
    this.lRecord.opacity = Math.max(band(p, 0.485, 0.5, 0.55, 0.58), band(p, 0.668, 0.685, 0.76, 0.78))

    // cart items: dock (live) → vault (drop) → back to the tray (callback)
    v.group.updateMatrixWorld()
    let count = 0
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      const a = easeOut(range(p, 0.03 + i * 0.045, 0.075 + i * 0.045))
      const bIn = smoother(range(p, 0.415 + i * 0.012, 0.455 + i * 0.012))
      const bOut = smoother(range(p, 0.686 + i * 0.012, 0.73 + i * 0.012))
      // spot inside the drawer (drawer-local → world-local)
      _c.set(it.dx * 1.05 + v.drawer.position.x, v.drawer.position.y - 0.3, v.drawer.position.z)
      v.group.localToWorld(_c)
      this.group.worldToLocal(_c)
      const gpos = it.g.position
      if (bOut > 0) {
        _b.copy(_c).lerp(it.home, 0.5).y += 4.5
        bez(gpos, _c, _b, it.home, bOut)
      } else if (bIn > 0) {
        _b.copy(it.home).lerp(_c, 0.5).y += 4.5
        bez(gpos, it.home, _b, _c, bIn)
      } else {
        gpos.copy(it.home).y += (1 - a) * 5
      }
      const inV = bIn * (1 - bOut)
      it.g.scale.setScalar(lerp(1, 0.52, inV))
      const op = a
      it.mat.opacity = 0.6 * op
      it.lm.opacity = 0.7 * op
      it.g.visible = op > 0.01
      it.label.opacity = op * (1 - band(p, 0.415 + i * 0.012, 0.43, 0.71, 0.745 + i * 0.012))
      it.g.rotation.y = Math.sin(t * 0.6 + i) * 0.05 * (1 - inV) + inV * -0.32
      if (a > 0.9 && (bIn < 0.5 || bOut > 0.5)) count++
    }
    this.cartLabel.setText(`CART · ${count} ITEM${count === 1 ? '' : 'S'}${p > 0.252 && count ? ' · REV 4' : ''}`)

    // hero shard: forms above the break, flies into its lattice cell
    const form = easeOut(range(p, 0.405, 0.425))
    this.cryst.material.uniforms.uForm.value = range(p, 0.378, 0.42)
    this.cryst.visible = p > 0.378 && p < 0.425
    const fly = smoother(range(p, 0.43, 0.485))
    _b.set(3, 17, -6)
    bez(this.hero.position, FORM, _b, this.slotW, fly)
    this.hero.scale.set(0.55 * form, 1.05 * form, 0.55 * form).multiplyScalar(lerp(1.35, 1, fly))
    this.hero.visible = form > 0.001
    this.hero.rotation.y = t * 0.5
    const fuse = range(p, 0.645, 0.665)
    const fusePulse = band(p, 0.645, 0.66, 0.72, 0.76)
    const hu = this.hero.material.uniforms
    hu.uGlow.value = 0.35 + 1.4 * band(p, 0.4, 0.41, 0.425, 0.46) + 0.9 * band(p, 0.478, 0.49, 0.5, 0.54) + 1.4 * fusePulse
    S.uSlotGlow.value = fly * (0.25 + fusePulse)
    this.lSum.position.copy(this.hero.position).add(_a.set(0.9, 0.4, 0))
    this.lSum.opacity = Math.max(band(p, 0.41, 0.425, 0.49, 0.515), band(p, 0.662, 0.68, 0.735, 0.76))
    // isolation rings
    for (let i = 0; i < 4; i++) {
      const r = this.rings[i]
      const s = easeOut(range(p, 0.47 + i * 0.008, 0.495 + i * 0.008))
      r.scale.setScalar(lerp(2.2, 1, s))
      r.material.opacity = s * (0.55 + 0.8 * fusePulse) * lerp(0.7, 1, 1 - dimB * 0.3)
      r.visible = s > 0.001
      r.rotateOnAxis(r.userData.axis, dt * (0.25 + i * 0.08) * (i % 2 ? -1 : 1))
    }
    this.lIso.opacity = band(p, 0.49, 0.505, 0.56, 0.58)
    const awake = range(p, 0.36, 0.42)
    S.uLatOp.value = awake
    this.lQdrant.opacity = 0.3 + 0.7 * band(p, 0.43, 0.46, 0.76, 0.8)

    // ---- beat 4 · callback
    const ring = band(p, 0.508, 0.518, 0.555, 0.575)
    for (let i = 0; i < 2; i++) {
      const r = this.ripples[i]
      const ph = (t * 0.9 + i * 0.5) % 1
      r.scale.setScalar(1 + ph * 1.6)
      r.material.opacity = ring * (1 - ph) * 0.8
      r.visible = ring > 0.001
    }
    this.lHindi.opacity = band(p, 0.53, 0.545, 0.562, 0.574)
    this.lHindiSub.opacity = this.lHindi.opacity * 0.9
    const q = smoother(range(p, 0.56, 0.605))
    const qStart = _a.set(X0 + (X1 - X0) * 0.42, CALLER.y, 0)
    const qEnd = _c.copy(this.slotW).add(_b.set(-2.8, -1.1, 3.2))
    const qCtrl = _b.set(-6, 13, -6)
    bez(this.query.position, qStart, qCtrl, qEnd, q)
    const qVis = q * (1 - range(p, 0.715, 0.745))
    this.query.scale.set(0.3, 0.6, 0.3).multiplyScalar(easeOut(clamp(q * 4)) * (1 - range(p, 0.715, 0.745)))
    this.query.visible = qVis > 0.001
    this.query.rotation.y = -t * 0.8
    this.lXling.position.copy(this.query.position).add(_b.set(-0.2, -0.9, 0))
    this.lXling.opacity = band(p, 0.565, 0.58, 0.68, 0.71)
    // hybrid retrieval: dense beams + keyword sweep → RRF fusion
    const bu = this.beams.material.uniforms
    bu.uGrow.value = range(p, 0.6, 0.625)
    bu.uOp.value = band(p, 0.598, 0.61, 0.69, 0.72)
    this.beams.visible = bu.uOp.value > 0.001
    if (this.beams.visible) {
      const arr = this.beams.geometry.attributes.position.array
      const put = (i, tgt) => { const o = i * 6; arr[o] = this.query.position.x; arr[o + 1] = this.query.position.y; arr[o + 2] = this.query.position.z; arr[o + 3] = tgt.x; arr[o + 4] = tgt.y; arr[o + 5] = tgt.z }
      put(0, this.slotW)
      this.densePos.forEach((d, i) => put(i + 1, _a.copy(d).add(LAT)))
      this.beams.geometry.attributes.position.needsUpdate = true
    }
    S.uDense.value = band(p, 0.6, 0.625, 0.69, 0.72)
    S.uFuse.value = fuse
    S.uKwX.value = lerp(-(NX - 1) / 2 * SP - 2, (NX - 1) / 2 * SP + 2, range(p, 0.605, 0.655))
    S.uKw.value = band(p, 0.605, 0.615, 0.69, 0.72)
    this.sweep.position.x = S.uKwX.value
    this.sweep.material.uniforms.uOp.value = band(p, 0.605, 0.615, 0.65, 0.665)
    this.sweep.visible = this.sweep.material.uniforms.uOp.value > 0.001
    this.lRet.opacity = band(p, 0.648, 0.665, 0.735, 0.76)

    // ---- beat 5 · resumed
    this.lResumed.opacity = band(p, 0.79, 0.81, 0.9, 0.935)
    this.lReply.opacity = band(p, 0.8, 0.82, 0.91, 0.945)
    this.lReplySub.opacity = this.lReply.opacity * 0.9
    const chainP = range(p, 0.83, 0.95) * 8.4 - 0.7
    this.capMat.uniforms.uP.value = chainP
    this.capMat.uniforms.uBase.value = 0.25 + 0.2 * range(p, 0.8, 0.85)
    this.railMat.uniforms.uP.value = chainP
    const chainOp = band(p, 0.81, 0.85, 1.2, 1.3)
    this.chainLabels.forEach((l, i) => { l.opacity = chainOp * (0.45 + 0.55 * clamp(chainP - i + 0.8)) })

    // live labels
    const liveA = Math.max(band(p, 0.02, 0.05, 0.33, 0.37), band(p, 0.8, 0.83, 0.93, 0.97))
    this.lLat.opacity = liveA
    this.lLatK.opacity = liveA
    this.lLink.opacity = 0.9 * Math.max(band(p, -1, 0, 0.33, 0.372), band(p, 0.78, 0.81, 1.2, 1.3))
    this.lCaller.opacity = 0.9 * (1 - band(p, 0.562, 0.574, 0.68, 0.72))
    this.lCaller.setText(p < 0.5 ? 'CALLER · SESSION A' : 'CALLER · SESSION B')
    const tick = Math.floor(t * 3)
    if (tick !== this._lastTick && liveA > 0.01) {
      this._lastTick = tick
      const h = Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 1
      const turn = p < 0.5 ? 1 + Math.floor(range(p, 0.0, 0.34) * 4) : 6 + Math.floor(range(p, 0.8, 1) * 2)
      this.lLat.setText(`TURN ${String(turn).padStart(2, '0')} · ${(0.9 + h * 0.4).toFixed(2)} s`)
    }

    // ---- pointer: the lattice answers the cursor
    let hov = false
    if (k === 0 && S.uLatOp.value > 0.5 && p < 0.97 && !this.ctx.isMobile) {
      const hit = this.pointerOnPlane(this._plane, this._hit)
      if (hit && Math.abs(hit.x - LAT.x) < (NX - 1) / 2 * SP + 2 && Math.abs(hit.y - LAT.y) < (NY - 1) / 2 * SP + 2) {
        hov = true
        this._mouseT.copy(hit).sub(LAT)
        this._mouseT.z = 3
      }
    }
    this.hoverAmt = damp(this.hoverAmt, hov ? 1 : 0, 6, dt)
    S.uHover.value = this.hoverAmt
    S.uMouse.value.x = damp(S.uMouse.value.x, this._mouseT.x, 8, dt)
    S.uMouse.value.y = damp(S.uMouse.value.y, this._mouseT.y, 8, dt)
    S.uMouse.value.z = this._mouseT.z
    if (hov !== this._hov) {
      this._hov = hov
      this.ctx.cursor?.hover(hov ? 'QDRANT' : null, hov ? 'hybrid · RRF' : null, this)
    }

    // labels face the camera
    const cam = this.ctx.camera
    for (const l of this.labels) if (l.visible) faceCamera(l, cam)

    // ---- overlay
    if (this.dom) {
      const d = this.dom
      reveal(d.head, band(p, -1, 0, 0.1, 0.14))
      reveal(d.beats, band(p, 0.02, 0.05, 0.95, 0.99))
      reveal(d.c[0], band(p, 0.2, 0.23, 0.33, 0.36))
      reveal(d.c[1], band(p, 0.41, 0.44, 0.53, 0.56))
      reveal(d.c[2], band(p, 0.582, 0.605, 0.73, 0.76))
      reveal(d.end, band(p, 0.855, 0.89, 0.945, 0.97))
      let beat = 0
      for (let i = 0; i < BEAT_AT.length; i++) if (p >= BEAT_AT[i]) beat = i
      if (beat !== this._beat) {
        this._beat = beat
        d.beatLis.forEach((li, i) => { li.classList.toggle('is-on', i === beat); li.classList.toggle('is-done', i < beat) })
      }
    }
  }

  onLeave() {
    if (this._hov) { this._hov = false; this.ctx.cursor?.hover(null, null, this) }
  }
}
