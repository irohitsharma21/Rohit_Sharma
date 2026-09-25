import * as THREE from 'three'
import { POINT_FRAG } from '../../lib/glsl.js'
import { rng } from '../../lib/math.js'
import { fxMat, stripGeo, RIBBON_VS, COMMON, FOG_V, FOG_F } from './gl.js'
import { X, LANES, LLM_N, LLM_H } from './layout.js'

const v3 = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k)

// ------------------------------------------------------------------ 01 · raw speech (input waveform)
const SPEECH_FN = /* glsl */ `
float speechEnv(float s){
  float a = sin(s * 0.21) * 0.5 + 0.5;
  float b = sin(s * 0.083 + 1.7) * 0.5 + 0.5;
  float c = sin(s * 0.037 + 0.4) * 0.5 + 0.5;
  return smoothstep(0.28, 0.98, a * 0.72 + b * 0.5) * (0.3 + 0.7 * c);
}
float speechCarrier(float s){ return sin(s * 3.3) * 0.55 + sin(s * 5.9 + 1.3) * 0.3 + sin(s * 9.7 + 0.4) * 0.15; }
float speechTaper(float x){ return smoothstep(${X.inStart.toFixed(1)}, ${(X.inStart + 44).toFixed(1)}, x) * (1.0 - 0.35 * smoothstep(${(X.stt0 - 10).toFixed(1)}, ${X.stt0.toFixed(1)}, x)); }
`

