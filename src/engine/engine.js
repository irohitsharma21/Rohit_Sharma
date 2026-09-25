import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import Lenis from 'lenis'
import { World } from './World.js'
import { createPost } from './post.js'
import { Cursor } from './cursor.js'
import { Loader, Nav, Hud, Keys } from './ui.js'
import { Soundscape } from './audio.js'
import { WORLDS, worldOffset } from '../worlds/index.js'
import * as content from '../content.js'
import { clamp, lerp, damp, smoother } from '../lib/math.js'
import { COLOR } from '../lib/palette.js'
import { Label } from '../lib/label.js'

const params = new URLSearchParams(location.search)

class OfflineWorld extends World {
  async init() {
    const l = new Label(`WORLD ${this.meta.code} · ${this.meta.title}\nOFFLINE: ${this.error?.message || 'failed to load'}`, { height: 1.4, color: '#ff4d5e', align: 'center' })
    this.group.add(l)
  }
}

export class Engine {
  constructor(root) {
    this.root = root
    this.worlds = []
    this.lastNow = performance.now()
    this.t = 0
    this.state = { index: 0, p: 0, k: 0 }
    this.pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 }
    this.camPos = new THREE.Vector3(); this.camTarget = new THREE.Vector3(); this.camFov = 42
    this.snap = true
    this.frames = 0
  }

  async boot() {
    const loader = (this.loader = new Loader())
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = matchMedia('(pointer: coarse)').matches
    const quality = params.get('q') || (coarse || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'high')

    // --- renderer ---
    const canvas = document.createElement('canvas')
    canvas.id = 'gl'
    this.root.appendChild(canvas)
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    } catch (e) {
      loader.log('webgl', 'unavailable', 'err')
      return this.fallback()
    }
    this.renderer = renderer
    this.maxDpr = quality === 'low' ? 1.25 : 1.75
    this.dpr = Math.min(devicePixelRatio || 1, this.maxDpr)
    renderer.setPixelRatio(this.dpr)
    renderer.setSize(innerWidth, innerHeight, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const gl = renderer.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl2'
    loader.log('renderer', `webgl2 · ${String(gpu).replace(/ANGLE \((.*)\)/, '$1').split(',').slice(0, 2).join(' ').slice(0, 42)}`)

    // --- fonts (3D labels rasterise text, so fonts must be ready first) ---
    await Promise.race([
      Promise.all(['500 16px "Geist Mono"', '400 16px "Geist Mono"', '300 16px "Geist"', '500 16px "Geist"', '600 16px "Geist"'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ])
    loader.log('typeface', 'geist · geist mono')
    loader.progress(0.08)

    // --- scene ---
    const scene = (this.scene = new THREE.Scene())
    scene.background = COLOR.obsidian.clone()
    scene.fog = new THREE.FogExp2(COLOR.obsidian.clone(), 0.0045)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    const camera = (this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 30000))
    scene.add(camera)
    loader.log('environment', 'pmrem studio · fog exp2')
    loader.progress(0.12)

    // --- shared context handed to every world ---
    const pointer = {
      x: 0, y: 0, sx: 0, sy: 0, vx: 0, vy: 0, speed: 0, clientX: innerWidth / 2, clientY: innerHeight / 2,
      down: false, moved: false, lastMove: 0, ray: new THREE.Ray(),
    }
    this.pointer = pointer
    this.raycaster = new THREE.Raycaster()
    addEventListener('pointermove', (e) => {
      pointer.clientX = e.clientX; pointer.clientY = e.clientY
      pointer.x = (e.clientX / innerWidth) * 2 - 1
      pointer.y = -(e.clientY / innerHeight) * 2 + 1
      pointer.moved = true; pointer.lastMove = this.t
    }, { passive: true })
    addEventListener('pointerdown', () => { pointer.down = true })
    addEventListener('pointerup', () => { pointer.down = false })
    this.cursor = new Cursor(pointer)

    this.ctx = {
      renderer, scene, camera, pointer, content, quality, reducedMotion: reduced, isMobile: coarse,
      cursor: this.cursor, env, time: 0, engine: this,
      worlds: WORLDS.map((m, i) => ({ ...m, index: i, offset: new THREE.Vector3(...worldOffset(i)) })),
      /** Smooth-scroll to a world (id) at progress p. */
      goTo: (id, p = 0) => this.goTo(id, p),
    }

    // --- worlds ---
    const only = params.get('only')
    const metas = this.ctx.worlds.filter((m) => !only || m.id === only || m.id === 'hero' && only === 'hero')
    let fetched = 0
    const tm = performance.now()
    const classes = await Promise.all(metas.map((m) => m.load().then((mod) => mod.default).catch((e) => { console.error(`[world ${m.id}] load failed`, e); const C = class extends OfflineWorld {}; C.error = e; return C }).finally(() => loader.progress(0.12 + (++fetched / metas.length) * 0.4))))
    loader.log('modules', `${metas.length} worlds fetched · ${(performance.now() - tm).toFixed(0)} ms`)
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const Cls = classes[i]
      let w
      const t0 = performance.now()
      try {
        w = new Cls(this.ctx, meta)
        await w.init()
      } catch (e) {
        console.error(`[world ${meta.id}] init failed`, e)
        w = new OfflineWorld(this.ctx, meta); w.error = e
        await w.init()
      }
      if (Cls.error) w.error = Cls.error
      w.height = Cls.height ?? World.height
      w.group.position.copy(meta.offset)
      w.group.visible = false
      scene.add(w.group)
      this.worlds.push(w)
      loader.log(`world ${meta.code}`, `${meta.title.toLowerCase()} · ${(performance.now() - t0).toFixed(0)} ms`, w instanceof OfflineWorld ? 'err' : 'ok')
      loader.progress(0.52 + (i + 1) / metas.length * 0.36)
    }

    // --- DOM ---
    this.buildDom()
    this.post = createPost(renderer, scene, camera, quality)
    this.resize()
    addEventListener('resize', () => this.resize())

    // --- warp streaks (belong to the camera, visible only in flight between worlds) ---
    this.buildWarp()

    // --- compile every shader up front so no world hitches on first sight ---
    // Only the first world the visitor will see blocks the boot; the rest compile in the
    // background right after, one world at a time, long before anyone can scroll to them.
    const w0id = params.get('w')
    const first = this.worlds.find((w) => w.meta.id === w0id) || this.worlds[0]
    await this.compileWorld(first)
    loader.log('shaders', `${first.meta.title.toLowerCase()} compiled · rest streaming`)
    loader.progress(1)

    // --- scroll ---
    this.lenis = new Lenis({ lerp: reduced ? 1 : 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4, autoRaf: false })
    history.scrollRestoration = 'manual'
    const w0 = params.get('w')
    if (w0) this.goTo(w0, parseFloat(params.get('p') || '0'), true, parseFloat(params.get('k') || '0'))
    else this.lenis.scrollTo(0, { immediate: true })

    this.running = true
    renderer.setAnimationLoop(() => this.frame())
    this.keys = new Keys(this)
    try { this.audio = new Soundscape(this) } catch (e) { console.error('[audio] unavailable', e) }
    await loader.done(params.has('w') || params.has('instant'))
    this.worlds[0]?.onBoot?.()
    window.__ready = true
    this.compileRest(first)
  }

  /** Compile one world's programs without letting it render (the group stays hidden to the frame loop). */
  async compileWorld(w) {
    if (w._compiled) return
    w._compiled = true
    const was = w.group.visible
    w.group.visible = true
    let pending
    try { pending = this.renderer.compileAsync(w.group, this.camera, this.scene) } catch { /* not fatal */ }
    w.group.visible = was
    try { await pending } catch { /* not fatal */ }
  }

  /** Background shader warm-up, nearest worlds first, yielding between worlds so frames stay smooth. */
  async compileRest(first) {
    const start = this.worlds.indexOf(first)
    const order = this.worlds.map((w, i) => [w, Math.abs(i - start) + (i < start ? 0.5 : 0)]).sort((a, b) => a[1] - b[1]).map((x) => x[0])
    for (const w of order) {
      if (w._compiled) continue
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 60)))
      await this.compileWorld(w)
    }
  }

  buildDom() {
    const main = document.createElement('main')
    main.id = 'scroll'
    this.root.appendChild(main)
    this.sections = this.worlds.map((w) => {
      const s = document.createElement('section')
      s.className = 'world'
      s.id = w.meta.id
      s.dataset.world = w.meta.id
      s.style.height = `${w.height}vh`
      const layer = document.createElement('div')
      layer.className = `world-layer wl-${w.meta.id}`
      s.appendChild(layer)
      main.appendChild(s)
      w.el = layer
      try { w.mount(layer) } catch (e) { console.error(`[world ${w.meta.id}] mount failed`, e) }
      return s
    })
    this.nav = new Nav(this)
    this.hud = new Hud(this)
  }

  // The flight between worlds travels down a data conduit: fibre lanes wrapped around the camera
  // with packets racing along them (bright head, fading tail). All motion is in the vertex shader.
  buildWarp() {
    const LANES = 30, PER = 9, N = LANES * PER
    const pos = new Float32Array(N * 2 * 3), lane = new Float32Array(N * 2 * 2), end = new Float32Array(N * 2)
    let v = 0
    for (let l = 0; l < LANES; l++) {
      const a = (l / LANES) * Math.PI * 2 + (Math.random() - 0.5) * 0.08
      const r = 10 + Math.random() * 7
      for (let j = 0; j < PER; j++) {
        const seed = Math.random(), speed = 0.6 + Math.random() * 0.8
        for (let e = 0; e < 2; e++, v++) {
          pos.set([Math.cos(a) * r, Math.sin(a) * r * 0.78, 0], v * 3)
          lane.set([seed, speed], v * 2)
          end[v] = e
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(lane, 2))
    g.setAttribute('aHead', new THREE.BufferAttribute(end, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uTravel: { value: 0 }, uLen: { value: 4 }, uAmt: { value: 0 }, uHead: { value: new THREE.Color(COLOR.ice).multiplyScalar(1.6) }, uTail: { value: new THREE.Color(COLOR.blue) } },
      vertexShader: /* glsl */`
        attribute vec2 aSeed; attribute float aHead;
        uniform float uTravel, uLen; varying float vHead; varying float vFade;
        void main(){
          float span = 220.0;
          float z = -mod(aSeed.x * span - uTravel * aSeed.y, span);
          z *= 1.0 + (1.0 - aHead) * uLen * aSeed.y; // tail length scales with depth: constant on-screen length
          vHead = aHead;
          vFade = smoothstep(-span, -span * 0.55, z) * smoothstep(-10.0, -46.0, z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uHead, uTail; uniform float uAmt; varying float vHead; varying float vFade;
        void main(){
          vec3 c = mix(uTail * 0.6, uHead, vHead * vHead);
          gl_FragColor = vec4(c, (0.08 + 0.55 * vHead) * vFade * uAmt);
        }`,
    })
    const lines = new THREE.LineSegments(g, m)
    lines.frustumCulled = false
    lines.visible = false
    lines.renderOrder = 20
    this.camera.add(lines)
    this.warp = { lines, travel: 0 }
  }

  updateWarp(strength, dt) {
    const w = this.warp
    w.lines.visible = strength > 0.01
    if (!w.lines.visible) return
    const u = w.lines.material.uniforms
    w.travel += dt * (90 + strength * 520)
    u.uTravel.value = w.travel
    u.uLen.value = 0.03 + strength * 0.16
    u.uAmt.value = Math.min(1, strength * 1.3) * (this.ctx.reducedMotion ? 0.4 : 0.85)
  }

  resize() {
    const w = innerWidth, h = innerHeight
    this.vh = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h, this.dpr)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.measure()
    this.worlds.forEach((wd) => wd.onResize?.(w, h))
  }

  measure() {
    const y0 = window.scrollY
    this.bounds = this.sections.map((s) => {
      const r = s.getBoundingClientRect()
      const start = r.top + y0
      return { start, len: r.height, hold: Math.max(1, r.height - this.vh) }
    })
  }

  goTo(id, p = 0, immediate = false, k = 0) {
    const i = this.worlds.findIndex((w) => w.meta.id === id)
    if (i < 0) return
    this.measure()
    const b = this.bounds[i]
    const y = b.start + clamp(p) * b.hold + k * this.vh
    if (immediate) { this.lenis.scrollTo(y, { immediate: true, force: true }); this.snap = true; return }
    const dist = Math.abs(y - window.scrollY) / this.vh
    this.lenis.scrollTo(y, { duration: Math.min(4.5, 1.2 + Math.sqrt(dist) * 0.55), easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), force: true })
  }

  resolveScroll(y) {
    const B = this.bounds, n = B.length
    for (let i = 0; i < n; i++) {
      const b = B[i]
      if (y < b.start + b.hold || i === n - 1) return { index: i, p: clamp((y - b.start) / b.hold), k: 0 }
      if (y < b.start + b.len) return { index: i, p: 1, k: clamp((y - b.start - b.hold) / this.vh) }
    }
    return { index: 0, p: 0, k: 0 }
  }

  poseOf(w, p, out) {
    out.fov = 42
    w.cameraAt(p, out)
    out.pos.add(w.group.position)
    out.target.add(w.group.position)
    return out
  }

  frame() {
    const now = performance.now()
    const dt = Math.min((now - this.lastNow) / 1000, 1 / 20)
    this.lastNow = now
    this.t += dt
    this.ctx.time = this.t
    this.lenis.raf(this.t * 1000)
    const y = this.lenis.animatedScroll ?? window.scrollY
    const { index, p, k } = this.resolveScroll(y)
    const cur = this.worlds[index], next = k > 0 ? this.worlds[index + 1] : null

    // active world bookkeeping
    if (this.state.index !== index || !cur.active) {
      const prev = this.worlds[this.state.index]
      if (prev && prev !== cur && prev.active) { prev.active = false; prev.onLeave() }
      cur.active = true; cur.onEnter()
    }
    this.state.index = index; this.state.p = p; this.state.k = k

    // pointer smoothing (inertia everywhere)
    const P = this.pointer
    const px = P.sx, py = P.sy
    P.sx = damp(P.sx, P.x, 5, dt); P.sy = damp(P.sy, P.y, 5, dt)
    P.vx = damp(P.vx, (P.sx - px) / Math.max(dt, 1e-3), 8, dt); P.vy = damp(P.vy, (P.sy - py) / Math.max(dt, 1e-3), 8, dt)
    P.speed = Math.hypot(P.vx, P.vy)

    // camera: world pose, or a flight between two worlds' poses
    const A = this.poseOf(cur, p, this._pa ??= { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 })
    const pose = this.pose
    let warp = 0
    if (next) {
      const Bp = this.poseOf(next, 0, this._pb ??= { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 })
      const e = smoother(k)
      const et = smoother(clamp(k * 1.35 - 0.1))
      pose.pos.lerpVectors(A.pos, Bp.pos, e)
      const dist = A.pos.distanceTo(Bp.pos)
      pose.pos.y += Math.sin(Math.PI * e) * dist * 0.06
      pose.target.lerpVectors(A.target, Bp.target, et)
      warp = Math.pow(Math.sin(Math.PI * k), 1.4)
      pose.fov = lerp(A.fov, Bp.fov, e) + warp * 16
    } else {
      pose.pos.copy(A.pos); pose.target.copy(A.target); pose.fov = A.fov
    }
    this.warpAmount = warp

    // weight: camera eases toward the pose (skipped on jumps)
    const lam = 9
    if (this.snap) { this.camPos.copy(pose.pos); this.camTarget.copy(pose.target); this.camFov = pose.fov; this.snap = false }
    else {
      this.camPos.x = damp(this.camPos.x, pose.pos.x, lam, dt); this.camPos.y = damp(this.camPos.y, pose.pos.y, lam, dt); this.camPos.z = damp(this.camPos.z, pose.pos.z, lam, dt)
      this.camTarget.x = damp(this.camTarget.x, pose.target.x, lam, dt); this.camTarget.y = damp(this.camTarget.y, pose.target.y, lam, dt); this.camTarget.z = damp(this.camTarget.z, pose.target.z, lam, dt)
      this.camFov = damp(this.camFov, pose.fov, lam, dt)
    }
    const cam = this.camera
    cam.position.copy(this.camPos)
    cam.lookAt(this.camTarget)
    // pointer parallax in the camera's own frame
    const par = (cur.parallax ?? 1) * (this.ctx.reducedMotion ? 0.3 : 1) * this.camPos.distanceTo(this.camTarget) * 0.022
    this._right ??= new THREE.Vector3(); this._up ??= new THREE.Vector3()
    this._right.setFromMatrixColumn(cam.matrix, 0); this._up.setFromMatrixColumn(cam.matrix, 1)
    cam.position.addScaledVector(this._right, P.sx * par).addScaledVector(this._up, P.sy * par)
    cam.lookAt(this.camTarget)
    if (Math.abs(cam.fov - this.camFov) > 0.01) { cam.fov = this.camFov; cam.updateProjectionMatrix() }
    cam.updateMatrixWorld()
    this.raycaster.setFromCamera({ x: P.x, y: P.y }, cam)
    P.ray.copy(this.raycaster.ray)

    // atmosphere follows the dominant world
    const fogT = next ? smoother(k) : 0
    const fog = next ? lerp(cur.fog, next.fog, fogT) : cur.fog
    this.scene.fog.density = damp(this.scene.fog.density, fog * (1 - warp * 0.3), 6, dt)
    const bloom = next ? lerp(cur.bloom, next.bloom, fogT) : cur.bloom
    this.post.bloom.strength = damp(this.post.bloom.strength, bloom + warp * 0.25, 6, dt)
    const exp = next ? lerp(cur.exposure, next.exposure, fogT) : cur.exposure
    this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, exp, 6, dt)
    this.post.lens.uniforms.uWarp.value = warp
    this.post.lens.uniforms.uTime.value = this.t
    this.updateWarp(warp, dt)

    // overlays crossfade during flights instead of scrolling over each other and the HUD
    for (let i = 0; i < this.worlds.length; i++) {
      const w = this.worlds[i]
      const o = w === cur ? 1 - smoother(clamp(k / 0.3)) : w === next ? smoother(clamp((k - 0.72) / 0.28)) : 1
      const r = Math.round(o * 1000) / 1000
      if (w._layerO !== r && w.el) { w._layerO = r; w.el.style.opacity = r; w.el.style.visibility = r <= 0 ? 'hidden' : '' }
    }

    // visibility + update
    for (let i = 0; i < this.worlds.length; i++) {
      const w = this.worlds[i]
      const vis = w === cur || w === next
      w.group.visible = vis
      if (!vis || w._dead) continue
      const wp = w === cur ? p : 0
      w.p = wp
      try { w.update(wp, dt, this.t, w === next ? k : 0) } catch (e) { console.error(`[world ${w.meta.id}] update failed`, e); w._dead = true }
    }

    this.cursor.update(dt)
    if (this.audio && !this._audioDead) { try { this.audio.update(dt) } catch (e) { console.error('[audio] update failed', e); this._audioDead = true } }
    this.hud.update(index, p, k, y, dt)
    this.nav.update(index)
    this.post.render(dt)
    this.adapt(dt)
  }

  // Resolution drops (never rises) when the device can't keep ~45 fps.
  adapt(dt) {
    this.frames++
    this._acc = (this._acc || 0) + dt
    this._n = (this._n || 0) + 1
    if (this._acc >= 2.5) {
      const avg = this._acc / this._n
      this.fps = 1 / avg
      // ignore the boot window (ignition, background shader compiles) and demand two slow windows in a row
      const warm = window.__ready && this.t > (this._adaptFrom ??= this.t + 8)
      this._slow = warm && avg > 1 / 42 ? (this._slow || 0) + 1 : 0
      if (this._slow >= 2 && this.dpr > 0.85 && !params.has('w')) {
        this._slow = 0
        this.dpr = Math.max(0.85, this.dpr - 0.25)
        this.resize()
      }
      this._acc = 0; this._n = 0
    }
  }

  fallback() {
    document.documentElement.classList.add('no-webgl')
    const p = content.profile
    const div = document.createElement('div')
    div.className = 'fallback'
    div.innerHTML = `<h1>${p.name}</h1><p class="fb-role">${p.role}</p><p>${p.tagline}</p><p>${p.summary}</p>
      <p class="fb-links">${p.links.map((l) => `<a href="${l.href}">${l.value}</a>`).join('')}</p>
      <p class="fb-note">This portfolio is a real-time 3D experience and needs WebGL 2.</p>`
    this.root.appendChild(div)
    this.loader.done(true)
  }
}
