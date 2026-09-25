import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label } from '../../lib/label.js'
import { chrome, graphite, smokedGlass } from '../../lib/materials.js'
import { HEX } from '../../lib/palette.js'
import { range, band, clamp, damp, lerp, smoother, smoothstep } from '../../lib/math.js'
import { reveal, tag, linkChip } from '../../lib/dom.js'
import { POINT_FRAG } from '../../lib/glsl.js'
import { projects } from '../../content.js'
import { drawTerminal, drawPanel, CMD, DESC, OUTPUT, SAVED } from './panels.js'
import './style.css'

// WORLD 07: a quiet developer workstation. One command is typed, saved, described, found and run:
// SAVE → UNDERSTAND → SEARCH → RUN. Small and precise on purpose; it must not compete with the AI worlds.

const RB = projects.runbook
const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
const QUERY = 'compose up'
const VIS1 = { a: 1, h: 1 }
const STEPS = [
  { id: 'SAVE', a: 0.05, b: 0.3, note: 'Captured from the terminal' },
  { id: 'UNDERSTAND', a: 0.3, b: 0.5, note: 'Description written for you' },
  { id: 'SEARCH', a: 0.5, b: 0.72, note: 'Found by what it does' },
  { id: 'RUN', a: 0.72, b: 1.01, note: 'Re-run in one click' },
]

// Workstation layout (group-local): the Runbook side panel sits flush left of the terminal and is angled in
// toward the operator, like a VS Code side bar next to the editor/terminal on a curved display. The floor is the desk.
const PH = 6.0 // shared pane height (both canvases are 1000 px tall, so the panes line up exactly)
const TERM = { pos: V3(2.4, 4.35, 0), rotY: 0, w: PH * 1.536, h: PH, px: [1536, 1000] }
const SIDE_ROT = 0.3
const SIDE_W = PH * 0.768
const SIDE = {
  pos: V3(TERM.pos.x - TERM.w / 2 - 0.24 - Math.cos(SIDE_ROT) * SIDE_W / 2, PH * 0 + 4.35, 0.02 + Math.sin(SIDE_ROT) * SIDE_W / 2),
  rotY: SIDE_ROT, w: SIDE_W, h: PH, px: [768, 1000],
}

// Desktop: the workstation lives right of the left-third text column; each step has one focal point.
const KEYS = [
  { p: 0.0, pos: V3(-6.4, 7.6, 23.5), tgt: V3(-3.9, 3.7, 0), fov: 38 }, // establishing: the whole desk
  { p: 0.2, pos: V3(1.0, 6.3, 15.8), tgt: V3(0.2, 3.8, 0), fov: 38 }, // SAVE: the command in the terminal
  { p: 0.42, pos: V3(-5.6, 6.0, 14.0), tgt: V3(-4.6, 4.3, 0.5), fov: 38 }, // UNDERSTAND: the new entry in the panel
  { p: 0.62, pos: V3(-5.2, 5.9, 13.6), tgt: V3(-4.4, 4.2, 0.5), fov: 38 }, // SEARCH: the search field + result
  { p: 0.84, pos: V3(-1.6, 6.2, 16.0), tgt: V3(-1.4, 3.8, 0), fov: 38 }, // RUN: the output stream
  { p: 1.0, pos: V3(-2.5, 12, 31), tgt: V3(-1.5, 5.8, -6), fov: 40 }, // exit: rise and pull away
]
// Portrait: frame one pane at a time, fully in view (w = width that must fit, d = view direction).
const KEYS_M = [
  { p: 0.0, tgt: V3(-0.2, 3.2, 0.5), d: V3(-0.12, 0.2, 1), w: 15.5 },
  { p: 0.2, tgt: V3(TERM.pos.x, 3.3, 0), d: V3(-0.05, 0.14, 1), w: TERM.w + 0.6 },
  { p: 0.42, tgt: V3(SIDE.pos.x, 3.4, SIDE.pos.z), d: V3(0.28, 0.12, 1), w: SIDE_W + 0.6 },
  { p: 0.62, tgt: V3(SIDE.pos.x, 3.4, SIDE.pos.z), d: V3(0.28, 0.12, 1), w: SIDE_W + 0.6 },
  { p: 0.84, tgt: V3(TERM.pos.x, 3.3, 0), d: V3(-0.05, 0.14, 1), w: TERM.w + 0.6 },
  { p: 1.0, tgt: V3(-0.5, 5, -6), d: V3(-0.05, 0.3, 1), w: 26 },
]
for (const k of KEYS_M) k.d.normalize()

