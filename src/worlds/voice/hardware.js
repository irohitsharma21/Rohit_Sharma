import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { chrome, graphite, smokedGlass } from '../../lib/materials.js'
import { POINT_FRAG } from '../../lib/glsl.js'
import { fxMat, COMMON, FOG_V, FOG_F } from './gl.js'
import { X, FLOOR_Y, LANES, LLM_N, LLM_H } from './layout.js'

// Precision hardware for each stage + the chamber they sit in. Static geometry is merged per material,
// so the whole hall costs a handful of draw calls.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3()
function put(bucket, geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z)
  geo.applyMatrix4(_m.compose(_p, _q, _s))
  bucket.push(geo)
  return geo
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
const rodX = (len, r = 0.1) => new THREE.CylinderGeometry(r, r, len, 10, 1).rotateZ(Math.PI / 2)

/** Machined pedestal: floor plate, graphite column, chrome collars. Pushes into the shared buckets. */
let _B = null
function pedestal(x, z, yTop) {
  const len = yTop - FLOOR_Y
  put(_B.G, new THREE.CylinderGeometry(0.34, 0.42, len, 20), x, FLOOR_Y + len / 2, z)
  put(_B.C, new THREE.CylinderGeometry(0.5, 0.5, 0.16, 24), x, yTop - 0.12, z)
  put(_B.C, new THREE.CylinderGeometry(0.56, 0.56, 0.12, 24), x, FLOOR_Y + 0.62, z)
  put(_B.G, new THREE.CylinderGeometry(1.5, 1.7, 0.4, 32), x, FLOOR_Y + 0.2, z)
  put(_B.C, new THREE.TorusGeometry(1.52, 0.035, 6, 48).rotateX(Math.PI / 2), x, FLOOR_Y + 0.41, z)
}

function collarGeo() {
  const pts = [[8.3, -1.9], [9.3, -2.15], [10.8, -1.75], [11.5, -0.7], [11.6, 0], [11.5, 0.7], [10.8, 1.75], [9.3, 2.15], [8.3, 1.9], [8.1, 0], [8.3, -1.9]]
  return new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 128).rotateZ(-Math.PI / 2)
}

