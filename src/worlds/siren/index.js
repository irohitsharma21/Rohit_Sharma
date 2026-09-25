import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { projects } from '../../content.js'
import { range, band, clamp, lerp, damp, smoother } from '../../lib/math.js'
import { HEX } from '../../lib/palette.js'
import { faceCamera } from '../../lib/label.js'
import { reveal } from '../../lib/dom.js'
import { buildGround, buildStreaks, buildBuildings, buildLamps, buildInfra, buildSky, buildRain } from './city.js'
import { Traffic, Ambulance } from './traffic.js'
import { Signals, SignalLamps, buildSpectrogram, buildConduits, buildFrustum, label } from './perception.js'
import { overlayHTML, Boxes, STAGES } from './overlay.js'
import { MAST, MICS, CAMERA, CABINET, AMB_X } from './layout.js'
import './style.css'

const SIREN = projects.siren
const ROC = SIREN.metrics.find((m) => m.label === 'ROC-AUC')?.value || '0.986'
const PUB = SIREN.metrics.find((m) => m.label === 'PUBLISHED')?.value || 'ICACIS 2026'

// Story beats (scroll progress).
const T = { lock0: 0.25, lock1: 0.33, audio0: 0.44, audio1: 0.5, fan0: 0.52, fan1: 0.58, gV: 0.7, gA: 0.715, gD: 0.73, preempt: 0.75, map0: 0.86, map1: 0.97 }

// Camera keyframes: [p, position, target, fov]. Uniform Catmull-Rom through them.
const CAM = [
  [0.0, [-4, 34, -70], [3, 0, 34], 44],
  [0.2, [-5, 12.5, -34], [4, 2, 40], 40],
  [0.36, [2.6, 8.4, -5.5], [2.2, 1.6, 64], 36],
  [0.5, [-5, 14.5, -31], [12, 6, 4], 42],
  [0.62, [-4, 27, -35], [5, 0, 22], 42],
  [0.74, [0.2, 10.5, 58], [4.5, 4, -8], 40],
  [0.84, [2.6, 9.2, 33], [2.2, 2.4, -12], 40],
  [0.92, [6, 44, 28], [1, 0, -3], 42],
  [1.0, [0, 132, 11], [0, 0, -2], 40],
]

// Ambulance: position along the northbound inner lane as a function of scroll (monotone cubic).
const AMB = [[0.0, 300], [0.1, 232], [0.2, 172], [0.35, 114], [0.45, 82], [0.58, 55], [0.66, 43], [0.76, 30], [0.84, 17], [0.9, 0], [0.95, -24], [1.0, -56]]
const AMB_M = (() => {
  const n = AMB.length, d = [], m = []
  for (let i = 0; i < n - 1; i++) d.push((AMB[i + 1][1] - AMB[i][1]) / (AMB[i + 1][0] - AMB[i][0]))
  m.push(d[0])
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  return m
})()
function ambZ(p) {
  p = clamp(p)
  let i = 0
  while (i < AMB.length - 2 && p > AMB[i + 1][0]) i++
  const [p0, z0] = AMB[i], [p1, z1] = AMB[i + 1], h = p1 - p0, t = (p - p0) / h
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * z0 + (t3 - 2 * t2 + t) * h * AMB_M[i] + (-2 * t3 + 3 * t2) * z1 + (t3 - t2) * h * AMB_M[i + 1]
}

const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)

