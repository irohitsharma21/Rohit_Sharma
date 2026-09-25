// WORLD 04 · MEETAI
// A holographic conference room where a meeting is turned into work, as a physical flow through space:
// SPEECH → TRANSCRIPTION → SEMANTIC UNDERSTANDING → COMMITMENT DETECTION → ACTION → CALENDAR → MINUTES.
// Participants are abstract fresnel busts; their voices ripple across a smoked-glass table and stream (LiveKit)
// into a hub, pass the Deepgram gate and become caption strips, which dissolve into a Qdrant vector field.
// One commitment is detected, snaps into an action item, docks into a calendar, and the whole meeting condenses
// into a minutes document stored in MongoDB. Dialogue is illustrative sample data.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'
import { World } from '../../engine/World.js'
import { projects } from '../../content.js'
import { range, band, damp, smoother, easeInOut, easeOut, rng, clamp, lerp } from '../../lib/math.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { smokedGlass, graphite, chrome, glow, lineGlow } from '../../lib/materials.js'
import { Label, faceCamera } from '../../lib/label.js'
import { POINT_FRAG } from '../../lib/glsl.js'
import { reveal, readout, tag, linkChip } from '../../lib/dom.js'
import { bustGeometry, Strip, Panel, FOG_V, FOG_F, roundRect as roundRectPath } from './parts.js'
import { drawAction, drawCalendar, drawBlock, drawMinutes, calSlot, drawBriefDoc, drawCue, drawSwitch, drawContact } from './panels.js'
import './style.css'

const P = projects.meetai
const FLOOR = -3.4

// Stage boundaries in scroll progress (the flow). `n` marks capabilities that are new / in active development.
const LATEST = Object.fromEntries((P.latest || []).map((l) => [l.id, l]))
const STAGES = [
  { id: 'speech', t: 'SPEECH', d: 'LiveKit WebRTC media', a: 0.0 },
  { id: 'transcription', t: 'TRANSCRIPTION', d: 'Deepgram streaming · ~1.7 s', a: 0.11 },
  { id: 'briefing', t: 'BRIEFING', d: 'Your documents answer, privately', a: 0.235, n: true },
  { id: 'semantic', t: 'SEMANTIC', d: 'Qdrant Cloud · persistent', a: 0.335, n: true },
  { id: 'commitment', t: 'COMMITMENT', d: 'LLM pass · fallback chain', a: 0.43, n: true },
  { id: 'agent', t: 'AGENT', d: 'Personal meeting agent', a: 0.535, n: true },
  { id: 'action', t: 'ACTION', d: 'Action item extracted', a: 0.635 },
  { id: 'calendar', t: 'CALENDAR', d: 'One-click scheduling', a: 0.705 },
  { id: 'minutes', t: 'MINUTES', d: 'Summary · actions · sentiment', a: 0.805 },
]

// Station anchors (local space). The flow runs left → right, away from the table.
const HUB = new THREE.Vector3(0, 10.5, 0)
const GATE = new THREE.Vector3(18.5, 5.6, 0)
const BRIEF = new THREE.Vector3(14.6, 3.3, 0.4)
const CUE = new THREE.Vector3(7.2, 5.5, -4.6)
const FIELD = new THREE.Vector3(47, 6.2, -1.5)
const COMMIT = new THREE.Vector3(64.5, 7.2, 0.5)
const AGENT = new THREE.Vector3(79, 7.4, -3)
const CARD = new THREE.Vector3(94, 6.6, 0)
const CALP = new THREE.Vector3(110, 7, -1)
const DOC = new THREE.Vector3(132, 3.4, 1)
const DB = new THREE.Vector3(143, FLOOR, 3)

// Participants: 3 each side of the table. Names + lines are illustrative.
const PEOPLE = [
  { name: 'ANANYA', x: -10, side: -1, line: "Let's lock the Q3 launch scope today." },
  { name: 'MARCUS', x: 0, side: -1, line: 'Design review moves to Thursday.' },
  { name: 'PRIYA', x: 10, side: -1, line: "I'll send the revised deck by Friday." },
  { name: 'DEV', x: -10, side: 1, line: 'Spend stays inside the current quarter.' },
  { name: 'LENA', x: 0, side: 1, line: 'We still need two backend hires.' },
  { name: 'SAM', x: 10, side: 1, line: 'What latency did we hit in the demo?' },
]
// Transcript order → [speaker index, topic cluster]
const UTTER = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 0]]
const TOPICS = [
  { t: 'LAUNCH', c: new THREE.Vector3(-5.2, 2.2, 1.2) },
  { t: 'DESIGN', c: new THREE.Vector3(-1.5, -2.9, 2.6) },
  { t: 'DELIVERABLES', c: new THREE.Vector3(4.6, 1.6, 1.0) },
  { t: 'BUDGET', c: new THREE.Vector3(0.4, 4.4, -3.0) },
  { t: 'HIRING', c: new THREE.Vector3(4.8, -3.0, -2.6) },
]
const COMMIT_IDX = 2

// Camera keyframes [p, pos, target, fov]
const KEYS = [
  [0.0, [-31, 15.5, 35], [5, 1.5, -2], 42],
  [0.075, [-17, 8.2, 21.5], [0, 2.4, 0], 40],
  [0.16, [5, 9.5, 22], [20, 5.6, -1], 40],
  [0.225, [19, 9.8, 24], [28, 5.8, -1], 40],
  [0.29, [14.5, 14, 26.5], [19.2, 4.3, -2.2], 40],
  [0.39, [34, 9.5, 24], [47, 6, -1.5], 40],
  [0.49, [56, 9.8, 21.5], [64.5, 8.1, 0], 40],
  [0.585, [71, 9, 18], [79.5, 7.2, -3], 40],
  [0.67, [86, 8.6, 17.5], [94, 6.1, 0], 40],
  [0.765, [101.5, 9.2, 23], [110, 6.6, -1], 40],
  [0.875, [123.5, 28.5, 27.5], [128.5, 3.4, 0.6], 40],
  [1.0, [132.5, 54, 19.5], [132, 3, -0.6], 42],
]

