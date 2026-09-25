import * as THREE from 'three'
import { Label } from '../../lib/label.js'
import { HEX } from '../../lib/palette.js'
import { smat, HASH, FOGF } from './shaders.js'
import { HEADS, HEAD_Y, MAST, CAMERA, MICS, CABINET } from './layout.js'

// ---------------------------------------------------------------- signal controller
// A tiny phase state machine: a change of requested axis always goes green → amber → all-red → green.
export class Signals {
  constructor() { this.G = 'EW'; this.phase = 'green'; this.timer = 0 }
  snap(req) { this.G = req; this.phase = 'green'; this.timer = 0 }
  update(dt, req) {
    if (this.phase === 'green') { if (req !== this.G) { this.phase = 'amber'; this.timer = 1.3 } }
    else if (this.phase === 'amber') { this.timer -= dt; if (this.timer <= 0) { this.phase = 'allred'; this.timer = 0.7 } }
    else { this.timer -= dt; if (this.timer <= 0) { this.G = req; this.phase = 'green' } }
  }
  state(axis) { return axis === this.G ? (this.phase === 'allred' ? 'red' : this.phase) : 'red' }
}

const LAMP_COL = { red: [1.0, 0.07, 0.09], amber: [1.0, 0.5, 0.08], green: [0.16, 1.0, 0.6] }

