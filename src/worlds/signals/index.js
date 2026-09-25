import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { range, band, smoother, lerp, damp, rng, clamp } from '../../lib/math.js'
import { reveal } from '../../lib/dom.js'
import { achievements, projects } from '../../content.js'
import { waveMaterial, carrierMaterial, shaftMaterial, dustMaterial, flareMaterial, floorMaterial, starMaterial } from './shaders.js'
import './style.css'

// WORLD 08 · SIGNAL RECEIVED
// A dark, nearly empty receiving field. Three receiver traces sit on the noise floor at increasing depth.
// With scroll, a carrier arrives out of the dark for each one, the trace locks (noise resolves into a clean
// sine spreading out from the arrival point), a shaft of light opens over it and the achievement lights up.

const FLOOR_Y = -10
const LEN = 110
// station layout (local space): each receiver sits deeper in the field
const ST = [
  { x: 0, z: 0, xa: 22 },
  { x: 16, z: -140, xa: -20 },
  { x: -12, z: -280, xa: 24 },
]
// scroll choreography: segment i starts at S0[i] and lasts SEG
const S0 = [0.07, 0.32, 0.57]
const SEG = 0.25
const MOVE = [[0.29, 0.35], [0.54, 0.6]]
const EXIT = [0.84, 1]

const _v = new THREE.Vector3()