export default class MeetAIWorld extends World {
  static height = 660

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0068
    this.bloom = 0.8
    this.exposure = 1.05
    this.parallax = 0.8
    this.low = ctx.quality === 'low'
    this.S = { uTime: { value: 0 }, uFog: { value: this.fog } }
    this.labels = []
    this.speak = new Float32Array(7)
    this.hoverI = -1
    this.hoverT = 0
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3()
    this._ray = new THREE.Ray()
    this._stage = -1
  }

  // ------------------------------------------------------------------ build
  async init() {
    const g = this.group
    this.buildCameraPath()
    this.buildRoom(g)
    this.buildTable(g)
    this.buildPeople(g)
    this.buildStreams(g)
    this.buildGate(g)
    this.buildStrips(g)
    this.buildBriefing(g)
    this.buildField(g)
    this.buildCommit(g)
    this.buildChain(g)
    this.buildAgent(g)
    this.buildCard(g)
    this.buildCalendar(g)
    this.buildMinutes(g)
    this.buildRail(g)
    this.buildDust(g)
  }

  label(text, pos, o = {}) {
    const l = new Label(text, { height: 0.3, color: HEX.chrome, tracking: 0.16, ...o })
    l.position.copy(pos)
    l.userData.face = o.face !== false
    l.userData.base = o.opacity ?? 1
    this.group.add(l)
    this.labels.push(l)
    return l
  }

  buildCameraPath() {
    this.keyP = KEYS.map((k) => k[0])
    this.posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal')
    this.tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal')
    this.keyFov = KEYS.map((k) => k[3])
  }

  buildRoom(g) {
    // floor: obsidian with a faint grid and light pools under active stations
    this.pools = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0))
    const floorMat = new THREE.ShaderMaterial({
      uniforms: { uPools: { value: this.pools }, uPoolN: { value: 0 }, uFog: this.S.uFog, uFogColor: { value: COLOR.obsidian } },
      vertexShader: /* glsl */`varying vec2 vL; ${FOG_V}
        void main(){ vL = vec2(position.x, -position.y); vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform vec4 uPools[8]; uniform int uPoolN; uniform vec3 uFogColor; varying vec2 vL; ${FOG_F}
        void main(){
          vec2 p = vL;
          vec2 q = p/2.5; vec2 gg = abs(fract(q-0.5)-0.5)/fwidth(q);
          float line = 1.0-min(min(gg.x,gg.y),1.0);
          vec2 q2 = p/12.5; vec2 g2 = abs(fract(q2-0.5)-0.5)/fwidth(q2);
          float line2 = 1.0-min(min(g2.x,g2.y),1.0);
          float pool = 0.0;
          for(int i=0;i<8;i++){ if(i>=uPoolN) break; vec4 P=uPools[i]; vec2 d=p-P.xy; pool += P.w*exp(-dot(d,d)/(P.z*P.z)); }
          float near = exp(-vFogD*0.012);
          vec3 col = vec3(0.010,0.014,0.020);
          col += vec3(0.05,0.16,0.42)*pool*0.5;
          col += vec3(0.22,0.4,0.62)*(line*0.05 + line2*0.07)*near*(0.35+pool*1.6);
          gl_FragColor = vec4(mix(uFogColor, col, fogF()), 1.0);
        }`,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 240), floorMat)
    floor.geometry.translate(60, 20, 0)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = FLOOR
    g.add(floor)
    this.floorU = floorMat.uniforms

    // walls: tall vertical light slats behind (z = -36) and at the far left, fading upward into fog
    const pos = [], col = []
    const slat = (x0, z0, x1, z1, hgt, c) => { pos.push(x0, FLOOR, z0, x1, FLOOR + hgt, z1); col.push(c, c * 1.15, c * 1.4, 0, 0, 0) }
    const r = rng(404)
    for (let x = -64; x <= 172; x += 2.4) {
      const hot = r() < 0.08 ? 2.4 : 1
      slat(x, -36, x, -36, 26 + r() * 20, 0.022 * hot + r() * 0.016)
    }
    for (let z = -34; z <= 30; z += 2.4) slat(-60, z, -60, z, 24 + r() * 16, 0.02 + r() * 0.014)
    // base lines where the walls meet the floor
    pos.push(-64, FLOOR + 0.02, -36, 172, FLOOR + 0.02, -36); col.push(0.05, 0.08, 0.12, 0.05, 0.08, 0.12)
    pos.push(-60, FLOOR + 0.02, -36, -60, FLOOR + 0.02, 32); col.push(0.04, 0.07, 0.1, 0.04, 0.07, 0.1)
    // light cove over the table, mirroring its shape (the room is built around the meeting)
    const cove = this.stadium(21, 8.5, 64)
    for (let i = 0; i < cove.length; i++) {
      const a = cove[i], b = cove[(i + 1) % cove.length]
      pos.push(a.x, 16, a.y, b.x, 16, b.y); col.push(0.035, 0.06, 0.1, 0.035, 0.06, 0.1)
    }
    const wg = new THREE.BufferGeometry()
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    wg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const walls = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    walls.frustumCulled = false
    g.add(walls)
  }

  /** Stadium (rounded-rectangle) outline points in the XZ plane (x = length, y = width). */
  stadium(hx, hz, n = 48) {
    const pts = [], rr = hz
    const cx = hx - rr
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const s = Math.cos(a) >= 0 ? 1 : -1
      pts.push(new THREE.Vector2(s * cx + Math.cos(a) * rr, Math.sin(a) * rr))
    }
    return pts
  }

  buildTable(g) {
    const shape = new THREE.Shape()
    const L = 15, Wd = 4, R = 3.4
    shape.moveTo(-L + R, -Wd); shape.lineTo(L - R, -Wd); shape.quadraticCurveTo(L, -Wd, L, -Wd + R); shape.lineTo(L, Wd - R)
    shape.quadraticCurveTo(L, Wd, L - R, Wd); shape.lineTo(-L + R, Wd); shape.quadraticCurveTo(-L, Wd, -L, Wd - R); shape.lineTo(-L, -Wd + R)
    shape.quadraticCurveTo(-L, -Wd, -L + R, -Wd)
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, curveSegments: 24 })
    geo.rotateX(Math.PI / 2)
    const top = new THREE.Mesh(geo, smokedGlass({ opacity: 0.66, color: 0x060a10, envMapIntensity: 0.2, roughness: 0.18, clearcoat: 0, specularIntensity: 0.45 }))
    top.renderOrder = 2
    g.add(top)
    // luminous edge (the table is an interface surface)
    const pts = shape.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, 0.03, p.y))
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineGlow(COLOR.ice, 0.55, 1.1))
    g.add(edge)
    const edge2 = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, -0.24, p.z))), lineGlow(COLOR.blue, 0.35, 1.0))
    g.add(edge2)
    // two graphite pedestals
    const ped = new THREE.BoxGeometry(0.5, -FLOOR - 0.3, 4.6)
    ped.translate(0, (FLOOR - 0.3) / 2, 0)
    const pm = graphite({ color: 0x1a2029 })
    for (const x of [-8.5, 8.5]) { const m = new THREE.Mesh(ped, pm); m.position.x = x; g.add(m) }
    // contact shadow on the floor
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(44, 20), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ vec2 q=(vUv-0.5)*vec2(2.0,2.0); float d=length(max(abs(q)-vec2(0.55,0.2),0.0)); gl_FragColor=vec4(0.0,0.0,0.0,0.55*smoothstep(0.45,0.0,d)); }',
    }))
    sh.rotation.x = -Math.PI / 2; sh.position.y = FLOOR + 0.01
    g.add(sh)

    // voice ripples on the glass: one plane, one ring field per participant
    this.speakPts = PEOPLE.map((p) => new THREE.Vector2(p.x, p.side * 3.1))
    const rip = new THREE.Mesh(new THREE.PlaneGeometry(31, 9), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uAmp: { value: this.speak }, uPts: { value: this.speakPts }, uFog: this.S.uFog },
      vertexShader: `varying vec2 vP; ${FOG_V} void main(){ vP=position.xy*vec2(1.0,-1.0); vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform float uAmp[7]; uniform vec2 uPts[6]; varying vec2 vP; ${FOG_F}
        void main(){
          // stadium mask so ripples stay on the glass
          vec2 q = vec2(max(abs(vP.x)-11.3,0.0), vP.y); float inside = smoothstep(4.0,3.6,length(q));
          float s = 0.0;
          for(int i=0;i<6;i++){
            float d = length(vP-uPts[i]);
            float w = fract(d*0.55 - uTime*0.9);
            float ring = smoothstep(0.0,0.05,w)*smoothstep(0.2,0.05,w);
            s += uAmp[i]*ring*exp(-d*0.32) + uAmp[i]*exp(-d*d*0.6)*0.35;
          }
          vec3 col = vec3(0.35,0.85,1.5)*s;
          gl_FragColor = vec4(col*inside*fogF(), 1.0);
        }`,
    }))
    rip.rotation.x = -Math.PI / 2; rip.position.y = 0.06; rip.renderOrder = 3
    g.add(rip)
    this.rip = rip
  }

  buildPeople(g) {
    const bg = bustGeometry()
    this.figures = []
    const holoMat = () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.S.uTime, uSpeak: { value: 0 }, uFade: { value: 1 }, uFog: this.S.uFog },
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying float vY; ${FOG_V}
        void main(){ vec4 w=modelMatrix*vec4(position,1.0); vY=position.y; vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz);
          vec4 mv=viewMatrix*w; vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime,uSpeak,uFade; varying vec3 vN; varying vec3 vV; varying float vY; ${FOG_F}
        void main(){
          float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.4);
          float scan = 0.82 + 0.18*sin(vY*42.0 - uTime*2.0);
          float band = exp(-pow((vY - mod(uTime*1.6, 5.0) + 1.2)*3.0, 2.0)) * uSpeak;
          float fade = smoothstep(-0.9, 0.5, vY);
          vec3 base = mix(vec3(0.42,0.62,0.95), vec3(0.75,0.92,1.1), f);
          vec3 col = base*(f*1.0 + 0.025) * scan * (1.0 + uSpeak*0.8) + vec3(0.4,0.9,1.6)*band*0.6;
          gl_FragColor = vec4(col*fade*uFade*fogF(), 1.0);
        }`,
    })
    const nPer = this.low ? 400 : 750
    const ptsPos = new Float32Array(nPer * 6 * 3), ptsFig = new Float32Array(nPer * 6), ptsR = new Float32Array(nPer * 6)
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(bg)).build()
    const tmp = new THREE.Vector3(), r = rng(7)
    PEOPLE.forEach((p, i) => {
      const m = new THREE.Mesh(bg, holoMat())
      m.position.set(p.x, 0, p.side * 5.35)
      m.rotation.y = p.side > 0 ? Math.PI : 0
      m.rotation.y += (p.x / 10) * -0.12 * p.side
      m.scale.setScalar(1.02 + ((i * 37) % 5) * 0.02)
      m.renderOrder = 4
      m.userData.i = i
      g.add(m); m.updateMatrix()
      this.figures.push(m)
      for (let k = 0; k < nPer; k++) {
        sampler.sample(tmp); tmp.multiplyScalar(0.985).applyMatrix4(m.matrix)
        const j = i * nPer + k
        ptsPos.set([tmp.x, tmp.y, tmp.z], j * 3); ptsFig[j] = i; ptsR[j] = r()
      }
      // seat label
      const l = this.label(p.name, new THREE.Vector3(p.x, 3.75, p.side * 5.35), { height: 0.2, color: HEX.smoke, align: 'center', tracking: 0.22 })
      l.userData.person = i
    })
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(ptsPos, 3))
    pg.setAttribute('aFig', new THREE.BufferAttribute(ptsFig, 1))
    pg.setAttribute('aR', new THREE.BufferAttribute(ptsR, 1))
    this.figPts = new THREE.Points(pg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uAmp: { value: this.speak }, uPR: { value: Math.min(devicePixelRatio, 2) }, uFade: { value: 1 }, uFog: this.S.uFog },
      vertexShader: /* glsl */`attribute float aFig; attribute float aR; uniform float uTime; uniform float uAmp[7]; uniform float uPR; uniform float uFade;
        varying float vA; varying float vY; ${FOG_V}
        void main(){
          float amp = 0.0; for(int i=0;i<6;i++){ if (abs(aFig-float(i))<0.5) amp = uAmp[i]; }
          vec3 p = position;
          float tw = 0.5+0.5*sin(uTime*(1.0+aR*2.0) + aR*40.0);
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          vFogD = -mv.z; vY = p.y;
          vA = (0.2 + 0.8*tw) * (0.22 + amp*0.8) * uFade * smoothstep(-0.8,0.4,p.y);
          gl_PointSize = (1.0 + aR*1.6) * uPR * (60.0 / -mv.z) * (1.0+amp*0.4);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */`varying float vA; varying float vY; ${FOG_F} ${POINT_FRAG}
        void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.55,0.85,1.3)*s*vA*fogF(), 1.0); }`,
    }))
    this.figPts.frustumCulled = false
    this.figPts.renderOrder = 5
    g.add(this.figPts)

    // per-participant hover captions (above the head, typed out while hovered)
    this.hoverStrips = PEOPLE.map((p) => {
      const s = new Strip(p.name, p.line, this.S, { height: 0.34 })
      s.position.set(p.x, 4.6, p.side * 5.35)
      s.opacity = 0
      g.add(s)
      return s
    })
  }

  buildStreams(g) {
    // LiveKit media streams: every participant publishes a track to the SFU hub above the table
    const geos = []
    const addTube = (curve, fig, rad = 0.028) => {
      const tg = new THREE.TubeGeometry(curve, 64, rad, 5, false)
      tg.setAttribute('aFig', new THREE.Float32BufferAttribute(new Float32Array(tg.attributes.position.count).fill(fig), 1))
      geos.push(tg)
    }
    PEOPLE.forEach((p, i) => {
      const a = new THREE.Vector3(p.x, 3.35, p.side * 5.35)
      const dir = this._v.set(p.x, 0, p.side * 5.35).normalize()
      const b = new THREE.Vector3(HUB.x + dir.x * 2.3, HUB.y, HUB.z + dir.z * 2.3)
      const c = new THREE.Vector3(p.x * 0.8, 8.5, p.side * 5.0)
      addTube(new THREE.QuadraticBezierCurve3(a, c, b), i)
    })
    // mixed stream: hub → Deepgram gate
    addTube(new THREE.CubicBezierCurve3(new THREE.Vector3(2.3, HUB.y, 0), new THREE.Vector3(9, HUB.y + 0.5, 0), new THREE.Vector3(12, GATE.y, 0), new THREE.Vector3(GATE.x + 1.2, GATE.y, 0)), 6, 0.05)
    const sg = mergeGeometries(geos)
    this.streamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uAmp: { value: this.speak }, uOn: { value: 1 }, uFog: this.S.uFog },
      vertexShader: /* glsl */`attribute float aFig; uniform float uAmp[7]; varying float vU; varying float vAmp; varying float vF; ${FOG_V}
        void main(){ vU=uv.x; vF=aFig; float a=0.0; for(int i=0;i<7;i++){ if(abs(aFig-float(i))<0.5) a=uAmp[i]; } vAmp=a;
          vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime,uOn; varying float vU; varying float vAmp; varying float vF; ${FOG_F}
        void main(){
          float speed = 0.55 + vAmp*0.5;
          float k = fract(vU*5.0 - uTime*speed - vF*0.37);
          float pk = smoothstep(0.0,0.04,k)*smoothstep(0.22,0.04,k);
          float ends = smoothstep(0.0,0.08,vU)*smoothstep(1.0,0.9,vU);
          vec3 col = vec3(0.3,0.6,1.1)*(0.10 + vAmp*0.25) + vec3(0.5,1.2,2.0)*pk*(0.15 + vAmp*1.4);
          gl_FragColor = vec4(col*ends*uOn*fogF(), 1.0);
        }`,
    })
    const streams = new THREE.Mesh(sg, this.streamMat)
    streams.frustumCulled = false
    streams.renderOrder = 5
    g.add(streams)

    // SFU hub: a chrome ring with a lit inner track
    const hub = new THREE.Group(); hub.position.copy(HUB)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.07, 12, 96), chrome({ roughness: 0.22, envMapIntensity: 0.6 }))
    ring.rotation.x = Math.PI / 2
    hub.add(ring)
    const inner = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.018, 6, 96), glow(COLOR.cyan, 1.6))
    inner.rotation.x = Math.PI / 2
    hub.add(inner)
    this.hubInner = inner
    g.add(hub)
    this.hubLabels = [this.label('LIVEKIT · WEBRTC SFU', new THREE.Vector3(HUB.x, HUB.y + 0.95, 0), { align: 'center', color: HEX.ice, height: 0.24 }),
      this.label('01  SPEECH', new THREE.Vector3(HUB.x, HUB.y + 1.55, 0), { align: 'center', color: HEX.cyan, height: 0.22 }),
      this.label('MEDIA TRACKS · 6', new THREE.Vector3(HUB.x, HUB.y - 0.85, 0), { align: 'center', color: HEX.smoke, height: 0.2 })]
  }

  buildGate(g) {
    // Deepgram: the streaming transcription gate the mixed audio passes through
    const gate = new THREE.Group(); gate.position.copy(GATE); gate.rotation.y = 1.0
    const outer = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.08, 14, 120), chrome({ roughness: 0.22, envMapIntensity: 0.6 }))
    gate.add(outer)
    const outer2 = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.02, 6, 120), graphite({ color: 0x2a323d }))
    gate.add(outer2)
    this.gateFilm = new THREE.Mesh(new THREE.CircleGeometry(2.9, 96), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.S.uTime, uOn: { value: 0 }, uFog: this.S.uFog },
      vertexShader: `varying vec2 vUv; ${FOG_V} void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime,uOn; varying vec2 vUv; ${FOG_F}
        void main(){
          vec2 q=(vUv-0.5)*2.0; float r=length(q);
          // audio waveform on the left half resolves into discrete "token" dashes on the right
          float wave = 0.14*sin(q.x*9.0 - uTime*5.0)*sin(q.x*3.1 + uTime*1.3) * smoothstep(0.2,-0.6,q.x);
          float wl = smoothstep(0.035,0.0,abs(q.y-wave)) * smoothstep(0.25,-0.1,q.x);
          float dash = step(0.5, fract(q.x*7.0 - uTime*1.4)) * smoothstep(0.03,0.0,abs(q.y)) * smoothstep(-0.1,0.25,q.x);
          float rim = smoothstep(0.9,1.0,r)*0.25;
          float body = (1.0-r)*0.06;
          vec3 col = vec3(0.35,0.8,1.5)*(wl*1.2 + dash*1.0 + rim + body);
          gl_FragColor = vec4(col*smoothstep(1.0,0.97,r)*uOn*fogF(), 1.0);
        }`,
    }))
    gate.add(this.gateFilm)
    g.add(gate)
    this.gate = gate
    this.label('02  TRANSCRIPTION', new THREE.Vector3(GATE.x - 0.9, GATE.y + 4.1, 0), { align: 'center', color: HEX.cyan, height: 0.22 })
    this.label('DEEPGRAM · STREAMING STT', new THREE.Vector3(GATE.x - 0.9, GATE.y + 3.6, 0), { align: 'center', color: HEX.ice, height: 0.3 })
    this.latLabel = this.label('LATENCY ~1.7 s', new THREE.Vector3(GATE.x, GATE.y - 3.75, 0), { align: 'center', color: HEX.smoke, height: 0.24 })
  }

  buildStrips(g) {
    this.strips = UTTER.map(([pi, topic], i) => {
      const p = PEOPLE[pi]
      const s = new Strip(p.name, p.line, this.S, { height: 0.42, hi: i === COMMIT_IDX ? ["I'll send", 'revised deck', 'by Friday'] : i === 5 ? ['latency'] : null })
      const w = s.baseScale.x
      s.userData.home = new THREE.Vector3(20.9 + w / 2 + (i % 2) * 0.4, 8.75 - i * 0.94, -i * 0.25)
      s.userData.topic = topic
      s.userData.target = FIELD.clone().add(TOPICS[topic].c)
      s.opacity = 0
      g.add(s)
      return s
    })
  }

  buildField(g) {
    const N = this.low ? 2200 : 4200
    const home = new Float32Array(N * 3), tgt = new Float32Array(N * 3), rnd = new Float32Array(N * 4), cl = new Float32Array(N)
    const r = rng(1234)
    const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += r(); return (u - 2) / 2 }
    for (let i = 0; i < N; i++) {
      // loose uniform cloud → topic clusters
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = Math.cbrt(r()) * 9
      const s = Math.sqrt(1 - u * u)
      home.set([Math.cos(th) * s * rad * 1.25, u * rad * 0.8, Math.sin(th) * s * rad * 0.9], i * 3)
      const c = i % 7 === 0 ? -1 : Math.floor(r() * 5) // a few points stay as unclustered background
      cl[i] = c
      if (c < 0) tgt.set([home[i * 3] * 1.1, home[i * 3 + 1] * 1.1, home[i * 3 + 2] * 1.1], i * 3)
      else { const C = TOPICS[c].c, sp = 1.25; tgt.set([C.x + gauss() * sp, C.y + gauss() * sp, C.z + gauss() * sp], i * 3) }
      rnd.set([r(), r(), r(), r()], i * 4)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(home, 3))
    geo.setAttribute('aTgt', new THREE.BufferAttribute(tgt, 3))
    geo.setAttribute('aR', new THREE.BufferAttribute(rnd, 4))
    geo.setAttribute('aC', new THREE.BufferAttribute(cl, 1))
    this.fieldU = {
      uTime: this.S.uTime, uFog: this.S.uFog, uCluster: { value: 0 }, uOn: { value: 0 }, uHiC: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) },
      uRayO: { value: new THREE.Vector3() }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uPtr: { value: 0 }, uDim: { value: 1 },
    }
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.fieldU,
      vertexShader: /* glsl */`attribute vec3 aTgt; attribute vec4 aR; attribute float aC;
        uniform float uTime,uCluster,uOn,uHiC,uPR,uPtr,uDim; uniform vec3 uRayO,uRayD;
        varying vec3 vCol; varying float vA; ${FOG_V}
        void main(){
          float k = smoothstep(aR.x*0.35, 0.65+aR.x*0.35, uCluster);
          vec3 p = mix(position, aTgt, k);
          float t = uTime*0.35;
          p += vec3(sin(t+aR.y*6.28), cos(t*0.8+aR.z*6.28), sin(t*0.7+aR.w*6.28)) * (0.32 - 0.18*k);
          // pointer: points part around the ray
          vec3 w = (modelMatrix*vec4(p,1.0)).xyz;
          vec3 d = w - uRayO; vec3 cp = uRayO + uRayD*max(dot(d,uRayD),0.0); vec3 away = w - cp; float dl = length(away);
          float push = uPtr * smoothstep(3.2, 0.0, dl);
          w += (away/max(dl,1e-3)) * push * 1.6;
          bool hc = abs(aC-2.0)<0.5;
          float hi = hc ? uHiC : 0.0;
          vec3 base = mix(vec3(0.62,0.82,1.0), vec3(0.2,0.45,1.0), aR.w);
          if (aC < -0.5) base *= 0.5;
          vCol = base*(0.55 + 0.5*k)*(1.0 - hi*0.3) + vec3(0.2,0.55,0.9)*hi*0.35 + vec3(0.5,1.0,1.4)*push*0.5;
          vA = uOn * (0.35 + 0.65*step(0.93, aR.y) + 0.3*k) * mix(1.0, hc ? 0.8 : 0.4, uHiC) * uDim * (1.0 - 0.45*k*step(-0.5,aC));
          vec4 mv = viewMatrix*vec4(w,1.0);
          vFogD = -mv.z;
          gl_PointSize = (1.2 + aR.z*2.2 + step(0.97,aR.y)*2.0) * uPR * (70.0 / -mv.z) * (1.0 + hi*0.25);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */`varying vec3 vCol; varying float vA; ${FOG_F} ${POINT_FRAG}
        void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vCol*s*vA*fogF(), 1.0); }`,
    }))
    pts.position.copy(FIELD)
    pts.frustumCulled = false
    pts.renderOrder = 6
    g.add(pts)
    this.field = pts
    this.topicLabels = TOPICS.map((tp) => this.label(tp.t, FIELD.clone().add(tp.c).add(this._v.set(0, 2.1, 0)), { align: 'center', color: HEX.ice, height: 0.26, tracking: 0.24 }))
    this.fieldHeads = [this.label('04  SEMANTIC UNDERSTANDING', FIELD.clone().add(this._v.set(0, 8.4, 0)), { align: 'center', color: HEX.cyan, height: 0.22 }),
      this.label('QDRANT CLOUD · PERSISTENT', FIELD.clone().add(this._v.set(0, 7.85, 0)), { align: 'center', color: HEX.ice, height: 0.3 })]
    this.fieldHint = this.label('UTTERANCES + DOCUMENTS · CLUSTERED BY TOPIC', FIELD.clone().add(this._v.set(0, -7.2, 0)), { align: 'center', color: HEX.smoke, height: 0.22 })
  }

  buildCommit(g) {
    // scanning brackets around the detected utterance
    const b = []
    const cs = 0.7
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      b.push(sx, sy, 0, sx - sx * cs * 0.4, sy, 0, sx, sy, 0, sx, sy - sy * cs, 0)
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(b, 3))
    this.brackets = new THREE.LineSegments(bg, lineGlow(COLOR.cyan, 0, 2.2))
    this.brackets.position.copy(COMMIT)
    this.brackets.renderOrder = 13
    g.add(this.brackets)
    this.commitHead = this.label('05  COMMITMENT DETECTION', COMMIT.clone().add(this._v.set(0, 2.25, 0)), { align: 'center', color: HEX.cyan, height: 0.22 })
    this.commitLlm = this.label('LLM PASS · PER UTTERANCE', COMMIT.clone().add(this._v.set(0, 1.75, 0)), { align: 'center', color: HEX.ice, height: 0.3 })
    const tagDefs = [['OWNER', 'PRIYA'], ['ACTION', 'SEND REVISED DECK'], ['DUE', 'FRIDAY']]
    this.tags = tagDefs.map(([k, v]) => this.label(`${k}  ·  ${v}`, new THREE.Vector3(), { align: 'center', color: HEX.white, height: 0.3, bg: 'rgba(10,18,26,0.7)', padding: 0.5 }))
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3))
    this.connectors = new THREE.LineSegments(cg, lineGlow(COLOR.cyan, 0, 1.4))
    this.connectors.frustumCulled = false
    g.add(this.connectors)
  }

  buildCard(g) {
    this.card = new Panel(7.6, 4.3, 512, drawAction, this.S, { renderOrder: 14 })
    this.card.position.copy(CARD)
    this.card.opacity = 0
    g.add(this.card)
    this.cardHead = this.label('07  ACTION', CARD.clone().add(this._v.set(0, 2.75, 0)), { align: 'center', color: HEX.cyan, height: 0.22 })
  }

  buildCalendar(g) {
    const W = 16, H = 10.5
    this.cal = new Panel(W, H, 1024, drawCalendar, this.S, { dir: 0, renderOrder: 7 })
    this.cal.position.copy(CALP)
    this.cal.rotation.y = -0.16
    this.cal.opacity = 0
    g.add(this.cal)
    // FRI 10:00 slot in calendar-local coords
    const s = calSlot(4, 1)
    this.slotLocal = new THREE.Vector3((s.u - 0.5) * W, (0.5 - s.v) * H, 0.06)
    this.slotSize = new THREE.Vector2(s.w * W * 0.92, s.h * H * 0.84)
    this.block = new Panel(1, 0.3, 256, drawBlock, this.S, { renderOrder: 15, gain: 1.35 })
    this.block.opacity = 0
    g.add(this.block)
    this.calHead = this.label('08  CALENDAR', CALP.clone().add(this._v.set(0, H / 2 + 1.0, 0)), { align: 'center', color: HEX.cyan, height: 0.22 })
    this.calOne = this.label('ONE-CLICK SCHEDULING', CALP.clone().add(this._v.set(0, H / 2 + 0.5, 0)), { align: 'center', color: HEX.ice, height: 0.3 })
    this.calDone = this.label('FRI 10:00 · SCHEDULED', new THREE.Vector3(), { align: 'left', color: HEX.cyan, height: 0.24 })
  }

  buildMinutes(g) {
    this.doc = new Panel(15, 20, 1600, drawMinutes, this.S, { renderOrder: 9, gain: 1.15 })
    this.doc.position.copy(DOC)
    this.doc.rotation.x = -1.22
    this.doc.opacity = 0
    g.add(this.doc)
    this.docHead = this.label('09  MEETING MINUTES', DOC.clone().add(this._v.set(-7.4, 4.3, -9.2)), { align: 'left', color: HEX.cyan, height: 0.3, face: true })

    // MongoDB: minutes persisted (a light column into the floor, beside the document)
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 11, 8, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uOn: { value: 0 }, uFog: this.S.uFog },
      vertexShader: `varying float vY; ${FOG_V} void main(){ vY=uv.y; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uTime,uOn; varying float vY; ${FOG_F} void main(){ float k=fract(vY*3.0+uTime*0.9); float pk=smoothstep(0.0,0.05,k)*smoothstep(0.25,0.05,k); vec3 c=vec3(0.4,0.9,1.6)*(0.25+pk*1.4)*smoothstep(1.0,0.6,vY); gl_FragColor=vec4(c*uOn*fogF(),1.0); }`,
    }))
    col.position.set(DB.x, FLOOR + 5.5, DB.z)
    this.dbCol = col
    g.add(col)
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), glow(COLOR.cyan, 1.4, { transparent: true, opacity: 0, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2; disc.position.set(DB.x, FLOOR + 0.03, DB.z)
    this.dbDisc = disc
    g.add(disc)
    const disc2 = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.53, 64), glow(COLOR.ice, 0.9, { transparent: true, opacity: 0, depthWrite: false }))
    disc2.rotation.x = -Math.PI / 2; disc2.position.set(DB.x, FLOOR + 0.03, DB.z)
    this.dbDisc2 = disc2
    g.add(disc2)
    this.dbLabel = this.label('MONGODB · MINUTES STORED', new THREE.Vector3(DB.x, FLOOR + 11.8, DB.z), { align: 'center', color: HEX.ice, height: 0.34 })
    // connector from the document edge to the column
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(DOC.x + 7.6, DOC.y, DOC.z), new THREE.Vector3(DB.x - 0.1, DOC.y, DB.z)])
    this.dbLink = new THREE.Line(lg, lineGlow(COLOR.cyan, 0, 1.4))
    g.add(this.dbLink)

    // condensation: the whole meeting flows into the document
    const N = this.low ? 400 : 800
    const st = new Float32Array(N * 3), en = new Float32Array(N * 3), rr = new Float32Array(N * 4)
    const r = rng(99)
    const srcs = [FIELD, COMMIT, AGENT, CARD, CALP, GATE.clone().setX(28)]
    const docN = new THREE.Matrix4().makeRotationX(-1.22)
    for (let i = 0; i < N; i++) {
      const s = srcs[Math.floor(r() * srcs.length)]
      st.set([s.x + (r() - 0.5) * 10, s.y + (r() - 0.5) * 6, s.z + (r() - 0.5) * 5], i * 3)
      const e = this._v.set((r() - 0.5) * 14, (r() - 0.5) * 19, 0.05).applyMatrix4(docN).add(DOC)
      en.set([e.x, e.y, e.z], i * 3)
      rr.set([r(), r(), r(), r()], i * 4)
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(st, 3))
    cg.setAttribute('aEnd', new THREE.BufferAttribute(en, 3))
    cg.setAttribute('aR', new THREE.BufferAttribute(rr, 4))
    this.condU = { uC: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) }, uFog: this.S.uFog }
    const cp = new THREE.Points(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.condU,
      vertexShader: /* glsl */`attribute vec3 aEnd; attribute vec4 aR; uniform float uC,uPR; varying float vA; ${FOG_V}
        void main(){
          float t = clamp((uC - aR.x*0.45)/0.55, 0.0, 1.0); t = t*t*(3.0-2.0*t);
          vec3 m = mix(position, aEnd, 0.5) + vec3(0.0, 5.0 + aR.y*7.0, (aR.z-0.5)*6.0);
          vec3 p = mix(mix(position,m,t), mix(m,aEnd,t), t);
          vA = sin(3.14159*t) * step(0.001,t);
          vec4 mv = modelViewMatrix*vec4(p,1.0); vFogD=-mv.z;
          gl_PointSize = (1.5+aR.w*2.0)*uPR*(70.0/-mv.z);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `varying float vA; ${FOG_F} ${POINT_FRAG} void main(){ float s=softPoint(gl_PointCoord); gl_FragColor=vec4(vec3(0.5,1.0,1.6)*s*vA*fogF(),1.0); }`,
    }))
    cp.frustumCulled = false
    cp.renderOrder = 16
    g.add(cp)
    this.cond = cp
  }

  // ------------------------------------------------------------------ latest capabilities
  buildBriefing(g) {
    const B = LATEST.briefing || { formats: ['PDF', 'PPTX', 'DOCX', 'TXT', 'MD'], example: { answer: 'latency is 350 ms', source: 'Slide 3' } }
    // the uploaded document hovers over the end of the table
    this.brief = new Panel(3.0, 3.9, 512, drawBriefDoc(B.formats), this.S, { renderOrder: 11 })
    this.brief.position.copy(BRIEF)
    g.add(this.brief)
    this.briefHead = this.label('03  BRIEFING CUES · NEW', BRIEF.clone().add(this._v.set(0, 2.55, 0)), { align: 'center', color: HEX.cyan, height: 0.2 })
    // private cue: a panel only Priya sees, joined to her by a thin privacy cone
    this.cue = new Panel(4.4, 2.2, 400, drawCue(B.example), this.S, { renderOrder: 13 })
    this.cue.position.copy(CUE)
    this.cue.opacity = 0
    g.add(this.cue)
    const head = new THREE.Vector3(PEOPLE[2].x, 2.75, PEOPLE[2].side * 5.35)
    const apex = CUE.clone().add(this._v.set(0.9, -1.0, 0))
    const len = apex.distanceTo(head)
    const cg = new THREE.ConeGeometry(1.05, len, 40, 1, true)
    cg.translate(0, -len / 2, 0) // apex at origin, base toward the head
    this.cone = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOn: { value: 0 }, uTime: this.S.uTime, uFog: this.S.uFog },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_V} void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); vec4 mv=viewMatrix*w; vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uOn,uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_F} void main(){ float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.0); float flow=0.6+0.4*sin(vUv.y*30.0+uTime*4.0); vec3 c=vec3(0.35,0.8,1.4)*(f*0.9+0.07)*flow*(0.35+0.65*vUv.y); gl_FragColor=vec4(c*uOn*fogF(),1.0); }`,
    }))
    this.cone.position.copy(apex)
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), head.clone().sub(apex).normalize())
    this.cone.frustumCulled = false
    g.add(this.cone)
    this.cueLabel = this.label('PRIVATE · PRIYA ONLY', head.clone().add(this._v.set(0, 1.35, 0.9)), { align: 'center', color: HEX.ice, height: 0.18 })
    // match beams: question strip → document → private cue
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
    this.match = new THREE.LineSegments(mg, lineGlow(COLOR.cyan, 0, 1.8))
    this.match.frustumCulled = false
    g.add(this.match)
  }

  buildChain(g) {
    const F = LATEST.fallback || { providers: ['Cerebras', 'Gemini', 'OpenRouter', 'Groq'] }
    this.chainPos = F.providers.map((_, i) => COMMIT.clone().add(new THREE.Vector3(-5.4 + i * 3.6, 3.9, -1.2)))
    this.chainCores = []
    this.chainNodes = []
    const tor = new THREE.TorusGeometry(0.42, 0.05, 10, 48), disc = new THREE.CircleGeometry(0.27, 32)
    const cm = chrome({ roughness: 0.22, envMapIntensity: 0.6 })
    this.chainLabels = F.providers.map((name, i) => {
      const n = new THREE.Mesh(tor, cm); n.position.copy(this.chainPos[i]); g.add(n)
      this.chainNodes.push(n)
      const c = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.16, 0.24), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      c.position.copy(this.chainPos[i]); g.add(c)
      this.chainCores.push(c)
      return this.label(name.toUpperCase(), this.chainPos[i].clone().add(this._v.set(0, -0.78, 0)), { align: 'center', color: HEX.chrome, height: 0.18 })
    })
    const lp = []
    for (let i = 0; i < 3; i++) { const a = this.chainPos[i], b = this.chainPos[i + 1]; lp.push(a.x + 0.46, a.y, a.z, b.x - 0.46, b.y, b.z) }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3))
    this.chainLinks = new THREE.LineSegments(lg, lineGlow(COLOR.blue, 0, 1.2))
    g.add(this.chainLinks)
    this.pulse = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), glow(COLOR.ice, 3, { transparent: true, depthWrite: false }))
    g.add(this.pulse)
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    this.chainBeam = new THREE.Line(bg, lineGlow(COLOR.cyan, 0, 1.8))
    this.chainBeam.frustumCulled = false
    g.add(this.chainBeam)
    this.chainHead = this.label('AI FALLBACK CHAIN · NEW', COMMIT.clone().add(this._v.set(0, 5.05, -1.2)), { align: 'center', color: HEX.ice, height: 0.22 })
    this.chainFail = this.label('FAILOVER →', this.chainPos[0].clone().lerp(this.chainPos[1], 0.5).add(this._v.set(0, 0.32, 0)), { align: 'center', color: HEX.red, height: 0.15 })
  }

  buildAgent(g) {
    const A = LATEST.agent || { wake: 'Hey MeetAI, send my contact details to Rohit', tools: ['send contact card', 'share snippets', 'email documents', 'draft emails', 'save notes'], modes: ['ASK FIRST', 'JUST DO IT'] }
    const grp = new THREE.Group(); grp.position.copy(AGENT); grp.rotation.y = -0.32
    this.agentGrp = grp
    grp.add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.065, 14, 128), chrome({ roughness: 0.3, envMapIntensity: 0.28, color: 0x9aa6b4 })))
    this.agentRing = new THREE.Mesh(new THREE.TorusGeometry(2.28, 0.016, 6, 128), glow(COLOR.cyan, 1.2))
    grp.add(this.agentRing)
    // core: a small gimbal that spins up when the wake phrase is heard
    const gim = new THREE.Group()
    const gt = new THREE.TorusGeometry(0.55, 0.035, 8, 64)
    const gm = chrome({ roughness: 0.2, envMapIntensity: 0.6 })
    const g1 = new THREE.Mesh(gt, gm), g2 = new THREE.Mesh(gt, gm); g2.rotation.y = Math.PI / 2
    gim.add(g1, g2)
    this.agentCore = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), glow(COLOR.cyan, 1, { transparent: true, depthWrite: false }))
    grp.add(gim, this.agentCore)
    this.gimbal = gim
    g.add(grp)
    grp.updateMatrix()
    // enabled tools (illustrative per-tool settings); only enabled ones light
    const mode = ['JUST DO IT', 'ASK FIRST', 'OFF', 'ASK FIRST', 'JUST DO IT']
    this.toolLabels = A.tools.map((tool, i) => {
      const a = 0.95 - i * 0.475
      const pos = new THREE.Vector3(Math.cos(a) * 3.05, Math.sin(a) * 3.05, 0).applyMatrix4(grp.matrix)
      const on = mode[i] !== 'OFF'
      const l = this.label(`${on ? '●' : '○'} ${tool.toUpperCase()}  ·  ${mode[i]}`, pos, { align: 'left', color: on ? HEX.ice : HEX.smoke, height: 0.2 })
      l.userData.on = on
      return l
    })
    this.toolLink = new THREE.Line(new THREE.BufferGeometry().setFromPoints([AGENT.clone(), this.toolLabels[0].position.clone()]), lineGlow(COLOR.cyan, 0, 1.6))
    g.add(this.toolLink)
    // permission switch for the tool being used
    this.sw = new Panel(3.6, 1.05, 256, drawSwitch(A.tools[0], A.modes), this.S, { renderOrder: 14 })
    this.sw.position.copy(this._v.set(2.6, -3.75, 0).applyMatrix4(grp.matrix))
    this.sw.opacity = 0
    g.add(this.sw)
    this.knob = new Panel(1.72, 0.54, 128, (x, W, H) => {
      x.fillStyle = 'rgba(98,216,255,0.28)'; roundRectPath(x, 3, 3, W - 6, H - 6, (H - 6) / 2); x.fill()
      x.strokeStyle = 'rgba(190,240,255,0.95)'; x.lineWidth = 4; roundRectPath(x, 3, 3, W - 6, H - 6, (H - 6) / 2); x.stroke()
    }, this.S, { additive: true, renderOrder: 15 })
    this.knob.opacity = 0
    g.add(this.knob)
    // the wake phrase, as heard
    this.wake = new Strip('LENA', A.wake, this.S, { height: 0.46, hi: ['Hey MeetAI'] })
    this.wake.opacity = 0
    g.add(this.wake)
    // the contact card that gets emailed
    this.contact = new Panel(2.8, 1.75, 256, drawContact, this.S, { renderOrder: 16 })
    this.contact.opacity = 0
    g.add(this.contact)
    this.agentHead = this.label('06  PERSONAL MEETING AGENT · NEW', AGENT.clone().add(this._v.set(0, 3.45, 0)), { align: 'center', color: HEX.cyan, height: 0.2 })
    this.agentSent = this.label('EMAILED → ROHIT', new THREE.Vector3(), { align: 'left', color: HEX.cyan, height: 0.22 })
    this.agentOnly = this.label('ONLY ENABLED TOOLS RUN', AGENT.clone().add(this._v.set(-2.6, -3.3, 0)), { align: 'center', color: HEX.smoke, height: 0.18 })
  }

  buildRail(g) {
    // the flow's backbone: a lit channel on the floor from the table to the database
    const pts = [[13, 0], [18.5, 0.6], [28, 2.4], [40, 3.6], [47, 3.4], [56, 2.2], [64.5, 2.4], [72, 2.0], [79, 0.6], [86, 2.2], [94, 2.5], [102, 2.6], [110, 3.4], [119, 6.5], [125, 13.2], [134, 14.2], [141, 10], [143, 3]]
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, FLOOR + 0.02, z)), false, 'centripetal')
    this.railCurve = curve
    const n = 400, w = 1.8
    const pos = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2), idx = []
    const T = new THREE.Vector3(), Nn = new THREE.Vector3(), Pp = new THREE.Vector3()
    for (let i = 0; i <= n; i++) {
      const u = i / n
      curve.getPointAt(u, Pp); curve.getTangentAt(u, T)
      Nn.set(-T.z, 0, T.x).normalize()
      pos.set([Pp.x + Nn.x * w, Pp.y, Pp.z + Nn.z * w, Pp.x - Nn.x * w, Pp.y, Pp.z - Nn.z * w], i * 6)
      uv.set([u, 0, u, 1], i * 4)
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx)
    this.railU = { uTime: this.S.uTime, uFill: { value: 0 }, uFog: this.S.uFog, uLen: { value: curve.getLength() } }
    const rail = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.railU,
      vertexShader: `varying vec2 vUv; ${FOG_V} void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform float uTime,uFill,uLen; varying vec2 vUv; ${FOG_F}
        void main(){
          float x = abs(vUv.y-0.5)*2.0;
          float core = exp(-x*x*260.0);
          float halo = exp(-x*x*9.0);
          float s = vUv.x*uLen;
          float lit = smoothstep(uFill+0.004, uFill-0.01, vUv.x);
          float pk = smoothstep(0.0,0.02,fract(s*0.07 - uTime*0.45))*smoothstep(0.14,0.02,fract(s*0.07 - uTime*0.45));
          float head = exp(-pow((vUv.x-uFill)*uLen*0.35,2.0));
          vec3 c = vec3(0.2,0.45,0.9)*(core*0.35 + halo*0.05)
                 + vec3(0.4,0.9,1.6)*lit*(core*(0.3+pk*1.1) + halo*0.05)
                 + vec3(0.5,1.1,1.9)*head*(core*0.9 + halo*0.08);
          gl_FragColor = vec4(c*fogF(), 1.0);
        }`,
    }))
    rail.frustumCulled = false
    rail.renderOrder = 1
    g.add(rail)
    // risers: light lines from the rail up into each station, lit as the flow reaches it
    const st = [[GATE, GATE.y - 2.6], [FIELD, FIELD.y - 2.6], [COMMIT, COMMIT.y - 2.6], [AGENT, AGENT.y - 3.3], [CARD, CARD.y - 2.6], [CALP, CALP.y - 5.3], [DOC, null]]
    this.riserU = new Float32Array(7)
    const rp = [], ra = []
    st.forEach(([s, top], i) => {
      const u = this.closestU(s)
      const b = curve.getPointAt(u, new THREE.Vector3())
      if (top == null) rp.push(b.x, b.y, b.z, b.x, b.y + 1.2, b.z); else rp.push(b.x, b.y, b.z, s.x, top, s.z)
      ra.push(i, 0, i, 1)
      s.userData = { u }
    })
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
    rg.setAttribute('aI', new THREE.Float32BufferAttribute(ra, 2))
    this.risers = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uOn: { value: this.riserU }, uTime: this.S.uTime, uFog: this.S.uFog },
      vertexShader: `attribute vec2 aI; uniform float uOn[7]; varying float vA; varying float vT; ${FOG_V} void main(){ float o=0.0; for(int i=0;i<7;i++){ if(abs(aI.x-float(i))<0.5) o=uOn[i]; } vA=o; vT=aI.y; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uTime; varying float vA; varying float vT; ${FOG_F} void main(){ float k=fract(vT*2.0-uTime*0.8); float pk=smoothstep(0.0,0.1,k)*smoothstep(0.35,0.1,k); gl_FragColor=vec4(vec3(0.4,0.85,1.5)*vA*(0.35+pk)*fogF()*smoothstep(1.0,0.7,vT),1.0); }`,
    }))
    this.risers.frustumCulled = false
    g.add(this.risers)
  }

  closestU(v) {
    let best = 0, bd = Infinity
    for (let i = 0; i <= 200; i++) { const u = i / 200; const d = this.railCurve.getPointAt(u, this._v2).distanceToSquared(this._v3.set(v.x, FLOOR, v.z)); if (d < bd) { bd = d; best = u } }
    return best
  }

  buildDust(g) {
    const N = this.low ? 500 : 1000
    const pos = new Float32Array(N * 3), rr = new Float32Array(N)
    const r = rng(55)
    for (let i = 0; i < N; i++) { pos.set([-40 + r() * 200, FLOOR + r() * 26, -30 + r() * 55], i * 3); rr[i] = r() }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aR', new THREE.BufferAttribute(rr, 1))
    const d = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.S.uTime, uFog: this.S.uFog, uPR: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: `attribute float aR; uniform float uTime,uPR; varying float vA; ${FOG_V} void main(){ vec3 p=position; p.y+=sin(uTime*0.2+aR*30.0)*0.6; p.x+=cos(uTime*0.13+aR*20.0)*0.8; vec4 mv=modelViewMatrix*vec4(p,1.0); vFogD=-mv.z; vA=0.25+0.5*aR; gl_PointSize=(0.8+aR*1.4)*uPR*(40.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; ${FOG_F} ${POINT_FRAG} void main(){ gl_FragColor=vec4(vec3(0.5,0.7,0.95)*softPoint(gl_PointCoord)*vA*fogF(),1.0); }`,
    }))
    d.frustumCulled = false
    g.add(d)
  }

  // ------------------------------------------------------------------ overlay
  mount(el) {
    this.el = el
    const latest = (P.latest || []).map((l) => l.label).join(' · ')
    el.innerHTML = `
      <div class="w-head fx mx-head">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">${P.name}</h2>
        <p class="w-lede">A Meet-grade call on LiveKit WebRTC that listens, transcribes, and turns what people commit to into scheduled work.</p>
      </div>
      <ol class="mx-flow fx" aria-label="MeetAI pipeline">
        ${STAGES.map((s, i) => `<li data-i="${i}"><span class="mx-n">${String(i + 1).padStart(2, '0')}</span><span class="mx-t">${s.t}${s.n ? '<i class="mx-new">NEW</i>' : ''}</span><span class="mx-d">${s.d}</span></li>`).join('')}
      </ol>
      <div class="mx-end fx">
        ${readout('Transcription', P.metrics[0].value, P.metrics[0].note)}
        <p class="mx-full">${P.full.replace('MeetAI: ', '')}</p>
        ${latest ? `<p class="mx-latest"><span>LATEST</span>${latest}</p>` : ''}
        <div class="mx-links interactive">${linkChip('GitHub', P.github)}${linkChip('Live demo', P.demo)}</div>
        <div class="mx-tags">${P.stack.map(tag).join('')}</div>
      </div>`
    this.$head = this.$('.mx-head'); this.$flow = this.$('.mx-flow'); this.$end = this.$('.mx-end')
    this.$items = this.$$('.mx-flow li')
  }

  // ------------------------------------------------------------------ camera
  cameraAt(p, out) {
    const K = this.keyP
    let i = 0
    while (i < K.length - 2 && p > K[i + 1]) i++
    const t = easeInOut(clamp((p - K[i]) / (K[i + 1] - K[i])))
    const u = (i + t) / (K.length - 1)
    this.posCurve.getPoint(u, out.pos)
    this.tgtCurve.getPoint(u, out.target)
    out.fov = lerp(this.keyFov[i], this.keyFov[i + 1], t)
    const asp = this.ctx.camera.aspect
    if (asp < 1) {
      // portrait: widen and step back a little so strips and panels stay in frame
      out.fov *= 1 + (1 - asp) * 0.55
      this._cv ??= new THREE.Vector3()
      this._cv.subVectors(out.pos, out.target).multiplyScalar(1 + (1 - asp) * 0.45)
      out.pos.copy(out.target).add(this._cv)
      // keep the minutes above the end overlay on tall screens
      const e = range(p, 0.86, 1) * 9
      out.target.z += e; out.pos.z += e
    }
  }

  // ------------------------------------------------------------------ update
  update(p, dt, t, k) {
    this.S.uTime.value = t
    this.S.uFog.value = this.ctx.scene.fog?.density ?? this.fog
    const cam = this.ctx.camera
    this._right ??= new THREE.Vector3(); this._up ??= new THREE.Vector3()
    this._right.set(1, 0, 0).applyQuaternion(cam.quaternion); this._up.set(0, 1, 0).applyQuaternion(cam.quaternion)

    // --- speaking ---
    // autoplay conversation during the speech stage; scroll-linked speaker while their caption is typed
    const sSpeech = band(p, -1, 0, 0.16, 0.24)
    const sTrans = range(p, 0.1, 0.13)
    const cyc = t / 2.4, cur = Math.floor(cyc) % 6, ph = cyc - Math.floor(cyc)
    const auto = Math.sin(Math.PI * clamp(ph * 1.15)) ** 2
    this.hoverT = this.hoverI >= 0 ? Math.min(1, this.hoverT + dt * 0.9) : 0
    let mix = 0
    for (let i = 0; i < 6; i++) {
      let a = (i === cur ? auto : 0) * sSpeech * (1 - sTrans * 0.6)
      for (let j = 0; j < UTTER.length; j++) {
        if (UTTER[j][0] !== i) continue
        const a0 = 0.125 + j * 0.017
        a = Math.max(a, band(p, a0 - 0.005, a0, a0 + 0.017, a0 + 0.024) * 0.95)
      }
      if (i === this.hoverI) a = Math.max(a, 0.6 + 0.4 * Math.sin(t * 9) ** 2)
      this.speak[i] = damp(this.speak[i], a, 8, dt)
      mix = Math.max(mix, this.speak[i])
      this.figures[i].material.uniforms.uSpeak.value = this.speak[i]
    }
    this.speak[6] = damp(this.speak[6], Math.max(mix, range(p, 0.09, 0.12) * band(p, 0, 0.08, 0.22, 0.25)) * 0.9 + 0.1, 6, dt)
    const roomFade = 1 - range(p, 0.42, 0.55) * 0.7
    for (const f of this.figures) f.material.uniforms.uFade.value = roomFade
    this.figPts.material.uniforms.uFade.value = roomFade
    this.figPts.visible = p < 0.62
    this.rip.visible = p < 0.5
    this.hubInner.material.color.setRGB(0.38, 0.85, 1).multiplyScalar(1.0 + this.speak[6] * 1.4)

    { const o = 1 - range(p, 0.085, 0.115); for (const l of this.hubLabels) l.opacity = o }
    // --- gate ---
    this.gateFilm.material.uniforms.uOn.value = 0.35 + 0.65 * band(p, 0.07, 0.12, 0.23, 0.28)
    this.gate.rotation.z = t * 0.05

    // --- caption strips ---
    for (let i = 0; i < this.strips.length; i++) {
      const s = this.strips[i], U = s.u, home = s.userData.home, tg = s.userData.target
      const a0 = 0.125 + i * 0.017
      U.uReveal.value = range(p, a0, a0 + 0.022)
      const tr = easeInOut(range(p, 0.335 + i * 0.01, 0.385 + i * 0.01))
      let op = range(p, a0 - 0.004, a0 + 0.002)
      let sc = 1 - tr * 0.72
      s.position.lerpVectors(home, tg, tr)
      s.position.y += Math.sin(Math.PI * tr) * 2.2
      let dis = range(tr, 0.35, 1.0)
      if (i === COMMIT_IDX) {
        dis = Math.min(dis, 0.6)
        // re-emerges from the field, detected
        const e = easeInOut(range(p, 0.43, 0.47))
        if (e > 0) {
          s.position.lerpVectors(tg, COMMIT, e)
          s.position.y += Math.sin(Math.PI * e) * 1.4
          sc = lerp(sc, 1.08, e)
          dis = lerp(0.6, 0, range(e, 0, 0.7))
        }
        // collapses into the action card (arcing over the agent)
        const f = easeInOut(range(p, 0.635, 0.672))
        if (f > 0) {
          s.position.lerpVectors(COMMIT, CARD, f)
          s.position.y += Math.sin(Math.PI * f) * 2.2
          sc = lerp(1.08, 0.4, f)
          op *= 1 - range(f, 0.6, 0.95)
        }
        U.uHi.value = range(p, 0.5, 0.52)
        U.uScan.value = p > 0.492 && p < 0.52 ? lerp(-0.05, 1.05, range(p, 0.494, 0.516)) : -1
      } else if (i === 5) {
        // the question the briefing document answers
        U.uHi.value = band(p, 0.255, 0.265, 0.32, 0.34)
        U.uScan.value = p > 0.25 && p < 0.268 ? lerp(-0.05, 1.05, range(p, 0.251, 0.266)) : -1
        op *= 1 - range(tr, 0.85, 1)
      } else {
        op *= (1 - range(tr, 0.85, 1)) * (1 - 0.6 * band(p, 0.25, 0.265, 0.325, 0.345))
      }
      U.uDissolve.value = dis
      s.scale.copy(s.baseScale).multiplyScalar(Math.max(sc, 0.001))
      s.opacity = op
      s.quaternion.copy(cam.quaternion)
    }

    // --- briefing: the uploaded document answers Sam's question, privately, for Priya ---
    const bOn = band(p, -1, 0, 0.36, 0.41)
    const dock = easeInOut(range(p, 0.35, 0.405))
    this.brief.position.copy(BRIEF).lerp(this._v.copy(FIELD).add(this._v2.set(-1.5, -4.8, 2.6)), dock)
    this.brief.position.y += Math.sin(t * 0.8) * 0.06 * (1 - dock) + Math.sin(Math.PI * dock) * 3
    this.brief.scale.setScalar(lerp(1, 0.25, dock))
    this.brief.quaternion.copy(cam.quaternion)
    this.brief.opacity = bOn * (0.55 + 0.45 * band(p, 0.235, 0.26, 0.33, 0.36)) * (1 - range(dock, 0.7, 1))
    this.brief.u.uGlow.value = band(p, 0.262, 0.27, 0.285, 0.3) * 1.2
    this.briefHead.opacity = band(p, 0.235, 0.255, 0.33, 0.35)
    const cueOn = band(p, 0.283, 0.295, 0.33, 0.35)
    this.cue.opacity = cueOn
    this.cue.scale.setScalar(0.85 + 0.15 * easeOut(range(p, 0.283, 0.295)))
    this.cue.u.uReveal.value = easeOut(range(p, 0.285, 0.3))
    this.cue.quaternion.copy(cam.quaternion)
    this.cone.material.uniforms.uOn.value = cueOn
    this.cueLabel.opacity = cueOn * 0.9
    // match beams grow: question → document, then document → cue
    const q = this.strips[5]
    const m1 = range(p, 0.262, 0.274), m2 = range(p, 0.274, 0.286)
    const mfade = 1 - range(p, 0.3, 0.32)
    const mp = this.match.geometry.attributes.position
    this._v.copy(q.position).addScaledVector(this._right, -q.scale.x * 0.5)
    this._v2.lerpVectors(this._v, this.brief.position, m1)
    mp.setXYZ(0, this._v.x, this._v.y, this._v.z); mp.setXYZ(1, this._v2.x, this._v2.y, this._v2.z)
    this._v3.copy(CUE).addScaledVector(this._right, 2.2).addScaledVector(this._up, -0.4)
    this._v2.lerpVectors(this.brief.position, this._v3, m2)
    mp.setXYZ(2, this.brief.position.x, this.brief.position.y, this.brief.position.z); mp.setXYZ(3, this._v2.x, this._v2.y, this._v2.z)
    mp.needsUpdate = true
    this.match.material.opacity = (m1 > 0 ? 0.85 : 0) * mfade

    // --- vector field (Qdrant Cloud) ---
    const fOn = range(p, 0.18, 0.27) * (1 - range(p, 0.88, 0.96) * 0.85)
    this.fieldU.uOn.value = fOn
    this.field.visible = fOn > 0.002
    for (const l of this.fieldHeads) l.opacity = band(p, 0.2, 0.3, 0.6, 0.66)
    this.fieldU.uCluster.value = easeInOut(range(p, 0.345, 0.425))
    this.fieldU.uHiC.value = band(p, 0.42, 0.435, 0.5, 0.56)
    this.fieldU.uDim.value = 1 - range(p, 0.5, 0.6) * 0.5
    const ptrActive = this.active && p > 0.3 && p < 0.52 && !this.ctx.isMobile
    this.fieldU.uPtr.value = damp(this.fieldU.uPtr.value, ptrActive ? 1 : 0, 4, dt)
    if (ptrActive) {
      const ray = this.ctx.pointer.ray
      this.fieldU.uRayO.value.lerp(ray.origin, 1 - Math.exp(-10 * dt))
      this.fieldU.uRayD.value.lerp(ray.direction, 1 - Math.exp(-10 * dt)).normalize()
    }
    for (let i = 0; i < this.topicLabels.length; i++) {
      this.topicLabels[i].opacity = band(p, 0.39 + i * 0.007, 0.42 + i * 0.007, 0.56, 0.62) * (i === 2 ? 1 : 1 - this.fieldU.uHiC.value * 0.5)
    }

    // --- commitment + fallback chain ---
    const bs = this.strips[COMMIT_IDX]
    const br = band(p, 0.492, 0.515, 0.535, 0.55)
    this.brackets.material.opacity = br * 0.9
    const pulse = 1 + (1 - range(p, 0.492, 0.515)) * 0.25
    this.brackets.scale.set(bs.scale.x * 0.5 + 0.5, bs.scale.y * 0.5 + 0.45, 1).multiplyScalar(pulse)
    this.brackets.position.copy(bs.position)
    this.brackets.quaternion.copy(cam.quaternion)
    const cpos = this.connectors.geometry.attributes.position
    const tagsOn = band(p, 0.51, 0.52, 0.535, 0.55)
    const tagX = [-0.34, 0.02, 0.36]
    const collapse = easeInOut(range(p, 0.632, 0.662))
    for (let i = 0; i < 3; i++) {
      const tl = this.tags[i]
      tl.opacity = band(p, 0.51 + i * 0.005, 0.52 + i * 0.005, 0.535, 0.55)
      const sx = bs.spanX(i) * bs.scale.x
      this._v.copy(bs.position).addScaledVector(this._right, sx).addScaledVector(this._up, -bs.scale.y * 0.5)
      this._v2.copy(bs.position).addScaledVector(this._right, tagX[i] * 14).addScaledVector(this._up, -2.1 - (i === 1 ? 0.45 : 0))
      this._v2.lerp(CARD, collapse)
      tl.position.copy(this._v2)
      cpos.setXYZ(i * 2, this._v.x, this._v.y, this._v.z)
      cpos.setXYZ(i * 2 + 1, this._v2.x, this._v2.y + 0.3, this._v2.z)
    }
    cpos.needsUpdate = true
    this.connectors.material.opacity = tagsOn * 0.7
    this.commitHead.opacity = band(p, 0.465, 0.485, 0.535, 0.55)
    this.commitLlm.opacity = this.commitHead.opacity
    this.commitHead.position.copy(bs.position).addScaledVector(this._up, 1.75)
    this.commitLlm.position.copy(bs.position).addScaledVector(this._up, 1.25)
    // chain: request tries Cerebras → fails (red flicker) → reroutes to Gemini → answers into the strip
    const chOn = band(p, 0.44, 0.46, 0.535, 0.55)
    const c = range(p, 0.455, 0.505)
    for (const n of this.chainNodes) n.visible = chOn > 0.01
    for (const l of this.chainLabels) l.opacity = chOn * 0.85
    this.chainHead.opacity = chOn
    this.chainLinks.material.opacity = chOn * 0.5
    const fail = band(c, 0.2, 0.24, 0.4, 0.46)
    const flick = 0.55 + 0.45 * Math.sign(Math.sin(t * 38))
    const ok = range(c, 0.62, 0.7)
    for (let i = 0; i < 4; i++) {
      const col = this.chainCores[i].material.color
      col.setRGB(0.08, 0.13, 0.2)
      if (i === 0) {
        const trying = band(c, 0.12, 0.18, 0.2, 0.24)
        col.lerp(this._c1 ??= new THREE.Color(0.35, 0.8, 1.4), trying).lerp(this._c2 ??= new THREE.Color(2.2, 0.35, 0.4), fail * flick)
        if (c > 0.46) col.setRGB(0.28, 0.06, 0.08)
      }
      if (i === 1) col.lerp(this._c3 ??= new THREE.Color(0.5, 1.2, 2.0), ok)
      this.chainCores[i].material.opacity = chOn
      this.chainCores[i].visible = chOn > 0.01
    }
    this.chainFail.opacity = fail * chOn
    // request pulse
    const P0 = this.chainPos[0], P1 = this.chainPos[1]
    let pv = 0
    if (c < 0.18) { this._v.copy(P0).add(this._v2.set(-3.2, 0, 0)).lerp(P0, easeOut(c / 0.18)); pv = 1 }
    else if (c < 0.44) { this._v.copy(P0); pv = 0.5 }
    else if (c < 0.64) { this._v.lerpVectors(P0, P1, easeInOut((c - 0.44) / 0.2)); pv = 1 }
    else { this._v.copy(P1); pv = 1 - range(c, 0.64, 0.75) }
    this.pulse.position.copy(this._v).addScaledVector(this._v2.set(0, 0, 1), 0.08)
    this.pulse.material.opacity = pv * chOn * (c > 0 ? 1 : 0)
    this.pulse.visible = this.pulse.material.opacity > 0.01
    this.pulse.quaternion.copy(cam.quaternion)
    for (const n of this.chainNodes) n.quaternion.copy(cam.quaternion)
    for (const cc of this.chainCores) cc.quaternion.copy(cam.quaternion)
    // answer beam from the node that answered, down into the utterance
    const beam = range(c, 0.7, 0.85)
    const bp = this.chainBeam.geometry.attributes.position
    this._v2.copy(bs.position).addScaledVector(this._up, 2.2)
    this._v3.lerpVectors(P1, this._v2, beam)
    bp.setXYZ(0, P1.x, P1.y - 0.45, P1.z); bp.setXYZ(1, this._v3.x, this._v3.y, this._v3.z); bp.needsUpdate = true
    this.chainBeam.material.opacity = (beam > 0 ? 0.9 : 0) * (1 - range(p, 0.52, 0.54)) * chOn

    // --- personal meeting agent ---
    const agOn = band(p, 0.53, 0.55, 0.625, 0.645)
    const wk = range(p, 0.54, 0.558)
    const into = easeInOut(range(p, 0.566, 0.584))
    const W = this.wake
    W.u.uReveal.value = wk
    W.u.uHi.value = range(p, 0.556, 0.564)
    this._v.copy(AGENT).add(this._v2.set(0, 4.4, 1.2))
    W.position.lerpVectors(this._v, AGENT, into)
    W.scale.copy(W.baseScale).multiplyScalar(lerp(1, 0.08, into))
    W.u.uDissolve.value = range(into, 0.3, 1)
    W.opacity = range(p, 0.536, 0.54) * (1 - range(into, 0.85, 1))
    W.quaternion.copy(cam.quaternion)
    const heard = range(p, 0.582, 0.59)
    const spin = 1 + heard * 5 * (1 - range(p, 0.62, 0.64))
    this.gimbal.rotation.x += dt * 0.3 * spin; this.gimbal.rotation.y += dt * 0.5 * spin
    this.agentCore.material.color.setRGB(0.38, 0.85, 1).multiplyScalar(0.5 + heard * 1.4 * agOn)
    this.agentCore.material.opacity = agOn
    this.agentRing.material.color.setRGB(0.38, 0.85, 1).multiplyScalar(0.45 + heard * 0.5)
    this.agentGrp.visible = p > 0.5 && p < 0.66
    this.agentHead.opacity = agOn
    this.agentOnly.opacity = agOn * 0.8
    const toolOn = range(p, 0.586, 0.594)
    for (let i = 0; i < this.toolLabels.length; i++) {
      const l = this.toolLabels[i]
      l.opacity = agOn * (l.userData.on ? (i === 0 ? 0.65 + 0.35 * toolOn : 0.65) : 0.35)
    }
    this.toolLink.material.opacity = agOn * toolOn * 0.8
    this.sw.opacity = agOn * range(p, 0.585, 0.595)
    this.sw.quaternion.copy(this.agentGrp.quaternion)
    this.knob.opacity = this.sw.u.uOpacity.value
    const kx = easeInOut(range(p, 0.594, 0.604))
    this.knob.position.copy(this.sw.position).addScaledVector(this._v.set(1, 0, 0).applyQuaternion(this.agentGrp.quaternion), lerp(-0.88, 0.88, kx))
      .addScaledVector(this._v2.set(0, 1, 0), -0.12).addScaledVector(this._v3.set(0, 0, 1).applyQuaternion(this.agentGrp.quaternion), 0.02)
    this.knob.quaternion.copy(this.agentGrp.quaternion)
    // contact card leaves as email
    const fly = easeInOut(range(p, 0.606, 0.628))
    this._v.copy(AGENT).add(this._v2.set(0, 0, 0.6))
    this._v3.copy(AGENT).add(this._v2.set(9, 6.5, -14))
    this.contact.position.lerpVectors(this._v, this._v3, fly)
    this.contact.position.y += Math.sin(Math.PI * fly) * 1.6
    this.contact.scale.setScalar(lerp(0.3, 1, easeOut(range(p, 0.603, 0.612))) * lerp(1, 0.25, fly))
    this.contact.opacity = range(p, 0.603, 0.609) * (1 - range(fly, 0.75, 1)) * agOn
    this.contact.quaternion.copy(cam.quaternion)
    this.agentSent.opacity = band(p, 0.612, 0.62, 0.63, 0.645)
    this.agentSent.position.copy(this.contact.position).add(this._v2.set(-1.2, 1.3, 0))

    // --- action card ---
    const cOn = range(p, 0.658, 0.688)
    const cardOut = range(p, 0.745, 0.8) * 0.55 + range(p, 0.82, 0.88) * 0.45
    this.card.opacity = cOn * (1 - cardOut)
    const cs = 0.55 + easeOut(cOn) * 0.45
    this.card.scale.set(cs * lerp(1.5, 1, easeOut(cOn)), cs, 1)
    this.card.quaternion.copy(cam.quaternion)
    const click = band(p, 0.717, 0.724, 0.728, 0.74)
    this.card.u.uGlow.value = click * 1.2
    this.cardHead.opacity = band(p, 0.655, 0.675, 0.72, 0.75)

    // --- calendar ---
    this.cal.opacity = range(p, 0.695, 0.71) * (1 - range(p, 0.87, 0.94) * 0.8)
    this.cal.u.uReveal.value = easeInOut(range(p, 0.697, 0.745))
    const g2 = easeInOut(range(p, 0.728, 0.79))
    this.cal.updateMatrix()
    this._v.copy(this.slotLocal).applyMatrix4(this.cal.matrix)
    this.block.opacity = range(p, 0.724, 0.732) * (1 - range(p, 0.87, 0.94) * 0.8)
    this.block.position.lerpVectors(CARD, this._v, g2)
    this.block.position.y += Math.sin(Math.PI * g2) * 2.4
    this.block.position.z += Math.sin(Math.PI * g2) * 2.0
    this.block.quaternion.copy(cam.quaternion).slerp(this.cal.quaternion, g2)
    const bw = lerp(4.2, this.slotSize.x, g2), bh = lerp(1.26, this.slotSize.y, g2)
    this.block.scale.set(bw, bh / 0.3, 1)
    const docked = range(p, 0.785, 0.792) * (1 - range(p, 0.792, 0.83))
    this.block.u.uGlow.value = docked * 1.8 + range(p, 0.788, 0.792) * 0.35
    this.calHead.opacity = band(p, 0.695, 0.715, 0.86, 0.89)
    this.calOne.opacity = band(p, 0.715, 0.735, 0.86, 0.89)
    this.calDone.opacity = band(p, 0.788, 0.8, 0.86, 0.89)
    this.calDone.position.copy(this._v).add(this._v2.set(this.slotSize.x * 0.5 + 0.35, 0, 0.1))

    // --- minutes ---
    this.doc.opacity = range(p, 0.805, 0.83)
    this.doc.u.uReveal.value = easeInOut(range(p, 0.825, 0.92))
    this.doc.u.uGlow.value = band(p, 0.825, 0.85, 0.9, 0.96) * 0.6
    this.condU.uC.value = range(p, 0.8, 0.92)
    this.cond.visible = this.condU.uC.value > 0 && this.condU.uC.value < 1
    this.docHead.opacity = range(p, 0.83, 0.855)
    const db = range(p, 0.915, 0.945)
    this.dbCol.material.uniforms.uOn.value = db
    this.dbDisc.material.opacity = db
    this.dbDisc2.material.opacity = db * (0.5 + 0.5 * Math.sin(t * 2.2) ** 2)
    this.dbLink.material.opacity = db * 0.8
    this.dbLabel.opacity = db

    // --- rail + risers + floor pools ---
    // flow head position along the rail per stage
    const stageU = [0.02, GATE.userData.u, GATE.userData.u + 0.02, FIELD.userData.u, COMMIT.userData.u, AGENT.userData.u, CARD.userData.u, CALP.userData.u, DOC.userData.u, 1]
    let fill = 0
    for (let i = 0; i < STAGES.length; i++) {
      const a = STAGES[i].a, b = i + 1 < STAGES.length ? STAGES[i + 1].a : 0.95
      if (p >= a) fill = lerp(stageU[i], stageU[i + 1], smoother(range(p, a, b)))
    }
    this.railU.uFill.value = fill
    const act = [band(p, 0.07, 0.11, 0.23, 0.28), band(p, 0.3, 0.34, 0.45, 0.5), band(p, 0.43, 0.46, 0.53, 0.56), band(p, 0.53, 0.56, 0.63, 0.66), band(p, 0.64, 0.66, 0.72, 0.76), band(p, 0.69, 0.72, 0.84, 0.89), range(p, 0.82, 0.88)]
    for (let i = 0; i < 7; i++) this.riserU[i] = act[i] * 0.55
    const pl = this.pools
    pl[0].set(0, 0, 13, 0.35 + mix * 0.25)
    pl[1].set(GATE.x, GATE.z, 5, act[0] * 0.6)
    pl[2].set(FIELD.x, FIELD.z, 9, act[1] * 0.55 + fOn * 0.15)
    pl[3].set(COMMIT.x, COMMIT.z, 6, act[2] * 0.6)
    pl[4].set(AGENT.x, AGENT.z, 5, act[3] * 0.55)
    pl[5].set(CALP.x, CALP.z, 9, Math.max(act[4], act[5]) * 0.5)
    pl[6].set(DOC.x, DOC.z, 12, act[6] * 0.6)
    pl[7].set(DB.x, DB.z, 3, db * 0.8)
    // compact the lit pools to the front so the floor shader only loops over the ones that matter
    let pn = 0
    for (let i = 0; i < 8; i++) {
      if (pl[i].w < 0.004) continue
      if (i !== pn) { this._pt ??= new THREE.Vector4(); this._pt.copy(pl[pn]); pl[pn].copy(pl[i]); pl[i].copy(this._pt) }
      pn++
    }
    this.floorU.uPoolN.value = pn

    // --- labels ---
    for (const l of this.labels) if (l.userData.face && l.visible) faceCamera(l, cam)
    for (const l of this.labels) {
      if (l.userData.person != null) l.opacity = (1 - range(p, 0.3, 0.38)) * (0.7 + 0.3 * this.speak[l.userData.person])
    }

    // --- hover: participants speak ---
    this.updateHover(p, dt)

    // --- overlay ---
    if (this.el) {
      reveal(this.$head, band(p, -1, 0, 0.06, 0.1))
      reveal(this.$flow, band(p, 0.03, 0.06, 0.87, 0.9), 0)
      reveal(this.$end, band(p, 0.875, 0.905, 0.945, 0.97))
      let st = 0
      for (let i = 0; i < STAGES.length; i++) if (p >= STAGES[i].a) st = i
      if (st !== this._stage) {
        this._stage = st
        this.$items.forEach((li, i) => { li.classList.toggle('is-on', i === st); li.classList.toggle('is-done', i < st) })
      }
    }
  }

  updateHover(p, dt) {
    const can = this.active && p < 0.33 && !this.ctx.isMobile
    let hit = -1
    if (can && this.ctx.pointer.moved !== false) {
      const h = this.pick(this.figures)
      if (h.length) hit = h[0].object.userData.i
    }
    if (hit !== this.hoverI) {
      this.hoverI = hit
      this.hoverT = 0
      if (hit >= 0) {
        const pp = PEOPLE[hit]
        this.ctx.cursor.hover(`PARTICIPANT · ${pp.name}`, 'SPEAKING · LIVEKIT AUDIO TRACK', this)
      } else this.ctx.cursor.hover(null, null, this)
    }
    const cam = this.ctx.camera
    for (let i = 0; i < 6; i++) {
      const s = this.hoverStrips[i]
      const on = i === this.hoverI ? 1 : 0
      const o = damp(s.u.uOpacity.value, on, on ? 10 : 5, dt)
      s.opacity = o
      if (s.visible) {
        s.u.uReveal.value = on ? easeOut(this.hoverT * 1.3) : s.u.uReveal.value
        s.quaternion.copy(cam.quaternion)
      }
    }
  }

  onLeave() { this.hoverI = -1; this.ctx.cursor.hover(null, null, this) }
}