export default class SirenWorld extends World {
  static height = 620

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0062
    this.bloom = 0.95
    this.exposure = 1.08
    this.parallax = 0.6
  }

  async init() {
    const q = this.ctx.quality
    const G = this.group
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.camL = new THREE.Vector3()

    this.sky = buildSky(); G.add(this.sky)
    this.ground = buildGround(); G.add(this.ground)
    this.traffic = new Traffic(q)
    const maxStreaks = 56 + 8 + this.traffic.N * 2 + 6
    this.streaks = buildStreaks(maxStreaks); G.add(this.streaks.mesh)
    this.buildings = buildBuildings(q); G.add(this.buildings)
    this.lamps = buildLamps(q, this.streaks); G.add(this.lamps.group)
    this.nStatic = this.lamps.count
    G.add(buildInfra())
    G.add(this.traffic.group)
    this.amb = new Ambulance(); G.add(this.amb.group)
    this.signals = new Signals()
    this.sigLamps = new SignalLamps(); G.add(this.sigLamps.group)
    this.lightState = (axis) => this.signals.state(axis)

    // --- perception layer
    this.spec = buildSpectrogram(q)
    const specOuter = new THREE.Group()
    specOuter.position.set(18.2, 8.6, 4.2)
    specOuter.rotation.y = Math.PI / 2
    this.spec.group.rotation.x = -0.62
    specOuter.add(this.spec.group)
    G.add(specOuter)
    this.specOuter = specOuter
    this.conduits = buildConduits(); G.add(this.conduits.mesh)
    this.frustum = buildFrustum(); G.add(this.frustum.group)
    this.rain = buildRain(q); G.add(this.rain.mesh)

    // --- labels in the environment
    const L = (text, o, pos, parent = G) => { const l = label(text, o); l.position.copy(pos); parent.add(l); return l }
    const V = (x, y, z) => new THREE.Vector3(x, y, z)
    this.faced = []
    this.lCam = L('CAM 01 · YOLOv8\nFRAME ~110 ms · CPU', { height: 0.26, color: HEX.ice, align: 'center' }, V(CAMERA.x, CAMERA.y + 0.95, CAMERA.z))
    this.lMic = L('STEREO PAIR', { height: 0.2, color: HEX.chrome, align: 'center' }, V(MICS.x, MICS.y + 0.5, MICS.z))
    this.lSpecT = L('LOG-MEL SPECTROGRAM', { height: 0.3, color: HEX.ice }, V(12.8, 12.6, -8.6))
    this.lSpecR = L(`SIREN CNN · ROC-AUC ${ROC}`, { height: 0.34, color: HEX.white }, V(12.8, 12.05, -8.6))
    this.lSpecP = L('p(siren) 0.00', { height: 0.3, color: HEX.cyan }, V(12.8, 11.5, -8.6))
    this.lDoa = L('DOA  0°', { height: 0.46, color: HEX.white, align: 'center' }, V(0, 1.3, 0))
    this.lDoaS = L('STEREO DIRECTION OF ARRIVAL', { height: 0.2, color: HEX.ice, align: 'center' }, V(0, 0.75, 0))
    this.faced.push(this.lCam, this.lMic, this.lSpecT, this.lSpecR, this.lSpecP, this.lDoa, this.lDoaS)

    // safety gate: three independent conditions light up, then the gate opens
    const gate = new THREE.Group()
    gate.position.set(0.9, 8.7, -10.2)
    G.add(gate)
    this.gate = gate
    const gl = (t, y, o = {}) => { const l = label(t, { height: 0.3, color: '#ffffff', ...o }); l.position.set(0, y, 0); gate.add(l); return l }
    this.gHead = gl('SAFETY GATE · HOLD', 2.45, { height: 0.22 })
    this.gRows = [gl('VISION     ambulance 0.97', 1.85), gl('AUDIO      siren confirmed', 1.35), gl('DIRECTION  on approach  0°', 0.85)]
    this.gOut = gl('PREEMPT  →  N–S GREEN', 0.05, { height: 0.42, weight: 500 })
    this.gDots = []
    const dotG = new THREE.PlaneGeometry(0.16, 0.16)
    for (const y of [1.85, 1.35, 0.85, 0.05]) {
      const d = new THREE.Mesh(dotG, new THREE.MeshBasicMaterial({ color: 0x222a33, transparent: true, depthWrite: false }))
      d.position.set(-0.32, y, 0); gate.add(d); this.gDots.push(d)
    }
    const rule = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 2.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(0.8), transparent: true, depthWrite: false }))
    rule.position.set(-0.62, 1.2, 0); gate.add(rule); this.gRule = rule
    const sep = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.012), rule.material)
    sep.position.set(2.0, 0.5, 0); gate.add(sep)

    // the accepted paper: a faint engraved citation on the controller that made the decision
    const plaque = new THREE.Group()
    plaque.position.set(CABINET.x + 0.5, CABINET.h + 0.72, CABINET.z + 0.2)
    G.add(plaque)
    const pl1 = label(SIREN.paper.toUpperCase().replace(' AMBULANCE', '\nAMBULANCE'), { height: 0.22, color: HEX.chrome, align: 'center', tracking: 0.14 })
    pl1.position.y = 0.5; pl1.material.opacity = 0.62
    const pl2 = label(`ACCEPTED · ${PUB}`, { height: 0.22, color: HEX.ice, align: 'center', tracking: 0.22 })
    pl2.position.y = -0.08; pl2.material.opacity = 0.8
    const hair = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.chrome), transparent: true, opacity: 0.35, depthWrite: false }))
    hair.position.y = 0.07
    plaque.add(pl1, pl2, hair)
    this.plaque = plaque; this.plaqueL = [pl1, pl2, hair]

    // perception map caption, painted onto the street for the top-down exit
    const mapL = label('PERCEPTION MAP · INTERSECTION 01\nPREEMPTION ACTIVE · N–S', { height: 0.95, color: HEX.cyan, align: 'center' })
    mapL.rotation.x = -Math.PI / 2
    mapL.position.set(0, 0.15, 31)
    mapL.rotation.z = 0
    G.add(mapL)
    this.mapL = mapL

    this.lastP = -1
    this.tick = 0
    this.doaDeg = 0
    this.ambInfo = { x: AMB_X, z: 300, visible: false, dist: 0 }
    this.stageState = []
    this.updateAll(0, 0.016, 0, 0)
  }

  mount(el) {
    el.innerHTML = overlayHTML()
    this.boxes = new Boxes(el.querySelector('.sr-boxes'))
    this.dom = { head: el.querySelector('.sr-head'), stages: el.querySelector('.sr-stages'), end: el.querySelector('.sr-end'), li: [...el.querySelectorAll('.sr-stages li')] }
    this.domDoa = this.dom.li[2]?.querySelector('span')
  }

  onResize() { this.boxes?.resize() }

  cameraAt(p, out) {
    p = clamp(p)
    let i = 0
    while (i < CAM.length - 2 && p > CAM[i + 1][0]) i++
    const a = CAM[Math.max(0, i - 1)], b = CAM[i], c = CAM[i + 1], d = CAM[Math.min(CAM.length - 1, i + 2)]
    let t = (p - b[0]) / (c[0] - b[0])
    t = lerp(t, smoother(t), 0.35)
    out.pos.set(cr(a[1][0], b[1][0], c[1][0], d[1][0], t), cr(a[1][1], b[1][1], c[1][1], d[1][1], t), cr(a[1][2], b[1][2], c[1][2], d[1][2], t))
    out.target.set(cr(a[2][0], b[2][0], c[2][0], d[2][0], t), cr(a[2][1], b[2][1], c[2][1], d[2][1], t), cr(a[2][2], b[2][2], c[2][2], d[2][2], t))
    out.fov = lerp(b[3], c[3], t)
    const asp = this.ctx.camera.aspect
    if (asp < 1) {
      const k = clamp((1 - asp) / 0.55)
      out.fov += 16 * k
      const pull = 1 - band(p, 0.2, 0.28, 0.82, 0.9)
      out.pos.sub(out.target).multiplyScalar(1 + 0.15 * k * pull).add(out.target)
    }
  }

  update(p, dt, t, k) { this.updateAll(p, dt, t, k) }

  updateAll(p, dt, t, k) {
    const U = this.ground.material.uniforms
    const cam = this.ctx.camera
    this.localCamera(this.camL)
    const jump = Math.abs(p - this.lastP) > 0.08
    this.lastP = p

    // ---- signal plan: free cycle while establishing, cross traffic holds green once the ambulance is
    // approaching (its own approach is red), and the safety gate's PREEMPT flips it.
    const preempt = p >= T.preempt
    const req = preempt ? 'NS' : p >= 0.22 ? 'EW' : (Math.floor(t / 13) % 2 ? 'NS' : 'EW')
    if (jump) this.signals.snap(req)
    else this.signals.update(dt, req)
    this.traffic.step(Math.min(dt, 0.05), this.lightState)

    // ---- ambulance (scroll-controlled)
    const z = ambZ(p)
    const A = this.amb
    const ambVis = z < 262
    A.group.visible = ambVis
    A.group.position.set(AMB_X, 0, z)
    A.strobe(t, ambVis ? 1 : 0)
    const ai = this.ambInfo
    ai.x = AMB_X; ai.z = z; ai.visible = ambVis && z > -40
    ai.dist = Math.hypot(AMB_X - CAMERA.x, z - CAMERA.z); ai.cleared = z < -1
    U.uAmb.value.set(AMB_X, z)
    U.uBeacon.value.set(A.r, A.b)
    U.uTime.value = t
    this.rain.uniforms.uTime.value = t

    // ---- perception envelopes
    const vision = band(p, 0.18, 0.26, 0.97, 1.01)
    const lock = range(p, T.lock0, T.lock1)
    const audio = band(p, T.audio0, T.audio1, 0.6, 0.66)
    const fan = band(p, T.fan0, T.fan1, 0.7, 0.77)
    const ring = band(p, 0.4, 0.47, 0.64, 0.72)
    const gV = range(p, T.gV, T.gV + 0.012), gA = range(p, T.gA, T.gA + 0.012), gD = range(p, T.gD, T.gD + 0.012), gO = range(p, T.preempt, T.preempt + 0.012)
    const gateVis = band(p, 0.68, 0.71, 0.9, 0.95)
    const mapA = smoother(range(p, T.map0, T.map1))
    const corr = range(p, T.preempt, T.preempt + 0.04) * (1 - range(p, 0.97, 1.0) * 0.3)

    // bearing from the stereo pair to the ambulance (0° = straight down the approach)
    const bearing = Math.atan2(AMB_X - MAST.x, z - MAST.z) * 180 / Math.PI
    const dist = Math.hypot(AMB_X - MAST.x, z - MAST.z)
    U.uBearing.value = bearing
    U.uFanR.value = clamp(dist - 3.5, 8, 70)
    U.uFan.value = fan * (1 - mapA * 0.5)
    U.uRing.value = ring
    U.uCorr.value = corr
    U.uMap.value = mapA
    this.buildings.material.uniforms.uMap.value = mapA
    this.buildings.material.uniforms.uCam.value.copy(this.camL)

    // spectrogram
    const su = this.spec.uniforms
    su.uTime.value = t
    su.uSiren.value = ambVis ? clamp(0.25 + (175 - z) / 150, 0, 1) : 0
    su.uAmt.value = smoother(audio)
    this.spec.frameMat.opacity = audio * 0.6
    this.specOuter.visible = audio > 0.002
    const pSiren = clamp(0.5 + su.uSiren.value * 0.46 + Math.sin(t * 5.3) * 0.006, 0, 0.99)

    // conduits: vision flows once locked, audio with the spectrogram, output after preempt
    const cu = this.conduits.uniforms
    cu.uTime.value = t
    cu.uFlow.value.set(vision * (0.3 + 0.7 * lock) * (1 - mapA * 0.6), Math.max(audio, fan) * (1 - mapA * 0.6), gO * (1 - mapA * 0.3), fan * (1 - mapA))
    this.v1.set(MICS.x, MICS.y, MICS.z); this.v2.set(AMB_X, 2.4, z)
    this.conduits.setRay(this.v1, this.v2)
    this.frustum.uniforms.uO.value = band(p, 0.18, 0.26, 0.42, 0.5)

    // ---- labels
    this.tick += dt
    const slow = this.tick > 0.14
    if (slow) this.tick = 0
    const deg = Math.round(bearing)
    if (slow) {
      const ms = 110 + Math.round(Math.sin(t * 1.7) * 3 + Math.sin(t * 4.1) * 2)
      this.lCam.setText(`CAM 01 · YOLOv8\nFRAME ${ms} ms · CPU`)
      this.lSpecP.setText(`p(siren) ${pSiren.toFixed(2)}`)
      const ds = `${deg < 0 ? '−' : '+'}${Math.abs(deg)}°`
      this.lDoa.setText(`DOA  ${ds}`)
      this.gRows[2].setText(`DIRECTION  on approach  ${ds}`)
      this.gRows[1].setText(`AUDIO      siren ${pSiren.toFixed(2)}`)
      if (this.domDoa && fan > 0.01) this.domDoa.textContent = `stereo direction of arrival · ${ds}`
    }
    this.lCam.opacity = vision * 0.95 * (1 - range(p, 0.6, 0.66))
    this.lMic.opacity = Math.max(fan, audio) * 0.7 * (1 - mapA)
    const specLab = audio * (1 - mapA)
    this.lSpecT.opacity = specLab * 0.7; this.lSpecR.opacity = specLab; this.lSpecP.opacity = specLab * 0.9
    // DOA readout sits on the fan, along the beam
    const rr = 15, br = bearing * Math.PI / 180
    this.lDoa.position.set(MAST.x + Math.sin(br) * rr - 3.2, 1.5, MAST.z + Math.cos(br) * rr)
    this.lDoaS.position.set(this.lDoa.position.x, 0.95, this.lDoa.position.z)
    this.lDoa.opacity = fan * (1 - mapA); this.lDoaS.opacity = fan * 0.7 * (1 - mapA)

    // gate
    const passC = (m, v, dim) => m.color.setRGB(lerp(dim, 0.62, v), lerp(dim, 0.92, v), lerp(dim, 1.0, v))
    const g3 = [gV, gA, gD]
    this.gRows.forEach((r, i) => { passC(r.material, g3[i], 0.32); r.opacity = gateVis })
    this.gDots.forEach((d, i) => {
      const v = i < 3 ? g3[i] : gO
      d.material.color.setRGB(lerp(0.08, 0.5, v), lerp(0.1, 1.3, v), lerp(0.12, 1.8, v))
      d.material.opacity = gateVis
    })
    this.gHead.setText(gO > 0.5 ? 'SAFETY GATE · OPEN' : 'SAFETY GATE · HOLD')
    passC(this.gHead.material, gO, 0.45); this.gHead.opacity = gateVis * 0.85
    this.gOut.material.color.setRGB(lerp(0.25, 0.8, gO), lerp(0.28, 1.35, gO), lerp(0.3, 1.7, gO))
    this.gOut.opacity = gateVis * (0.35 + 0.65 * gO)
    this.gRule.material.opacity = gateVis * 0.7
    this.gate.visible = gateVis > 0.002
    faceCamera(this.gate, cam)
    const plq = band(p, 0.6, 0.7, 0.92, 0.97)
    this.plaque.visible = plq > 0.002
    this.plaqueL[0].opacity = plq * 0.62; this.plaqueL[1].opacity = plq * 0.85; this.plaqueL[2].material.opacity = plq * 0.35
    this.mapL.opacity = mapA * 0.55
    for (const l of this.faced) if (l.visible) faceCamera(l, cam)

    // ---- signal lamps, halos, reflections
    const S = this.streaks
    this.sigLamps.cam = this.camL
    let o = this.nStatic
    o = this.sigLamps.update(this.lightState, S, o, { x: AMB_X, z: ambVis ? z : 9999, r: A.r, b: A.b })
    o = this.traffic.streaks(S, o)
    if (ambVis) {
      S.set(o++, AMB_X - 0.5, 1.95, z - 2.2, 0.9, A.r * 1.4, A.r * 0.05, A.r * 0.06)
      S.set(o++, AMB_X + 0.5, 1.95, z - 2.2, 0.9, A.b * 0.15, A.b * 0.4, A.b * 1.4)
      S.set(o++, AMB_X, 0.8, z - 4.0, 0.9, 0.5, 0.55, 0.6)
      S.set(o++, AMB_X, 1.0, z + 2.9, 0.7, 0.35, 0.01, 0.02)
    }
    S.mesh.geometry.instanceCount = o
    S.aL.needsUpdate = true; S.aC.needsUpdate = true
    S.mesh.material.uniforms.uCam.value.copy(this.camL)

    // sky dome fades during the flight in and on the top-down exit
    this.sky.material.uniforms.uO.value = k > 0 ? k : 1 - range(p, 0.86, 0.96)

    // ---- 2D detection overlay + DOM
    if (this.boxes) this.boxes.draw(cam, this.group.position, this.traffic.cars, ai, vision * (k > 0 ? 0 : 1), lock, t, mapA > 0.5)
    if (this.dom) {
      reveal(this.dom.head, 1 - range(p, 0.12, 0.2))
      reveal(this.dom.stages, band(p, 0.17, 0.23, 0.9, 0.95))
      // flight out: the overlay layer scrolls up with the page, so fade the end block before it reaches the nav
      const kOut = p >= 1 ? (this.ctx.engine?.state?.k || 0) : 0
      reveal(this.dom.end, range(p, 0.92, 0.985) * (1 - range(kOut, 0.0, 0.12)))
      STAGES.forEach((s, i) => {
        const st = p >= s.a && p < s.b ? 2 : p >= s.b ? 1 : 0
        if (this.stageState[i] !== st) {
          this.stageState[i] = st
          const li = this.dom.li[i]
          li.classList.toggle('is-on', st === 2); li.classList.toggle('is-done', st === 1)
        }
      })
    }
  }
}