// ---------------------------------------------------------------- signal lamps (+ halos)
export class SignalLamps {
  constructor() {
    const n = HEADS.length * 3
    this.n = n
    const disc = new THREE.CircleGeometry(0.2, 18)
    this.mesh = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff }), n)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
    this.pos = []
    HEADS.forEach((H, hi) => {
      const ang = Math.atan2(H.face[0], H.face[1])
      q.setFromAxisAngle(up, ang)
      for (let k = 0; k < 3; k++) {
        const y = HEAD_Y + 0.55 - k * 0.55
        p.set(H.x + H.face[0] * 0.32, y, H.z + H.face[1] * 0.32)
        m4.compose(p, q, s)
        this.mesh.setMatrixAt(hi * 3 + k, m4)
        this.pos.push(p.clone())
      }
    })
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    // camera-facing halos (also used for the ambulance beacons: two extra slots)
    const hn = n + 2
    const g = new THREE.InstancedBufferGeometry()
    const base = new THREE.PlaneGeometry(1, 1)
    g.index = base.index; g.setAttribute('position', base.attributes.position)
    this.hP = new THREE.InstancedBufferAttribute(new Float32Array(hn * 4), 4)
    this.hC = new THREE.InstancedBufferAttribute(new Float32Array(hn * 3), 3)
    this.hP.setUsage(THREE.DynamicDrawUsage); this.hC.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aP', this.hP); g.setAttribute('aC', this.hC)
    g.instanceCount = hn
    this.halos = new THREE.Mesh(g, smat({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        attribute vec4 aP; attribute vec3 aC; varying vec2 vQ; varying vec3 vC;
        void main(){ vQ = position.xy; vC = aC;
          vec4 mvPosition = modelViewMatrix * vec4(aP.xyz, 1.0);
          mvPosition.xy += position.xy * aP.w; mvPosition.z += 0.6;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        ${FOGF}
        varying vec2 vQ; varying vec3 vC;
        void main(){ float d = length(vQ)*2.0; float a = exp(-d*d*5.0)*0.9 + exp(-d*3.2)*0.25; a *= smoothstep(1.0, 0.7, d);
          gl_FragColor = vec4(vC * a * (1.0 - fogF()), 1.0); }`,
    }))
    this.halos.frustumCulled = false
    this.halos.renderOrder = 6
    this.group = new THREE.Group()
    this.group.add(this.mesh, this.halos)
    this.c = new THREE.Color()
  }
  facing(H) { const c = this.cam; if (!c) return 1; const dx = c.x - H.x, dz = c.z - H.z; const d = (dx * H.face[0] + dz * H.face[1]) / Math.max(1e-3, Math.hypot(dx, dz)); return Math.max(0, Math.min(1, d * 2.5 + 0.2)) }
  /** state(axis) → 'green'|'amber'|'red'. Writes lamp colours, halos and returns lit lamp list for streaks. */
  update(state, S, o, beacon) {
    const col = this.mesh.instanceColor.array
    HEADS.forEach((H, hi) => {
      const st = state(H.axis)
      const lit = st === 'red' ? 0 : st === 'amber' ? 1 : 2
      for (let k = 0; k < 3; k++) {
        const key = k === 0 ? 'red' : k === 1 ? 'amber' : 'green'
        const c = LAMP_COL[key], on = k === lit
        const I = on ? 3.4 : 0.035
        const j = (hi * 3 + k)
        col[j * 3] = c[0] * I; col[j * 3 + 1] = c[1] * I; col[j * 3 + 2] = c[2] * I
        const pp = this.pos[j]
        this.hP.setXYZW(j, pp.x, pp.y, pp.z, on ? 0.95 * this.facing(H) : 0)
        this.hC.setXYZ(j, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6)
        if (on) S.set(o++, pp.x, pp.y, pp.z, 0.7, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5)
      }
    })
    // beacons
    const n = this.n
    this.hP.setXYZW(n, beacon.x - 0.5, 1.95, beacon.z - 2.25, 0.8 + beacon.r * 2.2)
    this.hC.setXYZ(n, 1.0 * beacon.r, 0.05 * beacon.r, 0.06 * beacon.r)
    this.hP.setXYZW(n + 1, beacon.x + 0.5, 1.95, beacon.z - 2.25, 0.8 + beacon.b * 2.2)
    this.hC.setXYZ(n + 1, 0.1 * beacon.b, 0.3 * beacon.b, 1.0 * beacon.b)
    this.mesh.instanceColor.needsUpdate = true
    this.hP.needsUpdate = true; this.hC.needsUpdate = true
    return o
  }
}

// ---------------------------------------------------------------- spectrogram
// A log-mel spectrogram as a scrolling terrain: time along the ribbon (newest at the microphone end),
// mel bins across it, energy as height. The siren's wail is a rising/falling harmonic stack.
export function buildSpectrogram(quality) {
  const NT = quality === 'low' ? 80 : 128, NF = quality === 'low' ? 32 : 48
  const LT = 24, LF = 10, A = 3.2
  const uniforms = { uTime: { value: 0 }, uSiren: { value: 0 }, uAmt: { value: 0 } }
  const SPEC = /* glsl */`
    uniform float uTime, uSiren, uAmt;
    ${HASH}
    float spec(vec2 uv){
      float tm = uTime - (1.0 - uv.x)*5.0;
      float m = uv.y;
      float wail = 0.24 + 0.12*sin(tm*6.2831/3.2);
      float h = 0.0;
      for (int k = 1; k <= 4; k++) {
        float fk = float(k);
        float mk = wail + log2(fk)*0.21;
        float w = 0.014 + 0.006*fk;
        float e = (m - mk)/w; h += (1.15/fk) * exp(-e*e);
      }
      h *= uSiren;
      float nz = vnoise(vec2(m*11.0, tm*6.0))*0.6 + vnoise(vec2(m*29.0, tm*17.0))*0.4;
      h += nz * (0.05 + 0.2*pow(clamp(1.0 - m, 0.0, 1.0), 3.0));
      return h;
    }`
  const vert = /* glsl */`
    #include <fog_pars_vertex>
    ${SPEC}
    varying float vH; varying vec2 vUv;
    void main(){
      vUv = uv;
      float h = spec(uv);
      vH = h;
      vec3 p = vec3((uv.x - 0.5)*${LT.toFixed(1)}, h*${A.toFixed(1)}*uAmt, (uv.y - 0.5)*${LF.toFixed(1)});
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`
  const surf = new THREE.PlaneGeometry(1, 1, NT - 1, NF - 1)
  const surfMat = smat({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: vert,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${FOGF}
      uniform float uAmt;
      varying float vH; varying vec2 vUv;
      void main(){
        float h = clamp(vH, 0.0, 1.4);
        vec3 c = mix(vec3(0.004, 0.014, 0.04), vec3(0.12, 0.45, 0.85), smoothstep(0.05, 0.55, h));
        c = mix(c, vec3(0.75, 0.95, 1.2), smoothstep(0.6, 1.1, h));
        float edge = 1.0 - smoothstep(0.0, 0.025, 1.0 - vUv.x);
        float old = smoothstep(0.0, 0.25, vUv.x);
        float a = (0.03 + 0.28*h*h) * old * uAmt;
        gl_FragColor = vec4((c*a + vec3(0.3, 0.8, 1.0)*edge*0.35*uAmt) * (1.0 - fogF()), 1.0);
      }`,
  })
  const surfMesh = new THREE.Mesh(surf, surfMat)
  // ridge lines along time, one per mel bin (every other bin), plus a sparse time grid
  const pos = [], uv = []
  for (let f = 0; f < NF; f += 2) for (let t = 0; t < NT - 1; t++) { uv.push(t / (NT - 1), f / (NF - 1), (t + 1) / (NT - 1), f / (NF - 1)); pos.push(0, 0, 0, 0, 0, 0) }
  for (let t = 0; t < NT; t += 16) for (let f = 0; f < NF - 1; f++) { uv.push(t / (NT - 1), f / (NF - 1), t / (NT - 1), (f + 1) / (NF - 1)); pos.push(0, 0, 0, 0, 0, 0) }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const lineMat = smat({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: vert,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${FOGF}
      uniform float uAmt;
      varying float vH; varying vec2 vUv;
      void main(){
        float h = clamp(vH, 0.0, 1.4);
        vec3 c = mix(vec3(0.05, 0.22, 0.45), vec3(0.45, 0.9, 1.3), smoothstep(0.15, 0.9, h));
        float old = smoothstep(0.0, 0.3, vUv.x);
        gl_FragColor = vec4(c * (0.06 + 0.75*h*h) * old * uAmt * (1.0 - fogF()), 1.0);
      }`,
  })
  lineMat.uniforms = surfMat.uniforms   // share the same uniform objects
  const lines = new THREE.LineSegments(lg, lineMat)
  // frame
  const fr = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-LT / 2, 0, -LF / 2), new THREE.Vector3(LT / 2, 0, -LF / 2),
    new THREE.Vector3(LT / 2, 0, -LF / 2), new THREE.Vector3(LT / 2, 0, LF / 2),
    new THREE.Vector3(LT / 2, 0, LF / 2), new THREE.Vector3(-LT / 2, 0, LF / 2),
    new THREE.Vector3(LT / 2, 0, -LF / 2), new THREE.Vector3(LT / 2, A * 1.1, -LF / 2),
  ])
  const frameMat = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(0.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const frame = new THREE.LineSegments(fr, frameMat)
  const inner = new THREE.Group()
  inner.add(surfMesh, lines, frame)
  for (const o of [surfMesh, lines]) o.frustumCulled = false
  return { group: inner, uniforms: surfMat.uniforms, frameMat, LT, LF, A }
}

// ---------------------------------------------------------------- flowing conduits
// Signal paths drawn on the physical infrastructure: camera → controller (vision), microphones →
// controller (audio + direction), controller → every signal head (output), and the live bearing ray.
export function buildConduits() {
  const pos = [], dist = [], ch = []
  const path = (pts, c, off = 0) => {
    let d = off
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = a.distanceTo(b)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); dist.push(d, d + l); ch.push(c, c); d += l
    }
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const cabTop = V(CABINET.x - 0.2, CABINET.h + 0.1, CABINET.z)
  // vision: camera → along arm → down the mast → cabinet
  path([V(CAMERA.x + 0.25, CAMERA.y - 0.05, CAMERA.z - 0.12), V(MAST.x - 0.2, 6.32, MAST.z - 0.12), V(MAST.x - 0.2, 1.9, MAST.z - 0.12), cabTop], 0)
  // audio: each mic → bar centre → down the mast → cabinet
  path([V(MICS.x - MICS.half, MICS.y + 0.05, MICS.z + 0.12), V(MICS.x + 0.2, MICS.y + 0.05, MICS.z + 0.12), V(MAST.x + 0.2, 1.9, MAST.z + 0.12), V(CABINET.x + 0.2, CABINET.h + 0.1, CABINET.z)], 1)
  path([V(MICS.x + MICS.half, MICS.y + 0.05, MICS.z + 0.12), V(MICS.x + 0.2, MICS.y + 0.05, MICS.z + 0.12)], 1)
  // output: cabinet → up the mast → along the arm → NB heads; and across the street to the other poles
  const up = [cabTop, V(MAST.x, 1.9, MAST.z + 0.2), V(MAST.x, 6.05, MAST.z + 0.2)]
  path([...up, V(5.25, 6.05, MAST.z + 0.2), V(5.25, HEAD_Y + 1.0, MAST.z + 0.2)], 2)
  path([V(5.25, 6.05, MAST.z + 0.2), V(1.75, 6.05, MAST.z + 0.2), V(1.75, HEAD_Y + 1.0, MAST.z + 0.2)], 2, 12)
  const g0 = 0.06
  path([V(CABINET.x, g0, CABINET.z + 0.4), V(MAST.x + 0.6, g0, -7.4), V(MAST.x + 0.6, g0, 9.5), V(9.5, g0, 9.5)], 2)
  path([V(MAST.x + 0.6, g0, -7.4), V(-9.5, g0, -7.4), V(-9.5, g0, -9.5)], 2, 3)
  path([V(-9.5, g0, -7.4), V(-9.5, g0, 7.4), V(-9.5, g0, 9.5)], 2, 22)
  // bearing ray (updated per frame: mic centre → ambulance)
  const rayStart = pos.length / 3
  pos.push(0, 0, 0, 0, 0, 0); dist.push(0, 1); ch.push(3, 3)
  const g = new THREE.BufferGeometry()
  const pa = new THREE.Float32BufferAttribute(pos, 3), da = new THREE.Float32BufferAttribute(dist, 1)
  pa.setUsage(THREE.DynamicDrawUsage); da.setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('position', pa); g.setAttribute('aD', da); g.setAttribute('aCh', new THREE.Float32BufferAttribute(ch, 1))
  const m = smat({
    uniforms: { uTime: { value: 0 }, uFlow: { value: new THREE.Vector4() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute float aD; attribute float aCh; varying float vD; varying float vCh;
      void main(){ vD = aD; vCh = aCh; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${FOGF}
      uniform float uTime; uniform vec4 uFlow; varying float vD; varying float vCh;
      void main(){
        float k = vCh < 0.5 ? uFlow.x : vCh < 1.5 ? uFlow.y : vCh < 2.5 ? uFlow.z : uFlow.w;
        float speed = vCh > 2.5 ? -9.0 : 5.0;
        float dash = smoothstep(0.55, 1.0, fract(vD*0.28 - uTime*speed*0.28));
        vec3 c = vec3(0.30, 0.78, 1.0) * (0.18 + dash*2.2) * k;
        gl_FragColor = vec4(c * (1.0 - fogF()), 1.0);
      }`,
  })
  const lines = new THREE.LineSegments(g, m)
  lines.frustumCulled = false
  lines.renderOrder = 5
  return {
    mesh: lines, uniforms: m.uniforms,
    setRay(a, b) { const i = rayStart; pa.setXYZ(i, a.x, a.y, a.z); pa.setXYZ(i + 1, b.x, b.y, b.z); da.setX(i + 1, a.distanceTo(b)); pa.needsUpdate = true; da.needsUpdate = true },
  }
}

// ---------------------------------------------------------------- camera frustum
export function buildFrustum() {
  const o = new THREE.Vector3(CAMERA.x, CAMERA.y, CAMERA.z + 0.6)
  const far = 120, hx = Math.tan(THREE.MathUtils.degToRad(17)), vy = Math.tan(THREE.MathUtils.degToRad(9)), pitch = -0.055
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(o.x + sx * hx * far, o.y + (pitch + sy * vy) * far, o.z + far))
  corners.forEach((c) => { c.y = Math.max(c.y, 0.05) })
  const pos = [], a = []
  for (const c of corners) { pos.push(o.x, o.y, o.z, c.x, c.y, c.z); a.push(1, 0) }
  // faint volume (4 side faces)
  const vpos = [], va = []
  for (let i = 0; i < 4; i++) { const c1 = corners[i], c2 = corners[(i + 1) % 4]; vpos.push(o.x, o.y, o.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z); va.push(1, 0, 0) }
  const mk = (P, A, vol) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 1))
    return g
  }
  const mat = (k) => smat({
    uniforms: { uO: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute float aA; varying float vA;
      void main(){ vA = aA; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${FOGF}
      uniform float uO; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.30, 0.78, 1.0) * pow(max(vA, 0.0), 1.5) * uO * ${k} * (1.0 - fogF()), 1.0); }`,
  })
  const lines = new THREE.LineSegments(mk(pos, a), mat('0.9'))
  const vol = new THREE.Mesh(mk(vpos, va), mat('0.012'))
  vol.material.uniforms = lines.material.uniforms
  const group = new THREE.Group()
  group.add(vol, lines)
  return { group, uniforms: lines.material.uniforms }
}

// ---------------------------------------------------------------- labels
export function label(text, o = {}) {
  const l = new Label(text, { height: 0.34, color: HEX.white, ...o })
  l.material.fog = true
  return l
}