export function buildSpeech(U, q) {
  const group = new THREE.Group()
  const x0 = X.inStart, x1 = X.stt0 + 3.5
  // bright oscilloscope trace
  const ribbon = new THREE.Mesh(stripGeo(x0, x1, q === 'low' ? 900 : 1600), fxMat(U, {
    uniforms: { uWidth: { value: 0.06 }, uColA: { value: v3('#2d7dff', 0.9) }, uColB: { value: v3('#cfefff', 2.6) } },
    vs: SPEECH_FN + /* glsl */ `
      float W(float x, float lane){
        float s = x - uTime * 16.0;
        float y = 6.2 * speechEnv(s) * speechCarrier(s) * speechTaper(x);
        float k = ptrK(vec2(x, 0.0));
        return y * (1.0 + k * 0.9) + k * 2.4 * sin(x * 1.25 - uTime * 7.0);
      }
      float Z(float x, float lane){ return 0.0; }
    ` + RIBBON_VS,
    fs: /* glsl */ `
      uniform vec3 uColA; uniform vec3 uColB;
      varying float vSide; varying float vX; varying float vA; varying float vLane;
      void main(){
        float sd = clamp(vSide, -1.0, 1.0); float e = 1.0 - sd * sd; e *= e;
        float fade = smoothstep(${x1.toFixed(1)}, ${(x1 - 4).toFixed(1)}, vX);
        vec3 c = mix(uColA, uColB, e);
        gl_FragColor = vec4(c * fogK(), e * clamp(vA, 0.0, 1.0) * fade);
      }`,
  }))
  ribbon.frustumCulled = false
  group.add(ribbon)

  // amplitude body: dense vertical bars, the classic "audio file" silhouette behind the trace
  const N = q === 'low' ? 320 : 520
  const pos = new Float32Array(N * 2 * 3)
  for (let i = 0; i < N; i++) {
    const x = x0 + ((x1 - 2 - x0) * i) / (N - 1)
    pos.set([x, -1, 0, x, 1, 0], i * 6)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const bars = new THREE.LineSegments(g, fxMat(U, {
    uniforms: { uCol: { value: v3('#2d7dff', 0.8) } },
    vs: SPEECH_FN + /* glsl */ `
      varying float vA; varying float vY;
      void main(){
        float x = position.x;
        float s = x - uTime * 16.0;
        float h = 6.2 * speechEnv(s) * (0.45 + 0.55 * abs(sin(s * 1.9))) * speechTaper(x) + 0.06;
        float k = ptrK(vec2(x, 0.0));
        h *= 1.0 + k * 0.9;
        vec3 p = vec3(x, position.y * h, -0.05);
        vY = position.y;
        vA = act(x) * (0.25 + 0.75 * smoothstep(0.1, 3.0, h));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fs: /* glsl */ `
      uniform vec3 uCol; varying float vA; varying float vY;
      void main(){ float e = 1.0 - abs(vY) * 0.6; gl_FragColor = vec4(uCol * fogK(), 0.32 * vA * e); }`,
  }))
  bars.frustumCulled = false
  group.add(bars)
  return group
}

// ------------------------------------------------------------------ 02 · STT: waveform shredded into glyph tokens
function glyphAtlas() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  const chars = [...'abcdefghijklmnopqrstuvwxyz0123456789', ...'अआकखगमनरसतहयलवदप', ...'ABDEHKMNRST']
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  chars.slice(0, 64).forEach((ch, i) => {
    const cx = (i % 8) * 64 + 32, cy = Math.floor(i / 8) * 64 + 34
    ctx.font = i >= 36 && i < 53 ? '500 40px "Nirmala UI", "Mangal", "Noto Sans Devanagari", sans-serif' : '500 42px "Geist Mono", ui-monospace, monospace'
    ctx.fillText(ch, cx, cy)
  })
  const t = new THREE.CanvasTexture(c)
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

export function buildGlyphs(U, q) {
  const r = rng(7)
  const lanes = q === 'low' ? 14 : 24
  const L = 24 // lane cycle length (units)
  const U_ = [], lane = [], gl = [], rr = []
  for (let k = 0; k < lanes; k++) {
    const a = r() * Math.PI * 2, rad = 1.2 + Math.sqrt(r()) * 4.6
    const ly = Math.sin(a) * rad, lz = Math.cos(a) * rad * 0.8
    let u = r() * 2
    while (u < L - 0.6) {
      const len = 2 + Math.floor(r() * 6)
      const deva = r() < 0.22
      for (let j = 0; j < len && u < L; j++) {
        U_.push(u / L); lane.push(ly, lz)
        gl.push(deva ? 36 + Math.floor(r() * 17) : (r() < 0.12 ? 26 + Math.floor(r() * 10) : Math.floor(r() * 26)))
        rr.push(r())
        u += 0.52
      }
      u += 0.9 + r() * 1.4
    }
  }
  const g = new THREE.BufferGeometry()
  const n = U_.length
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aU', new THREE.Float32BufferAttribute(U_, 1))
  g.setAttribute('aLane', new THREE.Float32BufferAttribute(lane, 2))
  g.setAttribute('aG', new THREE.Float32BufferAttribute(gl, 1))
  g.setAttribute('aR', new THREE.Float32BufferAttribute(rr, 1))
  const xa = X.stt0 + 2.5, xb = X.llm0 - 0.5
  const pts = new THREE.Points(g, fxMat(U, {
    uniforms: { uAtlas: { value: glyphAtlas() } },
    vs: /* glsl */ `
      attribute float aU; attribute vec2 aLane; attribute float aG; attribute float aR;
      varying float vA; varying float vG; varying float vEm; varying float vR;
      void main(){
        float f = fract(aU + uTime * 0.17);
        float x = ${xa.toFixed(2)} + f * ${(xb - xa).toFixed(2)};
        float em = smoothstep(0.0, 0.22, f);
        float cv = smoothstep(0.72, 1.0, f);
        vec2 l = aLane * mix(0.22, 1.0, em) * mix(1.0, 0.3, cv);
        float y = l.x + (1.0 - em) * sin(x * 3.3 + aR * 6.28) * 1.4;
        vec3 p = vec3(x, y, l.y);
        float k = ptrK(p.xy);
        p.xy += normalize(p.xy - uPtr.xy + vec2(1e-3)) * k * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
        float size = mix(0.16, 0.66, em) * (1.0 - cv * 0.55) * (1.0 + k * 0.4);
        gl_PointSize = size * uPx / -mv.z;
        vA = act(x) * smoothstep(0.0, 0.03, f) * (1.0 - smoothstep(0.9, 1.0, f));
        vG = aG; vEm = em; vR = aR;
      }`,
    fs: POINT_FRAG + /* glsl */ `
      uniform sampler2D uAtlas;
      varying float vA; varying float vG; varying float vEm; varying float vR;
      void main(){
        vec2 pc = gl_PointCoord;
        float col = mod(vG, 8.0), row = floor(vG / 8.0);
        vec2 uv = vec2((col + pc.x) / 8.0, 1.0 - (row + pc.y) / 8.0);
        float gph = texture2D(uAtlas, uv).a;
        float m = mix(softPoint(pc), gph, smoothstep(0.35, 0.85, vEm));
        vec3 c = vR > 0.84 ? vec3(0.38, 0.85, 1.0) * 2.2 : vec3(0.78, 0.9, 1.0) * 1.15;
        float a = m * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(c * fogK(), a);
      }`,
  }))
  pts.frustumCulled = false
  return pts
}

// ------------------------------------------------------------------ 03 · LLM: layered lattice, attention routes, token packets
export function buildLattice(U, q) {
  const group = new THREE.Group()
  const r = rng(21)
  const NL = X.layers, S = LLM_N, H = LLM_H
  const lx = (l) => X.llm0 + l * X.llmDX
  const ny = (i) => -H + (2 * H * i) / (S - 1)

  // nodes
  const npos = [], nr = []
  for (let l = 0; l < NL; l++) for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) { npos.push(lx(l), ny(i), ny(j) * 0.9); nr.push(r()) }
  const ng = new THREE.BufferGeometry()
  ng.setAttribute('position', new THREE.Float32BufferAttribute(npos, 3))
  ng.setAttribute('aR', new THREE.Float32BufferAttribute(nr, 1))
  const nodes = new THREE.Points(ng, fxMat(U, {
    vs: /* glsl */ `
      attribute float aR; varying float vA; varying float vB;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z; gl_Position = projectionMatrix * mv;
        float pulse = pow(max(0.5 + 0.5 * sin(uTime * (0.8 + aR * 2.6) + aR * 40.0), 1e-4), 10.0);
        vB = pulse; vA = act(position.x);
        gl_PointSize = (0.34 + pulse * 0.3) * uPx / -mv.z;
      }`,
    fs: POINT_FRAG + /* glsl */ `
      varying float vA; varying float vB;
      void main(){
        float s = softPoint(gl_PointCoord);
        vec3 c = mix(vec3(0.35, 0.5, 0.7) * 0.6, vec3(0.6, 0.9, 1.0) * 1.8, vB);
        float a = s * mix(0.25, 1.0, vA) * (0.45 + 0.55 * vB);
        gl_FragColor = vec4(c * fogK() * mix(0.25, 1.0, vA), a);
      }`,
  }))
  nodes.frustumCulled = false
  group.add(nodes)

  // routes: token paths hopping node to node through the layers (attention-like, mostly local)
  const R = q === 'low' ? 90 : 160
  const lpos = [], lrt = [], lt = []
  const pA = [], pB = [], pC = [], pD = [], pRt = [], ppos = []
  const TRAIL = q === 'low' ? 4 : 6
  for (let k = 0; k < R; k++) {
    const route = []
    let iy = Math.floor(r() * S), iz = Math.floor(r() * S)
    for (let l = 0; l < NL; l++) {
      route.push([ny(iy), ny(iz) * 0.9])
      iy = Math.min(S - 1, Math.max(0, iy + Math.round((r() - 0.5) * 4.2)))
      iz = Math.min(S - 1, Math.max(0, iz + Math.round((r() - 0.5) * 4.2)))
    }
    const phase = r(), speed = 0.16 + r() * 0.12
    for (let l = 0; l < NL - 1; l++) {
      lpos.push(lx(l), route[l][0], route[l][1], lx(l + 1), route[l + 1][0], route[l + 1][1])
      lrt.push(phase, speed, phase, speed)
      lt.push(l / (NL - 1), (l + 1) / (NL - 1))
    }
    const flat = route.flat()
    for (let j = 0; j < TRAIL; j++) {
      pA.push(...flat.slice(0, 4)); pB.push(...flat.slice(4, 8)); pC.push(...flat.slice(8, 12)); pD.push(...flat.slice(12, 16))
      pRt.push(phase, speed, j); ppos.push(0, 0, 0)
    }
  }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3))
  lg.setAttribute('aRt', new THREE.Float32BufferAttribute(lrt, 2))
  lg.setAttribute('aT', new THREE.Float32BufferAttribute(lt, 1))
  const lines = new THREE.LineSegments(lg, fxMat(U, {
    vs: /* glsl */ `
      attribute vec2 aRt; attribute float aT;
      varying float vT; varying vec2 vRt; varying float vA;
      void main(){
        vT = aT; vRt = aRt; vA = act(position.x);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fs: /* glsl */ `
      varying float vT; varying vec2 vRt; varying float vA;
      void main(){
        float head = fract(vRt.x + uTime * vRt.y);
        float d = head - vT;
        float b = d > 0.0 ? exp(-d * 9.0) * step(d, 0.45) : 0.0;
        vec3 c = mix(vec3(0.16, 0.36, 0.9) * 0.55, vec3(0.55, 0.88, 1.0) * 1.3, b);
        float a = (0.07 + 0.75 * b) * mix(0.18, 1.0, vA);
        gl_FragColor = vec4(c * fogK() * mix(0.3, 1.0, vA), a);
      }`,
  }))
  lines.frustumCulled = false
  group.add(lines)

  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3))
  pg.setAttribute('aA', new THREE.Float32BufferAttribute(pA, 4))
  pg.setAttribute('aB', new THREE.Float32BufferAttribute(pB, 4))
  pg.setAttribute('aC', new THREE.Float32BufferAttribute(pC, 4))
  pg.setAttribute('aD', new THREE.Float32BufferAttribute(pD, 4))
  pg.setAttribute('aRt', new THREE.Float32BufferAttribute(pRt, 3))
  const packets = new THREE.Points(pg, fxMat(U, {
    vs: /* glsl */ `
      attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD; attribute vec3 aRt;
      varying float vA; varying float vJ;
      void main(){
        vec2 N[8];
        N[0] = aA.xy; N[1] = aA.zw; N[2] = aB.xy; N[3] = aB.zw; N[4] = aC.xy; N[5] = aC.zw; N[6] = aD.xy; N[7] = aD.zw;
        float head = fract(aRt.x + uTime * aRt.y);
        float t = head - aRt.z * 0.012;
        float vis = step(0.0, t);
        t = clamp(t, 0.0, 0.9999);
        float ft = t * 7.0; int li = int(floor(ft)); float fr = fract(ft);
        vec2 yz = mix(N[li], N[li + 1], fr);
        vec3 p = vec3(${X.llm0.toFixed(2)} + ft * ${X.llmDX.toFixed(2)}, yz);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z; gl_Position = projectionMatrix * mv;
        float sz = aRt.z < 0.5 ? 0.62 : 0.4 * (1.0 - aRt.z / 8.0);
        gl_PointSize = sz * uPx / -mv.z * vis;
        vA = act(p.x) * vis * smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.95, 1.0, t)); vJ = aRt.z;
      }`,
    fs: POINT_FRAG + /* glsl */ `
      varying float vA; varying float vJ;
      void main(){
        float s = softPoint(gl_PointCoord);
        vec3 c = vJ < 0.5 ? vec3(0.85, 0.96, 1.0) * 2.2 : vec3(0.38, 0.8, 1.0) * 1.2;
        float a = s * vA * (1.0 - vJ / 8.0);
        if (a < 0.01) discard;
        gl_FragColor = vec4(c * fogK(), a);
      }`,
  }))
  packets.frustumCulled = false
  group.add(packets)
  return group
}

