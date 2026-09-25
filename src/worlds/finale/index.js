import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { chrome, glow } from '../../lib/materials.js'
import { COLOR, HEX } from '../../lib/palette.js'
import { range, band, damp, smoother, lerp, clamp } from '../../lib/math.js'
import { reveal } from '../../lib/dom.js'
import { buildBrain } from './brain.js'
import { buildEmblems } from './emblems.js'
import { buildArcs } from './arcs.js'
import './style.css'

// FINALE · THE COMPLETE SYSTEM
// The camera starts at the core in the centre of the spiral, then pulls back thousands of units while
// every environment the visitor travelled through lights up as a signature and connects: to the core,
// to its neighbour in the story, and across systems. A faint neural structure resolves around it all.
// Then: name, closing line, contact.

const CROSS = [
  ['voice', 'meetai'], ['siren', 'realtime'], ['realtime', 'infra'], ['meetai', 'knowledge'], ['continuum', 'voice'], ['continuum', 'knowledge'], ['knowledge', 'skills'],
  ['runbook', 'infra'], ['shieldx', 'infra'], ['shieldx', 'realtime'], ['experience', 'voice'], ['signals', 'experience'], ['skills', 'hero'],
]
const T0 = 0.015, SPAN = 0.47, DRAW = 0.065

const _v = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3(), _cam = new THREE.Vector3()

