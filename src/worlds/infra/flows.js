import * as THREE from 'three'
import { HASH, FOG_ADD, shader, additive } from './gl.js'
import { POINT_FRAG } from '../../lib/glsl.js'

// Data moving between compute nodes: packets travel along quadratic curves, each packet a short comet
// (head + fading tail points). One Points draw call; positions are computed in the vertex shader.

const MAXC = 24

export class Flows {
  constructor(uTime, { low }) {
    this.uTime = uTime
    this.low = low
    this.curves = []
  }
  /** a → b with the control point lifted by `lift` (or given explicitly). */
  add(a, b, { lift = 3, ctrl = null, color = '#62d8ff', packets = 10, speed = 10, size = 1, intensity = 2.4 } = {}) {
    if (this.curves.length >= MAXC) return
    const c = ctrl ?? new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).add(new THREE.Vector3(0, lift, 0))
    const len = a.distanceTo(c) + c.distanceTo(b)
    this.curves.push({ a: a.clone(), b: b.clone(), c, color: new THREE.Color(color).multiplyScalar(intensity), packets: Math.max(1, Math.round(packets * (this.low ? 0.6 : 1))), speed: speed / len, size })
  }
  build() {
    const TAIL = this.low ? 4 : 7
    let n = 0
    for (const c of this.curves) n += c.packets * TAIL
    const pos = new Float32Array(n * 3), aC = new Float32Array(n), aPh = new Float32Array(n), aT = new Float32Array(n), aSp = new Float32Array(n), aSz = new Float32Array(n)
    let i = 0
    this.curves.forEach((c, ci) => {
      for (let k = 0; k < c.packets; k++) {
        const ph = (k + Math.random() * 0.6) / c.packets
        const sp = c.speed * (0.8 + Math.random() * 0.4)
        for (let t = 0; t < TAIL; t++) {
          aC[i] = ci; aPh[i] = ph; aT[i] = t / TAIL; aSp[i] = sp; aSz[i] = c.size
          i++
        }
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aCurve', new THREE.BufferAttribute(aC, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(aPh, 1))
    g.setAttribute('aTail', new THREE.BufferAttribute(aT, 1))
    g.setAttribute('aSpeed', new THREE.BufferAttribute(aSp, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(aSz, 1))
    const P = [], C = []
    for (let k = 0; k < MAXC; k++) {
      const c = this.curves[k]
      P.push(c ? c.a : new THREE.Vector3(), c ? c.c : new THREE.Vector3(), c ? c.b : new THREE.Vector3())
      C.push(c ? c.color : new THREE.Color())
    }
    this.uniforms = { uTime: this.uTime, uP: { value: P }, uCol: { value: C }, uPx: { value: 1 }, uAlpha: { value: 1 } }
    const mat = shader({
      uniforms: this.uniforms,
      ...additive,
      vertexShader: /* glsl */`
        uniform vec3 uP[${MAXC * 3}]; uniform vec3 uCol[${MAXC}];
        uniform float uTime, uPx;
        attribute float aCurve, aPhase, aTail, aSpeed, aSize;
        varying vec3 vCol; varying float vA;
        #include <fog_pars_vertex>
        void main(){
          int ci = int(aCurve + 0.5);
          vec3 a = uP[ci*3], c = uP[ci*3+1], b = uP[ci*3+2];
          float t = fract(aPhase + uTime * aSpeed - aTail * 0.035);
          float it = 1.0 - t;
          vec3 p = it*it*a + 2.0*it*t*c + t*t*b;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float ends = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.9, t);
          vA = (1.0 - aTail) * ends;
          vCol = uCol[ci];
          gl_PointSize = uPx * aSize * (1.0 - aTail * 0.55) * 26.0 / max(-mvPosition.z, 0.5);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uAlpha;
        varying vec3 vCol; varying float vA;
        #include <fog_pars_fragment>
        ${POINT_FRAG}
        void main(){
          float s = softPoint(gl_PointCoord);
          gl_FragColor = vec4(vCol * s * vA * uAlpha, 1.0);
          ${FOG_ADD}
        }`,
    })
    this.points = new THREE.Points(g, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 4
    return this.points
  }
}
