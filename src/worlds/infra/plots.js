import * as THREE from 'three'
import { FOG_ADD, shader, additive } from './gl.js'
import { Label } from '../../lib/label.js'
import { HEX } from '../../lib/palette.js'

// Prometheus / Grafana-style monitoring, drawn in space as thin cyan line plots (not a dashboard):
// a scrolling series, a whisper of fill under it, corner brackets and a baseline. They draw on as the camera approaches.

const NP = 4
const SAMPLES = 96

export class Plots {
  constructor(uTime) {
    this.uTime = uTime
    this.defs = []
  }
  /** origin = bottom-left corner; facing = direction the plot faces; w,h size; kind shapes the signal. */
  add({ origin, facing, w = 5, h = 2, kind = 0, title, sub, anchor = null }) {
    const f = facing.clone().setY(0).normalize()
    const right = new THREE.Vector3(0, 1, 0).cross(f).normalize()
    this.defs.push({ origin: origin.clone(), right, up: new THREE.Vector3(0, 1, 0), w, h, kind, title, sub, facing: f, anchor })
  }
  build(root) {
    const n = this.defs.length
    const O = [], Rt = [], S = [], K = [], V = []
    for (let i = 0; i < NP; i++) {
      const d = this.defs[i]
      O.push(d ? d.origin : new THREE.Vector3()); Rt.push(d ? d.right : new THREE.Vector3(1, 0, 0))
      S.push(new THREE.Vector2(d?.w ?? 1, d?.h ?? 1)); K.push(d?.kind ?? 0); V.push(0)
    }
    this.uniforms = { uTime: this.uTime, uO: { value: O }, uR: { value: Rt }, uS: { value: S }, uK: { value: K }, uVis: { value: V } }
    const signal = /* glsl */`
      uniform vec3 uO[${NP}]; uniform vec3 uR[${NP}]; uniform vec2 uS[${NP}]; uniform float uK[${NP}]; uniform float uVis[${NP}];
      uniform float uTime;
      float sig(float x, float k){
        float t = uTime;
        float u = x * 6.0 + t * 0.55;
        float v;
        if (k < 0.5) {            // latency: low, calm, rare small spikes
          v = 0.34 + 0.05*sin(u*1.7) + 0.035*sin(u*4.3 + 1.3) + 0.02*sin(u*11.0);
          v += 0.16 * pow(max(0.0, sin(u*0.63 + 2.0)), 24.0);
        } else if (k < 1.5) {     // throughput: busier, rhythmic
          v = 0.55 + 0.12*sin(u*1.1) + 0.07*sin(u*3.7 + 0.4) + 0.04*sin(u*9.0 + 2.0);
        } else if (k < 2.5) {     // pod cpu: a sawtooth-ish load profile
          v = 0.42 + 0.14*fract(u*0.35) + 0.05*sin(u*5.0);
        } else {                  // pipeline durations: steps
          v = 0.45 + 0.12*sin(floor(u*1.3)*2.1) + 0.03*sin(u*7.0);
        }
        return clamp(v, 0.04, 0.96);
      }`
    // series lines
    const segs = SAMPLES - 1
    const lx = new Float32Array(n * segs * 2), lp = new Float32Array(n * segs * 2)
    let i = 0
    for (let p = 0; p < n; p++) for (let s = 0; s < segs; s++) {
      lx[i] = s / segs; lp[i] = p; i++
      lx[i] = (s + 1) / segs; lp[i] = p; i++
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lx.length * 3), 3))
    lg.setAttribute('aX', new THREE.BufferAttribute(lx, 1))
    lg.setAttribute('aP', new THREE.BufferAttribute(lp, 1))
    const lineMat = shader({
      uniforms: this.uniforms, ...additive,
      vertexShader: /* glsl */`
        ${signal}
        attribute float aX; attribute float aP;
        varying float vA;
        #include <fog_pars_vertex>
        void main(){
          int p = int(aP + 0.5);
          float y = sig(aX, uK[p]);
          vec3 w = uO[p] + uR[p] * (aX * uS[p].x) + vec3(0.0, 1.0, 0.0) * (y * uS[p].y * smoothstep(0.0, 0.35, uVis[p]));
          vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vA = step(aX, uVis[p] * 1.15 - 0.1) * smoothstep(0.0, 0.1, aX) * (0.55 + 0.45 * aX);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(0.38, 0.85, 1.0) * 1.9 * vA, 1.0); ${FOG_ADD} }`,
    })
    const lines = new THREE.LineSegments(lg, lineMat)
    lines.frustumCulled = false; lines.renderOrder = 5
    // fill under the series
    const fx = [], fp = [], ft = []
    for (let p = 0; p < n; p++) for (let s = 0; s < segs; s++) {
      const x0 = s / segs, x1 = (s + 1) / segs
      for (const [x, top] of [[x0, 0], [x1, 0], [x1, 1], [x0, 0], [x1, 1], [x0, 1]]) { fx.push(x); fp.push(p); ft.push(top) }
    }
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fx.length * 3), 3))
    fg.setAttribute('aX', new THREE.BufferAttribute(new Float32Array(fx), 1))
    fg.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(fp), 1))
    fg.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array(ft), 1))
    const fillMat = shader({
      uniforms: this.uniforms, ...additive, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${signal}
        attribute float aX; attribute float aP; attribute float aTop;
        varying float vA; varying float vH;
        #include <fog_pars_vertex>
        void main(){
          int p = int(aP + 0.5);
          float y = sig(aX, uK[p]) * aTop;
          vec3 w = uO[p] + uR[p] * (aX * uS[p].x) + vec3(0.0, 1.0, 0.0) * (y * uS[p].y * smoothstep(0.0, 0.35, uVis[p]));
          vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vA = step(aX, uVis[p] * 1.15 - 0.1) * smoothstep(0.0, 0.15, aX);
          vH = aTop;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vH;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(0.18, 0.49, 1.0) * 0.16 * vA * vH, 1.0); ${FOG_ADD} }`,
    })
    const fill = new THREE.Mesh(fg, fillMat)
    fill.frustumCulled = false; fill.renderOrder = 4
    // static frames: corner brackets, baseline and ticks
    const fr = []
    for (const d of this.defs) {
      const P = (x, y) => d.origin.clone().addScaledVector(d.right, x).addScaledVector(d.up, y)
      const c = 0.35
      const corners = [[0, 0, 1, 1], [d.w, 0, -1, 1], [0, d.h, 1, -1], [d.w, d.h, -1, -1]]
      for (const [x, y, sx, sy] of corners) { fr.push(P(x, y), P(x + sx * c, y), P(x, y), P(x, y + sy * c)) }
      for (let k = 0; k <= 10; k++) { const x = (k / 10) * d.w; fr.push(P(x, -0.05), P(x, k % 5 ? -0.12 : -0.2)) }
      fr.push(P(0, 0), P(d.w, 0))
      fr.push(P(0, -0.25), P(0, d.anchor != null ? d.anchor - d.origin.y : -0.25))
      for (const y of [0.33, 0.66]) for (let k = 0; k < 24; k++) { const x0 = (k / 24) * d.w; fr.push(P(x0, y * d.h), P(x0 + d.w / 80, y * d.h)) }
    }
    const frg = new THREE.BufferGeometry().setFromPoints(fr)
    const frA = new Float32Array(fr.length)
    let fi = 0
    this.defs.forEach((d, p) => { const cnt = 16 + 22 + 2 + 2 + 96; for (let k = 0; k < cnt; k++) frA[fi++] = p })
    frg.setAttribute('aP', new THREE.BufferAttribute(frA, 1))
    const frameMat = shader({
      uniforms: this.uniforms, ...additive,
      vertexShader: /* glsl */`
        uniform float uVis[${NP}];
        attribute float aP; varying float vA;
        #include <fog_pars_vertex>
        void main(){ int p = int(aP + 0.5); vA = smoothstep(0.0, 0.3, uVis[p]); vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */`
        varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(0.62, 0.8, 0.95) * 0.55 * vA, 1.0); ${FOG_ADD} }`,
    })
    const frames = new THREE.LineSegments(frg, frameMat)
    frames.renderOrder = 5
    // smoked backing glass: darkens whatever is behind so the thin traces stay legible
    const bp = [], ba = [], bu = []
    this.defs.forEach((d, p) => {
      const P = (x, y) => d.origin.clone().addScaledVector(d.right, x).addScaledVector(d.up, y)
      const x0 = -0.35, x1 = d.w + 0.35, y0 = -0.45, y1 = d.h + 0.75
      const q = [[x0, y0, 0, 0], [x1, y0, 1, 0], [x1, y1, 1, 1], [x0, y0, 0, 0], [x1, y1, 1, 1], [x0, y1, 0, 1]]
      for (const [x, y, u, v] of q) { const w = P(x, y).addScaledVector(d.facing, -0.04); bp.push(w.x, w.y, w.z); ba.push(p); bu.push(u, v) }
    })
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bp), 3))
    bg.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(ba), 1))
    bg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bu), 2))
    const backMat = shader({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform float uVis[${NP}];
        attribute float aP; varying float vA; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vA = smoothstep(0.0, 0.4, uVis[int(aP + 0.5)]); vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          vec2 e = min(vUv, 1.0 - vUv);
          float soft = smoothstep(0.0, 0.08, e.x) * smoothstep(0.0, 0.14, e.y);
          gl_FragColor = vec4(0.004, 0.008, 0.014, 0.72 * soft * vA);
          #include <fog_fragment>
        }`,
    })
    const back = new THREE.Mesh(bg, backMat)
    back.renderOrder = 3
    root.add(back, lines, fill, frames)
    // labels
    this.labels = this.defs.map((d) => {
      const t = new Label(d.title, { height: 0.2, color: HEX.cyan, tracking: 0.18 })
      const s = new Label(d.sub, { height: 0.15, color: HEX.smoke, tracking: 0.16 })
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.facing)
      t.quaternion.copy(q); s.quaternion.copy(q)
      t.position.copy(d.origin).addScaledVector(d.up, d.h + 0.42)
      s.position.copy(d.origin).addScaledVector(d.up, d.h + 0.16)
      root.add(t, s)
      return [t, s]
    })
    this.vis = new Array(n).fill(0)
  }
  setVis(i, v) {
    this.vis[i] = v
    this.uniforms.uVis.value[i] = v
    const [t, s] = this.labels[i]
    const o = Math.min(1, v * 1.6)
    t.opacity = o; s.opacity = o * 0.9
  }
}
