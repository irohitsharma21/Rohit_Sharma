import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { HEX } from '../../lib/palette.js'
import { clamp, lerp, damp, smoother, smoothstep, band, range } from '../../lib/math.js'
import { reveal, readout } from '../../lib/dom.js'
import { experience } from '../../content.js'
import { X, FLOOR_Y } from './layout.js'
import { buildHardware } from './hardware.js'
import { buildSpeech, buildGlyphs, buildLattice, buildPackets, buildLanes, buildOutput, buildDust } from './signal.js'
import './style.css'

// WORLD 01 · VOICE AI
// A voice-processing chamber: a speech waveform enters from the fog and is physically transformed by each stage
//   SPEECH → STT (shredded into glyph tokens) → LLM (tokens hop through an attention lattice)
//   → TOOL CALL (tokens snap into a JSON block of packets that docks into a port)
//   → TTS (re-synthesised across 30 concurrent lanes) → RESPONSE (one expressive waveform, pitch contour visible).
// Scroll moves the camera stage to stage and advances the signal front; flow never stops.

const STAGES = [
  { id: 'speech', n: '01', name: 'SPEECH', label: 'STAGE 01 · SPEECH', x: X.speech, hover: 'raw audio in · multilingual', box: [X.speech - 3, -12, -12, X.speech + 3, 12, 12] },
  { id: 'stt', n: '02', name: 'STT', label: 'STAGE 02 · STT', x: (X.stt0 + X.stt1) / 2, hover: 'speech → text tokens · streaming', box: [X.stt0 - 1, -8.5, -5.6, X.stt1 + 1, 8.5, 5.6] },
  { id: 'llm', n: '03', name: 'LLM', label: 'STAGE 03 · LLM · INFERENCE', x: X.llm0 + 3.5 * X.llmDX, hover: 'reasoning over context · inference', box: [X.llm0 - 2.5, -9.5, -9.8, X.llm0 + 7 * X.llmDX + 2.5, 9.5, 9.8] },
  { id: 'tool', n: '04', name: 'TOOL CALL', label: 'STAGE 04 · TOOL CALL', x: 17, hover: 'structured action → enterprise workflow', box: [X.toolBed - 0.6, -4.6, -1.6, X.port1 + 0.4, 4.6, 1.6] },
  { id: 'tts', n: '05', name: 'TTS', label: 'STAGE 05 · TTS · PROSODY', x: 72, hover: 'expressive speech · controllable prosody', box: [X.tts - 1.6, -10, -3, X.lane1, 10, 3] },
  { id: 'resp', n: '06', name: 'RESPONSE', label: 'STAGE 06 · RESPONSE', x: X.resp, hover: 'streamed audio · first byte < 300 ms', box: [X.resp - 3, -12, -12, X.resp + 3, 12, 12] },
]
// p at which the camera arrives at each stage (the rail highlights the nearest)
const STAGE_P = [0.12, 0.27, 0.42, 0.58, 0.74, 0.88]

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const KEYS = [
  { p: 0.0, pos: V(-212, 30, 84), tgt: V(-112, -2, -8), fov: 40 },
  { p: 0.12, pos: V(-152, 6, 40), tgt: V(-114, 0, 0), fov: 40 },
  { p: 0.27, pos: V(-99, 3.5, 23), tgt: V(-74, 0, 0), fov: 40 },
  { p: 0.42, pos: V(-66, 7, 32), tgt: V(-27, -0.5, -2), fov: 42 },
  { p: 0.58, pos: V(-1, 5.5, 28), tgt: V(14, 0, 0), fov: 40 },
  { p: 0.74, pos: V(58, 7, 60), tgt: V(72, 0, 0), fov: 42 },
  { p: 0.88, pos: V(94, 4.5, 30), tgt: V(121, 1.5, 0), fov: 40 },
  { p: 1.0, pos: V(146, 30, 52), tgt: V(190, 0, -8), fov: 46 },
]
// Where the signal front sits for a given scroll position: it leads the camera into each stage.
const FRONT = [[0, -86], [0.17, -86], [0.24, -50], [0.33, -50], [0.4, -6], [0.5, -6], [0.55, 34], [0.66, 34], [0.72, 110], [0.81, 110], [0.88, 240]]
function frontAt(p) {
  if (p <= FRONT[0][0]) return FRONT[0][1]
  for (let i = 0; i < FRONT.length - 1; i++) {
    const [pa, a] = FRONT[i], [pb, b] = FRONT[i + 1]
    if (p <= pb) return lerp(a, b, smoother((p - pa) / (pb - pa)))
  }
  return FRONT[FRONT.length - 1][1]
}

