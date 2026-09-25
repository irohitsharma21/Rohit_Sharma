import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { profile } from '../../content.js'
import { clamp, lerp, range, damp, smoother } from '../../lib/math.js'
import { faceCamera } from '../../lib/label.js'
import { createMorph, createDust } from './particles.js'
import { createRings, createShell, createHeart, createSpectrogram, bakeEnvCube } from './structure.js'
import { createStreams, createRibbons } from './signals.js'
import { createGrid, createDiagram, createCode, createCrosshair } from './env.js'
import { createTunnel } from './tunnel.js'
import './style.css'

// HERO · BOOT THE SYSTEM
// A gigantic AI communication core in a dark void. It cycles VOICE → INTELLIGENCE → ACTION
// (~9 s): speech waveform rings resolve into a neural lattice, which resolves into directed
// action packets. Scrolling flies the camera through the rings and glass into the core and
// down the luminous channel behind it.

const PHASES = ['VOICE', 'INTELLIGENCE', 'ACTION']
const CYCLE = 9

// Camera keyframes (equally spaced in p). Pure function of p.
const CAM_POS = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 2.5, 94),
  new THREE.Vector3(5, 4.5, 58),
  new THREE.Vector3(4, 2.0, 30),
  new THREE.Vector3(0.8, 0.4, 7),
  new THREE.Vector3(0, 0, -12),
  new THREE.Vector3(0, 0, -30),
], false, 'centripetal')
const CAM_TGT = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-13.5, -3.4, 0),
  new THREE.Vector3(-1, -1.5, 0),
  new THREE.Vector3(0, 0, -4),
  new THREE.Vector3(0, 0, -30),
  new THREE.Vector3(0, 0, -70),
  new THREE.Vector3(0, 0, -150),
], false, 'centripetal')

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion()
const CORE_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.55, 0))
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _hit = new THREE.Vector3(), _ray = new THREE.Ray(), _cam = new THREE.Vector3(), _v = new THREE.Vector3()

