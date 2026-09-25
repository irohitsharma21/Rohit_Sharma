import { damp } from '../lib/math.js'

/**
 * Intelligent cursor: a precise dot plus an inertial ring. The ring locks onto [data-magnetic]
 * elements, and worlds can surface a holographic readout next to it via ctx.cursor.hover(text).
 * Magnetic elements drift toward the pointer with inertia.
 */
export class Cursor {
  constructor(pointer) {
    this.pointer = pointer
    this.enabled = matchMedia('(hover: hover) and (pointer: fine)').matches
    this.x = innerWidth / 2; this.y = innerHeight / 2
    this.rx = this.x; this.ry = this.y; this.scale = 1; this.targetScale = 1
    this.hoverText = null; this.hoverOwner = null
    this.magnets = new Set()
    if (!this.enabled) return
    document.documentElement.classList.add('has-cursor')
    const root = document.createElement('div')
    root.className = 'cursor'
    root.innerHTML = '<div class="cursor-ring"></div><div class="cursor-dot"></div><div class="cursor-label"><span class="cl-k"></span><span class="cl-v"></span></div>'
    document.body.appendChild(root)
    this.root = root
    this.ring = root.querySelector('.cursor-ring')
    this.dot = root.querySelector('.cursor-dot')
    this.label = root.querySelector('.cursor-label')
    this.lk = root.querySelector('.cl-k'); this.lv = root.querySelector('.cl-v')
    addEventListener('pointermove', (e) => { this.x = e.clientX; this.y = e.clientY; root.classList.remove('is-hidden') }, { passive: true })
    document.addEventListener('pointerleave', () => root.classList.add('is-hidden'))
    addEventListener('pointerdown', () => root.classList.add('is-down'))
    addEventListener('pointerup', () => root.classList.remove('is-down'))
    this.scan()
    new MutationObserver(() => this.scan()).observe(document.body, { childList: true, subtree: true })
  }

  scan() {
    document.querySelectorAll('[data-magnetic], a, button').forEach((el) => {
      if (el._mag) return
      el._mag = { x: 0, y: 0, tx: 0, ty: 0, over: false }
      this.magnets.add(el)
      el.addEventListener('pointerenter', () => { el._mag.over = true; this.root?.classList.add('is-link') })
      el.addEventListener('pointerleave', () => { el._mag.over = false; el._mag.tx = 0; el._mag.ty = 0; this.root?.classList.remove('is-link') })
    })
  }

  /**
   * Show a holographic readout by the cursor while hovering a 3D object.
   * owner lets several worlds share the cursor without clobbering each other: pass `this`.
   *   ctx.cursor.hover('NODE', 'Redis · cache', this)   ...   ctx.cursor.hover(null, null, this)
   */
  hover(key, value = '', owner = null) {
    if (!this.enabled) return
    if (key == null) {
      if (owner && this.hoverOwner !== owner) return
      if (this.hoverText !== null) { this.root.classList.remove('is-hover'); this.hoverText = null; this.hoverOwner = null }
      return
    }
    const t = key + '|' + value
    this.hoverOwner = owner
    if (t === this.hoverText) return
    this.hoverText = t
    this.lk.textContent = key; this.lv.textContent = value
    this.root.classList.add('is-hover')
  }

  update(dt) {
    if (!this.enabled) return
    this.rx = damp(this.rx, this.x, 16, dt)
    this.ry = damp(this.ry, this.y, 16, dt)
    this.dot.style.transform = `translate3d(${this.x}px,${this.y}px,0)`
    this.ring.style.transform = `translate3d(${this.rx}px,${this.ry}px,0)`
    this.label.style.transform = `translate3d(${this.rx + 22}px,${this.ry + 14}px,0)`
    for (const el of this.magnets) {
      const m = el._mag
      if (!el.isConnected) { this.magnets.delete(el); continue }
      if (m.over && el.hasAttribute('data-magnetic')) {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2 - m.x, cy = r.top + r.height / 2 - m.y
        const s = parseFloat(el.dataset.magnetic) || 0.28
        m.tx = (this.x - cx) * s; m.ty = (this.y - cy) * s
      }
      if (Math.abs(m.x - m.tx) + Math.abs(m.y - m.ty) > 0.05 || m.x || m.y) {
        m.x = damp(m.x, m.tx, 10, dt); m.y = damp(m.y, m.ty, 10, dt)
        if (Math.abs(m.x) < 0.05 && Math.abs(m.y) < 0.05 && !m.over) { m.x = m.y = 0 }
        el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`
      }
    }
  }
}