export default class VoiceWorld extends World {
  static height = 600

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0052
    this.bloom = 0.9
    this.exposure = 1.0
    this.parallax = 0.7
  }

  async init() {
    const q = this.ctx.quality
    const U = (this.U = {
      uTime: { value: 0 }, uFront: { value: frontAt(0) }, uPtr: { value: new THREE.Vector3(0, -999, 0) }, uPtrOn: { value: 0 }, uPx: { value: 600 },
    })
    this.cPos = new THREE.CatmullRomCurve3(KEYS.map((k) => k.pos), false, 'centripetal')
    this.cTgt = new THREE.CatmullRomCurve3(KEYS.map((k) => k.tgt), false, 'centripetal')

    const hw = buildHardware(U, q)
    this.group.add(hw.group)
    this.leds = hw.leds
    this.group.add(buildSpeech(U, q))
    this.group.add(buildGlyphs(U, q))
    this.group.add(buildLattice(U, q))
    this.tool = { uCycle: { value: 0.5 }, uSlide: { value: 0 }, uAct: { value: 0 }, uTime: U.uTime }
    this.packets = buildPackets(U, this.tool)
    this.group.add(this.packets.mesh)
    this.group.add(buildLanes(U, q))
    this.group.add(buildOutput(U, q))
    this.group.add(buildDust(U, q))
    this.cyc = 0.5

    // ---- labels: stage names (bright), technical annotations (dim), a few live readouts
    this.labels = []
    const L = (text, x, y, z, o = {}) => {
      const l = new Label(text, { height: 0.5, color: HEX.smoke, align: 'center', ...o })
      l.position.set(x, y, z)
      l.userData = { base: o.opacity ?? 1, x: o.ax ?? x, face: o.face !== false }
      this.group.add(l); this.labels.push(l)
      return l
    }
    this.stageLabels = STAGES.map((s) => {
      const y = s.id === 'speech' || s.id === 'resp' ? 15.2 : s.id === 'stt' ? 8.9 : s.id === 'llm' ? 12.6 : s.id === 'tool' ? 6.4 : 11.4
      return L(s.label, s.x, y, 0, { height: 0.62, color: HEX.white, ax: s.x })
    })
    L('PCM · STREAM IN', -168, 8.6, 0, { height: 0.42 })
    L('LANG · MULTILINGUAL', X.speech, -15.4 + 1.9, 7.2, { height: 0.4, face: true })
    L('WAVEFORM → TOKENS', (X.stt0 + X.stt1) / 2, -8.4, 5.2, { height: 0.4 })
    L('TRANSCRIPT', -63, 7.4, 0, { height: 0.4, color: HEX.ice, opacity: 0.8 })
    L('L01', X.llm0, -10.6, 10, { height: 0.4 })
    L('ATTENTION', X.llm0 + 3.5 * X.llmDX, -10.6, 10, { height: 0.4 })
    L('L08', X.llm0 + 7 * X.llmDX, -10.6, 10, { height: 0.4 })
    L('{ "name": …, "arguments": { … } }', X.toolBed + 5.2, 4.45, -0.7, { height: 0.3, color: HEX.ice, opacity: 0.85 })
    L('PORT · WORKFLOW', (X.port0 + X.port1) / 2, -5.3, 1.8, { height: 0.36 })
    this.toolState = L('ASSEMBLE', X.port0 + 3.4, 4.95, 1.7, { height: 0.34, color: HEX.cyan, align: 'left', ax: X.port0 + 3 })
    L('STREAM 01', X.tts + 3.2, -8.6, 2.6, { height: 0.34 })
    L('STREAM 30', X.tts + 3.2, 8.6, 2.6, { height: 0.34 })
    L(`THROUGHPUT ${experience.metrics[0].value}`, 78, 9.4, 0, { height: 0.42, color: HEX.ice })
    this.ttfbLabel = L('TTFB 268 ms', X.tts, 11.9, 3.2, { height: 0.42, color: HEX.ice, ax: X.tts + 10 })
    L('F0 · PITCH CONTOUR', X.resp + 26, 8.6, 0, { height: 0.4, color: HEX.ice, opacity: 0.85 })
    L('AUDIO OUT · STREAMING', X.resp + 42, -5.4, 0, { height: 0.4 })

    this.boxes = STAGES.map((s) => new THREE.Box3(new THREE.Vector3(s.box[0], s.box[1], s.box[2]), new THREE.Vector3(s.box[3], s.box[4], s.box[5])))
    this._ray = new THREE.Ray(); this._hit = new THREE.Vector3(); this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); this._pp = new THREE.Vector3()
    this.hoverIdx = -1
    this.ttfb = 268; this._tt = 0
    this.front = frontAt(0)
    this.first = true
    void FLOOR_Y
  }

  mount(el) {
    const ex = experience
    el.innerHTML = `
      <div class="w-head fx vo-head">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">Voice AI</h2>
        <p class="w-lede">Speech in, speech out. A real-time pipeline where audio becomes text, text becomes reasoning, reasoning becomes action, and action becomes expressive speech again.</p>
        <div class="vo-by">${ex.title} · ${ex.company}</div>
      </div>
      <nav class="vo-rail fx" aria-label="Pipeline stages">
        ${STAGES.map((s, i) => `<div class="vo-st" data-i="${i}"><span class="vo-n">${s.n}</span><span class="vo-l">${s.name}</span><i></i></div>`).join('')}
        <b class="vo-fill"></b>
      </nav>
      <div class="vo-ros">
        <div class="vo-ro fx" data-r="speech">${readout('INPUT', 'Multilingual speech', 'dataset preparation pipeline for TTS fine-tuning')}</div>
        <div class="vo-ro fx" data-r="pipe">${readout('PIPELINE', 'STT · LLM · TTS', 'low-latency · tool calling · enterprise workflows')}</div>
        <div class="vo-ro fx" data-r="tool">${readout('ACTION', 'Tool calling', 'model output as structured calls into business workflows')}</div>
        <div class="vo-ro vo-ro-tts fx" data-r="tts">
          <div class="vo-pair">
            ${readout(ex.metrics[0].label, ex.metrics[0].value, ex.metrics[0].note)}
            ${readout(ex.metrics[1].label, ex.metrics[1].value, ex.metrics[1].note)}
          </div>
          <div class="vo-tl">
            <div class="vo-tl-k"><span>REQUEST</span><span class="vo-tl-v">FIRST AUDIO BYTE · 268 ms</span></div>
            <div class="vo-tl-bar"><i></i><b></b><u></u></div>
            <div class="vo-tl-s"><span>0</span><span>100</span><span>200</span><span>300 ms</span></div>
          </div>
          <p class="vo-note">Fine-tuned TTS · emotionally expressive · controllable prosody</p>
        </div>
        <div class="vo-ro fx" data-r="agent">${readout('IN PRODUCTION', 'Voice AI Agent', `FastAPI backend · ${ex.company} · ${ex.period}`)}</div>
      </div>`
    this.dom = {
      head: this.$('.vo-head'), rail: this.$('.vo-rail'), st: this.$$('.vo-st'), fill: this.$('.vo-fill'),
      ro: Object.fromEntries(this.$$('.vo-ro').map((e) => [e.dataset.r, e])),
      tlv: this.$('.vo-tl-v'), tlb: this.$('.vo-tl-bar i'), tlm: this.$('.vo-tl-bar b'),
    }
    this.curStage = -1
  }

  cameraAt(p, out) {
    const K = KEYS
    let i = 0
    while (i < K.length - 2 && p > K[i + 1].p) i++
    const a = K[i], b = K[i + 1]
    let t = clamp((p - a.p) / (b.p - a.p))
    t = lerp(t, smoother(t), 0.55)
    const u = (i + t) / (K.length - 1)
    this.cPos.getPoint(u, out.pos)
    this.cTgt.getPoint(u, out.target)
    let fov = lerp(a.fov, b.fov, t)
    const asp = this.ctx.camera?.aspect ?? 1.6
    if (asp < 1) fov = fov + (1 - asp) * 34
    out.fov = fov
  }

  onLeave() { this.ctx.cursor.hover(null, null, this); this.hoverIdx = -1 }

  update(p, dt, t, k = 0) {
    const U = this.U, ctx = this.ctx
    const rm = ctx.reducedMotion ? 0.35 : 1
    U.uTime.value += dt * rm
    const time = U.uTime.value

    // signal front: scroll-driven with inertia
    const ft = frontAt(p)
    this.front = this.first ? ft : damp(this.front, ft, 3.2, dt)
    this.first = false
    U.uFront.value = this.front

    // point sprite scale (pixels per world unit at distance 1)
    const cam = ctx.camera
    U.uPx.value = ctx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))

    // pointer on the signal plane
    const P = ctx.pointer
    const live = !ctx.isMobile && k === 0 && P.moved && this.pointerOnPlane(this._plane, this._pp)
    if (live) {
      const w = U.uPtr.value
      if (w.y < -900) w.copy(this._pp)
      w.x = damp(w.x, this._pp.x, 10, dt); w.y = damp(w.y, this._pp.y, 10, dt)
    }
    U.uPtrOn.value = damp(U.uPtrOn.value, live ? 1 : 0, 4, dt)

    // tool call cycle: advances only while the stage is live
    const toolAct = smoothstep(X.toolBed + 6, X.toolBed - 2, this.front)
    const liveTool = 1 - toolAct
    this.tool.uAct.value = liveTool
    this.cyc += (dt * rm * liveTool) / 5.2
    const c = (this.cyc % 1 + 1) % 1
    this.tool.uCycle.value = c
    this.tool.uSlide.value = smoother(range(c, 0.6, 0.9)) * (X.port0 - X.toolBed + 1.2)
    const docked = liveTool * band(c, 0.86, 0.9, 0.97, 1.0)
    const valid = liveTool * band(c, 0.44, 0.47, 0.55, 0.62)
    this.leds.forEach((m, i) => {
      const on = i === 0 ? liveTool * 0.5 + valid : i === 1 ? valid : docked
      const col = i === 2 ? 0x3ee6a1 : i === 1 ? 0x62d8ff : 0x2d7dff
      m.material.color.set(col).multiplyScalar(0.06 + on * 2.2)
    })
    const stateTxt = liveTool < 0.5 ? 'STANDBY' : c < 0.44 ? 'ASSEMBLE' : c < 0.6 ? 'SCHEMA · VALID' : 'DISPATCH'
    this.toolState.setText(stateTxt)

    // simulated TTFB readout (always under the 300 ms fact), refreshed ~3 Hz
    this._tt -= dt
    if (this._tt <= 0) {
      this._tt = 0.34
      this.ttfb = Math.round(clamp(this.ttfb + (Math.random() - 0.5) * 18, 236, 292))
      this.ttfbLabel.setText(`TTFB ${this.ttfb} ms`)
      if (this.dom) {
        this.dom.tlv.textContent = `FIRST AUDIO BYTE · ${this.ttfb} ms`
        this.dom.tlb.style.transform = `scaleX(${(this.ttfb / 300).toFixed(3)})`
        this.dom.tlm.style.left = `${((this.ttfb / 300) * 100).toFixed(1)}%`
      }
    }

    // labels face the camera; stage labels brighten when the signal reaches them
    for (const l of this.labels) {
      if (l.userData.face) faceCamera(l, cam)
      const a = smoothstep(this.front + 3, this.front - 7, l.userData.x)
      l.opacity = l.userData.base * (0.28 + 0.72 * a)
    }

    // hover a stage housing → cursor readout
    let hi = -1
    if (!ctx.isMobile && k === 0 && P.moved) {
      this.localRay(this._ray)
      let best = Infinity
      this.boxes.forEach((b, i) => { if (this._ray.intersectBox(b, this._hit)) { const d = this._hit.distanceToSquared(this._ray.origin); if (d < best) { best = d; hi = i } } })
    }
    if (hi !== this.hoverIdx) {
      this.hoverIdx = hi
      if (hi >= 0) ctx.cursor.hover(STAGES[hi].label, STAGES[hi].hover, this)
      else ctx.cursor.hover(null, null, this)
    }
    this.stageLabels.forEach((l, i) => { if (i === hi) l.opacity = 1 })

    // ---- overlay
    const d = this.dom
    if (!d) return
    reveal(d.head, k > 0 ? smoothstep(0.55, 1, k) : 1 - range(p, 0.05, 0.1))
    reveal(d.rail, band(p, 0.06, 0.1, 0.95, 0.99))
    reveal(d.ro.speech, band(p, 0.1, 0.13, 0.2, 0.23))
    reveal(d.ro.pipe, band(p, 0.25, 0.28, 0.47, 0.5))
    reveal(d.ro.tool, band(p, 0.53, 0.56, 0.64, 0.67))
    reveal(d.ro.tts, band(p, 0.69, 0.72, 0.82, 0.85))
    // stays up at p = 1, then clears as the page scrolls into the next world's flight
    const leaving = this.active ? this.ctx.engine.state.k : 0
    reveal(d.ro.agent, band(p, 0.87, 0.9, 1.01, 1.02) * (1 - range(leaving, 0, 0.12)))
    let cur = 0, bd = Infinity
    STAGE_P.forEach((sp, i) => { const dd = Math.abs(p - sp); if (dd < bd) { bd = dd; cur = i } })
    if (cur !== this.curStage) {
      this.curStage = cur
      d.st.forEach((e, i) => { e.classList.toggle('is-on', i === cur); e.classList.toggle('is-done', i < cur) })
    }
    const fp = clamp((p - STAGE_P[0]) / (STAGE_P[5] - STAGE_P[0]))
    if (Math.abs((this._fp ?? -1) - fp) > 0.001) { this._fp = fp; d.fill.style.transform = `scaleY(${fp.toFixed(3)})` }
  }
}