export default class SignalsWorld extends World {
  static height = 340

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0022
    this.bloom = 0.95
    this.exposure = 1.0
    this.parallax = 0.7
  }

  async init() {
    const low = this.ctx.quality === 'low'
    const g = this.group
    this.px = Math.min(devicePixelRatio || 1, low ? 1.25 : 1.75)
    this.stations = []

    // floor with the shafts' light pools
    const pools = ST.map((s) => new THREE.Vector3(s.x + s.xa * 0.2, FLOOR_Y, s.z - 4))
    this.floorMat = floorMaterial(pools)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, FLOOR_Y, -200)
    g.add(floor)

    // deep-space dust
    const r = rng(808)
    const NS = low ? 900 : 1800
    const sp = new Float32Array(NS * 3), ss = new Float32Array(NS * 2)
    for (let i = 0; i < NS; i++) {
      const a = r() * Math.PI * 2, rad = 120 + r() * 520
      sp[i * 3] = Math.cos(a) * rad
      sp[i * 3 + 1] = FLOOR_Y + 8 + Math.pow(r(), 0.7) * 320
      sp[i * 3 + 2] = -140 + Math.sin(a) * rad - 200 * r()
      ss[i * 2] = Math.pow(r(), 3); ss[i * 2 + 1] = r()
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    sg.setAttribute('seed', new THREE.BufferAttribute(ss, 2))
    this.starMat = starMaterial()
    this.starMat.uniforms.uPx.value = this.px
    const stars = new THREE.Points(sg, this.starMat)
    stars.frustumCulled = false
    g.add(stars)

    const waveGeo = new THREE.PlaneGeometry(LEN, 1, low ? 260 : 520, 1)
    const coneH = 78
    const coneGeo = new THREE.CylinderGeometry(1.6, 11, coneH, 40, 1, true)
    coneGeo.translate(0, coneH / 2, 0)
    const carrierGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6, 1, true)
    carrierGeo.translate(0, 0.5, 0)
    const flareGeo = new THREE.PlaneGeometry(64, 8)
    const ringGeo = this.reticleGeometry()
    const ND = low ? 160 : 320

    ST.forEach((s, i) => {
      const st = { ...s, i, root: new THREE.Group() }
      st.root.position.set(s.x, 0, s.z)
      g.add(st.root)

      // receiver trace + its reflection in the floor
      st.u = {
        uTime: { value: 0 }, uLock: { value: 0 }, uArrive: { value: s.xa }, uSeed: { value: i * 7.3 + 1.1 },
        uLen: { value: LEN }, uW: { value: 1.3 }, uLevel: { value: 0.2 }, uFlash: { value: 0 },
        uCore: { value: new THREE.Color(HEX.ice).multiplyScalar(1.02) }, uHalo: { value: new THREE.Color(HEX.blue).lerp(COLOR.cyan, 0.4) },
      }
      const wave = new THREE.Mesh(waveGeo, waveMaterial(st.u, 0))
      wave.frustumCulled = false
      st.root.add(wave)
      const refl = new THREE.Mesh(waveGeo, waveMaterial(st.u, 1))
      refl.frustumCulled = false
      refl.scale.y = -1
      refl.position.y = 2 * FLOOR_Y
      st.root.add(refl)

      // incoming carrier from deep space to the arrival point
      const end = new THREE.Vector3(s.xa, 0, 0)
      const start = new THREE.Vector3(s.xa + (s.xa > 0 ? 110 : -110), 70, -460)
      const dir = start.clone().sub(end)
      // geometry runs 0 (far) → 1 (receiver): place at start, point toward end
      const carrier = new THREE.Mesh(carrierGeo, carrierMaterial())
      carrier.position.copy(start)
      carrier.scale.set(1, dir.length(), 1)
      carrier.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate().normalize())
      carrier.frustumCulled = false
      st.root.add(carrier)
      st.carrier = carrier

      // light shaft from above falling on the receiver
      const shaft = new THREE.Mesh(coneGeo, shaftMaterial())
      shaft.position.set(s.xa * 0.2, FLOOR_Y, -4)
      shaft.rotation.z = s.xa > 0 ? -0.2 : 0.2
      shaft.rotation.x = 0.08
      st.root.add(shaft)
      st.shaft = shaft

      // dust inside the shaft
      const dp = new Float32Array(ND * 3), ds = new Float32Array(ND * 4)
      for (let k = 0; k < ND; k++) {
        const y = r() * coneH
        const rad = lerp(10, 1.6, y / coneH) * Math.sqrt(r()) * 0.85
        const a = r() * Math.PI * 2
        dp.set([Math.cos(a) * rad, y, Math.sin(a) * rad], k * 3)
        ds.set([r(), r(), r(), r()], k * 4)
      }
      const dg = new THREE.BufferGeometry()
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
      dg.setAttribute('seed', new THREE.BufferAttribute(ds, 4))
      const dust = new THREE.Points(dg, dustMaterial(1.6))
      dust.material.uniforms.uH.value = coneH
      dust.material.uniforms.uPx.value = this.px
      dust.frustumCulled = false
      shaft.add(dust)
      st.dust = dust

      // lock flare at the arrival point
      const flare = new THREE.Mesh(flareGeo, flareMaterial())
      flare.position.set(s.xa, 0, 0.2)
      st.root.add(flare)
      st.flare = flare

      // acquisition reticle contracting on the arrival point
      const ret = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      ret.position.set(s.xa, 0, 0.1)
      st.root.add(ret)
      st.ret = ret

      // tiny technical labels on the trace
      st.lA = new Label(`RX 0${i + 1} · ACQUIRING`, { height: 0.42, color: HEX.cyan, tracking: 0.24 })
      st.lA.position.set(s.xa + (s.xa > 0 ? 2.2 : -2.2), 2.6, 0.2)
      if (s.xa < 0) { st.lA.opts.align = 'right'; st.lA.text = null; st.lA.setText(`RX 0${i + 1} · ACQUIRING`) }
      st.root.add(st.lA)
      st.lB = new Label(`CARRIER · ${achievements[i].year}`, { height: 0.4, color: HEX.smoke, tracking: 0.22 })
      st.lB.position.set(s.xa > 0 ? -27 : 14, -2.4, 0.2)
      st.root.add(st.lB)
      st.lC = new Label('NOISE FLOOR', { height: 0.4, color: HEX.smoke, tracking: 0.22 })
      st.lC.position.set(s.xa > 0 ? -27 : 14, 2.0, 0.2)
      st.root.add(st.lC)
      st.state = ''
      st.level = 0.2; st.shaftL = 0; st.lockS = 0
      this.stations.push(st)
    })
  }

  reticleGeometry() {
    const pts = []
    const ring = (r, n, gap) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1 - gap) / n) * Math.PI * 2
        pts.push(Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0)
      }
    }
    ring(1.35, 120, 0.5)
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      pts.push(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0, Math.cos(a) * 1.72, Math.sin(a) * 1.72, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }

  mount(el) {
    const n = achievements.length
    el.innerHTML = `
      <div class="w-head sg-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">Signal received.</h2>
        <p class="w-lede">Out of the noise floor, three signals lock on.</p>
      </div>
      ${achievements.map((a, i) => `
      <section class="sg-sig" data-i="${i}">
        <div class="sg-code fx"><span>SIGNAL 0${i + 1} / 0${n}</span><i></i><span class="sg-lock">LOCKED</span></div>
        <h3 class="sg-title fx">${a.title}</h3>
        <div class="sg-status fx">${a.status}</div>
        ${a.id === 'starforge' && projects.continuum ? `<div class="sg-proj fx">${projects.continuum.name} · ${projects.continuum.context.split(' · ').slice(2).join(' · ')}</div>` : ''}
        <p class="sg-detail fx">${a.detail}</p>
        ${a.prize ? `<div class="sg-prize fx"><span class="sg-pk">PRIZE</span><span class="sg-pv">${a.prize}</span><span class="sg-gauge"><b></b></span></div>` : ''}
      </section>`).join('')}
      <div class="sg-log fx">
        <div class="sg-log-h"><span>0${n} SIGNALS</span><span class="sg-ok">LOCKED</span></div>
        ${achievements.map((a, i) => `<div class="sg-log-r"><span>RX 0${i + 1}</span><span>${a.title}</span><span>${a.status}</span></div>`).join('')}
      </div>`
    this.sigs = this.$$('.sg-sig').map((s) => ({
      code: s.querySelector('.sg-code'), title: s.querySelector('.sg-title'), status: s.querySelector('.sg-status'), proj: s.querySelector('.sg-proj'),
      detail: s.querySelector('.sg-detail'), prize: s.querySelector('.sg-prize'), gauge: s.querySelector('.sg-gauge b'),
      lock: s.querySelector('.sg-lock'),
    }))
    this.head = this.$('.sg-head')
    this.log = this.$('.sg-log')
  }

  /** Continuous station coordinate: 0,1,2 at the three receivers. */
  stationF(p) {
    return smoother(range(p, MOVE[0][0], MOVE[0][1])) + smoother(range(p, MOVE[1][0], MOVE[1][1]))
  }

  stationAt(f, key) {
    const i = Math.min(1, Math.floor(f)), t = f - i
    return lerp(ST[i][key], ST[Math.min(2, i + 1)][key], t)
  }

  cameraAt(p, out) {
    const f = this.stationF(p)
    const x = this.stationAt(f, 'x'), z = this.stationAt(f, 'z')
    // slow push-in during each hold
    const seg = Math.min(2, Math.max(0, Math.round(f)))
    const u = clamp((p - S0[seg]) / SEG)
    const dist = 62 - 7 * smoother(u)
    const narrow = this.ctx.camera.aspect < 1
    out.pos.set(x * 0.85, 5.2, z + dist * (narrow ? 1.35 : 1))
    out.target.set(x * 0.9, 4.2, z)
    out.fov = narrow ? 58 : 38

    // establishing: further back and a little higher, the three traces receding into the dark
    const i0 = 1 - smoother(range(p, 0, 0.1))
    if (i0 > 0) {
      out.pos.lerp(_v.set(-4, 14, 150), i0)
      out.target.lerp(_v.set(2, 2, -140), i0)
      out.fov = lerp(out.fov, narrow ? 62 : 44, i0)
    }
    // exit: rise and pull back, all three locked traces below, then leave upward
    const e = smoother(range(p, EXIT[0], EXIT[1]))
    if (e > 0) {
      out.pos.lerp(_v.set(26, 26 + e * 30, 175), e)
      out.target.lerp(_v.set(2, 4 + e * 14, -140), e)
      out.fov = lerp(out.fov, narrow ? 62 : 46, e)
    }
  }

  update(p, dt, t, k) {
    if (!this.stations) return
    const cam = this.ctx.camera
    const fogD = this.ctx.scene.fog?.density ?? this.fog
    const summary = smoother(range(p, EXIT[0] - 0.02, EXIT[0] + 0.06))
    this.starMat.uniforms.uTime.value = t
    this.floorMat.uniforms.uTime.value = t

    for (let i = 0; i < this.stations.length; i++) {
      const s = this.stations[i]
      const u = (p - S0[i]) / SEG
      const head = clamp(range(u, 0.0, 0.3) * 1.08, 0, 1.08)
      const lock = smoother(range(u, 0.27, 0.47))
      const lit = smoother(range(u, 0.36, 0.52))
      const out = range(u, 0.9, 1.04)
      const active = lock * (1 - out)
      const flash = Math.exp(-Math.pow((u - 0.46) / 0.045, 2))

      // levels (damped, so scrubbing never snaps)
      const idle = u < -0.25 ? 0.18 : 0.4
      const levelT = idle + active * 0.6 + lock * out * 0.25 + summary * 0.3 * lock
      s.level = damp(s.level, levelT, 6, dt)
      s.lockS = damp(s.lockS, lock, 8, dt)
      s.shaftL = damp(s.shaftL, active + summary * 0.35, 5, dt)

      const U = s.u
      U.uTime.value = t
      U.uLock.value = s.lockS
      U.uLevel.value = s.level
      U.uFlash.value = flash
      s.carrier.material.uniforms.uHead.value = head
      s.carrier.material.uniforms.uFade.value = 1 - smoother(range(u, 0.34, 0.55))
      s.carrier.visible = head > 0 && u < 0.56

      const sm = s.shaft.material.uniforms
      sm.uTime.value = t; sm.uLevel.value = s.shaftL
      s.dust.material.uniforms.uTime.value = t
      s.dust.material.uniforms.uLevel.value = s.shaftL
      s.shaft.visible = s.shaftL > 0.005

      const fm = s.flare.material.uniforms
      fm.uLevel.value = flash * 0.7 + active * 0.05 + summary * lock * 0.03
      fm.uStreak.value = flash * 0.8 + active * 0.08
      faceCamera(s.flare, cam)

      // reticle: contracts from wide to the point during acquisition, then fades
      const acq = range(u, 0.12, 0.47)
      const rs = lerp(12, 2.4, smoother(acq))
      s.ret.scale.setScalar(rs)
      s.ret.rotation.z = (1 - smoother(acq)) * 1.6 + t * 0.05
      s.ret.material.opacity = band(u, 0.1, 0.2, 0.44, 0.56) * 0.3
      s.ret.visible = s.ret.material.opacity > 0.003
      faceCamera(s.ret, cam)

      // labels
      const state = u < 0.02 ? 'IDLE' : lock < 0.98 ? 'ACQUIRING' : 'LOCKED'
      if (state !== s.state) {
        s.state = state
        s.lA.setText(state === 'IDLE' ? `RX 0${i + 1} · LISTENING` : `RX 0${i + 1} · ${state}`)
        s.lA.material.color.set(state === 'LOCKED' ? HEX.ice : HEX.cyan)
      }
      s.lA.opacity = 0.35 + 0.65 * clamp(active + summary * 0.5 + (u > 0 ? 0.2 : 0))
      s.lB.opacity = 0.25 + 0.5 * active
      s.lC.opacity = (0.5 * (1 - lock)) + 0.05
      s.lC.visible = s.lC.opacity > 0.01

      // overlay: title lights up once the lock resolves
      const D = this.sigs?.[i]
      if (D) {
        const vis = lit * (1 - smoother(range(u, 0.86, 0.98)))
        reveal(D.code, band(u, 0.3, 0.42, 0.86, 0.96))
        reveal(D.title, vis, 0)
        reveal(D.status, band(u, 0.4, 0.48, 0.86, 0.97))
        reveal(D.detail, band(u, 0.44, 0.52, 0.87, 0.98))
        if (D.proj) reveal(D.proj, band(u, 0.42, 0.5, 0.86, 0.97))
        if (D.prize) {
          const pv = band(u, 0.46, 0.54, 0.87, 0.98)
          reveal(D.prize, pv)
          const gv = smoother(range(u, 0.48, 0.64)).toFixed(3)
          if (D._g !== gv) { D._g = gv; D.gauge.style.transform = `scaleX(${gv})` }
        }
        const lv = (Math.round(lit * 40) / 40)
        if (D._lit !== lv) {
          D._lit = lv
          D.title.style.setProperty('--lit', lv)
        }
        const lk = lock > 0.98
        if (D._lk !== lk) { D._lk = lk; D.lock.textContent = lk ? 'LOCKED' : 'ACQUIRING'; D.code.classList.toggle('is-locked', lk) }
      }
    }

    // floor pools follow the shafts
    const I = this.floorMat.uniforms.uI.value
    I.set(this.stations[0].shaftL, this.stations[1].shaftL, this.stations[2].shaftL)

    reveal(this.head, band(p, -1, 0, 0.05, 0.1) * (k > 0 ? smoother(range(k, 0.86, 1)) : 1))
    reveal(this.log, band(p, 0.88, 0.94, 1.1, 1.2))
    void fogD
  }
}