function cr(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t
  for (const k of ['x', 'y', 'z']) out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
  return out
}

export default class RunbookWorld extends World {
  static height = 280

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.009
    this.bloom = 0.7
    this.exposure = 1.0
    this.parallax = 0.5
    this.uTime = { value: 0 }
    this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3()
    this.keyPress = { value: new THREE.Vector3(-10, -10, -10) }
  }

  async init() {
    const g = this.group
    this.term = this.pane(TERM)
    this.side = this.pane(SIDE)
    this.buildDesk(g)
    this.buildFloor(g)
    this.buildPacket(g)
    this.buildDust(g)
    this.lastTerm = ''; this.lastSide = ''
    this.redraw(0, 0, true)
  }

  pane(L) {
    const grp = new THREE.Group()
    grp.position.copy(L.pos); grp.rotation.y = L.rotY
    // backlight: a soft blue bloom behind the glass that separates it from the void
    const bl = new THREE.Mesh(new THREE.PlaneGeometry(L.w * 1.9, L.h * 1.9), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0.22 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ vec2 d = (vUv - 0.5) * vec2(1.0, 1.25); float r = length(d) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2) * uA; gl_FragColor = vec4(vec3(0.12, 0.32, 0.8) * a, 1.0); }',
    }))
    bl.position.z = -0.6
    // smoked glass slab + chrome edge
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L.w + 0.34, L.h + 0.34, 0.1), smokedGlass({ opacity: 0.55, color: 0x070b10, envMapIntensity: 0.55, roughness: 0.3, clearcoatRoughness: 0.35 }))
    slab.position.z = -0.06
    const e = 0.035, W = L.w + 0.36, H = L.h + 0.36
    const bars = [[W, e, 0, H / 2], [W, e, 0, -H / 2], [e, H, -W / 2, 0], [e, H, W / 2, 0]].map(([w, h, x, y]) => { const b = new THREE.BoxGeometry(w, h, 0.12); b.translate(x, y, -0.06); return b })
    const edge = new THREE.Mesh(mergeBoxes(bars), new THREE.MeshBasicMaterial({ color: 0x46505b }))
    // screen (canvas)
    const canvas = document.createElement('canvas'); canvas.width = L.px[0]; canvas.height = L.px[1]
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    scr.material.color.setScalar(1.08)
    scr.position.z = 0.012
    scr.renderOrder = 8
    // rim light: a hairline of cool light along the top edge, as if a soft key light grazes the glass
    const rimGeo = new THREE.BoxGeometry(W - 0.1, 0.022, 0.03); rimGeo.translate(0, H / 2 + 0.005, 0.0)
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.68, 0.9).multiplyScalar(0.62), toneMapped: false }))
    grp.add(bl, slab, edge, rim, scr)
    this.group.add(grp)
    grp.updateMatrix()
    // desk reflection: the screen mirrored in the glossy desk, fading with distance from the surface
    const refl = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.h), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { map: { value: tex }, uA: { value: 0.3 }, uB: { value: L.pos.y - L.h / 2 }, uH: { value: L.h } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float uA, uB, uH; varying vec2 vUv;
        void main(){ vec4 c = texture2D(map, vUv, 2.5); float d = uB + vUv.y * uH; float f = exp(-(d - uB) * 0.42);
          float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          vec3 frame = vec3(0.05, 0.09, 0.15) * (1.0 - smoothstep(0.0, 0.012, e));
          vec3 wash = vec3(0.012, 0.03, 0.07) * smoothstep(0.0, 0.1, e);
          gl_FragColor = vec4((c.rgb * c.a * 1.4 + frame + wash) * f * uA, 1.0); }`,
    }))
    refl.position.set(L.pos.x, -L.pos.y, L.pos.z); refl.rotation.y = L.rotY; refl.scale.y = -1
    refl.renderOrder = 1
    this.group.add(refl)
    return { grp, canvas, ctx: canvas.getContext('2d'), tex, L }
  }

  /** Group-local point on a pane from canvas uv (0..1, y down). */
  paneAt(pane, u, v, out) {
    return out.set((u - 0.5) * pane.L.w, (0.5 - v) * pane.L.h, 0.05).applyMatrix4(pane.grp.matrix)
  }

  buildDesk(g) {
    // the chrome slab: a precise keyboard-like instrument under the displays
    const slab = new THREE.Group()
    slab.position.set(TERM.pos.x - 0.9, 0.16, 4.6); slab.rotation.x = 0.03; slab.scale.setScalar(0.88)
    const body = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.22, 3.1), graphite({ color: 0x0b0d11, roughness: 0.35, envMapIntensity: 0.3 }))
    const rim = new THREE.Mesh(new THREE.BoxGeometry(9.46, 0.05, 3.16), new THREE.MeshBasicMaterial({ color: 0x3a434d }))
    rim.position.y = -0.13
    const topGeo = new THREE.PlaneGeometry(9.1, 2.8); topGeo.rotateX(-Math.PI / 2)
    const top = new THREE.Mesh(topGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uKey: this.keyPress },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uKey; varying vec2 vUv; varying vec3 vW;
        void main(){
          vec2 grid = vec2(15.0, 5.0);
          vec2 q = vUv * grid;
          vec2 id = floor(q); vec2 f = fract(q);
          // space bar row
          float space = step(id.y, 0.0) * step(4.0, id.x) * step(id.x, 10.0);
          if (space > 0.5) { f.x = (q.x - 4.0) / 7.0; }
          vec2 d = abs(f - 0.5) - vec2(0.36, 0.34);
          if (space > 0.5) d.x = abs(f.x - 0.5) - 0.48;
          float r = length(max(d, 0.0)) - 0.06;
          float fw = fwidth(r) * 1.5;
          float key = 1.0 - smoothstep(0.0, fw, r);
          float rim = (1.0 - smoothstep(0.0, fw, abs(r) - 0.01)) * key;
          vec3 col = vec3(0.012, 0.015, 0.02);
          col += vec3(0.012, 0.015, 0.02) * key;
          col += vec3(0.12, 0.15, 0.18) * rim * 0.3;
          // pressed key glow
          float age = uTime - uKey.z;
          vec2 kid = space > 0.5 ? vec2(4.0, 0.0) : id;
          float hit = step(distance(kid, uKey.xy), 0.1) * exp(-age * 5.0) * step(0.0, age);
          col += vec3(0.38, 0.85, 1.0) * hit * key * 1.6;
          // faint idle glow across the board
          col += vec3(0.1, 0.3, 0.7) * key * 0.04 * (0.5 + 0.5 * sin(uTime * 0.8 + id.x * 0.4));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }))
    top.position.y = 0.13
    slab.add(body, rim, top)
    g.add(slab)
    // thin chrome stand lines (the displays float; two hairline posts suggest structure without weight)
    const posts = []
    const feet = []
    for (const [p, rot] of [[TERM.pos, TERM.rotY], [SIDE.pos, SIDE.rotY]]) {
      const hb = p.y - PH / 2 - 0.12
      const bx = p.x - Math.sin(rot) * 0.25, bz = p.z - Math.cos(rot) * 0.25
      const b = new THREE.BoxGeometry(0.07, hb, 0.07); b.translate(bx, hb / 2, bz)
      posts.push(b)
      const f = new THREE.BoxGeometry(1.1, 0.04, 0.5); f.rotateY(rot); f.translate(bx, 0.02, bz)
      feet.push(f)
    }
    g.add(new THREE.Mesh(mergeBoxes(posts), chrome({ roughness: 0.1 })))
    g.add(new THREE.Mesh(mergeBoxes(feet), chrome({ roughness: 0.35, color: 0x4a525c })))
    // contact shadow
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ float r = length((vUv - 0.5) * vec2(1.0, 1.4)) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(1.0, 0.1, r) * 0.6); }',
    }))
    sh.rotation.x = -Math.PI / 2; sh.position.set(TERM.pos.x - 0.9, 0.012, 4.8); sh.scale.set(0.5, 0.36, 1)
    g.add(sh)
  }

  buildFloor(g) {
    const geo = new THREE.PlaneGeometry(160, 160); geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.uTime, uAct: { value: 0 }, uRun: { value: 0 } },
      fog: true,
      vertexShader: /* glsl */`
        varying vec3 vW; varying vec3 vL;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vL = position; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uAct, uRun; varying vec3 vW; varying vec3 vL;
        #include <fog_pars_fragment>
        float gridL(float c){ float w = fwidth(c); return 1.0 - smoothstep(0.0, w * 1.2, abs(fract(c - 0.5) - 0.5)); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          vec3 col = vec3(0.004, 0.005, 0.007);
          float fw = length(fwidth(vW.xz));
          float grid = max(gridL(vW.x / 2.0), gridL(vW.z / 2.0)) * (1.0 - smoothstep(0.1, 0.8, fw));
          float pool = exp(-dot(vL.xz - vec2(0.0, 2.0), vL.xz - vec2(0.0, 2.0)) * 0.006);
          col += vec3(0.02, 0.03, 0.04) * grid * pool * 0.3;
          // blurred reflections of the two displays (soft vertical streaks under each pane)
          float t1 = exp(-pow((vL.x - ${TERM.pos.x.toFixed(2)}) / 5.0, 2.0) * 2.0) * exp(-pow((vL.z - 1.4) / 3.0, 2.0));
          float t2 = exp(-pow((vL.x - ${SIDE.pos.x.toFixed(2)}) / 2.4, 2.0) * 2.0) * exp(-pow((vL.z - 2.2) / 3.0, 2.0));
          col += vec3(0.035, 0.09, 0.22) * (t1 * (0.6 + uRun * 0.5) + t2 * (0.6 + uAct * 0.6)) * (0.25 + fres * 1.5);
          col += vec3(0.24, 0.9, 0.62) * t1 * uRun * 0.05;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    })
    mat.depthWrite = false
    this.floorMat = mat
    const floor = new THREE.Mesh(geo, mat)
    floor.renderOrder = -1
    g.add(floor)
  }

  buildPacket(g) {
    const N = 14
    const geo = new THREE.BufferGeometry()
    this.pkPos = new Float32Array(N * 3)
    const aT = new Float32Array(N); for (let i = 0; i < N; i++) aT[i] = i / N
    geo.setAttribute('position', new THREE.BufferAttribute(this.pkPos, 3))
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1))
    this.pkMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 }, uPx: { value: 1 }, uCol: { value: new THREE.Color(HEX.cyan) } },
      vertexShader: 'uniform float uPx; attribute float aT; varying float vT; void main(){ vT = aT; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (1.0 - aT * 0.8) * 60.0 / max(-mv.z, 0.5); }',
      fragmentShader: `uniform float uA; uniform vec3 uCol; varying float vT; ${POINT_FRAG} void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(uCol * 2.6 * s * (1.0 - vT) * uA, 1.0); }`,
    })
    this.packet = new THREE.Points(geo, this.pkMat)
    this.packet.frustumCulled = false
    this.packet.renderOrder = 9
    g.add(this.packet)
    this.pkN = N
  }

  buildDust(g) {
    const N = this.ctx.quality === 'low' ? 250 : 600
    const pos = new Float32Array(N * 3), sd = new Float32Array(N)
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 14; pos[i * 3 + 2] = (Math.random() - 0.7) * 30; sd[i] = Math.random() }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(sd, 1))
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uTime, uPx: { value: 1 } },
      vertexShader: 'uniform float uTime, uPx; attribute float aS; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.04 + aS * 0.05), 14.0); p.x += sin(uTime * 0.1 + aS * 30.0) * 0.6; vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (1.0 + aS * 1.5) * 6.0 / max(-mv.z, 0.5); vA = smoothstep(0.0, 1.5, p.y) * smoothstep(14.0, 11.0, p.y) * (0.2 + 0.8 * fract(aS * 13.0)); }',
      fragmentShader: `varying float vA; ${POINT_FRAG} void main(){ gl_FragColor = vec4(vec3(0.6, 0.78, 1.0) * softPoint(gl_PointCoord) * vA * 0.6, 1.0); }`,
    })
    const pts = new THREE.Points(geo, this.dustMat)
    pts.frustumCulled = false
    g.add(pts)
  }

  mount(el) {
    const steps = STEPS.map((s, i) => `<li class="rb-step" data-i="${i}"><span class="rb-n">0${i + 1}</span><span class="rb-id">${s.id}</span><span class="rb-note">${s.note}</span></li>`).join('')
    el.innerHTML = `
      <div class="w-head rb-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">${RB.name}</h2>
        <p class="w-lede">${RB.bullets[0]}</p>
      </div>
      <div class="rb-links fx">
        ${tag(`OPEN SOURCE · ${RB.license}`)}
        <div class="rb-chips">${linkChip('GitHub', RB.github)}${linkChip('VS Code Marketplace', RB.marketplace)}</div>
      </div>
      <ol class="rb-steps fx">${steps}</ol>`
    this.dom = { head: this.$('.rb-head'), links: this.$('.rb-links'), steps: this.$('.rb-steps'), items: this.$$('.rb-step') }
    this._active = -1
  }

  cameraAt(p, out) {
    p = clamp(p)
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++
    const a = KEYS[i], b = KEYS[i + 1]
    const t = smoother(range(p, a.p, b.p))
    const k0 = KEYS[Math.max(0, i - 1)], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)]
    cr(k0.pos, a.pos, b.pos, k3.pos, t, out.pos)
    cr(k0.tgt, a.tgt, b.tgt, k3.tgt, t, out.target)
    const asp = this.ctx.camera.aspect
    if (asp < 1) {
      // portrait: frame the focal pane so it fits the width, pulled back along its viewing direction
      const m0 = KEYS_M[Math.max(0, i - 1)], m1 = KEYS_M[i], m2 = KEYS_M[i + 1], m3 = KEYS_M[Math.min(KEYS_M.length - 1, i + 2)]
      const fov = 50
      const w = lerp(m1.w, m2.w, t)
      const dist = (w / 2) / (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * asp)
      cr(m0.tgt, m1.tgt, m2.tgt, m3.tgt, t, out.target)
      const d = this._v.copy(m1.d).lerp(m2.d, t).normalize()
      out.pos.copy(out.target).addScaledVector(d, dist)
      out.fov = fov
      return
    }
    out.fov = lerp(a.fov, b.fov, t)
  }

  /** Scroll → UI state, then redraw the canvases only when something visible changed. */
  redraw(p, t, force = false) {
    const cursor = Math.floor(t * 2.2) % 2 === 0
    const typed = Math.floor(range(p, 0.07, 0.19) * CMD.length + 0.0001)
    const enter = p > 0.2
    const saved = range(p, 0.2, 0.23)
    const insert = range(p, 0.25, 0.3)
    const desc = Math.floor(range(p, 0.33, 0.46) * DESC.length + 0.0001)
    const qf = range(p, 0.52, 0.62) * (QUERY.length + 2.5)
    const qn = Math.min(QUERY.length, Math.floor(qf + 0.0001))
    const query = QUERY.slice(0, qn)
    const filter = range(p, 0.55, 0.66)
    const selected = range(p, 0.64, 0.68)
    this._det = smoother(range(p, 0.575, 0.615))
    const play = range(p, 0.73, 0.75) * (1 - range(p, 0.93, 0.99) * 0.6)
    const run = p > 0.76
    const out = run ? range(p, 0.78, 0.9) * OUTPUT.length : 0
    const done = range(p, 0.9, 0.93)
    const typingQuery = qn > 0 && qn < QUERY.length
    const typingCmd = typed > 0 && typed < CMD.length
    const fx = Math.round(filter * 20) / 20
    const tKey = `${typed}|${enter}|${saved.toFixed(2)}|${run}|${Math.floor(out)}|${done.toFixed(2)}|${(!enter || done > 0) && cursor}`
    const sKey = `${this._det.toFixed(2)}|${insert.toFixed(2)}|${desc}|${query}|${qf.toFixed(1)}|${selected.toFixed(2)}|${play.toFixed(2)}|${cursor && (typingQuery || (desc > 0 && desc < DESC.length))}`
    if (force || tKey !== this.lastTerm) {
      this.lastTerm = tKey
      drawTerminal(this.term.ctx, this.term.canvas.width, this.term.canvas.height, { typed, enter, saved, runCmd: run, out, done, cursor: (!enter || done > 0) && cursor })
      this.term.tex.needsUpdate = true
    }
    if (force || sKey !== this.lastSide) {
      this.lastSide = sKey
      const q = query.trim()
      const match = (it) => !q || it.cmd.includes(q)
      const matches = [CMD, ...SAVED.map((x) => x.cmd)].filter((c) => !q || c.includes(q)).length
      drawPanel(this.side.ctx, this.side.canvas.width, this.side.canvas.height, {
        insert, desc, query, matches, selected, play, cursor, typingQuery, details: this._det,
        visible: (it) => {
          // each item dissolves, then collapses, from the keystroke at which it stops matching
          let n = 1
          while (n <= QUERY.length && it.cmd.includes(QUERY.slice(0, n).trim())) n++
          if (n > QUERY.length) return VIS1
          const v = clamp((qf - n) / 2.5)
          return { a: 1 - smoother(clamp(v * 2)), h: 1 - smoother(clamp(v * 2 - 1)) }
        },
      })
      this.side.tex.needsUpdate = true
    }
    // keyboard: light a key for each typed character
    const chars = typed + qn
    if (chars !== this._chars) {
      if (this._chars != null && (typingCmd || typingQuery)) {
        const h = Math.sin(chars * 91.7) * 43758.5
        const f = h - Math.floor(h)
        this.keyPress.value.set(Math.floor(f * 15), 1 + Math.floor(((f * 7.3) % 1) * 4), t)
        if (chars % 9 === 0) this.keyPress.value.set(4, 0, t)
      }
      this._chars = chars
    }
    return { insert, run, play }
  }

  update(p, dt, t, k = 0) {
    this.uTime.value = t
    const st = this.redraw(p, t)
    const px = this.ctx.renderer.getPixelRatio() * (innerHeight / 900)
    this.pkMat.uniforms.uPx.value = px
    this.dustMat.uniforms.uPx.value = px

    // packet: terminal → panel on save, panel → terminal on run
    const saveF = range(p, 0.215, 0.27)
    const runF = range(p, 0.735, 0.785)
    let f = -1, from, to
    if (saveF > 0 && saveF < 1) { f = saveF; from = this.paneAt(this.term, 0.45, 0.22, this._a); to = this.paneAt(this.side, 0.45, 0.3, this._b) }
    else if (runF > 0 && runF < 1) { f = runF; from = this.paneAt(this.side, 0.93, 0.33, this._a); to = this.paneAt(this.term, 0.3, 0.22, this._b) }
    if (f >= 0) {
      const c = this._c.addVectors(from, to).multiplyScalar(0.5); c.z += 2.4; c.y += 0.8
      const P = this.pkPos
      for (let i = 0; i < this.pkN; i++) {
        const u = clamp(smoother(f) - i * 0.018)
        const iu = 1 - u
        P[i * 3] = iu * iu * from.x + 2 * iu * u * c.x + u * u * to.x
        P[i * 3 + 1] = iu * iu * from.y + 2 * iu * u * c.y + u * u * to.y
        P[i * 3 + 2] = iu * iu * from.z + 2 * iu * u * c.z + u * u * to.z
      }
      this.packet.geometry.attributes.position.needsUpdate = true
      this.pkMat.uniforms.uCol.value.set(runF > 0 ? HEX.green : HEX.cyan)
    }
    this.pkMat.uniforms.uA.value = f >= 0 ? Math.sin(Math.PI * f) : 0
    this.floorMat.uniforms.uAct.value = damp(this.floorMat.uniforms.uAct.value, band(p, 0.25, 0.3, 0.68, 0.74), 4, dt)
    this.floorMat.uniforms.uRun.value = damp(this.floorMat.uniforms.uRun.value, range(p, 0.78, 0.92), 4, dt)

    // overlay
    const D = this.dom
    if (!D) return
    const mobile = this.ctx.camera.aspect < 1
    reveal(D.head, Math.max(band(p, -0.01, 0.0, 0.13, 0.19), band(p, 0.92, 0.95, 0.97, 0.995)))
    reveal(D.links, band(p, -0.01, 0.02, 0.965, 0.995))
    reveal(D.steps, band(p, 0.03, 0.08, 0.94, 0.975) * (mobile ? band(p, 0.28, 0.32, 1.1, 1.2) : 1))
    let act = -1
    for (let i = 0; i < STEPS.length; i++) if (p >= STEPS[i].a && p < STEPS[i].b) act = i
    if (act !== this._active) {
      this._active = act
      D.items.forEach((el, i) => { el.classList.toggle('is-on', i === act); el.classList.toggle('is-done', act > i) })
    }
  }
}

function mergeBoxes(list) {
  const pos = [], nor = []
  for (const b of list) {
    const g = b.index ? b.toNonIndexed() : b
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return out
}