export default class FinaleWorld extends World {
  static height = 420

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.00006
    this.bloom = 1.0
    this.exposure = 1.05
    this.parallax = 0.35
    this.hover = -1
    this.linksShown = -1
  }

  async init() {
    const g = this.group
    // entries: every other world, in narrative order, at its real scene offset (finale sits at the origin)
    const others = this.ctx.worlds.filter((w) => w.id !== this.meta.id)
    const DT = SPAN / Math.max(1, others.length)
    this.entries = others.map((w, i) => ({
      id: w.id, code: w.code, title: w.title, label: w.label, center: w.offset.clone(), i, start: T0 + i * DT,
    }))
    const E = this.entries, n = E.length
    // start the orbit on the side the visitor arrives from (the previous world)
    const prev = E[n - 1]?.center
    this.az0 = prev ? Math.atan2(prev.x, prev.z) : 0.06
    const idx = Object.fromEntries(E.map((e) => [e.id, e.i]))

    // ---- links: each world to the core, to the previous world, then cross-system links ----
    const origin = new THREE.Vector3(0, 0, 0)
    const links = []
    E.forEach((e, i) => {
      links.push({ a: origin, b: e.center, ia: -1, ib: i, start: e.start - 0.01, kind: 'core' })
      if (i > 0) links.push({ a: E[i - 1].center, b: e.center, ia: i - 1, ib: i, start: e.start + 0.012, kind: 'chain' })
    })
    CROSS.forEach(([a, b], k) => {
      if (idx[a] == null || idx[b] == null) return
      links.push({ a: E[idx[a]].center, b: E[idx[b]].center, ia: idx[a], ib: idx[b], start: T0 + SPAN + 0.01 + k * (0.13 / CROSS.length), kind: 'cross' })
    })
    this.links = links
    this.linkStarts = links.map((l) => l.start + DRAW).sort((a, b) => a - b)

    const dpr = this.ctx.renderer.getPixelRatio()
    this.arcU = {
      uProg: { value: 0 }, uTime: { value: 0 }, uHover: { value: -9 }, uHoverOn: { value: 0 }, uDraw: { value: DRAW },
      uDpr: { value: dpr }, uGlobal: { value: 1 }, uCamD: { value: 330 },
    }
    const arcs = buildArcs(links, this.arcU)
    g.add(arcs.lines, arcs.packets)

    // ---- signatures ----
    this.emU = {
      uTime: { value: 0 }, uGrow: { value: 1 }, uDpr: { value: dpr }, uR: { value: 70 }, uHalfH: { value: 450 },
      uRev: { value: new Array(n).fill(0) }, uHi: { value: new Array(n).fill(0) },
    }
    const em = buildEmblems(E, this.emU)
    g.add(em.lines, em.points)
    this.hiVals = new Array(n).fill(0)
    this.labO = new Float32Array(n); this.labVis = new Float32Array(n); this.labSide = new Float32Array(n).fill(-1); this.labSideT = new Float32Array(n).fill(-1)
    this.labOrder = Array.from({ length: n }, (_, i) => i); this.rects = new Float32Array(n * 2 * 4); this.scr = new Float32Array(n * 4)
    this.labCmp = (a, b) => (this.hover === b) - (this.hover === a) || this.scr[a * 4 + 3] - this.scr[b * 4 + 3]

    // mono labels (constant screen size, faced to camera each frame)
    this.labels = E.map((e) => {
      const l = new Label(`${e.code}  ${e.title}`, { height: 1, color: HEX.chrome, tracking: 0.16, align: 'center', weight: 500 })
      l.base = l.scale.clone()
      l.opacity = 0
      g.add(l)
      return l
    })

    // ---- the neural structure ----
    this.brain = buildBrain(this.ctx.quality)
    g.add(this.brain)

    // ---- the core: a smaller echo of the hero core ----
    const core = (this.core = new THREE.Group())
    const ringGeo = [new THREE.TorusGeometry(40, 0.7, 12, 160), new THREE.TorusGeometry(54, 0.42, 10, 180), new THREE.TorusGeometry(28, 1.1, 12, 120)]
    const cm = chrome({ roughness: 0.12 })
    this.rings = ringGeo.map((geo, i) => {
      const m = new THREE.Mesh(geo, cm)
      m.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.9, 0)
      core.add(m)
      return m
    })
    const hairGeo = new THREE.TorusGeometry(68, 0.18, 6, 220)
    const hair = new THREE.Mesh(hairGeo, glow(COLOR.cyan, 2.2, { transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
    hair.rotation.x = Math.PI / 2
    core.add(hair)
    this.hair = hair
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 3), glow(COLOR.ice, 2.2))
    core.add(heart)
    this.heart = heart
    // halo sprite (grows with distance so the core stays a luminous point from far away)
    const cv = document.createElement('canvas'); cv.width = cv.height = 128
    const c2 = cv.getContext('2d')
    const grd = c2.createRadialGradient(64, 64, 0, 64, 64, 64)
    for (let i = 0; i <= 16; i++) { const x = i / 16; const a = Math.exp(-x * 7) * 0.9 + Math.exp(-x * 2.4) * 0.12 * (1 - x); grd.addColorStop(x, `rgba(${Math.round(150 + 105 * Math.exp(-x * 9))},${Math.round(200 + 55 * Math.exp(-x * 9))},255,${a.toFixed(3)})`) }
    c2.fillStyle = grd; c2.fillRect(0, 0, 128, 128)
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.3, 1.5, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    this.halo.renderOrder = 6
    core.add(this.halo)
    // contact-shadow-like dark disc under the core so chrome reads against the particles
    g.add(core)

    this._ndc = new THREE.Vector3()
    this._onClick = (e) => this.click(e)
    addEventListener('click', this._onClick)
  }

  mount(el) {
    const P = this.ctx.content.profile
    const n = this.entries.length
    const [first, last] = P.name.split(' ')
    const pad = (v) => String(v).padStart(2, '0')
    el.innerHTML = `
      <div class="fn-intro fx">
        <span class="w-code">WORLD ${this.meta.code} · ${this.meta.title}</span>
        <p class="fn-sys"><i></i><span>ALL SYSTEMS CONNECTED</span></p>
        <p class="fn-count"><span>LINKS</span><b class="fn-n">00</b><em>/ ${pad(this.links.length)}</em><span>ENVIRONMENTS</span><b>${pad(n)}</b></p>
      </div>
      <div class="fn-final">
        <div class="fn-kicker fx"><span>WORLD ${this.meta.code} · ${this.meta.title}</span><span class="fn-kline"></span><span>${pad(n)} SYSTEMS · 1 NETWORK</span></div>
        <h2 class="fn-name fx"><span>${first}</span> <span>${last}</span></h2>
        <div class="fn-role fx">${P.role.toUpperCase()}</div>
        <p class="fn-close fx">${P.closing}</p>
        <nav class="fn-links" aria-label="Contact">
          ${P.links.map((l, i) => {
            const ext = l.href.startsWith('http')
            return `<a class="fn-link fx" href="${l.href}"${ext ? ' target="_blank" rel="noopener"' : ''} data-magnetic="0.06">
              <span class="fl-k">${pad(i + 1)} · ${l.label.toUpperCase()}</span>
              <span class="fl-v">${l.value}</span>
              <i class="fl-a" aria-hidden="true">${ext ? '↗' : '→'}</i>
            </a>`
          }).join('')}
        </nav>
      </div>
      <p class="fn-hint fx"><i></i>SELECT ANY SYSTEM TO RETURN TO IT</p>
      <footer class="fn-foot fx">
        <span>© 2026 ${P.name} · Noida, India</span>
        <span>Designed &amp; engineered by ${P.name}</span>
      </footer>`
    this.dom = {
      intro: this.$('.fn-intro'), final: this.$('.fn-final'), n: this.$('.fn-n'), kicker: this.$('.fn-kicker'), name: this.$('.fn-name'), role: this.$('.fn-role'),
      close: this.$('.fn-close'), links: this.$$('.fn-link'), hint: this.$('.fn-hint'), foot: this.$('.fn-foot'),
    }
  }

  // ---------------------------------------------------------------- camera
  cameraAt(p, out) {
    const asp = this.ctx.camera.aspect || 1.6
    const narrow = asp < 1
    const e = smoother(range(p, 0, 0.72))
    const hold = range(p, 0.72, 1)
    // exponential pull-back reads as a constant zoom speed
    let d = 330 * Math.pow(7300 / 330, e) + hold * 1400
    if (narrow) d *= 1.35
    const el = lerp(0.1, 0.6, smoother(range(p, 0.05, 0.8)))
    const az = (this.az0 ?? 0.06) + p * 1.05
    const ce = Math.cos(el)
    out.pos.set(Math.sin(az) * ce * d, Math.sin(el) * d + 30, Math.cos(az) * ce * d)
    out.fov = narrow ? 60 : 40
    // lift the target a touch with distance, then make room for the name block
    out.target.set(0, lerp(0, 160, e), 0)
    const room = smoother(range(p, 0.55, 0.82))
    if (room > 0) {
      const half = d * Math.tan((out.fov * Math.PI) / 360)
      if (!narrow) {
        // screen-left shift of the target = structure moves right
        _right.set(Math.cos(az), 0, -Math.sin(az))
        out.target.addScaledVector(_right, -room * half * asp * 0.43)
      } else {
        out.target.y -= room * half * 0.56
      }
    }
  }

  /**
   * Screen-space de-collision for the signature labels. Every visible emblem is an obstacle; labels are placed
   * hovered-first, then nearest-first. Each tries below its emblem, then above; if both collide it fades out.
   * css = css px per world unit at distance 1.
   */
  placeLabels(cam, css, dt) {
    const E = this.entries, n = E.length, W = innerWidth, H = innerHeight
    const Rr = this.rects
    let m = 0
    const put = (x0, y0, x1, y1) => { Rr[m * 4] = x0; Rr[m * 4 + 1] = y0; Rr[m * 4 + 2] = x1; Rr[m * 4 + 3] = y1; m++ }
    const hit = (x0, y0, x1, y1) => {
      for (let j = 0; j < m; j++) if (x0 < Rr[j * 4 + 2] && x1 > Rr[j * 4] && y0 < Rr[j * 4 + 3] && y1 > Rr[j * 4 + 1]) return true
      return false
    }
    const sc = this.scr
    for (const e of E) {
      const i = e.i
      _v.copy(e.center).project(cam)
      const dist = e.center.distanceTo(_cam)
      if (_v.z > 1) { sc[i * 4 + 3] = 0; continue }
      const ppu = css / Math.max(dist, 1)
      const R = this.emU.uR.value * this.emU.uGrow.value * (0.55 + 0.45 * this.emU.uRev.value[i]) * (1 + 0.25 * this.hiVals[i])
      const cx = (_v.x + 1) * 0.5 * W, cy = (1 - _v.y) * 0.5 * H, rp = R * ppu
      sc[i * 4] = cx; sc[i * 4 + 1] = cy; sc[i * 4 + 2] = rp; sc[i * 4 + 3] = dist
      if (this.emU.uRev.value[i] > 0.5) put(cx - rp * 0.92, cy - rp * 0.92, cx + rp * 0.92, cy + rp * 0.92)
    }
    const ord = this.labOrder
    ord.sort(this.labCmp)
    for (const i of ord) {
      let vis = 0
      const l = this.labels[i]
      if (this.labO[i] > 0.02 && sc[i * 4 + 3] > 0) {
        const cx = sc[i * 4], cy = sc[i * 4 + 1], rp = sc[i * 4 + 2]
        const hw = l.base.x * 5 + 4, hh = l.base.y * 5 + 2 // label is 10 css px tall per unit of base
        const off = rp * 1.3 + 12
        const pref = this.labSideT[i]
        for (const sd of [pref, -pref]) {
          const y = cy - sd * off // screen y grows downward; side -1 = below
          if (!hit(cx - hw, y - hh, cx + hw, y + hh)) { put(cx - hw, y - hh, cx + hw, y + hh); this.labSideT[i] = sd; vis = 1; break }
        }
        if (!vis && this.hover === i) vis = 1
      }
      // a label that must change sides fades out first and reappears on the other side (never slides across its emblem)
      if (vis && this.labSide[i] !== this.labSideT[i]) { if (this.labVis[i] < 0.04) this.labSide[i] = this.labSideT[i]; else vis = 0 }
      this.labVis[i] = damp(this.labVis[i], vis, vis ? 6 : 10, dt)
    }
  }

  // ---------------------------------------------------------------- interaction
  pickAt(nx, ny) {
    if (!this.entries || this.p < 0.0 || !this.active) return -1
    const cam = this.ctx.camera
    const H = innerHeight, W = innerWidth
    const px = H / (2 * Math.tan((cam.fov * Math.PI) / 360))
    cam.getWorldPosition(_cam)
    let best = -1, bd = 1e9
    for (const e of this.entries) {
      if (this.emU.uRev.value[e.i] < 0.5) continue
      _v.copy(e.center).project(cam)
      if (_v.z > 1) continue
      const dx = (_v.x - nx) * W / 2, dy = (_v.y - ny) * H / 2
      const dist = e.center.distanceTo(_cam)
      const rad = (this.emU.uR.value * this.emU.uGrow.value * 1.35 / dist) * px + 14
      const dd = Math.hypot(dx, dy)
      if (dd < rad && dd < bd) { bd = dd; best = e.i }
    }
    return best
  }

  click(e) {
    if (!this.active || !this.entries) return
    if (e.target.closest?.('a, button, nav')) return
    const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1
    const i = this.pickAt(nx, ny)
    if (i < 0) return
    this.ctx.cursor.hover(null, null, this)
    this.ctx.goTo(this.entries[i].id, 0.02)
  }

  onLeave() {
    this.hover = -1
    this.ctx.cursor.hover(null, null, this)
  }

  // ---------------------------------------------------------------- frame
  update(p, dt, t, k) {
    if (!this.entries) return
    const cam = this.ctx.camera
    const E = this.entries, n = E.length
    const prog = p + 0.02
    const r = this.ctx.renderer
    const dpr = r.getPixelRatio()
    const H = r.domElement.height || innerHeight * dpr
    const pxScale = H / (2 * Math.tan((cam.fov * Math.PI) / 360))
    cam.getWorldPosition(_cam)
    const camDist = _cam.length()

    // hover (pointer, desktop only, current world only)
    let hov = -1
    if (this.active && !k && this.ctx.cursor.enabled && this.ctx.pointer.moved) hov = this.pickAt(this.ctx.pointer.x, this.ctx.pointer.y)
    if (hov !== this.hover) {
      this.hover = hov
      if (hov >= 0) { const e = E[hov]; this.ctx.cursor.hover(`WORLD ${e.code} · RETURN`, `${e.title} · ${e.label}`, this) }
      else this.ctx.cursor.hover(null, null, this)
    }
    this.arcU.uHover.value = hov >= 0 ? hov : this.arcU.uHover.value
    this.arcU.uHoverOn.value = damp(this.arcU.uHoverOn.value, hov >= 0 ? 1 : 0, 7, dt)

    // arcs
    this.arcU.uProg.value = prog
    this.arcU.uTime.value = t
    this.arcU.uDpr.value = dpr
    this.arcU.uCamD.value = camDist

    // signatures: reveal in narrative order, grow with distance so they stay legible
    const pull = smoother(range(p, 0, 0.72))
    this.emU.uTime.value = t
    this.emU.uDpr.value = dpr
    this.emU.uHalfH.value = H / dpr / 2
    const narrow = cam.aspect < 1
    const labelK = narrow ? 1 - 0.9 * smoother(range(p, 0.55, 0.7)) : 1
    this.emU.uGrow.value = lerp(1, 2.2, pull)
    _up.setFromMatrixColumn(cam.matrixWorld, 1)
    for (const e of E) {
      const rv = smoother(range(prog, e.start - 0.03, e.start + 0.03))
      this.emU.uRev.value[e.i] = 0.12 + 0.88 * rv
      this.hiVals[e.i] = damp(this.hiVals[e.i], hov === e.i ? 1 : 0, 9, dt)
      this.emU.uHi.value[e.i] = this.hiVals[e.i]
      this.labO[e.i] = rv * (0.7 + 0.3 * this.hiVals[e.i]) * (1 - range(p, 0.9, 1) * 0.25) * labelK
    }
    this.placeLabels(cam, pxScale / dpr, dt)
    for (const e of E) {
      const l = this.labels[e.i]
      const dist = e.center.distanceTo(_cam)
      const s = dist * 10 / pxScale * dpr
      const R = this.emU.uR.value * this.emU.uGrow.value * (0.55 + 0.45 * this.emU.uRev.value[e.i])
      const side = this.labSide[e.i]
      l.position.copy(e.center).addScaledVector(_up, side * (R * 1.3 + s * 1.2))
      l.scale.copy(l.base).multiplyScalar(s)
      faceCamera(l, cam)
      l.opacity = this.labO[e.i] * this.labVis[e.i]
      l.material.color.setScalar(1 + this.hiVals[e.i] * 0.6)
    }

    // neural structure resolves as the camera leaves the centre
    const bu = this.brain.material.uniforms
    bu.uTime.value = t
    bu.uReveal.value = smoother(range(p, 0.2, 0.74))
    bu.uPx.value = pxScale
    bu.uHot.value = this.arcU.uHoverOn.value

    // core
    const cs = t * 0.35
    this.rings[0].rotation.z = cs
    this.rings[1].rotation.z = -cs * 0.7
    this.rings[2].rotation.y = cs * 1.3
    this.hair.rotation.z = cs * 0.2
    this.heart.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08)
    const hs = Math.max(120, camDist * 0.07)
    this.halo.scale.set(hs, hs, 1)
    this.halo.material.opacity = (0.14 + 0.7 * range(camDist, 600, 3500)) * (0.85 + 0.15 * Math.sin(t * 2.2))

    // overlay
    if (!this.dom) return
    const D = this.dom
    reveal(D.intro, band(p, -0.01, 0.0, 0.5, 0.6))
    let shown = 0
    for (const s of this.linkStarts) if (prog >= s) shown++
    if (shown !== this.linksShown) { this.linksShown = shown; D.n.textContent = String(shown).padStart(2, '0') }
    const f = (a) => smoother(range(p, a, a + 0.07))
    const back = f(0.62).toFixed(2)
    if (back !== this._back) { this._back = back; D.final.style.setProperty('--fn-back', back) }
    reveal(D.kicker, f(0.64))
    reveal(D.name, f(0.66), 24)
    reveal(D.role, f(0.69))
    reveal(D.close, f(0.71))
    D.links.forEach((l, i) => reveal(l, f(0.74 + i * 0.022), 18))
    reveal(D.hint, this.ctx.cursor.enabled ? f(0.84) : 0)
    reveal(D.foot, f(0.86))
  }

  dispose() { removeEventListener('click', this._onClick) }
}
