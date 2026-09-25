import * as THREE from 'three'
import { projects } from '../../content.js'
import { linkChip, tag, reveal } from '../../lib/dom.js'

const P = projects.siren

export const STAGES = [
  { key: 'VISION', sub: 'YOLOv8 · vehicle detection', a: 0.2, b: 0.45 },
  { key: 'AUDIO', sub: 'log-mel CNN · siren', a: 0.45, b: 0.6 },
  { key: 'DIRECTION', sub: 'stereo direction of arrival', a: 0.54, b: 0.68 },
  { key: 'DECISION', sub: 'safety-gated fusion', a: 0.68, b: 0.77 },
  { key: 'OUTPUT', sub: 'traffic signal preemption', a: 0.755, b: 1.01 },
]

export function overlayHTML() {
  return `
  <div class="w-head fx sr-head">
    <span class="w-code">WORLD 03</span>
    <h2 class="w-title">${P.name}</h2>
    <p class="w-lede">An intersection that sees, hears and locates an ambulance, then decides whether it should get the green.</p>
  </div>
  <ol class="sr-stages fx" aria-label="Perception pipeline">
    ${STAGES.map((s, i) => `<li data-i="${i}"><i>0${i + 1}</i><b>${s.key}</b><span>${s.sub}</span></li>`).join('')}
  </ol>
  <div class="sr-end fx">
    <span class="w-code">${P.period}</span>
    <p class="sr-full">${P.full.replace(/^Siren Eyes:\s*/, '')}</p>
    <div class="sr-links">${linkChip('GitHub', P.github)}${linkChip('Live demo', P.demo)}</div>
    <div class="sr-stack">${P.stack.map(tag).join('')}</div>
  </div>
  <canvas class="sr-boxes" aria-hidden="true"></canvas>`
}

