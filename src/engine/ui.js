import { NAV } from '../worlds/index.js'
import { damp } from '../lib/math.js'

/** Boot sequence. Every line reflects a real step the engine just completed. */
export class Loader {
  constructor() {
    this.el = document.getElementById('boot')
    this.logEl = this.el.querySelector('.boot-log')
    this.bar = this.el.querySelector('.boot-bar i')
    this.pct = this.el.querySelector('.boot-pct')
    this.t0 = performance.now()
  }
  log(key, value, status = 'ok') {
    const t = ((performance.now() - this.t0) / 1000).toFixed(3).padStart(7, ' ')
    const row = document.createElement('div')
    row.className = `bl bl-${status}`
    row.innerHTML = `<span class="bl-t">[${t}]</span><span class="bl-k">${key}</span><span class="bl-v">${value}</span><span class="bl-s">${status === 'ok' ? 'OK' : 'ERR'}</span>`
    this.logEl.appendChild(row)
    while (this.logEl.children.length > 9) this.logEl.firstChild.remove()
  }
  progress(v) {
    this.bar.style.transform = `scaleX(${v})`
    this.pct.textContent = String(Math.round(v * 100)).padStart(3, '0')
  }
  async done(instant = false) {
    if (!instant) await new Promise((r) => setTimeout(r, 450))
    this.el.classList.add('is-done')
    document.documentElement.classList.add('is-booted')
    setTimeout(() => this.el.remove(), instant ? 0 : 1600)
  }
}

/** OS-style floating navigation. Items map to the first world tagged with that nav key. */
export class Nav {
  constructor(engine) {
    this.engine = engine
    const el = document.createElement('nav')
    el.className = 'os-nav'
    el.setAttribute('aria-label', 'Primary')
    this.targets = NAV.map((key) => ({ key, index: engine.worlds.findIndex((w) => w.meta.nav === key) })).filter((t) => t.index >= 0)
    const [first = { key: 'ROHIT', index: 0 }, ...rest] = this.targets
    el.innerHTML = `
      <a class="os-mark" href="#${engine.worlds[first.index].meta.id}" data-i="${first.index}" data-magnetic="0.2">
        <span class="os-dot"></span><span class="os-name">${first.key}</span><span class="os-sub">AI ENGINEER</span>
      </a>
      <div class="os-items">${rest.map((t) => `<a href="#${engine.worlds[t.index].meta.id}" data-i="${t.index}" data-magnetic="0.25"><span>${t.key}</span></a>`).join('')}
        <span class="os-ind"></span>
      </div>`
    el.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-i]')
      if (!a) return
      e.preventDefault()
      const w = engine.worlds[+a.dataset.i]
      engine.goTo(w.meta.id, w.meta.id === 'finale' ? 1 : 0)
    })
    document.body.appendChild(el)
    this.el = el
    this.links = [...el.querySelectorAll('.os-items a')]
    this.ind = el.querySelector('.os-ind')
    this.current = -2
  }
  update(index) {
    let active = -1
    this.targets.forEach((t, i) => { if (index >= t.index) active = i })
    if (active === this.current) return
    this.current = active
    this.links.forEach((l, i) => l.classList.toggle('is-active', i === active - 1))
    const l = this.links[active - 1]
    if (l) { this.ind.style.opacity = 1; this.ind.style.transform = `translateX(${l.offsetLeft}px)`; this.ind.style.width = `${l.offsetWidth}px` }
    else this.ind.style.opacity = 0
  }
}

/** Minimal system HUD: current sector, travel through the whole system, real frame timing. */
export class Hud {
  constructor(engine) {
    this.engine = engine
    const el = document.createElement('div')
    el.className = 'hud'
    el.innerHTML = `
      <div class="hud-l">
        <div class="hud-sector"><span class="hs-code">00</span><span class="hs-sep">/</span><span class="hs-total">${String(engine.worlds.length - 1).padStart(2, '0')}</span><span class="hs-name">SYSTEM CORE</span></div>
        <div class="hud-track"><i></i></div>
      </div>
      <div class="hud-r"><span class="hud-k">FRAME</span><span class="hud-v hud-ms">--.- ms</span><span class="hud-k">STATUS</span><span class="hud-v hud-st">NOMINAL</span></div>
      <div class="hud-scroll"><span>SCROLL TO ENTER</span><i></i></div>`
    document.body.appendChild(el)
    this.el = el
    this.code = el.querySelector('.hs-code')
    this.name = el.querySelector('.hs-name')
    this.track = el.querySelector('.hud-track i')
    this.ms = el.querySelector('.hud-ms')
    this.st = el.querySelector('.hud-st')
    this.scroll = el.querySelector('.hud-scroll')
    this.last = -1; this.acc = 0; this.frameMs = 16.7; this.prog = 0
  }
  update(index, p, k, y, dt) {
    const w = this.engine.worlds[index]
    const shown = k > 0.5 ? this.engine.worlds[index + 1] : w
    if (shown && shown.meta.code !== this.last) {
      this.last = shown.meta.code
      this.code.textContent = shown.meta.code
      this.name.textContent = shown.meta.label
    }
    const max = document.documentElement.scrollHeight - innerHeight
    this.prog = damp(this.prog, max > 0 ? y / max : 0, 10, dt)
    this.track.style.transform = `scaleX(${this.prog.toFixed(4)})`
    this.frameMs = damp(this.frameMs, dt * 1000, 3, dt)
    this.acc += dt
    if (this.acc > 0.5) {
      this.acc = 0
      this.ms.textContent = `${this.frameMs.toFixed(1)} ms`
      this.st.textContent = k > 0.02 ? 'IN TRANSIT' : 'NOMINAL'
    }
    this.scroll.classList.toggle('is-hidden', y > innerHeight * 0.15)
  }
}