export function buildHardware(U, q) {
  const group = new THREE.Group()
  const G = [], C = [], D = [], GL = [], GLOW = [], DC = []
  _B = { G, C }

  // ---------------- chamber: back wall ribs, ceiling beams, rails
  for (let x = -250; x <= 250; x += 10) put(D, box(1.4, 70, 2.6), x, FLOOR_Y + 35, -62)
  for (let x = -240; x <= 240; x += 24) put(D, box(3, 2.4, 118), x, 42, -4)
  for (let x = -245; x <= 245; x += 30) put(GLOW, box(0.1, 44, 0.1), x, FLOOR_Y + 30, -60.6)
  put(GLOW, box(500, 0.06, 0.06), 0, FLOOR_Y + 0.05, -50)
  for (const z of [-7.5, 7.5]) put(DC, rodX(480, 0.09), 0, FLOOR_Y + 0.35, z)

  // ---------------- 01 SPEECH & 06 RESPONSE: machined intake/exit apertures
  for (const x of [X.speech, X.resp]) {
    put(DC, collarGeo(), x, 0, 0)
    for (const h of [-1.98, 1.98]) put(C, new THREE.TorusGeometry(8.32, 0.12, 12, 128), x + h, 0, 0, 0, Math.PI / 2, 0)
    put(C, new THREE.TorusGeometry(11.62, 0.07, 8, 128), x, 0, 0, 0, Math.PI / 2, 0)
    // fork + pedestal
    put(G, box(2.6, 2.6, 7), x, FLOOR_Y + 1.3, 0)
    put(C, box(3.2, 0.12, 7.6), x, FLOOR_Y + 2.66, 0)
    put(G, box(1.6, 1.6, 2.2), x, -11.9, 0)
  }

  // ---------------- 02 STT: stacked chrome blades between graphite slabs
  const blades = 22, bh = 13, bd = 8.6
  for (let i = 0; i < blades; i++) {
    const x = X.stt0 + (i * (X.stt1 - X.stt0)) / (blades - 1)
    if (i % 7 === 0) {
      put(C, box(0.16, bh, 0.24), x, 0, bd / 2); put(C, box(0.16, bh, 0.24), x, 0, -bd / 2)
      put(C, box(0.16, 0.24, bd), x, bh / 2, 0); put(C, box(0.16, 0.24, bd), x, -bh / 2, 0)
    } else {
      put(GL, new THREE.PlaneGeometry(bd, bh), x, 0, 0, 0, Math.PI / 2, 0)
      put(DC, box(0.05, bh, 0.05), x, 0, bd / 2)
    }
  }
  const sx = (X.stt0 + X.stt1) / 2, sw = X.stt1 - X.stt0 + 1.6
  for (const s of [-1, 1]) {
    put(DC, box(sw, 0.5, bd + 1.2), sx, s * (bh / 2 + 0.45), 0)
    for (const z of [-(bd + 1.2) / 2, (bd + 1.2) / 2]) put(C, rodX(sw, 0.07), sx, s * (bh / 2 + 0.45), z)
  }
  put(C, new THREE.CylinderGeometry(0.22, 0.22, -FLOOR_Y - bh / 2 - 0.7, 12), sx, (FLOOR_Y - bh / 2 - 0.7) / 2, 0)
  put(G, box(4, 0.4, 4), sx, FLOOR_Y + 0.2, 0)

  // ---------------- 03 LLM: glass layers in chrome frames inside a graphite gantry
  const H = LLM_H + 1.2
  for (let l = 0; l < X.layers; l++) {
    const x = X.llm0 + l * X.llmDX
    put(GL, new THREE.PlaneGeometry(2 * H * 0.9, 2 * H), x, 0, 0, 0, Math.PI / 2, 0)
    put(C, box(0.12, 0.12, 2 * H * 0.9), x, H, 0)
    put(C, box(0.12, 0.12, 2 * H * 0.9), x, -H, 0)
    put(C, box(0.12, 2 * H, 0.12), x, 0, H * 0.9)
    put(C, box(0.12, 2 * H, 0.12), x, 0, -H * 0.9)
  }
  const lx0 = X.llm0 - 2.5, lx1 = X.llm0 + (X.layers - 1) * X.llmDX + 2.5, lcx = (lx0 + lx1) / 2, lw = lx1 - lx0
  for (const s of [-1, 1]) {
    put(DC, box(lw, 0.45, 19.5), lcx, s * (H + 0.75), 0)
    for (const z of [-9.75, 9.75]) put(C, rodX(lw, 0.1), lcx, s * (H + 0.75), z)
  }
  for (const xx of [lx0 + 1.2, lx1 - 1.2]) for (const z of [-7.5, 7.5]) put(C, new THREE.CylinderGeometry(0.2, 0.2, -FLOOR_Y - H - 1, 12), xx, (FLOOR_Y - H - 1) / 2, z)

  // ---------------- 04 TOOL CALL: packet bed + docking port
  const bedW = 12 * 0.86 + 1.2, bedX = X.toolBed + bedW / 2 - 0.6
  put(GL, new THREE.PlaneGeometry(bedW, 7.4), bedX, 0, -0.75)
  put(C, box(bedW, 0.08, 0.08), bedX, 3.7, -0.75); put(C, box(bedW, 0.08, 0.08), bedX, -3.7, -0.75)
  put(DC, box(bedW, 0.3, 1.6), bedX, -4.1, -0.3)
  pedestal(bedX, -0.3, -4.25)
  const px = (X.port0 + X.port1) / 2, pw = X.port1 - X.port0
  for (const s of [-1, 1]) {
    put(DC, box(pw, 0.6, 3.2), px, s * 4.0, 0)
    for (const z of [-1.6, 1.6]) put(C, rodX(pw, 0.08), px, s * 3.64, z)
    // heat-sink fins milled into the housing, a chamfered chrome lip on the outer face
    for (let i = 0; i < 15; i++) put(DC, box(0.14, 0.42, 2.9), X.port0 + 1.0 + i * 0.72, s * 4.5, 0)
    put(C, box(pw + 0.2, 0.08, 0.08), px, s * 4.32, 1.62)
  }
  put(GL, new THREE.PlaneGeometry(pw, 7.4), px, 0, -1.5)
  put(GL, new THREE.PlaneGeometry(pw, 7.3), px, 0, 1.45)
  // receiving mouth: a stepped machined bezel (chrome outer frame + dark inner lip) the packet docks through
  for (const [dx, t, bucket, o] of [[0, 0.22, C, 0], [0.34, 0.16, DC, 0.28]]) {
    const x = X.port0 + dx, hy = 3.72 - o, hz = 1.78 - o
    put(bucket, box(t, t, 2 * hz), x, hy, 0); put(bucket, box(t, t, 2 * hz), x, -hy, 0)
    put(bucket, box(t, 2 * hy, t), x, 0, hz); put(bucket, box(t, 2 * hy, t), x, 0, -hz)
  }
  put(DC, box(0.4, 8.6, 3.4), X.port1 + 0.2, 0, 0)
  // conduit flange + bolt circle on the back plate
  put(C, new THREE.CylinderGeometry(1.05, 1.05, 0.14, 40).rotateZ(Math.PI / 2), X.port1 + 0.47, 0, 0)
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; put(C, new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8).rotateZ(Math.PI / 2), X.port1 + 0.56, Math.sin(a) * 0.8, Math.cos(a) * 0.8) }
  pedestal(px, 0, -4.3)
  // conduit: port -> resonator
  put(DC, rodX(X.tts - X.port1, 0.36), (X.port1 + X.tts) / 2, 0, 0)
  put(G, new THREE.CylinderGeometry(0.62, 0.62, 0.8, 24).rotateZ(Math.PI / 2), X.port1 + 1.4, 0, 0)
  put(G, new THREE.CylinderGeometry(0.62, 0.62, 0.8, 24).rotateZ(Math.PI / 2), X.tts - 2.2, 0, 0)
  for (const x of [X.port1 + 0.95, X.port1 + 1.85, X.tts - 2.65, X.tts - 1.75]) put(C, new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24).rotateZ(Math.PI / 2), x, 0, 0)

  // ---------------- 05 TTS: resonator column with 30 emitter slits
  const cy = FLOOR_Y + 12.25
  put(G, box(3.2, 24.5, 5.4), X.tts, cy, 0)
  put(C, box(0.16, 17.4, 4.6), X.tts + 1.68, 0, 0)
  // machined bezel framing the emitter face
  for (const s of [-1, 1]) {
    put(C, box(0.34, 0.22, 5.2), X.tts + 1.76, s * 8.9, 0)
    put(DC, box(0.3, 17.6, 0.2), X.tts + 1.74, 0, s * 2.5)
  }
  // chrome corner rails and a stepped crown
  for (const z of [-2.72, 2.72]) for (const dx of [-1.62, 1.62]) put(C, box(0.1, 24.5, 0.1), X.tts + dx, cy, z)
  put(C, box(3.4, 0.14, 5.6), X.tts, FLOOR_Y + 24.55, 0)
  put(DC, box(2.6, 0.5, 4.6), X.tts, FLOOR_Y + 24.87, 0)
  put(C, box(1.8, 0.08, 3.8), X.tts, FLOOR_Y + 25.16, 0)
  // heat-sink fins down the back: the column is doing 30x real-time work
  for (let i = 0; i < 22; i++) put(DC, box(0.9, 0.14, 5.0), X.tts - 2.05, -9.4 + i * 0.9, 0)
  // plinth
  put(D, box(5.4, 0.5, 7.6), X.tts, FLOOR_Y + 0.25, 0)
  // panel seams: the column reads as stacked machined segments, not a monolith
  for (let i = 1; i < 6; i++) put(DC, box(3.26, 0.06, 5.46), X.tts, FLOOR_Y + i * 4.1, 0)

  const merged = (arr, mat) => { const m = new THREE.Mesh(mergeGeometries(arr, false), mat); group.add(m); return m }
  const gMesh = merged(G, graphite({ color: 0x161b22, roughness: 0.38 }))
  const cMesh = merged(C, chrome())
  merged(DC, chrome({ color: 0x3a424d, roughness: 0.24, envMapIntensity: 1.0 }))
  const dMesh = merged(D, graphite({ color: 0x0c0f13, roughness: 0.6, metalness: 0.5 }))
  const glMesh = merged(GL, smokedGlass({ opacity: 0.14 }))
  glMesh.renderOrder = 2
  const glowMesh = merged(GLOW, new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fc6ff').multiplyScalar(0.9), fog: true }))
  void gMesh; void cMesh; void dMesh; void glowMesh

  // ---------------- back wall panel (very dark) so the ribs read against something
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(520, 80), graphite({ color: 0x07090c, roughness: 0.9, metalness: 0.2 }))
  wall.position.set(0, FLOOR_Y + 36, -63.4)
  group.add(wall)

  // ---------------- floor: fine grid, signal reflection under the path, contact shadows under hardware
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(520, 150).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    fog: true,
    vertexShader: COMMON + FOG_V + /* glsl */ `
      varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFogDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: COMMON + FOG_F + /* glsl */ `
      varying vec3 vP;
      float sh(float x, float w, float d){ float a = (vP.x - x) / w, b = vP.z / d; return exp(-a * a - b * b); }
      void main(){
        vec2 gc = vP.xz / 4.0;
        vec2 g = abs(fract(gc - 0.5) - 0.5) / fwidth(gc);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 gc2 = vP.xz / 20.0;
        vec2 g2 = abs(fract(gc2 - 0.5) - 0.5) / fwidth(gc2);
        float line2 = 1.0 - min(min(g2.x, g2.y), 1.0);
        vec3 base = vec3(0.012, 0.015, 0.02);
        base += (line * 0.35 + line2 * 0.6) * vec3(0.03, 0.045, 0.06);
        float lane = exp(-vP.z * vP.z / 26.0) * act(vP.x);
        float shimmer = 0.75 + 0.25 * sin(vP.x * 0.35 - uTime * 3.0);
        base += vec3(0.05, 0.22, 0.85) * lane * 0.05 * shimmer;
        float s = 1.0;
        s *= 1.0 - 0.85 * sh(${X.speech.toFixed(1)}, 4.0, 6.0);
        s *= 1.0 - 0.85 * sh(${X.resp.toFixed(1)}, 4.0, 6.0);
        s *= 1.0 - 0.8 * sh(${((X.stt0 + X.stt1) / 2).toFixed(1)}, 7.0, 7.0);
        s *= 1.0 - 0.8 * sh(${lcx.toFixed(1)}, 26.0, 11.0);
        s *= 1.0 - 0.7 * sh(${px.toFixed(1)}, 6.0, 4.0);
        s *= 1.0 - 0.8 * sh(${X.tts.toFixed(1)}, 3.5, 5.0);
        float f = fogK();
        gl_FragColor = vec4(mix(fogColor, base * s, f), 1.0);
      }`,
  }))
  floor.position.set(0, FLOOR_Y, -8)
  group.add(floor)

  // ---------------- chamber lamps: tick ring around each aperture (precision scale)
  const tick = []
  for (const x of [X.speech, X.resp]) {
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2, r0 = 12.25, r1 = i % 15 === 0 ? 13.4 : i % 5 === 0 ? 12.9 : 12.6
      tick.push(x, Math.sin(a) * r0, Math.cos(a) * r0, x, Math.sin(a) * r1, Math.cos(a) * r1)
    }
  }
  // grid slots under the JSON bed
  for (let i = 0; i <= 12; i++) { const x = X.toolBed + i * 0.86; tick.push(x, -3.3, -0.7, x, 3.3, -0.7) }
  for (let j = 0; j <= 7; j++) { const y = -3.01 + j * 0.86; tick.push(X.toolBed, y, -0.7, X.toolBed + 12 * 0.86, y, -0.7) }
  // engraved scale along the port's front lip (lights up when the stage is live)
  for (let i = 0; i <= 24; i++) { const x = X.port0 + 0.3 + i * 0.475, l = i % 4 === 0 ? 0.42 : 0.2; for (const s of [-1, 1]) tick.push(x, s * 3.69, 1.63, x, s * (3.69 - l), 1.63) }
  // lane index beside the 30 emitter slits
  for (let i = 0; i < LANES; i++) { const y = (i - 14.5) * 0.5, l = i % 5 === 0 ? 0.55 : 0.28; tick.push(X.tts + 1.86, y, -2.28, X.tts + 1.86, y, -2.28 + l) }
  const tg = new THREE.BufferGeometry()
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tick, 3))
  const ticks = new THREE.LineSegments(tg, fxMat(U, {
    vs: /* glsl */ `varying float vA; void main(){ vA = act(position.x); vec4 mv = modelViewMatrix * vec4(position, 1.0); vFogDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fs: /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * fogK(), mix(0.16, 0.5, vA)); }`,
  }))
  group.add(ticks)

  // ---------------- TTS emitters: 30 slits, each an independent stream
  const em = []
  const ep = new THREE.BoxGeometry(0.1, 0.12, 0.7)
  for (let i = 0; i < LANES; i++) {
    const g = ep.clone()
    g.setAttribute('aI', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(i), 1))
    em.push(put([], g, X.tts + 1.8, (i - 14.5) * 0.5, ((i % 5) - 2) * 0.8))
  }
  const emit = new THREE.Mesh(mergeGeometries(em, false), fxMat(U, {
    blending: THREE.NormalBlending, depthWrite: true, transparent: false,
    vs: /* glsl */ `
      attribute float aI; varying float vB; varying float vA;
      void main(){
        vA = act(position.x);
        vB = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin((position.x - uTime * (11.0 + mod(aI * 7.0, 5.0)) + aI * 17.3) * 0.06 + aI * 1.7));
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vFogDepth = -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fs: /* glsl */ `
      varying float vB; varying float vA;
      void main(){ gl_FragColor = vec4(mix(vec3(0.05, 0.08, 0.12), vec3(0.5, 0.85, 1.0) * (1.0 + vB * 2.5), vA) * fogK(), 1.0); }`,
  }))
  group.add(emit)

  // ---------------- port status LEDs (driven from update)
  const leds = []
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x111820), fog: true }))
    m.position.set(X.port0 + 0.9 + i * 0.75, 4.1, 1.64)
    group.add(m); leds.push(m)
  }
  return { group, leds }
}
