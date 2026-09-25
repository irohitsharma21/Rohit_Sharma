import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, clamp } from '../../lib/math.js'
import { smat, FOGF } from './shaders.js'
import { STOP, LANE } from './layout.js'

const LEN = 320            // lane loop length
const CAR_L = 4.4, CAR_W = 1.8

// Lanes carrying ordinary traffic. The northbound inner lane (x = +1.75) is kept for the ambulance.
const LANES = [
  { x: LANE[1], z: 0, dx: 0, dz: -1, axis: 'NS' },
  { x: -LANE[0], z: 0, dx: 0, dz: 1, axis: 'NS' },
  { x: -LANE[1], z: 0, dx: 0, dz: 1, axis: 'NS' },
  { x: 0, z: LANE[0], dx: 1, dz: 0, axis: 'EW' },
  { x: 0, z: LANE[1], dx: 1, dz: 0, axis: 'EW' },
  { x: 0, z: -LANE[0], dx: -1, dz: 0, axis: 'EW' },
  { x: 0, z: -LANE[1], dx: -1, dz: 0, axis: 'EW' },
]

function tint(geo, c) {
  const n = geo.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set(c, i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}
function kind(geo, k) {
  geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(k), 1))
  return geo
}
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

/** Car geometry, forward = −z (local). */
function carGeometry() {
  const body = tint(bx(CAR_W, 0.62, CAR_L, 0, 0.62, 0), [1, 1, 1])
  const nose = tint(bx(CAR_W * 0.96, 0.18, 1.0, 0, 0.98, -1.55), [1, 1, 1])
  const cabin = tint(bx(CAR_W * 0.9, 0.56, 2.1, 0, 1.2, 0.25), [0.12, 0.13, 0.15])
  const roof = tint(bx(CAR_W * 0.84, 0.05, 1.7, 0, 1.5, 0.3), [0.55, 0.55, 0.55])
  const wheels = []
  for (const x of [-0.82, 0.82]) for (const z of [-1.35, 1.35]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10); w.rotateZ(Math.PI / 2); w.translate(x, 0.34, z)
    wheels.push(tint(w, [0.05, 0.05, 0.05]))
  }
  return mergeGeometries([body, nose, cabin, roof, ...wheels].map((g) => g.toNonIndexed()))
}
function lightGeometry() {
  const parts = []
  for (const x of [-0.62, 0.62]) {
    parts.push(kind(bx(0.36, 0.13, 0.05, x, 0.78, -CAR_L / 2 - 0.02), 0))
    parts.push(kind(bx(0.42, 0.1, 0.05, x, 0.86, CAR_L / 2 + 0.02), 1))
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))
}

