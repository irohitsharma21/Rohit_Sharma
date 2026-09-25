import * as THREE from 'three'
import { HEX } from './palette.js'

const FONTS = { mono: '"Geist Mono", ui-monospace, monospace', sans: '"Geist", "Inter", system-ui, sans-serif' }
const _q = new THREE.Quaternion()

/**
 * Crisp text on a plane, sized in world units. Geist / Geist Mono are loaded before worlds init.
 *   const l = new Label('LATENCY 284 ms', { height: 0.6, color: HEX.cyan })
 *   l.setText('LATENCY 291 ms')   // re-rasterises; fine at ~10 Hz, don't do it every frame for many labels
 * `height` is the height of one line of text in world units. Anchor: align 'left' | 'center' | 'right'.
 */
export class Label extends THREE.Mesh {
  constructor(text, o = {}) {
    const opts = { height: 1, color: HEX.white, font: 'mono', weight: 500, tracking: 0.12, opacity: 1, align: 'left', bg: null, padding: 0.25, intensity: 1, lineHeight: 1.35, ...o }
    const canvas = document.createElement('canvas')
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.minFilter = THREE.LinearMipmapLinearFilter
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity, toneMapped: false, side: THREE.DoubleSide })
    mat.color.setScalar(opts.intensity)
    super(new THREE.PlaneGeometry(1, 1), mat)
    this.opts = opts; this.canvas = canvas; this.texture = tex; this.text = null
    this.renderOrder = 10
    this.setText(text)
  }
  setText(text) {
    text = String(text)
    if (text === this.text) return this
    this.text = text
    const o = this.opts, px = 64, lines = text.split('\n')
    const ctx = this.canvas.getContext('2d')
    const font = `${o.weight} ${px}px ${FONTS[o.font] || o.font}`
    ctx.font = font
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.tracking * px}px`
    const pad = o.bg ? o.padding * px : 4
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2)
    const lh = px * o.lineHeight
    const h = Math.ceil(lh * lines.length + pad * 2 - (lh - px))
    this.canvas.width = w; this.canvas.height = h
    ctx.font = font
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.tracking * px}px`
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w, h) }
    ctx.fillStyle = o.color; ctx.textBaseline = 'top'
    ctx.textAlign = o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : 'left'
    const x = o.align === 'center' ? w / 2 : o.align === 'right' ? w - pad : pad
    lines.forEach((l, i) => ctx.fillText(l, x, pad + i * lh + px * 0.08))
    this.texture.dispose(); this.texture.needsUpdate = true
    const scale = o.height / px
    this.scale.set(w * scale, h * scale, 1)
    this.geometry.dispose()
    const g = new THREE.PlaneGeometry(1, 1)
    g.translate(o.align === 'center' ? 0 : o.align === 'right' ? -0.5 : 0.5, 0, 0)
    this.geometry = g
    return this
  }
  set opacity(v) { this.material.opacity = v; this.visible = v > 0.002 }
  get opacity() { return this.material.opacity }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.texture.dispose() }
}

/** Rotate `obj` so it faces the camera regardless of its parents' rotation. Call per frame. */
export function faceCamera(obj, camera) {
  obj.parent.getWorldQuaternion(_q).invert()
  obj.quaternion.copy(_q).multiply(camera.quaternion)
}