// ---------------------------------------------------------------- detection overlay
// YOLO's output is a 2D box in image space, so the boxes are drawn exactly that way: every tracked
// vehicle's 3D extent projected through the live camera each frame, with class + confidence.
export class Boxes {
  constructor(canvas) {
    this.cv = canvas
    this.ctx = canvas.getContext('2d')
    this.v = new THREE.Vector3()
    this.cleared = true
    this.cand = []
    this.resize()
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    this.W = innerWidth; this.H = innerHeight; this.dpr = dpr
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr)
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px'
  }
  /** Screen-space bbox of an axis-aligned box (centre c, half extents hx, hy, hz), or null. */
  project(cam, cx, cy, cz, hx, hy, hz, out) {
    const v = this.v
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (let i = 0; i < 8; i++) {
      v.set(cx + (i & 1 ? hx : -hx), cy + (i & 2 ? hy : -hy), cz + (i & 4 ? hz : -hz))
      v.applyMatrix4(cam.matrixWorldInverse)
      if (v.z > -0.5) return null
      v.applyMatrix4(cam.projectionMatrix)
      const sx = (v.x + 1) / 2 * this.W, sy = (1 - v.y) / 2 * this.H
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy
    }
    if (x1 < 0 || y1 < 0 || x0 > this.W || y0 > this.H) return null
    out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1
    return out
  }
  clear() { if (!this.cleared) { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); this.cleared = true } }

  draw(cam, offset, cars, amb, alpha, lock, t, top) {
    if (alpha < 0.01) return this.clear()
    const c = this.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.cv.width, this.cv.height)
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.cleared = false
    c.font = '500 10px "Geist Mono", ui-monospace, monospace'
    c.textBaseline = 'middle'
    const camPos = cam.position
    // cars: nearest few that are on screen
    const cand = this.cand
    cand.length = 0
    const clx = camPos.x - offset.x, cly = camPos.y - offset.y, clz = camPos.z - offset.z
    for (const car of cars) {
      // buildings line both roads: a car down a street the camera is not looking along is occluded
      if (!top && cly < 30) {
        if (car.lane.dx ? (Math.abs(car.x) > 13 && Math.abs(clz) > 7.5) : (Math.abs(car.z) > 13 && Math.abs(clx) > 7.5)) continue
      }
      const wx = car.x + offset.x, wz = car.z + offset.z
      const d = Math.hypot(wx - camPos.x, wz - camPos.z)
      if (d > (top ? 220 : 95)) continue
      car._d = d
      cand.push(car)
    }
    cand.sort((a, b) => a._d - b._d)
    const box = this._b ??= { x0: 0, y0: 0, x1: 0, y1: 0 }
    let n = 0
    const q = Math.floor(t * 3)
    for (const car of cand) {
      if (n >= (top ? 30 : 11)) break
      const ln = car.lane
      const hx = ln.dx ? 2.25 : 0.95, hz = ln.dx ? 0.95 : 2.25
      if (!this.project(cam, car.x + offset.x, 0.78 + offset.y, car.z + offset.z, hx, 0.78, hz, box)) continue
      const w = box.x1 - box.x0, h = box.y1 - box.y0
      if (w < 7 || h < 5 || w > this.W * 0.5) continue
      const fade = alpha * Math.min(1, (95 - car._d) / 25 + (top ? 1 : 0))
      const conf = Math.min(0.96, car.conf + (((car.id * 7 + q) % 5) - 2) * 0.004)
      this.bracket(box, `rgba(98,216,255,${(0.62 * fade).toFixed(3)})`, 1)
      if (w > 22) this.tagText(box.x0, box.y0, `car ${conf.toFixed(2)}`, fade * 0.85, false)
      n++
    }
    // ambulance: acquisition lock
    if (amb.visible && this.project(cam, amb.x + offset.x, 1.35 + offset.y, amb.z + offset.z, 1.2, 1.35, 3.5, box)) {
      const w = box.x1 - box.x0, h = box.y1 - box.y0
      if (w > 3) {
        const grow = 1 + (1 - lock) * 1.6
        const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2
        const pad = 3
        const B = this._bb ??= {}
        B.x0 = cx - (w / 2 + pad) * grow; B.x1 = cx + (w / 2 + pad) * grow; B.y0 = cy - (h / 2 + pad) * grow; B.y1 = cy + (h / 2 + pad) * grow
        const flick = lock < 1 ? (0.55 + 0.45 * ((q % 2))) : 1
        const a = alpha * (0.35 + 0.65 * lock) * flick
        c.strokeStyle = `rgba(98,216,255,${(0.22 * a).toFixed(3)})`
        c.lineWidth = 1
        c.strokeRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0)
        this.bracket(B, `rgba(170,236,255,${(0.95 * a).toFixed(3)})`, 1.6)
        // centre ticks
        c.beginPath()
        c.moveTo(cx, B.y0 - 5); c.lineTo(cx, B.y0 + 3); c.moveTo(cx, B.y1 - 3); c.lineTo(cx, B.y1 + 5)
        c.moveTo(B.x0 - 5, cy); c.lineTo(B.x0 + 3, cy); c.moveTo(B.x1 - 3, cy); c.lineTo(B.x1 + 5, cy)
        c.stroke()
        const conf = 0.62 + 0.35 * lock
        this.tagText(B.x0, B.y0, `ambulance ${conf.toFixed(2)}`, a, true)
        if (lock > 0.99 && amb.dist != null) {
          c.fillStyle = `rgba(191,233,255,${(0.7 * a).toFixed(3)})`
          c.fillText(amb.cleared ? 'TRACK 01 · CLEARED INTERSECTION' : `TRACK 01 · ${amb.dist.toFixed(0)} m · APPROACHING`, B.x0, B.y1 + 12)
        }
      }
    }
  }
  bracket(b, style, lw) {
    const c = this.ctx
    const w = b.x1 - b.x0, h = b.y1 - b.y0
    const L = Math.max(4, Math.min(16, Math.min(w, h) * 0.26))
    c.strokeStyle = style; c.lineWidth = lw
    c.beginPath()
    c.moveTo(b.x0, b.y0 + L); c.lineTo(b.x0, b.y0); c.lineTo(b.x0 + L, b.y0)
    c.moveTo(b.x1 - L, b.y0); c.lineTo(b.x1, b.y0); c.lineTo(b.x1, b.y0 + L)
    c.moveTo(b.x1, b.y1 - L); c.lineTo(b.x1, b.y1); c.lineTo(b.x1 - L, b.y1)
    c.moveTo(b.x0 + L, b.y1); c.lineTo(b.x0, b.y1); c.lineTo(b.x0, b.y1 - L)
    c.stroke()
  }
  tagText(x, y, text, a, strong) {
    const c = this.ctx
    const w = c.measureText(text).width + 10
    if (strong) {
      c.fillStyle = `rgba(98,216,255,${(0.92 * a).toFixed(3)})`
      c.fillRect(x, y - 16, w, 14)
      c.fillStyle = `rgba(3,5,7,${a.toFixed(3)})`
      c.fillText(text, x + 5, y - 9)
    } else {
      c.fillStyle = `rgba(3,8,12,${(0.55 * a).toFixed(3)})`
      c.fillRect(x, y - 15, w, 13)
      c.fillStyle = `rgba(160,228,255,${a.toFixed(3)})`
      c.fillText(text, x + 5, y - 8.5)
    }
  }
}

export { reveal }