export class Traffic {
  constructor(quality) {
    const R = rng(77)
    this.perLane = quality === 'low' ? 4 : 6
    this.cars = []
    LANES.forEach((ln, li) => {
      const arr = []
      const n = this.perLane
      for (let i = 0; i < n; i++) arr.push({ lane: ln, li, s: (i / n) * LEN + R() * (LEN / n) * 0.5, v: 8 + R() * 3, vmax: 10.5 + R() * 3.5, brake: 0, conf: 0.82 + R() * 0.13, id: 0 })
      arr.sort((a, b) => a.s - b.s)
      ln.cars = arr
      this.cars.push(...arr)
    })
    this.cars.forEach((c, i) => { c.id = i + 2; c.x = 0; c.z = 0 })
    const N = this.cars.length
    this.N = N
    // shared instance matrices + per-instance brake
    const palette = [[0.10, 0.11, 0.13], [0.16, 0.18, 0.21], [0.06, 0.07, 0.08], [0.32, 0.35, 0.39], [0.09, 0.12, 0.17], [0.22, 0.23, 0.25]]
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.5, envMapIntensity: 0.07 })
    this.bodies = new THREE.InstancedMesh(carGeometry(), bodyMat, N)
    const col = new THREE.Color()
    for (let i = 0; i < N; i++) { const c = palette[Math.floor(R() * palette.length)]; col.setRGB(c[0] * 1.3, c[1] * 1.3, c[2] * 1.3); this.bodies.setColorAt(i, col) }
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.aBrake = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    this.aBrake.setUsage(THREE.DynamicDrawUsage)

    const lg = lightGeometry()
    lg.setAttribute('aBrake', this.aBrake)
    const lightMat = smat({
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        attribute float aKind; attribute float aBrake; varying float vK; varying float vB;
        void main(){ vK = aKind; vB = aBrake; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        ${FOGF}
        varying float vK; varying float vB;
        void main(){
          vec3 c = vK < 0.5 ? vec3(0.95, 1.0, 1.08) : vec3(1.3, 0.035, 0.05) * (0.55 + 2.6*vB);
          gl_FragColor = vec4(c * (1.0 - fogF()*0.9), 1.0);
        }`,
    })
    this.lights = new THREE.InstancedMesh(lg, lightMat, N)
    this.lights.instanceMatrix = this.bodies.instanceMatrix

    // headlight throw + brake glow on the road, and a soft contact shadow
    const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    dg.setAttribute('aBrake', this.aBrake)
    const decalMat = smat({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        attribute float aBrake; varying vec2 vQ; varying float vB;
        void main(){
          vQ = vec2(position.x, position.z);
          vec3 p = vec3(position.x*7.0, 0.04, position.z*28.0 - 5.0);   // spans z in [-19, 9]
          vB = aBrake;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        ${FOGF}
        varying vec2 vQ; varying float vB;
        void main(){
          float z = vQ.y*28.0 - 5.0; float x = vQ.x*7.0;
          float ahead = -z - 2.2;                                  // metres in front of the bumper
          float spread = 0.7 + max(ahead, 0.0)*0.2;
          float head = smoothstep(0.0, 2.5, ahead) * exp(-max(ahead, 0.0)/9.0) * exp(-x*x/(spread*spread));
          float behind = z - 2.2;
          float tail = smoothstep(0.0, 0.6, behind) * exp(-max(behind, 0.0)/1.6) * exp(-x*x/1.2);
          vec3 c = vec3(0.11, 0.12, 0.14)*head + vec3(0.5, 0.01, 0.02)*tail*(0.25 + 1.2*vB);
          gl_FragColor = vec4(c * (1.0 - fogF()), 1.0);
        }`,
    })
    this.decals = new THREE.InstancedMesh(dg, decalMat, N)
    this.decals.instanceMatrix = this.bodies.instanceMatrix
    const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const shadowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`varying vec2 vQ; void main(){ vQ = position.xz; vec3 p = vec3(position.x*2.8, 0.03, position.z*5.6); gl_Position = projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.0); }`,
      fragmentShader: /* glsl */`varying vec2 vQ; void main(){ vec2 q = vQ*2.0; float d = length(q*vec2(1.0, 1.0)); float a = smoothstep(1.0, 0.25, d)*0.75; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    })
    this.shadows = new THREE.InstancedMesh(sg, shadowMat, N)
    this.shadows.instanceMatrix = this.bodies.instanceMatrix
    this.shadows.renderOrder = -1

    for (const m of [this.bodies, this.lights, this.decals, this.shadows]) m.frustumCulled = false
    this.group = new THREE.Group()
    this.group.add(this.shadows, this.bodies, this.lights, this.decals)
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._up = new THREE.Vector3(0, 1, 0)
    this.write()
  }

  /** Advance the simulation. light(axis) returns 'green' | 'amber' | 'red'. */
  step(dt, light) {
    const sStop = LEN / 2 - STOP - CAR_L / 2 - 0.4
    for (const ln of LANES) {
      const arr = ln.cars, n = arr.length
      const st = light(ln.axis)
      for (let i = 0; i < n; i++) {
        const c = arr[i], lead = arr[(i + 1) % n]
        let gap = ((lead.s - c.s + LEN) % LEN) - CAR_L - 2.2
        if (st !== 'green' && c.s < sStop + 0.3) {
          const toStop = sStop - c.s
          // on amber, cars already close to the line carry on through
          if (!(st === 'amber' && toStop < c.v * 0.9)) gap = Math.min(gap, toStop)
        }
        const vt = Math.min(c.vmax, Math.sqrt(Math.max(0, 2 * 4.5 * Math.max(0, gap))))
        const v0 = c.v
        c.v = c.v < vt ? Math.min(vt, c.v + 3.2 * dt) : vt
        const decel = (v0 - c.v) / Math.max(dt, 1e-3)
        const b = decel > 0.6 || c.v < 0.4 ? 1 : 0
        c.brake += (b - c.brake) * Math.min(1, dt * 10)
      }
      for (let i = 0; i < n; i++) { const c = arr[i]; c.s += c.v * dt; if (c.s >= LEN) c.s -= LEN }
    }
    this.write()
  }

  write() {
    const { _m, _q, _p, _s, _up } = this
    let i = 0
    for (const c of this.cars) {
      const ln = c.lane
      const a = c.s - LEN / 2
      c.x = ln.x + ln.dx * a; c.z = ln.z + ln.dz * a
      _p.set(c.x, 0, c.z)
      _q.setFromAxisAngle(_up, Math.atan2(-ln.dx, -ln.dz))
      _m.compose(_p, _q, _s)
      this.bodies.setMatrixAt(i, _m)
      this.aBrake.array[i] = c.brake
      i++
    }
    this.bodies.instanceMatrix.needsUpdate = true
    this.aBrake.needsUpdate = true
  }

  /** Push head/tail light reflections into the streak buffer starting at index o. Returns next index. */
  streaks(S, o) {
    for (const c of this.cars) {
      const ln = c.lane
      const hx = c.x + ln.dx * 2.3, hz = c.z + ln.dz * 2.3
      const tx = c.x - ln.dx * 2.3, tz = c.z - ln.dz * 2.3
      S.set(o++, hx, 0.8, hz, 0.55, 0.30, 0.33, 0.38)
      const b = 0.12 + c.brake * 0.55
      S.set(o++, tx, 0.85, tz, 0.5, b, b * 0.02, b * 0.03)
    }
    return o
  }
}

// ---------------------------------------------------------------- ambulance
export class Ambulance {
  constructor() {
    const white = [], dark = [], red = [], blue = [], head = [], tail = []
    white.push(bx(2.3, 2.25, 4.3, 0, 0.45 + 1.125, 0.75))       // patient module
    white.push(bx(2.15, 1.35, 1.9, 0, 0.45 + 0.68, -2.35))       // cab
    white.push(bx(2.1, 0.5, 0.9, 0, 0.72, -3.55))                // bonnet
    dark.push(bx(2.02, 0.55, 0.06, 0, 1.55, -3.3))              // windscreen
    for (const s of [-1, 1]) {
      dark.push(bx(0.05, 0.5, 1.2, s * 1.08, 1.5, -2.35))       // cab side windows
      dark.push(bx(0.04, 0.16, 4.0, s * 1.16, 1.25, 0.75))      // livery band
      dark.push(bx(0.04, 0.5, 0.8, s * 1.16, 2.15, 1.7))        // rear side window
    }
    dark.push(bx(0.04, 1.75, 0.04, 0, 1.5, 2.915))            // rear door split
    for (const s of [-1, 1]) dark.push(bx(0.72, 0.5, 0.04, s * 0.5, 2.2, 2.915))  // rear door windows
    dark.push(bx(2.32, 0.1, 0.04, 0, 0.62, 2.915))            // bumper
    for (const x of [-0.95, 0.95]) for (const z of [-2.6, 1.9]) { const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12); w.rotateZ(Math.PI / 2); w.translate(x, 0.42, z); dark.push(w) }
    red.push(bx(0.72, 0.2, 0.34, -0.5, 1.92, -2.25)); blue.push(bx(0.72, 0.2, 0.34, 0.5, 1.92, -2.25))
    red.push(bx(0.34, 0.18, 0.2, -0.95, 2.78, 2.8)); blue.push(bx(0.34, 0.18, 0.2, 0.95, 2.78, 2.8))
    red.push(bx(0.34, 0.18, 0.2, 0.95, 2.78, -1.3)); blue.push(bx(0.34, 0.18, 0.2, -0.95, 2.78, -1.3))
    head.push(bx(0.4, 0.16, 0.05, -0.72, 0.8, -4.02), bx(0.4, 0.16, 0.05, 0.72, 0.8, -4.02))
    tail.push(bx(0.2, 0.5, 0.05, -1.0, 1.0, 2.92), bx(0.2, 0.5, 0.05, 1.0, 1.0, 2.92))
    const M = (list) => mergeGeometries(list.map((g) => g.toNonIndexed()))
    this.group = new THREE.Group()
    this.redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.06) })
    this.blueMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.3, 1) })
    this.group.add(
      new THREE.Mesh(M(white), new THREE.MeshStandardMaterial({ color: 0x7d858e, metalness: 0.3, roughness: 0.4, envMapIntensity: 0.22 })),
      new THREE.Mesh(M(dark), new THREE.MeshStandardMaterial({ color: 0x0b0e12, metalness: 0.6, roughness: 0.2, envMapIntensity: 0.6 })),
      new THREE.Mesh(M(red), this.redMat), new THREE.Mesh(M(blue), this.blueMat),
      new THREE.Mesh(M(head), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.5) })),
      new THREE.Mesh(M(tail), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.04, 0.05) })),
    )
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 8.4).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position + vec3(0.0, 0.03, 0.0), 1.0); }`,
      fragmentShader: /* glsl */`varying vec2 vU; void main(){ vec2 q = (vU - 0.5)*2.0; float a = smoothstep(1.0, 0.3, length(q))*0.8; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    }))
    sh.renderOrder = -1
    this.group.add(sh)
    this.r = 0; this.b = 0
  }
  /** Double-flash strobe, red and blue in counter-phase. */
  strobe(t, on) {
    const f = (x) => { const u = ((x % 0.56) + 0.56) % 0.56; return (u < 0.07 || (u > 0.12 && u < 0.19)) ? 1 : 0.06 }
    this.r = f(t) * on; this.b = f(t + 0.28) * on
    this.redMat.color.setRGB(1, 0.05, 0.06).multiplyScalar(0.25 + this.r * 5.5)
    this.blueMat.color.setRGB(0.1, 0.3, 1).multiplyScalar(0.25 + this.b * 5.5)
  }
}

export const CAR_DIMS = { l: CAR_L, w: CAR_W, h: 1.55 }
export const clampV = clamp
