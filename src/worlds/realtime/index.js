import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label, faceCamera } from '../../lib/label.js'
import { chrome, graphite, smokedGlass, glow } from '../../lib/materials.js'
import { HEX, COLOR } from '../../lib/palette.js'
import { range, band, damp, smoother, lerp, clamp, rng } from '../../lib/math.js'
import { reveal, readout, tag } from '../../lib/dom.js'
import { experience, skillGroups, allSkills } from '../../content.js'
import { buildTopology, bez, K, ROLE } from './topology.js'
import * as S from './shaders.js'
import './style.css'

/**
 * WORLD 02: REAL-TIME SYSTEMS.
 * Looking inside a distributed voice-AI system: edge clients (browsers, phones, SIP trunks) → load
 * balancers → FastAPI gateways → a Redis pub/sub hub → STT / LLM / TTS workers on an elevated ring,
 * replicated across regions. Packets are GPU-animated along every fibre with protocol-specific rhythm.
 * The camera establishes the whole network, then rides one request end to end while its latency
 * accumulates, then pulls out to show scale.
 */

const UP = new THREE.Vector3(0, 1, 0)
// Simulated per-hop timing for the followed request: [arrive, depart] in ms. Decorative telemetry,
// kept consistent with the resume's production figure (TTFB under 300 ms).
const HOP_MS = [[0, 0], [16, 16.5], [18, 18.5], [20, 20.5], [22, 92], [95, 188], [191, 242], [245, 245.5], [247, 247.5], [266, 266]]
const HOP_DWELL = [0, 0.1, 0.1, 0.12, 0.85, 0.85, 0.85, 0.1, 0.1, 0]
const HOPS = [
  ['EDGE', 'SIP / INVITE'], ['LB', 'L7 route'], ['FASTAPI', 'async gateway'], ['REDIS', 'pub/sub'],
  ['STT', 'streaming'], ['LLM', 'first token'], ['TTS', 'first audio'], ['FASTAPI', 'stream out'], ['LB', ''], ['EDGE', 'media back'],
]
const SAMP = [0.25, 0.5, 0.75]
const F0 = 0.13, F1 = 0.79, F2 = 0.93   // establish | follow | pull-out | exit