export default class HeroWorld extends World {
  static height = 260

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0042
    this.bloom = 0.8
    this.exposure = 1.0
    this.bootStart = null
    this.cyc = 0
    this.phase = -1
    this.coordT = 0
    this.flowT = 0
  }

  async init() {
    const q = this.ctx.quality
    const U = (this.U = {
      uTime: { value: 0 }, uBoot: { value: 0 }, uPh: { value: 0 }, uCore: { value: 1 },
      uPtr: { value: new THREE.Vector3(0, 0, 400) }, uPtrOn: { value: 0 },
      uRayO: { value: new THREE.Vector3(0, 0, 100) }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uRayOn: { value: 0 },
      uScale: { value: 800 }, uTun: { value: 0 }, uFlowT: { value: 0 },
    })
    const G = this.group

    this.grid = createGrid(); G.add(this.grid)
    this.diagram = createDiagram(); G.add(this.diagram)
    this.dust = createDust(U, q); G.add(this.dust)
    this.streams = createStreams(U); G.add(this.streams)
    this.ribbons = createRibbons(U); G.add(this.ribbons)

    this.core = new THREE.Group(); G.add(this.core)
    // coaxial assembly: rings, waveform/lattice cloud and spectrogram drum share one axis, tilted
    // 3/4 toward the name at rest and swung onto the camera axis as the visitor enters
    this.coax = new THREE.Group(); this.core.add(this.coax)
    this.rings = createRings()
    this.rings.forEach((r) => this.coax.add(r.pivot))
    const R = this.ctx.renderer, env = this.ctx.env
    this.shell = createShell(bakeEnvCube(R, env, 0.08), bakeEnvCube(R, env, 1, 8), this.ctx.scene.environmentIntensity); this.core.add(this.shell.group)
    this.heart = createHeart(U); this.core.add(this.heart.group)
    this.spectro = createSpectrogram(U); this.spectro.rotation.set(Math.PI / 2, 0, 0); this.coax.add(this.spectro)
    const morph = createMorph(U, q)
    this.morph = morph; this.coax.add(morph.points, morph.wires)

    this.tunnel = createTunnel(U, q); G.add(this.tunnel)

    this.code = createCode(); this.code.forEach((l) => G.add(l))
    this.cross = createCrosshair(); G.add(this.cross.group)
  }

  mount(el) {
    const name = profile.name.toUpperCase()
    const letters = [...name].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('')
    el.innerHTML = `
      <div class="hero-id">
        <div class="hero-sys"><i></i><span>SYSTEM CORE · ONLINE</span></div>
        <h1 class="hero-name" aria-label="${profile.name}">${letters}</h1>
        <div class="hero-role">${profile.role.toUpperCase()}</div>
        <div class="hero-tag">${profile.tagline.toUpperCase()}</div>
      </div>
      <div class="hero-state" aria-hidden="true">
        <div class="hst-k">CORE STATE</div>
        <ol>${PHASES.map((p, i) => `<li data-i="${i}"><b>0${i + 1}</b>${p}</li>`).join('')}</ol>
        <div class="hst-bar"><i></i></div>
      </div>
`
    this.idEl = this.$('.hero-id')
    this.stateEl = this.$('.hero-state')
    this.lis = this.$$('.hero-state li')
    this.barEl = this.$('.hst-bar i')
  }

  onBoot() {
    if (this.bootStart != null) return
    this.bootStart = this.ctx.time
    this.el?.classList.add('is-booting')
    setTimeout(() => this.el?.classList.add('is-on'), 900)
  }

  cameraAt(p, out) {
    const e = p
    CAM_POS.getPoint(e, out.pos)
    CAM_TGT.getPoint(e, out.target)
    let fov = 36 + smoother(range(p, 0.45, 1)) * 20
    if (this.ctx.camera.aspect < 1) {
      fov += 22 * (1 - range(p, 0.5, 0.9))
      out.pos.z += 30 * (1 - range(p, 0, 0.4))
      const k = 1 - range(p, 0, 0.3)
      out.target.x += 9 * k; out.pos.x += 2 * k
      out.target.y -= 6 * k
    }
    out.fov = fov
  }

  update(p, dt, t) {
    const U = this.U
    const P = this.ctx.pointer
    if (this.bootStart == null && t > 5) this.onBoot()
    const bootT = this.bootStart == null ? 0 : clamp((t - this.bootStart) / 2.6)
    const boot = smoother(bootT)
    U.uBoot.value = boot
    U.uTime.value = t

    // ---- phase cycle (starts after ignition)
    this.cyc += dt * (0.2 + 0.8 * boot)
    const ph = ((this.cyc / (CYCLE / 3)) % 3)
    U.uPh.value = ph
    const pi = Math.floor(ph + 0.19) % 3 // label switches as the transformation lands
    if (pi !== this.phase) {
      this.phase = pi
      this.lis.forEach((li, i) => li.classList.toggle('is-on', i === pi))
    }
    const segT = ph - Math.floor(ph)
    // wire visibility: lattice dominant during INTELLIGENCE
    const seg = Math.floor(ph), tr = smoother(range(segT, 0.62, 1))
    const wI = seg === 1 ? 1 - tr : seg === 0 ? tr : 0
    this.morph.wireMat.uniforms.uW.value = damp(this.morph.wireMat.uniforms.uW.value, wI, 4, dt)
    if (this.barEl) {
      const bw = Math.round(((this.cyc % CYCLE) / CYCLE) * 200) / 200
      if (bw !== this._bw) { this._bw = bw; this.barEl.style.transform = `scaleX(${bw})` }
    }

    // ---- scroll: entering the core
    const enter = smoother(range(p, 0.1, 0.55))
    const inside = range(p, 0.5, 0.85)
    const leave = this.ctx.engine?.state?.index === this.meta.index ? (this.ctx.engine.state.k || 0) : 0
    U.uTun.value = (0.06 + 0.94 * smoother(range(p, 0.3, 0.7))) * (1 - smoother(range(leave, 0.05, 0.4)))
    this.tunnel.userData.frames.material.opacity = smoother(range(p, 0.3, 0.6))
    this.tunnel.userData.frames.visible = p > 0.3
    U.uCore.value = 1 - 0.55 * inside
    this.fog = lerp(0.0042, 0.0026, inside)
    this.parallax = lerp(1, 0.3, range(p, 0.35, 0.8))
    this.bloom = 0.8 + 0.25 * range(p, 0.6, 1)

    // ---- pointer: particles bend toward it, waveforms distort, packets steer
    const moved = P.moved && t - P.lastMove < 4
    const pOn = (moved ? 1 : 0) * boot * (1 - range(p, 0.2, 0.45))
    U.uPtrOn.value = damp(U.uPtrOn.value, pOn, 3, dt)
    U.uRayOn.value = damp(U.uRayOn.value, (moved ? 1 : 0) * boot * (1 - range(p, 0.5, 0.8)), 3, dt)
    const hit = this.pointerOnPlane(_plane, _hit)
    if (hit) {
      const v = U.uPtr.value
      v.x = damp(v.x, hit.x, 7, dt); v.y = damp(v.y, hit.y, 7, dt); v.z = damp(v.z, hit.z, 7, dt)
    }
    this.localRay(_ray)
    const O = U.uRayO.value, D = U.uRayD.value
    O.x = damp(O.x, _ray.origin.x, 8, dt); O.y = damp(O.y, _ray.origin.y, 8, dt); O.z = damp(O.z, _ray.origin.z, 8, dt)
    D.x = damp(D.x, _ray.direction.x, 8, dt); D.y = damp(D.y, _ray.direction.y, 8, dt); D.z = damp(D.z, _ray.direction.z, 8, dt)
    D.normalize()
    this.flowT += dt * (1 + Math.min(P.speed, 3) * 1.6 * boot)
    U.uFlowT.value = this.flowT

    // ---- point size scale from the render resolution
    const cam = this.ctx.camera
    U.uScale.value = this.ctx.renderer.domElement.height * 0.5 / Math.tan(cam.fov * Math.PI / 360)

    // ---- rings: spin up on boot, align into an aperture as the camera enters
    const spinK = 0.08 + 0.92 * boot + Math.sin(Math.PI * bootT) * 3.5
    _q.copy(CORE_TILT).slerp(_q2.identity(), enter)
    this.coax.quaternion.copy(_q)
    // one slow common precession (never per-ring, so the stack stays coaxial)
    this.coax.rotateX(Math.sin(t * 0.23) * 0.02 * (1 - enter))
    this.coax.rotateY(Math.cos(t * 0.17) * 0.025 * (1 - enter))
    for (const r of this.rings) {
      r.angle += dt * r.spin * spinK
      r.spinner.rotation.z = r.angle
      r.pivot.position.z = lerp(r.z0, r.z, enter)
    }

    // ---- heart
    const H = this.heart
    H.crystal.rotation.y = t * 0.25
    H.crystal.rotation.x = Math.sin(t * 0.2) * 0.2
    H.inner.rotation.y = -t * 0.5; H.inner.rotation.z = t * 0.2
    const coreFade = 1 - range(p, 0.4, 0.54)
    H.crystal.scale.set(coreFade, coreFade * 1.35, coreFade)
    H.crystal.visible = coreFade > 0.01
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2)
    H.mat.uniforms.uLit.value = boot * (0.8 + 0.2 * pulse)
    H.inner.material.opacity = boot * 0.55 * coreFade
    const ign = bootT > 0 && bootT < 1 ? Math.exp(-Math.pow((bootT - 0.55) / 0.12, 2)) : 0
    H.glow.uniforms.uI.value = (0.06 + boot * (0.5 + 0.1 * pulse) + ign * 2.2) * (1 - 0.8 * range(p, 0.4, 0.6))
    // glow footprint: radius (in quad units, 1 = edge) past which halo and core are < 5e-4
    const gK = H.glow.uniforms.uI.value * 0.75
    H.glow.uniforms.uDisc.value = clamp(Math.log(Math.max(320 * gK, 1)) / 9, 0.26, 1)
    const post = this.ctx.engine?.post
    if (post && this.bootStart != null && bootT < 1.05) post.lens.uniforms.uFlash.value = ign * 0.05

    this.shell.group.rotation.y = t * 0.05
    const su = this.shell.uniforms
    // seen from outside the shell is one analytic layer; from inside, its back faces
    const shellIn = this.shell.group.getWorldPosition(_v).distanceTo(cam.position) < this.shell.R + 0.2
    this.shell.outer.visible = !shellIn; this.shell.inner.visible = shellIn
    su.uTime.value = t
    su.uRimOpacity.value = 0.06 * (0.3 + 0.7 * boot)
    su.uOpacity.value = 0.1 * (1 - 0.6 * range(p, 0.35, 0.55))
    this.spectro.rotation.y = t * 0.12 // spins about the shared axis
    this.spectro.visible = p < 0.56
    this.spectro.scale.setScalar(1 + range(p, 0.35, 0.56) * 0.6)

    // ---- environment
    const dg = this.diagram.userData
    dg.packet.position.x = lerp(dg.span[0], dg.span[1], (t * 0.09) % 1)
    this.grid.material.uniforms.uO.value = 1 - 0.9 * inside
    this.diagram.visible = p < 0.5
    this.localCamera(_cam)
    const codeO = (0.2 + 0.8 * boot) * (1 - range(p, 0.25, 0.5))
    for (const l of this.code) {
      const u = l.userData
      l.position.copy(u.base)
      l.position.y += ((t * u.sp + u.ph) % 36) - 18
      const edge = 1 - Math.pow(Math.abs(((t * u.sp + u.ph) % 36) / 18 - 1), 6)
      l.opacity = u.o * codeO * edge
      if (l.visible) faceCamera(l, cam)
    }

    // holographic crosshair at the pointer
    const cO = U.uPtrOn.value * 0.9
    this.cross.group.visible = cO > 0.01
    if (this.cross.group.visible) {
      this.cross.group.position.copy(U.uPtr.value)
      this.cross.group.quaternion.copy(cam.quaternion)
      this.cross.mat.opacity = cO * 0.7
      this.cross.label.opacity = cO * 0.8
      const dist = _cam.distanceTo(U.uPtr.value)
      this.cross.group.scale.setScalar(dist / 60)
      this.coordT += dt
      if (this.coordT > 0.12) {
        this.coordT = 0
        const v = U.uPtr.value
        this.cross.label.setText(`X ${v.x >= 0 ? ' ' : ''}${v.x.toFixed(3)}  Y ${v.y >= 0 ? ' ' : ''}${v.y.toFixed(3)}`)
      }
    }

    // ---- overlay: identity fades and blurs away as we enter
    const out = range(p, 0.015, 0.16)
    if (this.idEl && out !== this._out) {
      this._out = out
      const s = this.idEl.style
      s.opacity = String(1 - out)
      s.filter = out > 0.001 ? `blur(${(out * 14).toFixed(1)}px)` : ''
      s.transform = out > 0.001 ? `translate3d(0, ${(-out * 30).toFixed(1)}px, 0) scale(${(1 + out * 0.06).toFixed(3)})` : ''
      s.visibility = out >= 1 ? 'hidden' : 'visible'
      this.stateEl.style.opacity = String(1 - out)
      this.stateEl.style.visibility = out >= 1 ? 'hidden' : 'visible'
    }
  }
}