/**
 * Keyboard control of the whole journey.
 *   ↓ / ↑        glide forward / back (hold to keep moving)
 *   → / ←        next / previous world (← first rewinds to the start of the current one)
 *   Space, PgDn  one screen forward · Shift+Space, PgUp one screen back
 *   Home / End   system core / contact
 *   1–5          Systems, Projects, Experience, Stack, Contact · 0 back to the core
 *   ? or K       show / hide this key map · Esc closes it
 */
export class Keys {
  constructor(engine) {
    this.engine = engine
    const el = document.createElement('div')
    el.className = 'keymap'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Keyboard controls')
    const row = (k, v) => `<div class="km-row"><span class="km-k">${k}</span><span class="km-v">${v}</span></div>`
    el.innerHTML = `<div class="km-panel">
      <div class="km-head"><span>CONTROL INTERFACE</span><span class="km-x">ESC</span></div>
      ${row('<kbd>↓</kbd><kbd>↑</kbd>', 'glide forward / back · hold to keep moving')}
      ${row('<kbd>→</kbd><kbd>←</kbd>', 'next / previous world')}
      ${row('<kbd>SPACE</kbd><kbd>⇧ SPACE</kbd>', 'one screen forward / back')}
      ${row('<kbd>HOME</kbd><kbd>END</kbd>', 'system core / contact')}
      ${row('<kbd>1</kbd>–<kbd>5</kbd>', 'systems · projects · experience · stack · contact')}
      ${row('<kbd>0</kbd>', 'back to the core')}
      ${row('<kbd>M</kbd>', 'sound on / off')}
      ${row('<kbd>?</kbd>', 'show / hide this map')}
    </div>`
    document.body.appendChild(el)
    this.el = el
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.km-x')) this.toggle(false) })
    const hint = document.createElement('button')
    hint.className = 'key-hint'
    hint.type = 'button'
    hint.setAttribute('data-magnetic', '0.3')
    hint.innerHTML = '<kbd>?</kbd><span>KEYS</span>'
    hint.addEventListener('click', () => this.toggle())
    document.body.appendChild(hint)
    this.anchors = engine.nav.targets.slice(1).map((t) => t.index)
    addEventListener('keydown', (e) => this.onKey(e))
  }

  toggle(force) {
    this.open = force ?? !this.open
    this.el.classList.toggle('is-open', this.open)
  }

  scrollBy(dy, duration = 0.9) {
    const L = this.engine.lenis
    const max = document.documentElement.scrollHeight - innerHeight
    const from = L.targetScroll ?? L.animatedScroll ?? scrollY
    L.scrollTo(Math.max(0, Math.min(max, from + dy)), { duration, easing: (t) => 1 - Math.pow(1 - t, 3), force: true })
  }

  world(delta) {
    const e = this.engine, i = e.state.index
    if (delta < 0 && (e.state.p > 0.06 || e.state.k > 0)) return e.goTo(e.worlds[i].meta.id, 0)
    const j = Math.max(0, Math.min(e.worlds.length - 1, i + delta))
    e.goTo(e.worlds[j].meta.id, 0)
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    const vh = innerHeight, eng = this.engine
    let handled = true
    switch (e.key) {
      case 'ArrowDown': this.scrollBy(vh * 0.32, e.repeat ? 0.35 : 0.8); break
      case 'ArrowUp': this.scrollBy(-vh * 0.32, e.repeat ? 0.35 : 0.8); break
      case 'ArrowRight': if (!e.repeat) this.world(1); break
      case 'ArrowLeft': if (!e.repeat) this.world(-1); break
      case ' ': case 'PageDown': this.scrollBy((e.shiftKey && e.key === ' ' ? -1 : 1) * vh * 0.9, 1.1); break
      case 'PageUp': this.scrollBy(-vh * 0.9, 1.1); break
      case 'Home': eng.goTo(eng.worlds[0].meta.id, 0); break
      case 'End': { const w = eng.worlds[eng.worlds.length - 1]; eng.goTo(w.meta.id, 1); break }
      case '?': case 'k': case 'K': this.toggle(); break
      case 'Escape': if (this.open) this.toggle(false); else handled = false; break
      default:
        if (/^[0-5]$/.test(e.key)) {
          const n = +e.key
          const idx = n === 0 ? 0 : this.anchors[n - 1]
          if (idx != null) { const w = eng.worlds[idx]; eng.goTo(w.meta.id, w.meta.id === 'finale' ? 1 : 0) }
        } else handled = false
    }
    if (handled) e.preventDefault()
  }
}
