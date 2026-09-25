import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { chrome, graphite, smokedGlass, glow } from '../../lib/materials.js'
import { range, band, smoother, lerp, damp, clamp } from '../../lib/math.js'
import { reveal, readout } from '../../lib/dom.js'
import { experience, education } from '../../content.js'
import { spineMaterial, laneMaterial, pipeMaterial, ringMaterial, prosodyMaterial, discMaterial } from './shaders.js'
import './style.css'

// WORLD · PRODUCTION
// A tall precision tower: the Founding AI Engineer role as a machine. Five stacked modules, bottom to top,
// BUILD → OPTIMIZE → SCALE → DEPLOY → MONITOR. The camera rises up the tower; each stage powers on its module
// and energy climbs the spine to it.

const STAGES = experience.stages
const GAP = 30
const Y0 = -52
const stageY = (i) => Y0 + i * GAP
const R = 11.5 // frame radius
// scroll windows: stage i holds over [W0 + i*WS, W0 + (i+1)*WS]
const W0 = 0.12, WS = 0.15
const FINAL = W0 + WS * 5 // 0.87

const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()

export default class ExperienceWorld extends World {
  static height = 480

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0036
    this.bloom = 0.8
    this.exposure = 1.05
    this.parallax = 0.8
  }

  async init() {
    const g = this.group
    this.act = [0, 0, 0, 0, 0]
    this.labels = []
    // tamer env response: machined metal instead of blown chrome highlights and grey, plasticky plates
    const mChrome = chrome({ roughness: 0.2, envMapIntensity: 0.75 })
    const mGraph = graphite({ color: new THREE.Color('#1c222a'), envMapIntensity: 0.45 })
    const mGraphD = graphite({ color: new THREE.Color('#0b0e12'), metalness: 0.45, roughness: 0.44, envMapIntensity: 0.28 })
    this.mat = { mChrome, mGraph, mGraphD }

    this.buildFrame(g)
    this.buildBuild(g, stageY(0))
    this.buildOptimize(g, stageY(1))
    this.buildScale(g, stageY(2))
    this.buildDeploy(g, stageY(3))
    this.buildMonitor(g, stageY(4))
  }

  label(text, pos, o = {}) {
    const l = new Label(text, { height: 0.5, color: HEX.chrome, tracking: 0.22, ...o })
    l.position.copy(pos)
    l.userData.base = o.base ?? 0.8
    l.userData.stage = o.stage ?? -1
    this.group.add(l)
    this.labels.push(l)
    return l
  }

  // ------------------------------------------------------------------ structure
  buildFrame(g) {
    const { mChrome, mGraph, mGraphD } = this.mat
    const top = stageY(4) + 22, bot = stageY(0) - 20
    // rails
    const rails = []
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2
      const c = new THREE.CylinderGeometry(0.15, 0.15, top - bot, 10)
      c.translate(Math.sin(a) * R, (top + bot) / 2, Math.cos(a) * R)
      rails.push(c)
      // fine secondary rail
      const c2 = new THREE.CylinderGeometry(0.07, 0.07, top - bot, 6)
      c2.translate(Math.sin(a + 0.09) * (R - 0.4), (top + bot) / 2, Math.cos(a + 0.09) * (R - 0.4))
      rails.push(c2)
    }
    g.add(new THREE.Mesh(mergeGeometries(rails), chrome({ color: new THREE.Color('#7f8892'), roughness: 0.3 })))

    // collars between modules: graphite plate + chrome lip; each carries a status strip
    const plates = [], lips = []
    this.strips = []
    for (let i = 0; i <= 5; i++) {
      const y = stageY(i) - GAP / 2
      const p = new THREE.CylinderGeometry(R + 1.2, R + 1.2, 1.1, 64); p.translate(0, y, 0); plates.push(p)
      const t = new THREE.TorusGeometry(R + 1.2, 0.14, 8, 96); t.rotateX(Math.PI / 2); t.translate(0, y + 0.55, 0); lips.push(t)
      const t2 = t.clone(); t2.translate(0, -1.1, 0); lips.push(t2)
      const strip = new THREE.Mesh(new THREE.TorusGeometry(R + 1.28, 0.05, 6, 128), glow(COLOR.cyan, 0.2))
      strip.rotation.x = Math.PI / 2
      strip.position.y = y
      g.add(strip)
      this.strips.push(strip)
    }
    g.add(new THREE.Mesh(mergeGeometries(plates), mGraphD))
    g.add(new THREE.Mesh(mergeGeometries(lips), mChrome))

    // plinth and crown
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(17, 19, 5, 64), mGraphD)
    pl.position.y = bot - 2.5
    g.add(pl)
    const pl2 = new THREE.Mesh(new THREE.CylinderGeometry(14, 14.4, 1.2, 64), mGraph)
    pl2.position.y = bot + 0.6
    g.add(pl2)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), discMaterial(new THREE.Color(0, 0, 0), 0.9))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = bot - 5.05
    g.add(shadow)
    this.bot = bot; this.top = top

    // spine: glass sleeve + energy conduit through the full height
    const h = top - bot
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h, 32, 1, true), smokedGlass({ opacity: 0.25 }))
    sleeve.position.y = (top + bot) / 2
    g.add(sleeve)
    this.spine = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, h, 16, 1, true), spineMaterial())
    this.spine.position.y = (top + bot) / 2
    this.spine.frustumCulled = false
    g.add(this.spine)
    this.spineOff = (top + bot) / 2

  }

  // ------------------------------------------------------------------ BUILD: voice agent core assembly
  buildBuild(g, y) {
    const { mChrome, mGraph } = this.mat
    const N = 26
    const disc = new THREE.CylinderGeometry(1, 1, 0.26, 48)
    const im = new THREE.InstancedMesh(disc, mChrome, N)
    this.core = { im, N, y, radii: [] }
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      // a voice envelope turned into a lathe: the core's silhouette is a waveform
      const r = 2.3 + 2.6 * Math.abs(Math.sin(t * Math.PI * 3.2 + 0.4)) * Math.sin(t * Math.PI) + 0.4
      this.core.radii.push(r)
    }
    g.add(im)
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 17, 32), glow(COLOR.blue, 0.4))
    inner.position.y = y
    g.add(inner)
    this.coreInner = inner

    // housing panels around the back 250°: slide in radially during assembly
    this.panels = []
    const n = 5, span = 4.3, start = 1.0
    for (let i = 0; i < n; i++) {
      const th = start + (i / n) * span
      const geo = new THREE.CylinderGeometry(8.2, 8.2, 19, 16, 1, true, th, span / n - 0.05)
      const m = new THREE.Mesh(geo, graphite({ side: THREE.DoubleSide, color: new THREE.Color('#1a1f26') }))
      m.position.y = y
      m.userData.dir = new THREE.Vector3(Math.sin(th + span / n / 2), 0, Math.cos(th + span / n / 2))
      m.userData.delay = i * 0.08
      g.add(m)
      this.panels.push(m)
    }
    // two front ribs (chrome) framing the open face, plus a seam of light at top and bottom
    const ribs = []
    for (const a of [-0.75, 0.95]) {
      const c = new THREE.BoxGeometry(0.5, 20, 0.9)
      c.rotateY(a)
      c.translate(Math.sin(a) * 8.3, y, Math.cos(a) * 8.3)
      ribs.push(c)
    }
    const rc = new THREE.TorusGeometry(8.4, 0.22, 8, 96); rc.rotateX(Math.PI / 2)
    const r1 = rc.clone(); r1.translate(0, y + 9.6, 0)
    const r2 = rc.clone(); r2.translate(0, y - 9.6, 0)
    ribs.push(r1, r2)
    g.add(new THREE.Mesh(mergeGeometries(ribs), mChrome))
    const seam = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.06, 6, 128), glow(COLOR.cyan, 0.2))
    seam.rotation.x = Math.PI / 2
    seam.position.y = y - 8.9
    g.add(seam)
    this.buildSeam = seam
    void mGraph

    this.buildStatus = this.label('ASSEMBLY 00%', _v.set(-13, y - 7, 3), { stage: 0, color: HEX.cyan, height: 0.45, align: 'right' })
  }

  // ------------------------------------------------------------------ OPTIMIZE: tuning mechanism
  buildOptimize(g, y) {
    const { mChrome, mGraphD } = this.mat
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 18, 64), mGraphD)
    drum.position.y = y
    g.add(drum)
    const bands = []
    for (const dy of [-8.2, -2.8, 8.2]) {
      const t = new THREE.TorusGeometry(6.5, 0.12, 8, 96); t.rotateX(Math.PI / 2); t.translate(0, y + dy, 0); bands.push(t)
    }
    g.add(new THREE.Mesh(mergeGeometries(bands), mChrome))

    // three prosody dials on the front face
    this.dials = []
    const names = ['PITCH', 'ENERGY', 'RATE']
    const knobG = new THREE.CylinderGeometry(1.35, 1.5, 1.2, 48)
    knobG.rotateX(Math.PI / 2)
    const tickPts = []
    for (let i = 0; i <= 24; i++) {
      const a = -2.4 + (i / 24) * 4.8
      const r0 = i % 6 === 0 ? 1.8 : 1.9
      tickPts.push(Math.sin(a) * r0, Math.cos(a) * r0, 0, Math.sin(a) * 2.15, Math.cos(a) * 2.15, 0)
    }
    const tickG = new THREE.BufferGeometry(); tickG.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3))
    const notchG = new THREE.BoxGeometry(0.16, 0.7, 0.1); notchG.translate(0, 0.85, 0.66)
    const set = [0.9, -0.6, 0.35]
    ;[-0.62, 0.12, 0.86].forEach((a, i) => {
      const grp = new THREE.Group()
      grp.position.set(Math.sin(a) * 6.45, y - 5.4, Math.cos(a) * 6.45)
      grp.rotation.y = a
      g.add(grp)
      const knob = new THREE.Group()
      knob.add(new THREE.Mesh(knobG, mChrome))
      const notch = new THREE.Mesh(notchG, glow(COLOR.cyan, 1.0))
      knob.add(notch)
      knob.position.z = 0.6
      grp.add(knob)
      const ticks = new THREE.LineSegments(tickG, new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.chrome), transparent: true, opacity: 0.35 }))
      ticks.position.z = 0.15
      grp.add(ticks)
      this.dials.push({ knob, notch, set: set[i], from: -2.2 + i * 0.4 })
      const lp = new THREE.Vector3(0, -2.8, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(grp.position)
      this.label(names[i], lp, { stage: 1, height: 0.42, color: HEX.smoke, align: 'center', face: true })
    })

    // prosody contour wrapped around the upper front
    const band = new THREE.Mesh(new THREE.CylinderGeometry(6.9, 6.9, 5.4, 96, 1, true, -1.25, 2.5), prosodyMaterial())
    band.position.y = y + 2.6
    band.frustumCulled = false
    g.add(band)
    this.prosody = band

  }

  // ------------------------------------------------------------------ SCALE: 30 parallel lanes
  buildScale(g, y) {
    const { mChrome, mGraphD } = this.mat
    const N = 30, H = 21, r = 7.4
    const tubes = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.05
      const c = new THREE.CylinderGeometry(0.17, 0.17, H, 8, 1, true)
      c.translate(Math.sin(a) * r, y, Math.cos(a) * r)
      const lane = new Float32Array(c.attributes.position.count).fill(i)
      c.setAttribute('lane', new THREE.BufferAttribute(lane, 1))
      tubes.push(c)
    }
    // lanes spin up in an order that sweeps around the front first
    const lanes = new THREE.Mesh(mergeGeometries(tubes), laneMaterial())
    lanes.material.uniforms.uH.value = H
    lanes.frustumCulled = false
    g.add(lanes)
    this.lanes = lanes

    const man = []
    for (const dy of [-H / 2 - 0.4, H / 2 + 0.4]) {
      const t = new THREE.TorusGeometry(r, 0.55, 12, 96); t.rotateX(Math.PI / 2); t.translate(0, y + dy, 0); man.push(t)
    }
    g.add(new THREE.Mesh(mergeGeometries(man), mChrome))
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, H - 2, 48), mGraphD)
    hub.position.y = y
    g.add(hub)
    // turbine rotor: chrome blades around the hub that spin up with throughput
    const blades = []
    for (let i = 0; i < 10; i++) {
      const b = new THREE.BoxGeometry(0.14, H - 5, 2.1)
      b.translate(0, 0, 4.3)
      b.rotateY((i / 10) * Math.PI * 2)
      blades.push(b)
    }
    const rotor = new THREE.Mesh(mergeGeometries(blades), chrome({ color: new THREE.Color('#59616b'), roughness: 0.34 }))
    rotor.position.y = y
    g.add(rotor)
    this.rotor = rotor
    this.rotorSpeed = 0

    const m = experience.metrics
    this.label(`${m[0].value} ${m[0].label}`, _v.set(-13, y - 6.3, 3), { stage: 2, color: HEX.white, height: 0.45, align: 'right' })
    this.laneLabel = this.label('LANES 00/30', _v.set(-13, y - 7.3, 3), { stage: 2, color: HEX.cyan, height: 0.45, align: 'right' })
    this.ttfbLabel = this.label('TTFB --- ms', _v.set(-13, y - 8.2, 3), { stage: 2, color: HEX.smoke, height: 0.4, align: 'right' })
  }

  // ------------------------------------------------------------------ DEPLOY: pipelines into ports
  buildDeploy(g, y) {
    const { mChrome, mGraphD, mGraph } = this.mat
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 17, 48), mGraphD)
    hub.position.y = y
    g.add(hub)
    const rings = []
    for (const dy of [-7.6, -3, 3, 7.6]) {
      const t = new THREE.TorusGeometry(4.7, 0.14, 8, 72); t.rotateX(Math.PI / 2); t.translate(0, y + dy, 0); rings.push(t)
    }
    g.add(new THREE.Mesh(mergeGeometries(rings), mChrome))

    const ports = [
      { name: 'LLM', a: -0.95, dy: 3 },
      { name: 'STT', a: -0.25, dy: -3 },
      { name: 'TTS', a: 0.5, dy: 3 },
      { name: 'TOOL CALLING', a: 1.2, dy: -3 },
    ]
    const len = 10.2, r0 = 4.6
    const pipeG = new THREE.CylinderGeometry(0.42, 0.42, 1, 16, 1, true)
    pipeG.translate(0, 0.5, 0); pipeG.rotateX(Math.PI / 2) // along +z, uv.y 0 → 1 from hub outward
    const flangeG = new THREE.TorusGeometry(1.2, 0.28, 12, 40)
    const houseG = new THREE.CylinderGeometry(1.05, 1.05, 1.8, 32); houseG.rotateX(Math.PI / 2)
    const collarG = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 24); collarG.rotateX(Math.PI / 2)
    this.ports = ports.map((p, i) => {
      const grp = new THREE.Group()
      grp.position.set(0, y + p.dy, 0)
      grp.rotation.y = p.a
      g.add(grp)
      const pipe = new THREE.Mesh(pipeG, pipeMaterial())
      pipe.material.uniforms.uSeed.value = i * 0.27
      pipe.position.z = r0
      pipe.scale.set(1, 1, len)
      pipe.frustumCulled = false
      grp.add(pipe)
      const socket = new THREE.Group()
      socket.position.z = r0 + len + 0.9
      const house = new THREE.Mesh(houseG, mGraph); socket.add(house)
      const fl = new THREE.Mesh(flangeG, mChrome); fl.position.z = -0.9; socket.add(fl)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.05, 6, 48), glow(COLOR.cyan, 0.2)); ring.position.z = 0.92; socket.add(ring)
      grp.add(socket)
      const col = new THREE.Mesh(collarG, mChrome); col.position.z = r0 + 0.4; grp.add(col)
      const lp = new THREE.Vector3(0, 1.9, r0 + len + 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.a).add(grp.position)
      const l = this.label(p.name, lp, { stage: 3, color: HEX.white, height: 0.5, align: 'center', face: true })
      return { ...p, pipe, socket, ring, l, on: 0 }
    })

  }

  // ------------------------------------------------------------------ MONITOR: telemetry ring + crown
  buildMonitor(g, y) {
    const { mChrome, mGraphD } = this.mat
    const core = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 14, 48), mGraphD)
    core.position.y = y - 1
    g.add(core)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 5, 5, 48), mChrome)
    cap.position.y = y + 8.5
    g.add(cap)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 10, 12), mChrome)
    mast.position.y = y + 16
    g.add(mast)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), glow(COLOR.green, 0.5))
    beacon.position.y = y + 21.2
    g.add(beacon)
    this.beacon = beacon

    const r0 = 14, r1 = 19
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 256, 1), ringMaterial(r0, r1))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = y + 1
    ring.frustumCulled = false
    g.add(ring)
    this.ring = ring
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(r1 + 1.2, r1 + 1.35, 256, 1), ringMaterial(r1 + 1.2, r1 + 1.35))
    ring2.rotation.x = -Math.PI / 2 + 0.12
    ring2.rotation.y = 0.08
    ring2.position.y = y + 3.5
    ring2.frustumCulled = false
    g.add(ring2)
    this.ring2 = ring2

    const tags = ['PROMETHEUS', 'GRAFANA', 'AWS', 'GCP', 'DOCKER']
    tags.forEach((t, i) => {
      const a = 0.3 + (i - 2) * 0.42
      this.label(t, _v.set(Math.sin(a) * (r1 + 1.5), y + 2.4 + (i % 2) * 1.6, Math.cos(a) * (r1 + 1.5)), { stage: 4, color: HEX.ice, height: 0.48, align: 'center', face: true })
    })
    this.statusLabel = this.label('STATUS · HEALTHY', _v.set(0, y + 12.4, 5.6), { stage: 4, color: HEX.green, height: 0.42, align: 'center' })
    void mChrome
  }

  // ------------------------------------------------------------------ overlay
  mount(el) {
    const x = experience
    el.innerHTML = `
      <div class="w-head xp-head fx">
        <span class="w-code">WORLD ${this.meta.code} · EXPERIENCE</span>
        <h2 class="w-title">Production.</h2>
        <p class="w-lede">Model optimisation, infrastructure and deployment for real-time voice AI, running in production.</p>
      </div>
      <div class="xp-role fx">
        <div class="xp-now"><i></i>CURRENT ROLE</div>
        <div class="xp-title">${x.title}</div>
        <div class="xp-co">${x.company} <span>·</span> ${x.location}</div>
        <div class="xp-period">${x.period}</div>
      </div>
      <ol class="xp-index fx" aria-label="Stages">
        ${STAGES.map((s, i) => `<li data-i="${i}"><span class="xp-n">0${i + 1}</span><span class="xp-l">${s.label}</span></li>`).reverse().join('')}
        <span class="xp-track"><b></b></span>
      </ol>
      ${STAGES.map((s, i) => `
      <div class="xp-stage fx" data-i="${i}">
        <div class="xp-sc">STAGE 0${i + 1} / 05</div>
        <div class="xp-sl">${s.label}</div>
        <p class="xp-st">${s.text}</p>
        ${s.id === 'scale' ? `<div class="xp-ro">${x.metrics.map((m) => readout(m.label, m.value, m.note)).join('')}</div>` : ''}
      </div>`).join('')}
      <div class="xp-final fx">
        <div class="xp-fh"><span>${x.title.toUpperCase()}</span><span>${x.company.toUpperCase()} · ${x.period.toUpperCase()}</span></div>
        <ul>${x.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
        <div class="xp-edu"><span class="xp-ek">EDUCATION</span><span>B.Tech CSE · ${education.school} · expected ${education.expected} · CGPA ${education.cgpa}</span></div>
      </div>`
    this.dom = {
      head: this.$('.xp-head'), role: this.$('.xp-role'), index: this.$('.xp-index'),
      items: this.$$('.xp-index li'), track: this.$('.xp-track b'),
      stages: this.$$('.xp-stage'), final: this.$('.xp-final'),
    }
  }

  // ------------------------------------------------------------------ camera
  stageF(p) {
    let f = 0
    for (let i = 1; i < 5; i++) { const b = W0 + WS * i; f += smoother(range(p, b - 0.035, b + 0.035)) }
    return f
  }

  cameraAt(p, out) {
    const narrow = this.ctx.camera.aspect < 1
    const f = this.stageF(p)
    const seg = clamp(Math.round(f), 0, 4)
    const u = clamp((p - (W0 + WS * seg)) / WS)
    const y = Y0 + f * GAP + (u - 0.5) * 3
    const th = -0.42 + p * 0.95
    const rad = (narrow ? 96 : 72) - 5 * smoother(u)
    const off = narrow ? 0 : 12 // tower sits right of centre, text on the left
    const rx = Math.cos(th), rz = -Math.sin(th)
    const lift = 8 + 14 * smoother(range(f, 3.2, 4))
    out.pos.set(Math.sin(th) * rad - rx * off, y + lift, Math.cos(th) * rad - rz * off)
    out.target.set(-rx * off, y + 0.5, -rz * off)
    if (narrow) { out.target.y -= 6; out.pos.y -= 4 }
    out.fov = narrow ? 54 : 34

    // establishing: low and far, the whole tower looming, dormant
    const i0 = 1 - smoother(range(p, 0, W0))
    if (i0 > 0) {
      out.pos.lerp(_v.set(Math.sin(-0.5) * 96 - Math.cos(-0.5) * 22, -76, Math.cos(-0.5) * 96 + Math.sin(-0.5) * 22), i0)
      out.target.lerp(_v.set(-Math.cos(-0.5) * 22, 16, Math.sin(-0.5) * 22), i0)
      out.fov = lerp(out.fov, narrow ? 64 : 46, i0)
    }
    // final: pull back to see the whole tower powered, then rise away
    const e = smoother(range(p, FINAL - 0.01, 1))
    if (e > 0) {
      const a = 0.45
      const w = narrow ? 0 : 44
      const D = narrow ? 380 : 215
      out.pos.lerp(_v.set(Math.sin(a) * D - Math.cos(a) * w, (narrow ? 70 : 20) + e * 25, Math.cos(a) * D + Math.sin(a) * w), e)
      out.target.lerp(_v.set(-Math.cos(a) * w, (narrow ? 100 : 4) + e * 10, Math.sin(a) * w), e)
      out.fov = lerp(out.fov, narrow ? 60 : 40, e)
    }
  }

  // ------------------------------------------------------------------ animation
  update(p, dt, t, k) {
    if (!this.core) return
    const cam = this.ctx.camera
    const final = smoother(range(p, FINAL - 0.02, FINAL + 0.04))
    // stage activation: powers on as the camera arrives, stays on
    for (let i = 0; i < 5; i++) {
      const s = W0 + WS * i
      const target = smoother(range(p, s - 0.01, s + 0.08))
      this.act[i] = damp(this.act[i], target, 5, dt)
    }
    const A = this.act
    // energy fill climbs the spine to the highest active module
    let fillY = this.bot - 2
    for (let i = 0; i < 5; i++) if (A[i] > 0.001) fillY = lerp(i === 0 ? this.bot : stageY(i) - GAP / 2, stageY(i) + GAP / 2, A[i])
    if (A[4] > 0.99) fillY = this.top + 2
    const su = this.spine.material.uniforms
    su.uTime.value = t
    su.uFill.value = fillY - this.spineOff
    this.strips.forEach((s, i) => { const on = i === 0 ? A[0] : A[i - 1]; s.material.color.copy(COLOR.cyan).multiplyScalar(0.15 + on * 1.6) })

    // BUILD: discs grow in from the centre, panels slide home
    const a0 = A[0]
    for (let i = 0; i < this.core.N; i++) {
      const ti = clamp((a0 * 1.4 - (i / this.core.N) * 0.4))
      const r = this.core.radii[i] * smoother(ti)
      const yy = this.core.y - 8 + (i / (this.core.N - 1)) * 16 + (1 - smoother(ti)) * 3
      _s.set(Math.max(0.001, r), 1, Math.max(0.001, r))
      _m.compose(_v.set(0, yy, 0), _q.setFromEuler(_e.set(0, t * 0.2, 0)), _s)
      this.core.im.setMatrixAt(i, _m)
    }
    this.core.im.instanceMatrix.needsUpdate = true
    this.coreInner.material.color.copy(COLOR.blue).multiplyScalar(0.2 + a0 * 1.2 * (0.85 + 0.15 * Math.sin(t * 3)))
    this.panels.forEach((m) => {
      const s = smoother(clamp((a0 - m.userData.delay) * 1.6))
      m.position.x = m.userData.dir.x * (1 - s) * 7
      m.position.z = m.userData.dir.z * (1 - s) * 7
    })
    this.buildSeam.material.color.copy(COLOR.cyan).multiplyScalar(0.1 + a0 * 1.8)
    this.setLabel(this.buildStatus, a0 > 0.985 ? 'ASSEMBLY · ONLINE' : `ASSEMBLY ${String(Math.round(a0 * 100)).padStart(2, '0')}%`, t)

    // OPTIMIZE: dials turn to their setpoints, the prosody contour takes shape
    const a1 = A[1]
    this.dials.forEach((d, i) => {
      const s = smoother(clamp(a1 * 1.3 - i * 0.12))
      d.knob.rotation.z = lerp(d.from, d.set, s) + Math.sin(t * 0.7 + i) * 0.03 * s
      d.notch.material.color.copy(COLOR.cyan).multiplyScalar(0.3 + s * 1.8)
    })
    const pu = this.prosody.material.uniforms
    pu.uTime.value = t; pu.uTune.value = smoother(clamp(a1 * 1.2 - 0.1)); pu.uOn.value = 0.25 + a1 * 0.9

    // SCALE: lanes spin up one by one, rotor accelerates
    const a2 = A[2]
    const on = a2 * 30
    this.lanes.material.uniforms.uOn.value = on
    this.lanes.material.uniforms.uTime.value = t
    this.rotorSpeed = damp(this.rotorSpeed, 0.05 + a2 * 1.6, 2, dt)
    this.rotor.rotation.y += this.rotorSpeed * dt
    this.setLabel(this.laneLabel, `LANES ${String(Math.min(30, Math.floor(on + 0.02))).padStart(2, '0')}/30`, t)
    if (a2 > 0.5) this.setLabel(this.ttfbLabel, `TTFB ${Math.round(236 + 38 * (0.5 + 0.5 * Math.sin(t * 1.7) * Math.sin(t * 0.63)))} ms`, t, 3)

    // DEPLOY: pipes extend to each port in turn, then carry traffic
    const a3 = A[3]
    this.ports.forEach((pt, i) => {
      const s = clamp(a3 * 1.6 - i * 0.2)
      const pu3 = pt.pipe.material.uniforms
      pu3.uTime.value = t
      pu3.uGrow.value = smoother(s)
      pu3.uFlow.value = smoother(clamp((s - 0.85) * 6.7))
      pt.socket.position.z = 4.6 + 10.2 + 0.9 + (1 - smoother(clamp((s - 0.8) * 5))) * 1.6
      pt.ring.material.color.copy(COLOR.cyan).multiplyScalar(0.12 + pu3.uFlow.value * 2.2)
    })

    // MONITOR: telemetry ring draws on around the circumference, slowly rotates
    const a4 = A[4]
    const ru = this.ring.material.uniforms
    ru.uTime.value = t; ru.uOn.value = a4
    this.ring.rotation.z = t * 0.03
    const ru2 = this.ring2.material.uniforms
    ru2.uTime.value = t; ru2.uOn.value = a4 * 0.7
    this.beacon.material.color.copy(COLOR.green).multiplyScalar(0.3 + a4 * (1.4 + Math.sin(t * 2.4) * 0.8))

    // labels: each stage's labels brighten with its module
    for (const l of this.labels) {
      const st = l.userData.stage
      const a = st < 0 ? 1 : A[st]
      l.opacity = l.userData.base * (st < 0 ? 1 : (0.12 + 0.88 * a)) * (1 - final * 0.6)
      if (l.visible) faceCamera(l, cam)
    }

    // overlay
    const D = this.dom
    if (!D) return
    reveal(D.head, band(p, -1, 0, 0.06, 0.11) * (k > 0 ? smoother(range(k, 0.55, 1)) : 1))
    reveal(D.role, band(p, 0.08, 0.13, FINAL - 0.02, FINAL + 0.02))
    reveal(D.index, band(p, 0.1, 0.15, FINAL - 0.02, FINAL + 0.02))
    const f = this.stageF(p)
    const cur = clamp(Math.round(f), 0, 4)
    D.items.forEach((li) => {
      const i = +li.dataset.i
      const state = i === cur && p > W0 - 0.02 ? 'is-on' : A[i] > 0.5 ? 'is-done' : ''
      if (li._s !== state) { li._s = state; li.className = state }
    })
    const lv = clamp((A[0] + A[1] + A[2] + A[3] + A[4]) / 5).toFixed(3)
    if (D._lv !== lv) { D._lv = lv; D.track.style.transform = `scaleY(${lv})` }
    D.stages.forEach((el, i) => {
      const s = W0 + WS * i
      reveal(el, band(p, s + 0.005, s + 0.035, s + WS - 0.03, s + WS - 0.005))
    })
    reveal(D.final, band(p, FINAL + 0.01, FINAL + 0.05, 1.1, 1.2))
  }

  setLabel(l, text, t, hz = 8) {
    if (l.text === text) return
    if (t - (l._lt || 0) < 1 / hz) return
    l._lt = t
    l.setText(text)
  }
}