// ------------------------------------------------------------------ 04 · TOOL CALL: tokens snap into a JSON block of packets, which docks into a port
export const JSON_ROWS = [
  'B',
  ' KKKK VVVVVV',
  ' KKKKKKKKK B',
  '  KKK VVVVV',
  '  KKKKK VVV',
  ' B',
  'B',
]
export const CELL = 0.86

export function buildPackets(U, shared) {
  const r = rng(33)
  const cells = []
  JSON_ROWS.forEach((row, ri) => [...row].forEach((ch, ci) => { if (ch !== ' ') cells.push({ ri, ci, kind: ch === 'B' ? 0 : ch === 'K' ? 1 : 2 }) }))
  const n = cells.length
  const box = new THREE.BoxGeometry(0.7, 0.7, 0.7)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = box.index
  geo.setAttribute('position', box.attributes.position)
  geo.setAttribute('normal', box.attributes.normal)
  geo.setAttribute('uv', box.attributes.uv)
  const tgt = [], start = [], info = []
  const top = ((JSON_ROWS.length - 1) * CELL) / 2
  cells.forEach((c, i) => {
    tgt.push(X.toolBed + c.ci * CELL + CELL / 2, top - c.ri * CELL, 0)
    const a = r() * Math.PI * 2, rad = 1 + r() * 5
    start.push(X.llm0 + 7 * X.llmDX + 1.5 + r() * 2.5, Math.sin(a) * rad, Math.cos(a) * rad * 0.8)
    info.push(0.02 + (i / n) * 0.3, c.kind, r(), i)
  })
  geo.setAttribute('aTarget', new THREE.InstancedBufferAttribute(new Float32Array(tgt), 3))
  geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(new Float32Array(start), 3))
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(info), 4))
  geo.instanceCount = n
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b222c, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.3 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTarget; attribute vec3 aStart; attribute vec4 aInfo;
        uniform float uCycle; uniform float uSlide; uniform float uAct; uniform float uTime;
        varying vec3 vGlow; varying vec2 vUv2;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float c = uCycle;
        float lt = smoothstep(aInfo.x, aInfo.x + 0.11, c);
        float ov = lt + sin(lt * 3.14159) * 0.14;
        vec3 tgt = aTarget + vec3(uSlide, 0.0, 0.0);
        vec3 pp = mix(aStart, tgt, ov);
        pp.y += sin(lt * 3.14159) * 1.2 * (aInfo.z - 0.5);
        float sc = mix(0.25, 1.0, lt) * (1.0 - smoothstep(0.93, 0.995, c));
        transformed = transformed * sc + pp;
        float sd = (c - aInfo.x - 0.11) * 30.0; float snap = exp(-sd * sd);
        float valid = smoothstep(0.44, 0.48, c) * (1.0 - smoothstep(0.52, 0.6, c));
        vec3 kc = aInfo.y < 0.5 ? vec3(0.18, 0.45, 1.0) : (aInfo.y < 1.5 ? vec3(0.7, 0.8, 0.9) : vec3(0.38, 0.85, 1.0));
        float base = aInfo.y > 1.5 ? 0.55 : (aInfo.y < 0.5 ? 0.6 : 0.12);
        vGlow = kc * (base + snap * 3.0 + valid * 1.6) * mix(0.12, 1.0, uAct) * step(0.001, lt);
        vUv2 = uv;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow; varying vec2 vUv2;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 bz = abs(vUv2 - 0.5);
        float win = 1.0 - smoothstep(0.26, 0.3, max(bz.x, bz.y));
        totalEmissiveRadiance += vGlow * (0.15 + win * 0.85);`)
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return { mesh, count: n }
}

// ------------------------------------------------------------------ 05 · TTS: 30 concurrent lanes, fan out from the resonator and converge
export const LANE_FN = /* glsl */ `
float laneS(float x){ return clamp((x - ${X.lane0.toFixed(1)}) / ${(X.lane1 - X.lane0).toFixed(1)}, 0.0, 1.0); }
float laneSpread(float s){ return (1.0 + 0.3 * sin(3.14159 * s)) * (1.0 - smoothstep(0.52, 1.0, s)); }
float laneSi(float x, float i){ return x - uTime * (11.0 + mod(i * 7.0, 5.0)) + i * 17.3; }
`
export function buildLanes(U, q) {
  const n = q === 'low' ? 200 : 340
  const mesh = new THREE.Mesh(stripGeo(X.lane0 + 0.2, X.lane1 + 1, n, LANES), fxMat(U, {
    uniforms: { uWidth: { value: 0.03 } },
    vs: LANE_FN + /* glsl */ `
      float W(float x, float i){
        float s = laneS(x); float sp = laneSpread(s);
        float si = laneSi(x, i);
        float env = smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(si * 0.11)) * (0.55 + 0.45 * sin(si * 0.041 + i));
        float ph = si * 2.1 + 5.0 * sin(si * 0.07 + i * 0.7);
        float amp = 0.2 * env * smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.6, 0.95, s));
        float y = (i - 14.5) * 0.5 * sp + amp * sin(ph);
        float k = ptrK(vec2(x, y));
        return y + k * 0.7 * sin(x * 2.2 - uTime * 8.0 + i);
      }
      float Z(float x, float i){ return (mod(i, 5.0) - 2.0) * 0.8 * laneSpread(laneS(x)); }
    ` + RIBBON_VS.replace('vLane = lane;', 'vLane = lane; vB = laneSi(x, lane);').replace('varying float vLane;', 'varying float vLane; varying float vB;'),
    fs: /* glsl */ `
      varying float vSide; varying float vX; varying float vA; varying float vLane; varying float vB;
      void main(){
        float sd = clamp(vSide, -1.0, 1.0); float e = 1.0 - sd * sd; e *= e;
        float chunk = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(vB * 0.06 + vLane * 1.7));
        float primary = 1.0 - smoothstep(0.0, 1.5, abs(vLane - 14.5));
        vec3 c = mix(vec3(0.18, 0.45, 1.0) * 0.55, vec3(0.62, 0.9, 1.0) * 1.7, chunk * 0.85 + primary * 0.3);
        float head = smoothstep(${X.lane0.toFixed(1)}, ${(X.lane0 + 2).toFixed(1)}, vX) * mix(1.0, 0.2, smoothstep(${(X.lane0 + 0.72 * (X.lane1 - X.lane0)).toFixed(1)}, ${X.lane1.toFixed(1)}, vX));
        gl_FragColor = vec4(c * fogK(), e * clamp(vA, 0.0, 1.0) * (0.22 + 0.6 * chunk + 0.2 * primary) * head);
      }`,
  }))
  mesh.frustumCulled = false
  return mesh
}

// ------------------------------------------------------------------ 06 · RESPONSE: the re-synthesised waveform with its prosody (F0) contour
const OUT_FN = /* glsl */ `
float outS(float x){ return x - uTime * 14.0; }
float outEnv(float s){ return (0.3 + 0.7 * smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(s * 0.085))) * (0.62 + 0.38 * sin(s * 0.029 + 1.0)); }
float outPh(float s){ return s * 1.7 + 6.5 * sin(s * 0.055 + 0.7); }
float outGrow(float x){ return smoothstep(${(X.lane1 - 4).toFixed(1)}, ${(X.resp + 12).toFixed(1)}, x) * (1.0 - 0.6 * smoothstep(${(X.outEnd - 40).toFixed(1)}, ${X.outEnd.toFixed(1)}, x)); }
`
export function buildOutput(U, q) {
  const group = new THREE.Group()
  const x0 = X.lane1 - 4, x1 = X.outEnd
  const wave = new THREE.Mesh(stripGeo(x0, x1, q === 'low' ? 700 : 1200), fxMat(U, {
    uniforms: { uWidth: { value: 0.07 } },
    vs: OUT_FN + /* glsl */ `
      float W(float x, float lane){
        float s = outS(x);
        float y = 3.4 * outEnv(s) * sin(outPh(s)) * outGrow(x);
        float k = ptrK(vec2(x, 0.0));
        return y * (1.0 + k * 0.8) + k * 1.8 * sin(x * 1.1 - uTime * 6.0);
      }
      float Z(float x, float lane){ return 0.0; }
    ` + RIBBON_VS,
    fs: /* glsl */ `
      varying float vSide; varying float vX; varying float vA; varying float vLane;
      void main(){
        float sd = clamp(vSide, -1.0, 1.0); float e = 1.0 - sd * sd; e *= e;
        vec3 c = mix(vec3(0.18, 0.5, 1.0), vec3(0.85, 0.96, 1.0) * 2.8, e);
        gl_FragColor = vec4(c * fogK(), e * clamp(vA, 0.0, 1.0));
      }`,
  }))
  wave.frustumCulled = false
  group.add(wave)

  // F0 (pitch) contour: the instantaneous frequency of the wave above, drawn as a dotted trace
  const f0 = new THREE.Mesh(stripGeo(X.resp + 5, X.resp + 70, 400), fxMat(U, {
    uniforms: { uWidth: { value: 0.035 } },
    vs: OUT_FN + /* glsl */ `
      float W(float x, float lane){ float s = outS(x); return 6.4 + 1.5 * cos(s * 0.055 + 0.7) * outGrow(x); }
      float Z(float x, float lane){ return 0.0; }
    ` + RIBBON_VS,
    fs: /* glsl */ `
      varying float vSide; varying float vX; varying float vA; varying float vLane;
      void main(){
        float sd = clamp(vSide, -1.0, 1.0); float e = 1.0 - sd * sd;
        float dots = step(0.45, fract(vX * 1.6));
        float fade = smoothstep(${(X.resp + 5).toFixed(1)}, ${(X.resp + 12).toFixed(1)}, vX) * smoothstep(${(X.resp + 70).toFixed(1)}, ${(X.resp + 52).toFixed(1)}, vX);
        gl_FragColor = vec4(vec3(0.62, 0.85, 1.0) * 1.3 * fogK(), e * clamp(vA, 0.0, 1.0) * dots * fade * 0.8);
      }`,
  }))
  f0.frustumCulled = false
  group.add(f0)
  return group
}

// ------------------------------------------------------------------ ambient: dust in the chamber air
export function buildDust(U, q) {
  const r = rng(99)
  const n = q === 'low' ? 1200 : 2600
  const pos = new Float32Array(n * 3), rr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -240 + r() * 480; pos[i * 3 + 1] = -13 + r() * 50; pos[i * 3 + 2] = -58 + r() * 100
    rr[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aR', new THREE.BufferAttribute(rr, 1))
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: COMMON + FOG_V + /* glsl */ `
      attribute float aR; varying float vA;
      void main(){
        vec3 p = position;
        p.x = mod(position.x + uTime * (0.6 + aR * 1.4) + 240.0, 480.0) - 240.0;
        p.y += sin(uTime * 0.3 + aR * 20.0) * 0.8;
        p.z += cos(uTime * 0.23 + aR * 31.0) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z; gl_Position = projectionMatrix * mv;
        gl_PointSize = min((0.1 + aR * 0.14) * uPx / -mv.z, 3.5);
        vA = 0.18 + 0.3 * aR;
      }`,
    fragmentShader: COMMON + FOG_F + POINT_FRAG + /* glsl */ `
      varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * fogK(), softPoint(gl_PointCoord) * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  return pts
}