export default class RealtimeWorld extends World {
  static height = 420

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0028
    this.bloom = 0.9
    this.exposure = 1.05
    this.parallax = 0.7
  }

  async init() {
    const low = this.ctx.quality === 'low'
    this.low = low
    const topo = (this.topo = buildTopology(this.ctx.quality))
    this.buildLinkTexture()
    this.buildLinks()
    this.buildPackets(low)
    this.buildNodes()
    this.buildLeds()
    this.buildFloors()
    this.buildRoute(low)
    this.buildDust(low)
    this.buildLabels()
    this.buildHalos()
    this.bakeCamera()

    // pointer / state scratch
    this._ray = new THREE.Ray()
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._cam = new THREE.Vector3()
    this.ptr = 0
    this.hover = -1
    this.pubTime = 0
    this.linkTime = new Float32Array(topo.links.length)
    for (let i = 0; i < topo.links.length; i++) this.linkTime[i] = rng(i + 3)() * 40
    this.linkHl = new Float32Array(topo.links.length)
    this.linkAct = new Float32Array(topo.links.length)
    this.nodeAct = new Float32Array(topo.nodes.length)
    this._routeEval = { pos: new THREE.Vector3(), u: 0, ms: 0, hop: 0, dwell: -1, dk: 0 }
    this._lastText = 0
    this.reveal = 1
  }

  // ------------------------------------------------------------------ build

  buildLinkTexture() {
    const L = this.topo.links, n = L.length
    const data = (this.linkData = new Float32Array(n * 4 * 4))
    const set = (row, i, x, y, z, w) => { const o = (row * n + i) * 4; data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = w }
    L.forEach((l, i) => {
      set(0, i, l.A.x, l.A.y, l.A.z, 0)
      set(1, i, l.C.x, l.C.y, l.C.z, 0)
      set(2, i, l.B.x, l.B.y, l.B.z, 0)
      set(3, i, l.kind, l.kind === K.SIP ? l.per : l.kind === K.PUBSUB ? 1.9 : 1, l.off, l.len)
    })
    const tex = (this.linkTex = new THREE.DataTexture(data, n, 4, THREE.RGBAFormat, THREE.FloatType))
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    this.uFog = { value: 0.003 }
    this.uPx = { value: 800 }
    this.uTime = { value: 0 }
    this.uReveal = { value: 1 }
  }

  buildLinks() {
    const L = this.topo.links, SEG = 28
    const pos = new Float32Array(L.length * SEG * 2 * 3)
    const al = new Float32Array(L.length * SEG * 2 * 2)
    let k = 0
    L.forEach((l, i) => {
      for (let s = 0; s < SEG; s++) {
        for (const t of [s / SEG, (s + 1) / SEG]) { al[k * 2] = i; al[k * 2 + 1] = t; k++ }
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aL', new THREE.BufferAttribute(al, 2))
    const m = new THREE.ShaderMaterial({
      uniforms: { uLinks: { value: this.linkTex }, uFog: this.uFog, uTime: this.uTime, uReveal: this.uReveal },
      vertexShader: S.LINK_VS, fragmentShader: S.LINK_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const lines = new THREE.LineSegments(g, m)
    lines.frustumCulled = false
    lines.renderOrder = 2
    this.group.add(lines)
  }

  buildPackets(low) {
    const L = this.topo.links
    const q = low ? 0.55 : 1
    const P = [], A2 = []
    const R = rng(99)
    const push = (li, phase, role, dir, speed) => { P.push(li, phase, role); A2.push(dir, speed, R()) }
    L.forEach((l, i) => {
      const len = l.len
      switch (l.kind) {
        case K.WEBRTC: {
          const n = Math.max(6, Math.round(len * 1.25 * q))
          for (const dir of [1, -1]) for (let j = 0; j < n; j++) push(i, j / n + R() * 0.004, 2, dir, 17 + (dir < 0 ? 2 : 0))
          break
        }
        case K.WSS: {
          const n = Math.max(3, Math.round(len * 0.3 * q))
          for (const dir of [1, -1]) for (let j = 0; j < n; j++) push(i, R(), 0, dir, 30 + R() * 8)
          break
        }
        case K.SIP: {
          push(i, 0, 0, 1, 0); push(i, 0, 1, 1, 0)
          const n = Math.max(6, Math.round(len * 1.1 * q))
          for (const dir of [1, -1]) for (let j = 0; j < n; j++) push(i, j / n, 2, dir, 17)
          break
        }
        case K.PUBSUB: {
          for (let j = 0; j < 4; j++) push(i, j * 0.035, 0, 1, 0)
          for (let j = 0; j < 2; j++) push(i, j * 0.06, 1, 1, 0)
          break
        }
        case K.PIPE: {
          const n = Math.max(6, Math.round(len * 0.9 * q))
          for (let j = 0; j < n; j++) push(i, j / n + R() * 0.01, 0, 1, 22)
          break
        }
        default: {
          const n = Math.max(4, Math.round(len * 0.1 * q))
          for (const dir of [1, -1]) for (let j = 0; j < n; j++) push(i, R(), 0, dir, 46)
        }
      }
    })
    this.packetCount = P.length / 3
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('aP2', new THREE.Float32BufferAttribute(A2, 3))
    this.uRayO = { value: new THREE.Vector3(0, 1e4, 0) }
    this.uRayD = { value: new THREE.Vector3(0, 1, 0) }
    this.uPtr = { value: 0 }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uLinks: { value: this.linkTex }, uFog: this.uFog, uPx: this.uPx, uSize: { value: 0.3 }, uReveal: this.uReveal,
        uPtr: this.uPtr, uRayO: this.uRayO, uRayD: this.uRayD,
      },
      vertexShader: S.PACKET_VS, fragmentShader: S.PACKET_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.renderOrder = 4
    this.group.add(pts)
  }

  buildNodes() {
    const N = this.topo.nodes
    const mChrome = chrome({ roughness: 0.14 })
    const mChromeSoft = chrome({ roughness: 0.3, envMapIntensity: 0.9 })
    const mGraph = graphite({ roughness: 0.36, metalness: 0.75 })
    const mGraphDark = graphite({ color: new THREE.Color('#0d1015'), roughness: 0.3, metalness: 0.6 })
    // cheap smoked glass (standard, front faces only): racks fill the frame in close-ups, so no clearcoat pass
    const mGlass = new THREE.MeshStandardMaterial({ color: 0x0b121b, metalness: 0.2, roughness: 0.06, transparent: true, opacity: 0.32, envMapIntensity: 1.5, depthWrite: false })
    const mSlit = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    const mCap = graphite({ color: new THREE.Color('#1c2129'), roughness: 0.45, metalness: 0.8, envMapIntensity: 0.35 })
    const mScreen = new THREE.MeshPhysicalMaterial({ color: 0x05080c, roughness: 0.05, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.2 })
    const parts = {}
    const part = (name, geo, mat, colored = false) => (parts[name] = { geo, mat, list: [], colored })
    const put = (name, n, off = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], col = null) => parts[name].list.push({ n, off, rot, scl, col })

    part('browser', new THREE.CapsuleGeometry(0.7, 2.0, 6, 18).rotateZ(Math.PI / 2), mChrome)
    part('phone', new THREE.BoxGeometry(1.25, 2.4, 0.24), mGraphDark)
    part('phoneFace', new THREE.PlaneGeometry(1.08, 2.18), mScreen)
    part('sipBody', new THREE.CylinderGeometry(1.35, 1.42, 0.62, 36), mGraph)
    part('sipRing', new THREE.TorusGeometry(1.38, 0.08, 8, 56).rotateX(Math.PI / 2), mChrome)
    part('stem', new THREE.CylinderGeometry(0.09, 0.12, 1, 10), mChromeSoft)
    part('lbRing', new THREE.TorusGeometry(2.5, 0.26, 18, 72), mChrome)
    part('lbBack', new THREE.TorusGeometry(2.05, 0.42, 12, 56), mGraph)
    part('glass', new THREE.BoxGeometry(1, 1, 1), mGlass)
    part('blade', new THREE.BoxGeometry(1, 1, 1), mGraph)
    part('cap', new THREE.BoxGeometry(1, 1, 1), mCap)
    part('post', new THREE.BoxGeometry(1, 1, 1), mChromeSoft)
    part('slit', new THREE.BoxGeometry(1, 1, 1), mSlit, true)
    part('hubBase', new THREE.CylinderGeometry(6, 6.6, 1.3, 72), mGraph)
    part('hubRing', new THREE.TorusGeometry(7.1, 0.32, 16, 120).rotateX(Math.PI / 2), mChromeSoft)
    part('hubGlow', new THREE.TorusGeometry(5.3, 0.05, 6, 120).rotateX(Math.PI / 2), mSlit, true)
    part('hubCol', new THREE.CylinderGeometry(2.9, 2.9, 5.6, 56, 1, true), mGlass)
    part('hubCap', new THREE.CylinderGeometry(3.1, 3.1, 0.28, 56), mCap)
    part('hubDisc', new THREE.CylinderGeometry(2.55, 2.55, 0.22, 48), mGraphDark)
    part('hubDiscGlow', new THREE.TorusGeometry(2.57, 0.035, 6, 72).rotateX(Math.PI / 2), mSlit, true)
    part('core', new THREE.CylinderGeometry(0.14, 0.14, 1, 10), mSlit, true)
    part('rackBlade', new THREE.BoxGeometry(1, 1, 1), mGraphDark)

    const slitCol = { stt: new THREE.Color(HEX.cyan), llm: new THREE.Color(HEX.blue).lerp(new THREE.Color(HEX.ice), 0.2), tts: new THREE.Color(HEX.ice), gw: new THREE.Color(HEX.blue) }
    for (const n of N) {
      switch (n.kind) {
        case 'browser': put('browser', n, [0, 0.9, 0]); break
        case 'phone': put('phone', n, [0, 1.3, 0], [-0.12, 0, 0]); put('phoneFace', n, [0, 1.3 + 0.015, 0.125], [-0.12, 0, 0]); break
        case 'sip': put('sipBody', n, [0, 0.31, 0]); put('sipRing', n, [0, 0.56, 0]); break
        case 'lb':
          put('lbRing', n, [0, 2.8, 0]); put('lbBack', n, [0, 2.8, -0.35]); put('stem', n, [0, 0.75, -0.35], [0, 0, 0], [1, 1.5, 1])
          break
        case 'gw': {
          put('glass', n, [0, 3.05, 0], [0, 0, 0], [3.2, 5.9, 2.4])
          for (let i = 0; i < 6; i++) {
            const y = 0.75 + i * 0.9
            put('blade', n, [0, y, -0.1], [0, 0, 0], [2.7, 0.34, 1.9])
            put('slit', n, [-0.2, y, 0.86], [0, 0, 0], [1.9, 0.045, 0.02], slitCol.gw)
          }
          put('cap', n, [0, 0.05, 0], [0, 0, 0], [3.4, 0.16, 2.6]); put('cap', n, [0, 6.05, 0], [0, 0, 0], [3.4, 0.16, 2.6])
          for (const [x, z] of [[-1.62, 1.22], [1.62, 1.22], [-1.62, -1.22], [1.62, -1.22]]) put('post', n, [x, 3.05, z], [0, 0, 0], [0.06, 5.9, 0.06])
          break
        }
        case 'redis':
          put('hubBase', n, [0, 0.65, 0]); put('hubRing', n, [0, 0.9, 0]); put('hubGlow', n, [0, 1.32, 0], [0, 0, 0], [1, 1, 1], new THREE.Color(HEX.cyan))
          put('hubCol', n, [0, 4.1, 0]); put('hubCap', n, [0, 7.0, 0]); put('core', n, [0, 4.1, 0], [0, 0, 0], [1, 5.6, 1], new THREE.Color(HEX.ice))
          for (let i = 0; i < 6; i++) { put('hubDisc', n, [0, 1.75 + i * 0.9, 0]); put('hubDiscGlow', n, [0, 1.75 + i * 0.9, 0], [0, 0, 0], [1, 1, 1], new THREE.Color(HEX.cyan).multiplyScalar(0.7)) }
          break
        default: { // stt / llm / tts racks
          put('glass', n, [0, 4.1, 0], [0, 0, 0], [2.6, 8.0, 2.6])
          for (let i = 0; i < 12; i++) put('rackBlade', n, [0, 0.55 + i * 0.64, -0.08], [0, 0, 0], [2.25, 0.4, 2.2])
          put('cap', n, [0, 0.05, 0], [0, 0, 0], [2.8, 0.18, 2.8]); put('cap', n, [0, 8.15, 0], [0, 0, 0], [2.8, 0.18, 2.8])
          for (const [x, z] of [[-1.32, 1.32], [1.32, 1.32], [-1.32, -1.32], [1.32, -1.32]]) put('post', n, [x, 4.1, z], [0, 0, 0], [0.06, 8.0, 0.06])
          for (let i = -1; i <= 1; i++) put('slit', n, [i * 0.55, 4.1, 1.31], [0, 0, 0], [0.05, 6.6, 0.02], slitCol[n.kind])
        }
      }
    }
    const mN = new THREE.Matrix4(), mL = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3()
    this.slitMeshes = []
    for (const name in parts) {
      const P = parts[name]
      if (!P.list.length) continue
      const im = new THREE.InstancedMesh(P.geo, P.mat, P.list.length)
      P.list.forEach((it, i) => {
        const n = it.n
        mN.compose(n.pos, q.setFromAxisAngle(UP, n.yaw), s.setScalar(n.S))
        mL.compose(v.fromArray(it.off), new THREE.Quaternion().setFromEuler(e.set(...it.rot)), new THREE.Vector3().fromArray(it.scl))
        im.setMatrixAt(i, mN.multiply(mL))
        if (P.colored) im.setColorAt(i, new THREE.Color().copy(it.col).multiplyScalar(1.3))
      })
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
      if (P.colored) this.slitMeshes.push({ im, list: P.list, base: P.list.map((it) => it.col.clone()) })
      this.group.add(im)
    }
  }

  buildLeds() {
    const N = this.topo.nodes
    const pos = [], size = [], col = [], seed = []
    const off = { browser: [0.0, 0.9, 0.74], phone: [0, 2.2, 0.16], sip: [0, 0.7, 0], lb: [0, 2.8, 0], gw: [1.2, 5.6, 1.25], redis: [0, 7.5, 0], stt: [0, 8.6, 0], llm: [0, 8.6, 0], tts: [0, 8.6, 0] }
    const sz = { browser: 0.5, phone: 0.45, sip: 0.6, lb: 2.2, gw: 0.5, redis: 3.2, stt: 0.8, llm: 0.8, tts: 0.8 }
    const R = rng(5)
    const v = new THREE.Vector3()
    for (const n of N) {
      v.fromArray(off[n.kind]).multiplyScalar(n.S).applyAxisAngle(UP, n.yaw).add(n.pos)
      n.ledPos = v.clone()
      pos.push(v.x, v.y, v.z)
      size.push(sz[n.kind] * n.S)
      const c = n.kind === 'sip' ? COLOR.amber : n.kind === 'redis' || n.kind === 'lb' ? COLOR.cyan : n.kind === 'gw' ? COLOR.green : n.kind === 'browser' || n.kind === 'phone' ? COLOR.ice : COLOR.cyan
      const k = n.kind === 'gw' ? 0.6 : n.kind === 'lb' ? 0.5 : n.kind === 'redis' ? 0.8 : 0.9
      col.push(c.r * k, c.g * k, c.b * k)
      seed.push(R())
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    this.ledAct = new THREE.BufferAttribute(new Float32Array(N.length), 1)
    this.ledAct.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aAct', this.ledAct)
    const m = new THREE.ShaderMaterial({
      uniforms: { uFog: this.uFog, uPx: this.uPx, uTime: this.uTime, uReveal: this.uReveal },
      vertexShader: S.LED_VS, fragmentShader: S.LED_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.renderOrder = 5
    this.group.add(pts)
  }

  buildFloors() {
    this.pulseMats = []
    this.floorMats = []
    for (const cl of this.topo.clusters) {
      const S0 = cl.S
      const fm = new THREE.ShaderMaterial({
        uniforms: { uFog: this.uFog, uR: { value: 100 * S0 }, uYaw: { value: cl.yaw }, uReveal: this.uReveal, uPulse: { value: 0 } },
        vertexShader: S.FLOOR_VS, fragmentShader: S.FLOOR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(280 * S0, 280 * S0), fm)
      floor.rotation.x = -Math.PI / 2
      floor.position.copy(cl.origin).add(new THREE.Vector3(0, -3.5 * S0, 0))
      floor.renderOrder = 1
      this.group.add(floor)
      this.floorMats.push(fm)
      // pub/sub burst ring at the hub
      const pm = new THREE.ShaderMaterial({
        uniforms: { uC: { value: 0 }, uFog: this.uFog, uReveal: this.uReveal },
        vertexShader: S.UV_VS, fragmentShader: S.PULSE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pm)
      ring.rotation.x = -Math.PI / 2
      ring.scale.setScalar(64 * S0)
      ring.position.copy(cl.redis.pos).add(new THREE.Vector3(0, 1.4 * S0, 0))
      ring.renderOrder = 3
      this.group.add(ring)
      this.pulseMats.push({ m: pm, off: cl.ci * 0.37 })
    }
    // Soft volumetric haze around the primary hub and worker ring.
    this.hazes = []
    const hz = (pos, size, color, I) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: I }, uFog: this.uFog },
        vertexShader: S.UV_VS, fragmentShader: S.HAZE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })
      const h = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m)
      h.position.copy(pos)
      h.renderOrder = 0
      this.group.add(h)
      this.hazes.push(h)
      return h
    }
    const [main, s1, s2] = this.topo.clusters
    hz(new THREE.Vector3(0, 18, 0), 150, '#1d4f9a', 0.1)
    hz(s1.redis.pos.clone().add(new THREE.Vector3(0, 8, 0)), 90, '#1d4f9a', 0.2)
    hz(s2.redis.pos.clone().add(new THREE.Vector3(0, 8, 0)), 90, '#1d4f9a', 0.2)
    void main
  }

  buildRoute(low) {
    const { hops, links } = this.topo.route
    const raw = [], marks = [0]
    const v = new THREE.Vector3()
    const STEPS = 60
    for (const { link, rev } of links) {
      for (let i = 0; i <= STEPS; i++) {
        const s = i / STEPS
        raw.push(bez(link.A, link.C, link.B, rev ? 1 - s : s, v).clone())
      }
      marks.push(raw.length - 1)
    }
    const cum = [0]
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + raw[i].distanceTo(raw[i - 1]))
    const total = cum[cum.length - 1]
    // uniform arc-length resample
    const M = 1600
    const pts = new Float32Array(M * 3)
    let j = 0
    for (let i = 0; i < M; i++) {
      const a = (i / (M - 1)) * total
      while (j < cum.length - 2 && cum[j + 1] < a) j++
      const t = (a - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])
      v.lerpVectors(raw[j], raw[j + 1], clamp(t))
      pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z
    }
    const hopU = marks.map((m) => cum[m] / total)
    // unwrapped azimuth of the request around the network axis (drives the chase camera's orbit);
    // near the axis the azimuth is meaningless, so it is interpolated across from the neighbours.
    const az = new Float32Array(M), okA = new Uint8Array(M)
    let prevA = null
    for (let i = 0; i < M; i++) {
      const x = pts[i * 3], z = pts[i * 3 + 2]
      if (x * x + z * z < 100) continue
      let a = Math.atan2(x, z)
      if (prevA !== null) { while (a - prevA > Math.PI) a -= Math.PI * 2; while (a - prevA < -Math.PI) a += Math.PI * 2 }
      az[i] = a; okA[i] = 1; prevA = a
    }
    for (let i = 0; i < M; i++) {
      if (okA[i]) continue
      let a = i, b = i
      while (a > 0 && !okA[a]) a--
      while (b < M - 1 && !okA[b]) b++
      az[i] = okA[a] && okA[b] ? lerp(az[a], az[b], (i - a) / (b - a)) : okA[a] ? az[a] : az[b]
    }
    // scroll timeline: dwell at a hop, then travel to the next
    const segs = []
    for (let h = 0; h < hops.length; h++) {
      if (HOP_DWELL[h] > 0) segs.push({ type: 'dwell', h, u: hopU[h], ms0: HOP_MS[h][0], ms1: HOP_MS[h][1], w: HOP_DWELL[h] })
      if (h < hops.length - 1) {
        const len = (hopU[h + 1] - hopU[h]) * total
        segs.push({ type: 'travel', h, u0: hopU[h], u1: hopU[h + 1], ms0: HOP_MS[h][1], ms1: HOP_MS[h + 1][0], w: 0.25 + len / 70 })
      }
    }
    let W = 0
    for (const s of segs) { s.a = W; W += s.w }
    for (const s of segs) { s.a /= W; s.b = s.a + s.w / W }
    this.route = { pts, M, total, hopU, segs, hops, az }

    // trail points (dense along the route)
    const TN = low ? 1400 : 2600
    const tp = new Float32Array(TN * 3), tu = new Float32Array(TN)
    for (let i = 0; i < TN; i++) {
      const u = i / (TN - 1)
      this.routeAt(u, v)
      tp[i * 3] = v.x; tp[i * 3 + 1] = v.y; tp[i * 3 + 2] = v.z; tu[i] = u
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(tp, 3))
    g.setAttribute('aU', new THREE.BufferAttribute(tu, 1))
    this.trailU = { uFog: this.uFog, uPx: this.uPx, uProg: { value: 0 }, uShow: { value: 0 }, uTime: this.uTime }
    const m = new THREE.ShaderMaterial({ uniforms: this.trailU, vertexShader: S.TRAIL_VS, fragmentShader: S.TRAIL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const trail = new THREE.Points(g, m)
    trail.frustumCulled = false
    trail.renderOrder = 6
    this.group.add(trail)

    // the request itself: a hot core with a soft halo
    const head = (this.head = new THREE.Group())
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), glow(COLOR.ice, 3.2))
    head.add(core)
    const hm = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(HEX.cyan).multiplyScalar(1.6) }, uI: { value: 0.9 }, uFog: this.uFog },
      vertexShader: S.UV_VS, fragmentShader: S.HAZE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.headHalo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), hm)
    head.add(this.headHalo)
    head.visible = false
    this.group.add(head)
  }

  /** Position along the followed route at arc fraction u. */
  routeAt(u, out) {
    const { pts, M } = this.route
    const x = clamp(u) * (M - 1), i = Math.min(M - 2, Math.floor(x)), t = x - i
    return out.set(
      lerp(pts[i * 3], pts[i * 3 + 3], t), lerp(pts[i * 3 + 1], pts[i * 3 + 4], t), lerp(pts[i * 3 + 2], pts[i * 3 + 5], t),
    )
  }

  /** Follow progress f (0..1) → where the request is, how much latency it has accumulated, which hop. */
  evalRoute(f, o) {
    const segs = this.route.segs
    f = clamp(f)
    let s = segs[segs.length - 1]
    for (const sg of segs) if (f <= sg.b) { s = sg; break }
    const lk = clamp((f - s.a) / Math.max(1e-6, s.b - s.a))
    if (s.type === 'dwell') {
      o.u = s.u; o.ms = lerp(s.ms0, s.ms1, lk); o.hop = s.h; o.dwell = s.h; o.dk = lk
    } else {
      const e = smoother(lk)
      o.u = lerp(s.u0, s.u1, e); o.ms = lerp(s.ms0, s.ms1, e); o.hop = e > 0.97 ? s.h + 1 : s.h; o.dwell = -1; o.dk = e
    }
    this.routeAt(o.u, o.pos)
    return o
  }

  buildDust(low) {
    const n = low ? 900 : 2000
    const R = rng(77)
    const pos = new Float32Array(n * 3), sd = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 240
      pos[i * 3] = Math.sin(a) * r; pos[i * 3 + 1] = -10; pos[i * 3 + 2] = Math.cos(a) * r - 40
      sd[i] = R()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uPx: this.uPx, uFog: this.uFog, uReveal: this.uReveal },
      vertexShader: S.DUST_VS, fragmentShader: S.DUST_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    this.group.add(pts)
  }

  buildLabels() {
    const T = this.topo, main = T.main
    this.labels = []
    const L = (text, pos, o = {}) => {
      const l = new Label(text, { height: o.h ?? 0.34, color: o.color ?? HEX.chrome, align: o.align ?? 'center', tracking: 0.16, opacity: 0 })
      l.position.copy(pos)
      l.material.fog = true
      this.group.add(l)
      const e = { l, near: o.near ?? 60, far: o.far ?? 110, base: o.base ?? 0.85, n0: o.n0 ?? 5, n1: o.n1 ?? 11 }
      this.labels.push(e)
      return e
    }
    const v = new THREE.Vector3()
    L('REDIS PUB/SUB', main.redis.pos.clone().add(v.set(0, 9.6, 0)), { h: 0.5, color: HEX.ice, near: 110, far: 190, n0: 10, n1: 18 })
    main.gws.forEach((g) => L(`FASTAPI\n${g.name}`, g.pos.clone().add(v.set(0, 7.3, 0)), { h: 0.32, near: 60, far: 120 }))
    main.lbs.forEach((b) => L(`LB · ${b.name}`, b.pos.clone().add(v.set(0, 6.2, 0)), { h: 0.32, near: 60, far: 120 }))
    for (const k of ['stt', 'llm', 'tts']) {
      const c = new THREE.Vector3(); main[k].forEach((n) => c.add(n.pos)); c.multiplyScalar(1 / 3)
      L(k.toUpperCase(), c.add(v.set(0, 11.2, 0)), { h: 0.6, color: HEX.white, near: 120, far: 200, n0: 16, n1: 30 })
    }
    const mid = (l) => bez(l.A, l.C, l.B, 0.5, new THREE.Vector3()).add(v.set(0, 1.1, 0))
    const pick = (proto, sector) => main.edges.filter((e) => e.proto === proto)[sector]
    const hero = T.route.hops[0]
    L('SIP/INVITE', mid(hero.link), { h: 0.42, color: HEX.amber, near: 80, far: 150 })
    const w1 = pick(K.WEBRTC, 4), w2 = pick(K.WEBRTC, 10), s1 = pick(K.WSS, 2), s2 = pick(K.WSS, 5), sp = pick(K.SIP, 3)
    if (w1) L('WEBRTC', mid(w1.link), { h: 0.42, color: HEX.cyan, near: 80, far: 150 })
    if (w2) L('WEBRTC', mid(w2.link), { h: 0.42, color: HEX.cyan, near: 80, far: 150 })
    if (s1) L('WSS', mid(s1.link), { h: 0.42, color: HEX.cyan, near: 80, far: 150 })
    if (s2) L('WSS', mid(s2.link), { h: 0.42, color: HEX.cyan, near: 80, far: 150 })
    if (sp) L('SIP/INVITE', mid(sp.link), { h: 0.42, color: HEX.amber, near: 80, far: 150 })
    ;[main.edges[1], main.edges[12], main.edges[23]].filter(Boolean).forEach((e) => L(`NODE ${e.name}`, e.pos.clone().add(v.set(0, 3.2, 0)), { h: 0.28, color: HEX.smoke, near: 50, far: 95 }))
    for (const cl of T.clusters) {
      const a = cl.yaw + Math.PI / 3 + (cl.ci === 0 ? Math.PI * 2 / 3 : 0)
      const p = cl.origin.clone().add(v.set(Math.sin(a) * 118 * cl.S, -2.5 * cl.S, Math.cos(a) * 118 * cl.S))
      L(`REGION ${cl.region}`, p, { h: cl.ci === 0 ? 1.5 : 1.6, color: HEX.smoke, near: 700, far: 900, base: 0.8 })
    }
    // the travelling request's own tag
    this.headLabel = new Label('REQUEST', { height: 0.3, color: HEX.ice, align: 'left', tracking: 0.14, opacity: 0 })
    this.headLabel.material.depthTest = false
    this.headLabel.renderOrder = 20
    this.group.add(this.headLabel)
  }

  buildHalos() {
    const FS = /* glsl */`
      uniform float uO; uniform vec3 uColor; varying vec2 vUv; varying float vD;
      void main(){ vec2 q = vUv*2.0-1.0; float r = length(q);
        float ring = exp(-pow((r-0.78)/0.035, 2.0)) + 0.35*exp(-pow((r-0.9)/0.012, 2.0));
        float tick = step(0.92, fract(atan(q.y,q.x)/6.2831853*24.0)) * smoothstep(0.96,0.93,r)*step(0.86,r);
        gl_FragColor = vec4(uColor, (ring + tick*0.6)*uO); }`
    const mk = (color) => {
      const m = new THREE.ShaderMaterial({ uniforms: { uO: { value: 0 }, uColor: { value: new THREE.Color(color).multiplyScalar(0.9) } }, vertexShader: S.UV_VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthTest: false })
      const h = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m)
      h.renderOrder = 12
      h.visible = false
      this.group.add(h)
      return h
    }
    this.halo = mk(HEX.cyan)
    this.halo.userData.o = 0
    this.halo.userData.scale = 4
  }

  // ------------------------------------------------------------------ camera

  followPose(f, pos, tgt) {
    const o = this.evalRoute(f, this._camEval ??= { pos: new THREE.Vector3(), u: 0, ms: 0, hop: 0, dwell: -1, dk: 0 })
    const P = o.pos
    const { az, M } = this.route
    const x = clamp(o.u) * (M - 1), i = Math.min(M - 2, Math.floor(x))
    let phi = lerp(az[i], az[i + 1], x - i) + 0.32
    if (o.dwell >= 0) phi += (o.dk - 0.5) * 0.45 * (HOP_DWELL[o.dwell] > 0.5 ? 1 : 0.2)
    const r = Math.hypot(P.x, P.z) + 21
    pos.set(Math.sin(phi) * r, P.y + 10.5, Math.cos(phi) * r)
    // keep the request slightly right of centre (the live trace sits bottom-left)
    tgt.set(P.x - Math.cos(phi) * 5.2, P.y + 0.2, P.z + Math.sin(phi) * 5.2)
  }

  rawPose(p, pos, tgt) {
    const W0p = new THREE.Vector3(150, 62, 212), W0t = new THREE.Vector3(-34, 12, 10)
    const Sp = new THREE.Vector3(-70, 165, 285), St = new THREE.Vector3(-64, -22, -58)
    const Ep = new THREE.Vector3(-60, 300, 330), Et = new THREE.Vector3(-64, -40, -80)
    if (p < F0) {
      const e = smoother(p / F0)
      this.followPose(0, pos, tgt)
      // drift in slightly during the establishing hold, then dive
      const hold = W0p.clone().lerp(new THREE.Vector3(128, 56, 184), smoother(p / F0 * 1.4))
      const ep = smoother(clamp((p / F0 - 0.25) / 0.75))
      pos.lerpVectors(hold, pos, ep)
      tgt.lerpVectors(W0t, tgt, smoother(clamp((p / F0 - 0.3) / 0.7)))
      void e
      return lerp(40, 50, ep)
    }
    if (p < F1) { this.followPose((p - F0) / (F1 - F0), pos, tgt); return 50 }
    if (p < F2) {
      const e = smoother((p - F1) / (F2 - F1))
      this.followPose(1, pos, tgt)
      pos.lerp(Sp, e); tgt.lerp(St, e)
      return lerp(50, 44, e)
    }
    const e = smoother((p - F2) / (1 - F2))
    pos.lerpVectors(Sp, Ep, e); tgt.lerpVectors(St, Et, e)
    return 44
  }

  bakeCamera() {
    const N = 900
    const P = new Float32Array((N + 1) * 3), T = new Float32Array((N + 1) * 3), F = new Float32Array(N + 1)
    const pos = new THREE.Vector3(), tgt = new THREE.Vector3()
    for (let i = 0; i <= N; i++) {
      F[i] = this.rawPose(i / N, pos, tgt)
      pos.toArray(P, i * 3); tgt.toArray(T, i * 3)
    }
    const smooth = (A, dim, sigma) => {
      const out = new Float32Array(A.length), r = Math.ceil(sigma * 3)
      const w = []; for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)))
      for (let i = 0; i <= N; i++) {
        for (let d = 0; d < dim; d++) {
          let s = 0, ws = 0
          for (let k = -r; k <= r; k++) { const j = Math.min(N, Math.max(0, i + k)); s += A[j * dim + d] * w[k + r]; ws += w[k + r] }
          out[i * dim + d] = s / ws
        }
      }
      return out
    }
    this.cam = { N, P: smooth(P, 3, 11), T: smooth(T, 3, 7), F: smooth(F, 1, 8) }
  }

  cameraAt(p, out) {
    if (!this.cam) { out.pos.set(118, 84, 196); out.target.set(0, 10, 0); out.fov = 40; return }
    const { N, P, T, F } = this.cam
    const x = clamp(p) * N, i = Math.min(N - 1, Math.floor(x)), t = x - i
    out.pos.set(lerp(P[i * 3], P[i * 3 + 3], t), lerp(P[i * 3 + 1], P[i * 3 + 4], t), lerp(P[i * 3 + 2], P[i * 3 + 5], t))
    out.target.set(lerp(T[i * 3], T[i * 3 + 3], t), lerp(T[i * 3 + 1], T[i * 3 + 4], t), lerp(T[i * 3 + 2], T[i * 3 + 5], t))
    let fov = lerp(F[i], F[i + 1], t)
    const asp = this.ctx.camera.aspect
    if (asp < 1) {
      // portrait: the desktop framing leaves room for text on the left; re-centre the network instead
      fov += (1 - asp) * 26
      const m = Math.min(1, (1 - asp) * 2), est = 1 - range(p, 0, F0)
      out.target.x += (range(p, F1, F2) * 52 + est * 26) * m
      out.target.z -= est * 14 * m
      out.target.y += est * 22 * m
    }
    out.fov = fov
  }

  // ------------------------------------------------------------------ DOM

  mount(el) {
    const sys = skillGroups.find((g) => g.id === 'systems')?.items || []
    const rt = allSkills['Real-Time Systems'] || []
    const ttfb = experience.metrics.find((m) => m.label === 'TTFB')
    this.ttfb = ttfb
    const tags = [...rt, ...sys.filter((s) => !rt.includes(s))]
    el.innerHTML = `
      <div class="w-head rt-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">Real-Time<br>Systems</h2>
        <p class="w-lede">Models are one node. I build the network around them: the streams, signalling, queues and services that carry a voice request there and back in real time.</p>
        <div class="rt-stat"><span><i>NODES</i>${this.topo.nodes.length}</span><span><i>LINKS</i>${this.topo.links.length}</span><span><i>PACKETS IN FLIGHT</i><b class="rt-pk">0</b></span></div>
        <ul class="rt-key">
          <li><i class="g g-rtc"></i><b>WEBRTC</b><span>continuous media, both ways</span></li>
          <li><i class="g g-wss"></i><b>WSS</b><span>duplex socket, bursty frames</span></li>
          <li><i class="g g-sip"></i><b>SIP</b><span>INVITE → 200 OK → media</span></li>
          <li><i class="g g-pub"></i><b>REDIS</b><span>publish once, fan out to all</span></li>
        </ul>
      </div>
      <div class="rt-scrim fx"></div>
      <div class="rt-trace fx">
        <div class="rt-tr-top"><span>REQUEST TRACE</span><span class="rt-live"><i></i>LIVE</span></div>
        <div class="rt-ms"><b class="rt-ms-v">0</b><em>ms</em><span class="rt-ms-k">round trip<br>${ttfb ? 'TTFB ' + ttfb.value.replace('<', '&lt;') + ' in production' : ''}</span></div>
        <ol class="rt-hops">${HOPS.map((h, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="k">${h[0]}</span><span class="d">${h[1]}</span></li>`).join('')}</ol>
        <div class="rt-bar"><i></i></div>
      </div>
      <div class="rt-pillars fx">
        ${readout('LOW LATENCY', ttfb ? ttfb.value.replace('<', '&lt;') : '&lt;300 ms', 'TTFB · real-time voice agent in production')}
        ${readout('DISTRIBUTED', 'Microservices', 'FastAPI gateways · Redis pub/sub')}
        ${readout('REAL-TIME', 'WebRTC · SIP', 'WebSockets · low-latency streaming')}
      </div>
      <div class="rt-tags fx">${tags.map(tag).join('')}</div>
    `
    this.dom = {
      head: el.querySelector('.rt-head'), scrim: el.querySelector('.rt-scrim'), trace: el.querySelector('.rt-trace'), pillars: el.querySelector('.rt-pillars'), tags: el.querySelector('.rt-tags'),
      ms: el.querySelector('.rt-ms-v'), pk: el.querySelector('.rt-pk'), hops: [...el.querySelectorAll('.rt-hops li')], bar: el.querySelector('.rt-bar i'),
    }
    this._hopState = -2
  }

  // ------------------------------------------------------------------ frame

  update(p, dt, t, k = 0) {
    const ctx = this.ctx, cam = ctx.camera, T = this.topo
    this.uTime.value = t
    this.uFog.value = ctx.scene.fog.density
    this.uPx.value = ctx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))
    // flight-in: the network powers up as the camera arrives
    const rv = k > 0 ? smoother(clamp(k * 1.5 - 0.35)) : 1
    this.reveal = damp(this.reveal, rv, 8, dt)
    this.uReveal.value = k > 0 ? rv : this.reveal

    // atmosphere follows the shot: clear for wide shots, denser while inside the network
    const inside = band(p, F0 * 0.6, F0 + 0.04, F1 - 0.02, F1 + 0.06)
    const wide = range(p, F1 + 0.02, F2)
    this.fog = lerp(lerp(0.0028, 0.0042, inside), 0.0017, wide)
    this.bloom = lerp(0.9, 1.0, inside)

    // --- request progress ---
    const f = range(p, F0, F1)
    const o = this.evalRoute(f, this._routeEval)
    const following = band(p, F0 * 0.55, F0 + 0.01, F1, F1 + 0.05)
    this.trailU.uProg.value = o.u
    this.trailU.uShow.value = following
    this.head.visible = following > 0.01
    this.head.position.copy(o.pos)
    faceCamera(this.headHalo, cam)
    const dwellPulse = o.dwell >= 4 && o.dwell <= 6 ? 0.8 + 0.4 * Math.sin(t * 9) : 1
    this.headHalo.material.uniforms.uI.value = 0.45 * following * dwellPulse
    this.head.children[0].visible = o.dwell < 4 || o.dwell > 6
    const heroNode = o.dwell >= 0 ? T.route.hops[o.dwell].id : -1

    // --- pointer ---
    const P = ctx.pointer
    this.ptr = damp(this.ptr, P.moved && k === 0 ? 1 : 0, 4, dt)
    this.uPtr.value = this.ptr
    const ray = this.localRay(this._ray)
    this.uRayO.value.copy(ray.origin); this.uRayD.value.copy(ray.direction)
    const O = ray.origin, D = ray.direction, v = this._v
    let best = -1, bestScore = 1
    const nodes = T.nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      v.copy(n.port).sub(O)
      const tp = v.dot(D)
      if (tp < 2) { n._near = 0; continue }
      const perp = v.addScaledVector(D, -tp).length()
      const ang = perp / tp
      n._near = Math.exp(-(ang * ang) / 0.004)
      const hitR = Math.max(n.S * (n.kind === 'redis' ? 7 : n.kind === 'gw' || n.kind === 'lb' ? 3.4 : n.kind.length === 3 ? 3 : 1.8), tp * 0.012)
      const score = perp / hitR
      if (score < bestScore && tp < 260) { bestScore = score; best = i }
    }
    if (this.ptr < 0.5) best = -1
    if (best !== this.hover) {
      this.hover = best
      if (best >= 0) {
        const n = nodes[best], r = ROLE[n.kind]
        ctx.cursor.hover(r[0], `${n.name} · ${r[1]}`, this)
      } else ctx.cursor.hover(null, null, this)
    }
    // halo on hovered node
    const H = this.halo, hu = H.material.uniforms
    H.userData.o = damp(H.userData.o, best >= 0 ? 1 : 0, 10, dt)
    if (best >= 0) {
      const n = nodes[best]
      if (n.kind === 'redis') H.position.copy(n.pos).addScaledVector(UP, 3.5 * n.S); else H.position.copy(n.port)
      H.userData.scale = n.S * (n.kind === 'redis' ? 17 : n.kind === 'gw' ? 9 : n.kind === 'lb' ? 7.5 : n.kind.length === 3 ? 10.5 : 4.2)
    }
    hu.uO.value = H.userData.o * 0.55
    H.visible = H.userData.o > 0.01
    H.scale.setScalar(H.userData.scale * (1.08 - 0.08 * H.userData.o))
    faceCamera(H, cam)

    // --- node activation ---
    const act = this.ledAct.array
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const target = Math.max(i === best ? 1 : 0, n._near * 0.55 * this.ptr, i === heroNode ? 1 : 0)
      this.nodeAct[i] = damp(this.nodeAct[i], target, target > this.nodeAct[i] ? 10 : 3, dt)
      act[i] = this.nodeAct[i]
    }
    this.ledAct.needsUpdate = true
    for (const s of this.slitMeshes) {
      const arr = s.im.instanceColor.array
      for (let i = 0; i < s.list.length; i++) {
        const a = this.nodeAct[s.list[i].n.id], b = s.base[i]
        const hub = s.list[i].n.kind === 'redis'
        const flick = hub ? 1 : 0.85 + 0.15 * Math.sin(t * 7 + i * 1.7)
        const m = (1.1 + a * (hub ? 0.6 : 1.5)) * flick
        arr[i * 3] = b.r * m; arr[i * 3 + 1] = b.g * m; arr[i * 3 + 2] = b.b * m
      }
      s.im.instanceColor.needsUpdate = true
    }

    // --- links: highlight, pointer activity, time integration (packets near the cursor speed up) ---
    const L = T.links, nL = L.length, data = this.linkData
    const routeSet = this._routeSet ??= new Set(T.route.links.map((r) => r.link.id))
    let pubBoost = 0
    for (let i = 0; i < nL; i++) {
      const l = L[i]
      let near = 0
      if (this.ptr > 0.01) {
        for (const s of SAMP) {
          bez(l.A, l.C, l.B, s, v).sub(O)
          const tp = v.dot(D)
          if (tp < 2) continue
          const ang = v.addScaledVector(D, -tp).length() / tp
          near = Math.max(near, Math.exp(-(ang * ang) / 0.0025))
        }
      }
      const hlT = best >= 0 && (l.a === best || l.b === best) ? 1 : routeSet.has(l.id) ? following * 0.35 : 0
      this.linkHl[i] = damp(this.linkHl[i], hlT, 8, dt)
      this.linkAct[i] = damp(this.linkAct[i], near * this.ptr, 6, dt)
      const boost = this.linkAct[i] * 2.2 + this.linkHl[i] * 1.4
      if (l.kind === K.PUBSUB) pubBoost = Math.max(pubBoost, boost)
      else this.linkTime[i] += dt * (1 + boost)
    }
    this.pubTime += dt * (1 + pubBoost * 0.6)
    for (let i = 0; i < nL; i++) {
      data[i * 4 + 3] = L[i].kind === K.PUBSUB ? this.pubTime : this.linkTime[i]
      data[(nL + i) * 4 + 3] = this.linkHl[i]
      data[(2 * nL + i) * 4 + 3] = this.linkAct[i]
    }
    this.linkTex.needsUpdate = true
    for (const pm of this.pulseMats) pm.m.uniforms.uC.value = (this.pubTime / 1.9 + pm.off) % 1
    this.floorMats.forEach((fm, i) => (fm.uniforms.uPulse.value = this.pulseMats[i].m.uniforms.uC.value))

    // --- labels: face camera, fade by distance ---
    const cp = this.localCamera(this._cam)
    for (const e of this.labels) {
      const d = e.l.position.distanceTo(cp)
      const a = e.base * (1 - range(d, e.near, e.far)) * range(d, e.n0, e.n1) * this.uReveal.value
      e.l.opacity = a
      if (a > 0.002) faceCamera(e.l, cam)
    }
    const hl = this.headLabel
    hl.opacity = following * 0.95
    if (hl.visible) {
      hl.position.copy(o.pos).addScaledVector(UP, 1.3)
      faceCamera(hl, cam)
      hl.translateX(0.9)
    }

    // --- overlay ---
    const d = this.dom
    if (d) {
      reveal(d.head, band(p, -1, 0, 0.07, 0.12))
      const trv = band(p, F0 - 0.02, F0 + 0.02, F1 + 0.01, F1 + 0.05)
      reveal(d.trace, trv); reveal(d.scrim, trv, 0)
      // flight out: the overlay layer scrolls up with the page; fade before it climbs into the next title / nav
      const kOut = p >= 1 ? (this.ctx.engine?.state?.k || 0) : 0
      const out = 1 - range(kOut, 0.06, 0.3)
      reveal(d.pillars, range(p, F1 + 0.06, F2 - 0.02) * out)
      reveal(d.tags, range(p, F1 + 0.09, F2) * out)
      const ms = Math.round(o.ms + (o.ms > 0 && o.ms < 266 ? Math.sin(t * 23) * 0.6 : 0))
      if (t - this._lastText > 0.07) {
        this._lastText = t
        d.ms.textContent = String(ms)
        d.pk.textContent = Math.round(this.packetCount * (0.62 + 0.04 * Math.sin(t * 3.1) + 0.02 * Math.sin(t * 11.7))).toLocaleString('en-US')
        const hop = HOPS[o.hop]
        hl.setText(`REQ · ${String(ms).padStart(3, '0')} ms\n${hop[0]}${hop[1] ? ' · ' + hop[1].toUpperCase() : ''}`)
      }
      const hs = o.hop * 2 + (o.dwell >= 0 ? 1 : 0)
      if (hs !== this._hopState) {
        this._hopState = hs
        d.hops.forEach((li, i) => { li.classList.toggle('is-done', i < o.hop || (i === o.hop && f >= 1)); li.classList.toggle('is-on', i === o.hop && f < 1) })
      }
      d.bar.style.transform = `scaleX(${o.u.toFixed(4)})`
    }

    // billboards
    for (const h of this.hazes) faceCamera(h, cam)
  }

  onLeave() { this.ctx.cursor.hover(null, null, this); this.hover = -1 }
}
