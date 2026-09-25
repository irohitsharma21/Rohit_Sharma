import * as THREE from 'three'
import { World } from '../../engine/World.js'
import { Label } from '../../lib/label.js'
import { chrome, graphite, obsidian } from '../../lib/materials.js'
import { HEX } from '../../lib/palette.js'
import { range, band, clamp, damp, lerp, smoother, smoothstep } from '../../lib/math.js'
import { reveal, tag } from '../../lib/dom.js'
import { POINT_FRAG } from '../../lib/glsl.js'
import { experience, allSkills } from '../../content.js'
import { HASH, FOG_ADD, shader, additive, merge, boxSpan } from './gl.js'
import { buildHalls, Z0, Z1 } from './hall.js'
import { Flows } from './flows.js'
import { Plots } from './plots.js'
import './style.css'

// WORLD 06: the camera pulls away and every AI system so far turns out to sit on one production layer.
// Two region halls (AWS / GCP) joined by a backbone; down the corridor between them the stack runs for real:
// FastAPI / Redis / MongoDB services with live monitoring traces, a GitHub Actions conveyor turning commits into
// Docker images, and a Kubernetes cluster that rolls each new container into a pod.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
const DEPLOY_BULLET = experience.bullets.find((b) => /Prometheus/.test(b)) || experience.bullets[experience.bullets.length - 1]

// CI/CD conveyor geometry (x = lane centre, gates along -z in the order a build travels)
const LANE_X = 6.5
const BELT_Y = 0.94
const GATES = [
  { id: 'COMMIT', z: 17 },
  { id: 'BUILD', z: 5 },
  { id: 'TEST', z: -7 },
  { id: 'IMAGE', z: -19 },
  { id: 'DEPLOY', z: -31 },
]
const BELT_Z0 = 20, BELT_Z1 = -31
// Kubernetes cluster (left of the corridor)
const NODE_X = -6.5
const NODES = [-22, -33, -44]
const SLOTS = []
for (let n = 0; n < NODES.length; n++) for (const dz of [2.0, -2.0]) for (const dx of [1.1, -1.1]) SLOTS.push(V3(NODE_X + dx, 1.52, NODES[n] + dz))
// Build cadence
const T_ITEM = 2.4, T_BELT = 14, T_FLY = 1.7
// Services (with the plinth centre)
const SERVICES = [
  { id: 'FASTAPI', sub: 'API · SERVICE', x: -7.5, z: 50, units: [[-1, -1], [1, -1], [-1, 1], [1, 1]], hover: 'API · HEALTHY' },
  { id: 'REDIS', sub: 'CACHE · SERVICE', x: 7.5, z: 44, units: [[-1.4, 0], [0, 0], [1.4, 0]], hover: 'CACHE · HEALTHY' },
  { id: 'MONGODB', sub: 'STORE · SERVICE', x: -7.5, z: 33, units: [[-1, -0.8], [1, -0.8], [0, 1]], hover: 'STORE · HEALTHY' },
]

// Camera path: extremely high → descend into the corridor → glide past services, conveyor and cluster → rise out.
const KEYS = [
  { p: 0.0, pos: V3(-118, 292, 236), tgt: V3(-68, 0, -54), fov: 36 },
  { p: 0.13, pos: V3(-48, 150, 165), tgt: V3(-16, 0, -8), fov: 38 },
  { p: 0.26, pos: V3(-4, 46, 118), tgt: V3(0, 3, 30), fov: 40 },
  { p: 0.35, pos: V3(0, 11, 80), tgt: V3(-1, 4, 44), fov: 42 },
  { p: 0.45, pos: V3(0.6, 6.4, 62), tgt: V3(-3, 3.4, 38), fov: 44 },
  { p: 0.56, pos: V3(-1.6, 6.0, 38), tgt: V3(3.5, 2.4, 14), fov: 44 },
  { p: 0.67, pos: V3(-1.4, 5.8, 14), tgt: V3(3, 2.2, -12), fov: 44 },
  { p: 0.78, pos: V3(0.8, 6.6, -12), tgt: V3(-4, 2.2, -34), fov: 44 },
  { p: 0.88, pos: V3(0, 20, -38), tgt: V3(0, 4, -100), fov: 44 },
  { p: 1.0, pos: V3(8, 88, -36), tgt: V3(40, 0, -150), fov: 46 },
]

function cr(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  return out
}

export default class InfraWorld extends World {
  static height = 420

  constructor(ctx, meta) {
    super(ctx, meta)
    this.fog = 0.0011
    this.bloom = 0.9
    this.exposure = 1.05
    this.parallax = 0.6
    this.uTime = { value: 0 }
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._cam = new THREE.Vector3()
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler()
    this._ray = new THREE.Ray()
    this.hovered = -1
  }

  async init() {
    const low = this.ctx.quality === 'low'
    this.low = low
    const g = this.group
    this.hall = buildHalls(g, this.uTime, { low })
    this.buildServices(g)
    this.buildConveyor(g)
    this.buildCluster(g)
    this.buildContainers(g)
    this.buildBackbone(g)
    this.buildFlows(g)
    this.buildPlots(g)
    this.buildDust(g)
    this.buildSigns(g)
    this.buildHits()
  }

  // ------------------------------------------------------------------ status shader (shared by slits and rings)
  statusMat({ ring = false } = {}) {
    return shader({
      uniforms: { uTime: this.uTime, uHover: { value: -1 } },
      ...(ring ? additive : {}),
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float aSeed; attribute float aRare; attribute float aGroup;
        varying float vSeed; varying float vRare; varying float vGroup; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){
          vSeed = aSeed; vRare = aRare; vGroup = aGroup; vUv = uv;
          vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uHover;
        varying float vSeed; varying float vRare; varying float vGroup; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          float cyc = 13.0 + vSeed * 6.0;
          float ph = fract(uTime / cyc + vSeed);
          float amber = vRare * smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.13, 0.2, ph));
          float blink = mix(1.0, 0.55 + 0.45 * step(0.5, fract(uTime * 2.2)), step(0.02, amber));
          float breathe = 0.78 + 0.22 * sin(uTime * 1.4 + vSeed * 6.283);
          vec3 c = mix(vec3(0.24, 0.9, 0.62), vec3(1.0, 0.68, 0.24), amber) * breathe * blink;
          float hov = 1.0 + 0.8 * step(abs(vGroup - uHover), 0.1);
          ${ring ? `
          float r = abs(vUv.y - 0.5) * 2.0;
          float a = (1.0 - r) * 0.9;
          float sweep = pow(fract(vUv.x - uTime * 0.12 + vSeed), 6.0);
          gl_FragColor = vec4(c * (0.5 + 1.8 * sweep) * a * hov, 1.0);
          ${FOG_ADD}` : `
          gl_FragColor = vec4(c * 2.6 * hov, 1.0);
          #include <fog_fragment>`}
        }`,
    })
  }

  // ------------------------------------------------------------------ FastAPI / Redis / MongoDB
  buildServices(g) {
    const plinthGeo = new THREE.BoxGeometry(1, 1, 1); plinthGeo.translate(0, 0.5, 0)
    const plinths = []
    const units = []
    const slits = []
    const rings = []
    SERVICES.forEach((s, si) => {
      plinths.push({ x: s.x, z: s.z, sx: 5.4, sy: 0.32, sz: 5.4 })
      s.units.forEach(([ux, uz], k) => {
        const x = s.x + ux * 1.1, z = s.z + uz * 1.1
        units.push({ x, z })
        const face = Math.sign(-s.x) // slit on the side facing the corridor centre
        slits.push({ x: x + face * 0.625, z: z + 0.5, face, seed: si * 0.37 + k * 0.13, rare: si === 1 && k === 2 ? 1 : 0, group: si })
      })
      rings.push({ x: s.x, z: s.z, r: 3.6, seed: si * 0.29, group: si })
    })
    NODES.forEach((z, ni) => rings.push({ x: NODE_X, z, r: 0, seed: 0.5 + ni * 0.17, group: 3 + ni, node: true }))
    this.plinthList = plinths

    // units: precision server modules. Chamfered graphite body, chrome crown + foot + corner rails,
    // smoked-glass fronts (drive sleds + slot LEDs + intake vents) on the two faces the camera sees, a vented lid.
    const UW = 1.2, UH = 1.9, UY = 0.32, CH = 0.07
    const sh = new THREE.Shape()
    const hw = UW / 2 - 0.03
    sh.moveTo(-hw + CH, -hw); sh.lineTo(hw - CH, -hw); sh.lineTo(hw, -hw + CH); sh.lineTo(hw, hw - CH); sh.lineTo(hw - CH, hw)
    sh.lineTo(-hw + CH, hw); sh.lineTo(-hw, hw - CH); sh.lineTo(-hw, -hw + CH); sh.closePath()
    const unitGeo = new THREE.ExtrudeGeometry(sh, { depth: UH - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 })
    unitGeo.rotateX(-Math.PI / 2); unitGeo.translate(0, UY + 0.03, 0)
    const T = 0.028
    const trimParts = []
    for (const y of [UY + 0.1, UY + UH - 0.05]) {
      // horizontal bands: crown near the top, foot band near the base
      trimParts.push([-UW / 2 + CH, UW / 2 - CH, y, y + 0.035, UW / 2 - 0.005, UW / 2 + T], [-UW / 2 + CH, UW / 2 - CH, y, y + 0.035, -UW / 2 - T, -UW / 2 + 0.005])
      trimParts.push([UW / 2 - 0.005, UW / 2 + T, y, y + 0.035, -UW / 2 + CH, UW / 2 - CH], [-UW / 2 - T, -UW / 2 + 0.005, y, y + 0.035, -UW / 2 + CH, UW / 2 - CH])
    }
    const crownGeo = merge([
      ...trimParts.map(([x0, x1, y0, y1, z0, z1]) => ({ geo: boxSpan(x0, x1, y0, y1, z0, z1) })),
      // corner rails on the chamfers
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => {
        const b = new THREE.BoxGeometry(0.03, UH - 0.1, 0.02); b.rotateY(Math.atan2(sx, sz)); b.translate(sx * (UW / 2 - 0.045), UY + UH / 2 + 0.02, sz * (UW / 2 - 0.045))
        return { geo: b }
      }),
    ])
    const um = new THREE.InstancedMesh(unitGeo, graphite({ color: 0x0a0c10, roughness: 0.3, metalness: 0.75, envMapIntensity: 0.45 }), units.length)
    const cm = new THREE.InstancedMesh(crownGeo, chrome({ roughness: 0.18, envMapIntensity: 0.75 }), units.length)
    units.forEach((u, i) => { this._m.makeTranslation(u.x, 0, u.z); um.setMatrixAt(i, this._m); cm.setMatrixAt(i, this._m) })
    g.add(um, cm)

    // smoked-glass fronts + vented lids (one instanced plane, kind 0 = front, 1 = lid)
    const faceGeo = new THREE.PlaneGeometry(1, 1)
    const faces = []
    const FY = UY + 0.16 + (UH - 0.34) / 2 + 0.02
    units.forEach((u, i) => {
      const sl = slits[i]
      faces.push({ x: u.x + sl.face * (UW / 2 + 0.034), y: FY, z: u.z, ry: sl.face > 0 ? Math.PI / 2 : -Math.PI / 2, rx: 0, w: UW - 0.26, h: UH - 0.34, kind: 0, seed: sl.seed, group: sl.group })
      faces.push({ x: u.x, y: FY, z: u.z + UW / 2 + 0.034, ry: 0, rx: 0, w: UW - 0.26, h: UH - 0.34, kind: 0, seed: sl.seed + 0.5, group: sl.group })
      faces.push({ x: u.x, y: UY + UH + 0.032, z: u.z, ry: 0, rx: -Math.PI / 2, w: UW - 0.3, h: UW - 0.3, kind: 1, seed: sl.seed, group: sl.group })
    })
    const faceMat = shader({
      uniforms: { uTime: this.uTime, uHover: { value: -1 } },
      vertexShader: /* glsl */`
        attribute vec3 aFace; varying vec3 vF; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_vertex>
        void main(){
          vF = aFace; vUv = uv;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uHover;
        varying vec3 vF; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        #include <fog_pars_fragment>
        ${HASH}
        void main(){
          float seed = vF.x, kind = vF.y, grp = vF.z;
          vec2 uv = vUv;
          vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
          float hov = step(abs(grp - uHover), 0.1);
          vec3 col;
          if (kind < 0.5) {
            // smoked glass with a diagonal studio streak
            col = vec3(0.006, 0.008, 0.011);
            float streak = smoothstep(0.12, 0.0, abs(uv.x - 0.3 - uv.y * 0.35)) * 0.8 + smoothstep(0.04, 0.0, abs(uv.x - 0.46 - uv.y * 0.35)) * 0.5;
            col += vec3(0.035, 0.045, 0.06) * streak * (0.5 + fr);
            col += vec3(0.05, 0.07, 0.1) * fr;
            // drive sleds: 7 bays in the upper 64%, each with a hairline separator, a handle and two LEDs
            float y = (uv.y - 0.3) / 0.64;
            float inside = step(0.0, y) * step(y, 1.0) * step(0.08, uv.x) * step(uv.x, 0.92);
            float row = floor(y * 7.0); float fy = fract(y * 7.0);
            float fwY = fwidth(y * 7.0);
            float sep = 1.0 - smoothstep(0.0, max(fwY * 1.3, 0.04), abs(fy - 0.04));
            col += vec3(0.03, 0.038, 0.048) * sep * inside;
            float handle = (1.0 - smoothstep(0.0, fwY * 1.5 + 0.02, abs(fy - 0.5) - 0.06)) * step(0.52, uv.x) * step(uv.x, 0.78);
            col += vec3(0.02, 0.025, 0.032) * handle * inside;
            vec3 led = vec3(0.0);
            for (int k = 0; k < 2; k++) {
              float fk = float(k);
              vec2 d = vec2((uv.x - 0.16 - fk * 0.1) / 0.035, (fy - 0.5) / 0.18);
              float dt = 1.0 - smoothstep(0.5, 1.0 + fwY * 4.0, length(d));
              float rate = 1.0 + 5.0 * h11(row * 3.7 + seed * 11.0 + fk);
              float on = k == 0 ? 1.0 : step(0.4, h21(vec2(seed * 29.0 + row, floor(uTime * rate))));
              vec3 c = k == 0 ? vec3(0.24, 0.9, 0.62) : vec3(0.38, 0.85, 1.0);
              led += c * dt * on * (k == 0 ? 0.55 : 1.0);
            }
            col += led * inside * (2.6 + hov * 1.5);
            // intake vents: fine louvres in the lower band
            float vy = (uv.y - 0.06) / 0.18;
            float vin = step(0.0, vy) * step(vy, 1.0) * step(0.1, uv.x) * step(uv.x, 0.9);
            float lv = fract(vy * 9.0); float fwv = fwidth(vy * 9.0);
            float louvre = 1.0 - smoothstep(0.0, max(fwv * 1.2, 0.05), abs(lv - 0.5) - 0.2);
            col = mix(col, vec3(0.0015, 0.002, 0.003), louvre * vin * 0.9);
            col += vec3(0.018, 0.024, 0.03) * (1.0 - louvre) * vin * 0.5;
            // bezel hairline
            float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
            col += vec3(0.1, 0.13, 0.17) * (1.0 - smoothstep(0.0, fwidth(e) * 1.5 + 0.008, e)) * 0.8;
          } else {
            // vented lid: perforated grille inside a brushed frame
            col = vec3(0.012, 0.014, 0.018) + vec3(0.04, 0.05, 0.065) * fr;
            vec2 q = uv * 12.0; vec2 f = fract(q) - 0.5;
            float fw = fwidth(q.x);
            float hole = 1.0 - smoothstep(0.26, 0.26 + fw * 1.5, length(f));
            float inG = step(0.14, uv.x) * step(uv.x, 0.86) * step(0.14, uv.y) * step(uv.y, 0.86);
            col = mix(col, vec3(0.002), hole * inG * (1.0 - clamp(fw * 2.0, 0.0, 1.0)));
            float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
            col += vec3(0.08, 0.1, 0.13) * (1.0 - smoothstep(0.0, 0.02, abs(e - 0.1)));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    })
    const fm = new THREE.InstancedMesh(faceGeo, faceMat, faces.length)
    const fa = new Float32Array(faces.length * 3)
    faces.forEach((f, i) => {
      this._e.set(f.rx, f.ry, 0, 'YXZ'); this._q.setFromEuler(this._e)
      this._m.compose(V3(f.x, f.y, f.z), this._q, V3(f.w, f.h, 1)); fm.setMatrixAt(i, this._m)
      fa[i * 3] = f.seed; fa[i * 3 + 1] = f.kind; fa[i * 3 + 2] = f.group
    })
    fm.geometry.setAttribute('aFace', new THREE.InstancedBufferAttribute(fa, 3))
    g.add(fm)
    this.faceMat = faceMat

    // status slits
    const slitGeo = new THREE.PlaneGeometry(0.035, 1.56); slitGeo.translate(0, 0.32 + 0.98, 0)
    const sm = new THREE.InstancedMesh(slitGeo, this.statusMat(), slits.length)
    const sa = new Float32Array(slits.length), sr = new Float32Array(slits.length), sg = new Float32Array(slits.length)
    slits.forEach((s, i) => {
      this._q.setFromAxisAngle(V3(0, 1, 0), s.face > 0 ? Math.PI / 2 : -Math.PI / 2)
      this._m.compose(V3(s.x, 0, s.z), this._q, V3(1, 1, 1)); sm.setMatrixAt(i, this._m)
      sa[i] = s.seed; sr[i] = s.rare; sg[i] = s.group
    })
    sm.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sa, 1))
    sm.geometry.setAttribute('aRare', new THREE.InstancedBufferAttribute(sr, 1))
    sm.geometry.setAttribute('aGroup', new THREE.InstancedBufferAttribute(sg, 1))
    g.add(sm)
    this.slitMat = sm.material

    // floor status rings around each service plinth and cluster node
    const ringGeo = new THREE.RingGeometry(0.96, 1.0, 96, 1, 0, Math.PI * 2)
    // RingGeometry uv is planar; rebuild a polar uv (x = angle, y = radial) for the sweep
    const pos = ringGeo.attributes.position, uv = ringGeo.attributes.uv
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - 0.96) / 0.04) }
    ringGeo.rotateX(-Math.PI / 2)
    const rm = new THREE.InstancedMesh(ringGeo, this.statusMat({ ring: true }), rings.length)
    const ra = new Float32Array(rings.length), rr = new Float32Array(rings.length), rg = new Float32Array(rings.length)
    rings.forEach((r, i) => {
      if (r.node) this._m.compose(V3(r.x, 0.03, r.z), this._q.identity(), V3(3.3, 1, 5.6))
      else this._m.compose(V3(r.x, 0.03, r.z), this._q.identity(), V3(r.r, 1, r.r))
      rm.setMatrixAt(i, this._m); ra[i] = r.seed; rr[i] = 0; rg[i] = r.group
    })
    rm.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ra, 1))
    rm.geometry.setAttribute('aRare', new THREE.InstancedBufferAttribute(rr, 1))
    rm.geometry.setAttribute('aGroup', new THREE.InstancedBufferAttribute(rg, 1))
    rm.renderOrder = 3
    g.add(rm)
    this.ringMat = rm.material

    // labels
    this.serviceLabels = SERVICES.map((s) => {
      const face = V3(-s.x * 0.6, 0, 10).normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), face)
      const a = new Label(s.id, { height: 0.3, color: HEX.white, tracking: 0.22, weight: 400 })
      const b = new Label(s.sub, { height: 0.14, color: HEX.chrome, tracking: 0.3, opacity: 0.7 })
      a.position.set(s.x - 2.7, 3.62, s.z + 2.9); b.position.set(a.position.x, 3.18, a.position.z)
      a.quaternion.copy(q); b.quaternion.copy(q)
      g.add(a, b)
      return [a, b]
    })
  }

  // ------------------------------------------------------------------ GitHub Actions conveyor
  buildConveyor(g) {
    const x0 = LANE_X - 1.2, x1 = LANE_X + 1.2
    const chassis = new THREE.Mesh(merge([
      { geo: boxSpan(x0, x1, 0, BELT_Y - 0.04, BELT_Z1 - 2.5, BELT_Z0 + 2) },
    ]), graphite({ color: 0x0b0e12, roughness: 0.4, envMapIntensity: 0.3 }))
    const rails = new THREE.Mesh(merge([
      { geo: boxSpan(x0 + 0.1, x0 + 0.24, BELT_Y - 0.06, BELT_Y + 0.12, BELT_Z1 - 2.5, BELT_Z0 + 2) },
      { geo: boxSpan(x1 - 0.24, x1 - 0.1, BELT_Y - 0.06, BELT_Y + 0.12, BELT_Z1 - 2.5, BELT_Z0 + 2) },
      ...GATES.flatMap((gt) => [
        { geo: boxSpan(x0 - 0.2, x0 - 0.06, 0, 3.15, gt.z - 0.07, gt.z + 0.07) },
        { geo: boxSpan(x1 + 0.06, x1 + 0.2, 0, 3.15, gt.z - 0.07, gt.z + 0.07) },
        { geo: boxSpan(x0 - 0.2, x1 + 0.2, 3.02, 3.15, gt.z - 0.07, gt.z + 0.07) },
      ]),
    ]), chrome({ color: 0x9aa4b0, roughness: 0.24, envMapIntensity: 0.45 }))
    g.add(chassis, rails)

    // belt: moving slats + edge light
    const beltGeo = new THREE.PlaneGeometry(x1 - x0 - 0.5, BELT_Z0 - BELT_Z1 + 4.5); beltGeo.rotateX(-Math.PI / 2); beltGeo.translate(LANE_X, BELT_Y, (BELT_Z0 + BELT_Z1) / 2 - 0.25)
    const beltMat = shader({
      uniforms: { uTime: this.uTime },
      vertexShader: /* glsl */`
        varying vec3 vW; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec3 vW; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          float z = vW.z + uTime * ${(51 / T_BELT).toFixed(3)};
          float fw = fwidth(z * 2.5);
          float slat = 1.0 - smoothstep(0.0, max(fw, 0.06) * 1.5, abs(fract(z * 2.5) - 0.5) - 0.44);
          vec3 col = vec3(0.012, 0.015, 0.02) + vec3(0.03, 0.04, 0.05) * slat;
          float edge = smoothstep(0.06, 0.0, min(vUv.x, 1.0 - vUv.x));
          col += vec3(0.18, 0.49, 1.0) * edge * 0.9;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    })
    g.add(new THREE.Mesh(beltGeo, beltMat))

    // light curtains at each gate (brighten while a build passes through)
    const curtains = GATES.map((gt, i) => {
      const pg = new THREE.PlaneGeometry(x1 - x0 + 0.1, 3.02 - BELT_Y); pg.translate(LANE_X, (3.02 + BELT_Y) / 2, gt.z)
      return { geo: pg, attrs: { aGate: i } }
    })
    this.gateHit = new Array(GATES.length).fill(0)
    const curtainMat = shader({
      uniforms: { uTime: this.uTime, uHit: { value: this.gateHit.slice() }, uTest: { value: 0 } },
      ...additive, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float aGate; varying float vG; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){ vG = aGate; vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uHit[${GATES.length}];
        varying float vG; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          int gi = int(vG + 0.5);
          float hit = uHit[gi];
          float scan = smoothstep(0.03, 0.0, abs(fract(vUv.y - uTime * (0.35 + vG * 0.05)) - 0.5) - 0.47);
          float body = (1.0 - vUv.y) * (1.0 - vUv.y) * 0.02 + scan * 0.06;
          float frame = smoothstep(0.02, 0.0, min(vUv.x, 1.0 - vUv.x)) * 0.14;
          vec3 c = gi == 2 ? mix(vec3(0.38, 0.85, 1.0), vec3(0.24, 0.9, 0.62), hit) : vec3(0.38, 0.85, 1.0);
          gl_FragColor = vec4(c * (body + frame) * (0.3 + 1.6 * hit), 1.0);
          ${FOG_ADD}
        }`,
    })
    const cm = new THREE.Mesh(merge(curtains, ['aGate']), curtainMat)
    cm.renderOrder = 3
    g.add(cm)
    this.curtainMat = curtainMat

    // labels: a header and one per gate
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(-0.35, 0, 1).normalize())
    this.gateLabels = GATES.map((gt, i) => {
      const l = new Label(`0${i + 1}  ${gt.id}`, { height: 0.26, color: HEX.white, tracking: 0.2, align: 'center' })
      l.position.set(LANE_X, 3.5, gt.z); l.quaternion.copy(q)
      g.add(l)
      return l
    })
    const extra = [
      ['GITHUB ACTIONS  ·  CI/CD', 4.05, GATES[0].z, HEX.cyan, 0.2],
      ['DOCKER IMAGE', 3.95, GATES[3].z, HEX.smoke, 0.16],
      ['ROLLOUT → K8S', 3.95, GATES[4].z, HEX.smoke, 0.16],
      ['PYTEST · PASS', 3.95, GATES[2].z, HEX.smoke, 0.16],
    ]
    for (const [t, y, z, c, h] of extra) {
      const l = new Label(t, { height: h, color: c, tracking: 0.2, align: 'center' })
      l.position.set(LANE_X, y, z); l.quaternion.copy(q); g.add(l)
      this.gateLabels.push(l)
    }
    this.gateLabels.forEach((l) => (l.userData.base = l.material.opacity))
  }

  // ------------------------------------------------------------------ Kubernetes nodes + pods
  buildCluster(g) {
    const nodeGeo = merge(NODES.map((z) => ({ geo: boxSpan(NODE_X - 2.3, NODE_X + 2.3, 0, 0.55, z - 4.5, z + 4.5) })))
    g.add(new THREE.Mesh(nodeGeo, graphite({ color: 0x0c0f13, roughness: 0.36, envMapIntensity: 0.28 })))
    const trim = merge(NODES.flatMap((z) => rim(NODE_X - 2.3, NODE_X + 2.3, z - 4.5, z + 4.5, 0.55)))
    g.add(new THREE.Mesh(trim, chrome({ roughness: 0.18 })))
    // service plinths
    const pl = merge(this.plinthList.map((p) => ({ geo: boxSpan(p.x - p.sx / 2, p.x + p.sx / 2, 0, p.sy, p.z - p.sz / 2, p.z + p.sz / 2) })))
    g.add(new THREE.Mesh(pl, graphite({ color: 0x090b0e, roughness: 0.42, envMapIntensity: 0.16 })))
    // inset top tier: a darker machined deck the units stand on, with a hairline chrome edge
    const deck = merge(this.plinthList.map((p) => ({ geo: boxSpan(p.x - p.sx / 2 + 0.35, p.x + p.sx / 2 - 0.35, p.sy, p.sy + 0.03, p.z - p.sz / 2 + 0.35, p.z + p.sz / 2 - 0.35) })))
    g.add(new THREE.Mesh(deck, graphite({ color: 0x050608, roughness: 0.25, metalness: 0.6, envMapIntensity: 0.22 })))
    const deckRim = merge(this.plinthList.flatMap((p) => rim(p.x - p.sx / 2 + 0.35, p.x + p.sx / 2 - 0.35, p.z - p.sz / 2 + 0.35, p.z + p.sz / 2 - 0.35, p.sy + 0.005, 0.02, 0.03)))
    g.add(new THREE.Mesh(deckRim, chrome({ roughness: 0.2, envMapIntensity: 0.6 })))
    const plt = merge(this.plinthList.flatMap((p) => rim(p.x - p.sx / 2, p.x + p.sx / 2, p.z - p.sz / 2, p.z + p.sz / 2, p.sy)))
    g.add(new THREE.Mesh(plt, chrome({ roughness: 0.18 })))

    // pod outlines: dashed-free thin cubes that flash when a container is scheduled into them
    const pts = [], slot = []
    const e = 0.92
    const E = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    SLOTS.forEach((s, i) => {
      for (const [a, b] of EDGES) {
        for (const k of [a, b]) { pts.push(s.x + E[k][0] * e, s.y + E[k][1] * e, s.z + E[k][2] * e); slot.push(i) }
      }
    })
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    pg.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(slot), 1))
    this.podFlash = new Array(SLOTS.length).fill(0)
    const podMat = shader({
      uniforms: { uFlash: { value: this.podFlash.slice() } },
      ...additive,
      vertexShader: /* glsl */`
        uniform float uFlash[${SLOTS.length}];
        attribute float aSlot; varying float vF;
        #include <fog_pars_vertex>
        void main(){ vF = uFlash[int(aSlot + 0.5)]; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */`
        varying float vF;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(0.55, 0.72, 0.9) * 0.28 + vec3(0.38, 0.85, 1.0) * vF * 2.4, 1.0); ${FOG_ADD} }`,
    })
    const pods = new THREE.LineSegments(pg, podMat)
    pods.renderOrder = 5
    g.add(pods)
    this.podMat = podMat

    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(0.45, 0, 1).normalize())
    const head = new Label('KUBERNETES  ·  CLUSTER', { height: 0.22, color: HEX.cyan, tracking: 0.2 })
    head.position.set(NODE_X - 2.3, 3.55, NODES[0] + 4.6); head.quaternion.copy(q); g.add(head)
    const sub = new Label('ROLLING UPDATE · 12 PODS', { height: 0.15, color: HEX.smoke, tracking: 0.18 })
    sub.position.set(NODE_X - 2.3, 3.24, NODES[0] + 4.6); sub.quaternion.copy(q); g.add(sub)
    NODES.forEach((z, i) => {
      const l = new Label(`NODE-0${i + 1} · LINUX`, { height: 0.16, color: HEX.chrome, tracking: 0.18 })
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
      l.quaternion.copy(qq)
      l.position.set(NODE_X + 0.2, 0.62, z + 4.2)
      g.add(l)
    })
  }

  // ------------------------------------------------------------------ containers (glass cubes, Docker layers)
  buildContainers(g) {
    const N = 40
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = shader({
      uniforms: { uTime: this.uTime },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec4 aState;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vS; varying vec3 vL;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv; vS = aState; vL = position;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vS; varying vec3 vL;
        #include <fog_pars_fragment>
        void main(){
          float solid = vS.x, layers = vS.y, flash = vS.z, alpha = vS.w;
          vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1.0 - abs(dot(N, V)), 2.0);
          float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float fw = fwidth(e);
          float edge = 1.0 - smoothstep(0.035, 0.035 + fw * 1.5, e);
          vec3 glass = vec3(0.02, 0.03, 0.045) + vec3(0.35, 0.62, 0.95) * fr * 0.45 + vec3(0.1, 0.13, 0.16) * max(N.y, 0.0) * 0.5;
          float side = 1.0 - step(0.5, abs(N.y));
          float ly = fract(vL.y * 4.0 + 0.5);
          float layer = side * (1.0 - smoothstep(0.0, fwidth(vL.y * 4.0) * 1.5, abs(ly - 0.5) - 0.02)) * layers;
          vec3 ec = mix(vec3(0.75, 0.9, 1.0), vec3(0.3, 1.0, 0.7), flash) * (0.8 + flash * 1.3);
          vec3 col = glass * solid + ec * edge + vec3(0.38, 0.85, 1.0) * layer * 0.9 + vec3(0.24, 0.9, 0.62) * flash * 0.35;
          float a = max(edge * 0.95, solid * (0.5 + fr * 0.4) + layer * 0.6 + flash * 0.3);
          gl_FragColor = vec4(col, a * alpha);
          #include <fog_fragment>
        }`,
    })
    const im = new THREE.InstancedMesh(geo, mat, N)
    this.cState = new Float32Array(N * 4)
    this.cAttr = new THREE.InstancedBufferAttribute(this.cState, 4)
    this.cAttr.setUsage(THREE.DynamicDrawUsage)
    im.geometry.setAttribute('aState', this.cAttr)
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    im.frustumCulled = false
    im.renderOrder = 6
    im.count = 0
    g.add(im)
    this.cubes = im
  }

  // ------------------------------------------------------------------ backbone between the halls
  buildBackbone(g) {
    const tubes = []
    for (const z of [22, -82]) for (let k = 0; k < 3; k++) {
      const c = new THREE.CylinderGeometry(0.2, 0.2, 200, 10, 1, true)
      c.rotateZ(Math.PI / 2); c.translate(0, 11.3 + (k === 1 ? 0.35 : 0), z + (k - 1) * 0.5)
      tubes.push({ geo: c })
    }
    for (const z of [22, -82]) for (const x of [-40, -13, 13, 40, -70, 70]) tubes.push({ geo: boxSpan(x - 0.06, x + 0.06, 11.4, 22, z - 0.06, z + 0.06) })
    g.add(new THREE.Mesh(merge(tubes), chrome({ color: 0x4d5560, roughness: 0.34, envMapIntensity: 0.28 })))
    const l = new Label('BACKBONE  ·  AWS ↔ GCP', { height: 0.22, color: HEX.chrome, tracking: 0.22, align: 'center' })
    l.position.set(0, 10.45, 22.6); g.add(l)
  }

  // ------------------------------------------------------------------ packets
  buildFlows(g) {
    const F = new Flows(this.uTime, { low: this.low })
    const svc = (i, y = 2.4) => V3(SERVICES[i].x, y, SERVICES[i].z)
    const ice = '#bfe9ff', cyan = '#62d8ff', blue = '#2d7dff'
    // service mesh traffic
    F.add(svc(0), svc(1), { lift: 3.2, packets: 7, speed: 7, color: cyan })
    F.add(svc(1, 2.2), svc(0, 2.2), { lift: 2.2, packets: 6, speed: 7, color: ice })
    F.add(svc(0), svc(2), { lift: 2.4, packets: 6, speed: 6, color: cyan })
    F.add(svc(2, 2.2), svc(0, 2.2), { lift: 1.6, packets: 5, speed: 6, color: ice })
    // services <-> racks (into the halls on both sides)
    F.add(svc(0, 2.6), V3(-14, 4.5, 58), { lift: 2.5, packets: 5, speed: 8, color: blue })
    F.add(svc(1, 2.6), V3(14, 4.5, 36), { lift: 2.5, packets: 5, speed: 8, color: blue })
    F.add(svc(2, 2.6), V3(-14, 3.5, 28), { lift: 2, packets: 5, speed: 8, color: blue })
    // cluster: node <-> node, nodes -> racks
    F.add(V3(NODE_X, 3, NODES[0]), V3(NODE_X, 3, NODES[1]), { lift: 2, packets: 5, speed: 6, color: cyan })
    F.add(V3(NODE_X, 3, NODES[2]), V3(NODE_X, 3, NODES[1]), { lift: 2, packets: 5, speed: 6, color: cyan })
    F.add(V3(NODE_X - 2, 2.2, NODES[1]), V3(-14, 3, -30), { lift: 1.4, packets: 5, speed: 7, color: blue })
    F.add(V3(NODE_X - 2, 2.2, NODES[2]), V3(-14, 4, -48), { lift: 1.4, packets: 5, speed: 7, color: blue })
    // backbone
    for (const z of [22, -82]) {
      F.add(V3(-100, 11.3, z - 0.5), V3(100, 11.3, z - 0.5), { lift: 0, packets: 22, speed: 55, color: ice, size: 1.5 })
      F.add(V3(100, 11.3, z + 0.5), V3(-100, 11.3, z + 0.5), { lift: 0, packets: 22, speed: 55, color: cyan, size: 1.5 })
    }
    // long inter-rack traffic, visible from high above
    F.add(V3(-80, 9.5, -120), V3(-30, 9.5, 40), { lift: 24, packets: 10, speed: 40, color: ice, size: 3 })
    F.add(V3(-40, 9.5, 50), V3(40, 9.5, -60), { lift: 34, packets: 12, speed: 45, color: cyan, size: 3 })
    F.add(V3(70, 9.5, -130), V3(25, 9.5, 20), { lift: 22, packets: 10, speed: 40, color: ice, size: 3 })
    F.add(V3(60, 9.5, 40), V3(-60, 9.5, -140), { lift: 40, packets: 12, speed: 45, color: blue, size: 3 })
    F.add(V3(-90, 9.5, 0), V3(90, 9.5, -20), { lift: 30, packets: 12, speed: 50, color: cyan, size: 3 })
    g.add(F.build())
    this.flows = F
  }

  // ------------------------------------------------------------------ monitoring holograms
  buildPlots(g) {
    const P = new Plots(this.uTime)
    P.add({ origin: V3(-8.9, 5.3, 52.5), facing: V3(0.35, 0, 1), w: 4.6, h: 1.5, kind: 0, title: 'PROMETHEUS · FASTAPI', sub: 'TTFB  · ms', anchor: 2.3 })
    P.add({ origin: V3(4.5, 5.2, 46.0), facing: V3(-0.35, 0, 1), w: 4.4, h: 1.4, kind: 1, title: 'REDIS · OPS/S', sub: 'SCRAPE 15s', anchor: 2.3 })
    P.add({ origin: V3(3.2, 4.9, 5.0), facing: V3(-0.4, 0, 1), w: 4.4, h: 1.4, kind: 3, title: 'GRAFANA · PIPELINE', sub: 'BUILD DURATION', anchor: 3.2 })
    P.add({ origin: V3(-9.2, 4.9, -41.0), facing: V3(0.45, 0, 1), w: 4.4, h: 1.4, kind: 2, title: 'KUBERNETES · POD CPU', sub: 'NODE-01..03', anchor: 0.6 })
    P.build(g)
    this.plots = P
    this.plotCenters = P.defs.map((d) => d.origin.clone().addScaledVector(d.right, d.w / 2))
    this.ttfb = P.labels[0][1]
  }

  // ------------------------------------------------------------------ corridor dust
  buildDust(g) {
    const N = this.low ? 700 : 1800
    const pos = new Float32Array(N * 3), seed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30
      pos[i * 3 + 1] = Math.random() * 11
      pos[i * 3 + 2] = -70 + Math.random() * 150
      seed[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.dustMat = shader({
      uniforms: { uTime: this.uTime, uPx: { value: 1 }, uA: { value: 1 } },
      ...additive,
      vertexShader: /* glsl */`
        uniform float uTime, uPx; attribute float aSeed; varying float vA;
        #include <fog_pars_vertex>
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.8;
          p.y = mod(p.y + uTime * (0.05 + aSeed * 0.08), 11.0);
          p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.8;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = uPx * (1.0 + aSeed * 1.6) * 7.0 / max(-mvPosition.z, 0.5);
          vA = smoothstep(0.0, 1.0, p.y) * smoothstep(11.0, 9.0, p.y) * (0.3 + 0.7 * fract(aSeed * 17.0)) * smoothstep(1.5, 5.0, -mvPosition.z);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uA; varying float vA;
        #include <fog_pars_fragment>
        ${POINT_FRAG}
        void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.6, 0.78, 1.0) * s * vA * 0.9 * uA, 1.0); ${FOG_ADD} }`,
    })
    const pts = new THREE.Points(geo, this.dustMat)
    pts.frustumCulled = false
    g.add(pts)
  }

  // ------------------------------------------------------------------ hall signage
  buildSigns(g) {
    for (const [s, name] of [[-1, 'AWS'], [1, 'GCP']]) {
      // floor lettering in the apron, read from high above
      const f = new Label(name, { height: 11, color: HEX.chrome, tracking: 0.3, align: 'center', opacity: 0.2, weight: 400 })
      f.rotation.x = -Math.PI / 2
      f.position.set(s * 58, 0.05, Z0 - 22)
      const fs = new Label('REGION HALL  ·  COMPUTE', { height: 1.4, color: HEX.smoke, tracking: 0.3, align: 'center', opacity: 0.35 })
      fs.rotation.x = -Math.PI / 2
      fs.position.set(s * 58, 0.05, Z0 - 12)
      // hanging sign at the corridor mouth
      const h = new Label(name, { height: 1.5, color: HEX.white, tracking: 0.28, align: 'center', weight: 400 })
      h.position.set(s * 20.5, 11.2, Z1 + 1)
      const hs = new Label('REGION HALL', { height: 0.26, color: HEX.smoke, tracking: 0.3, align: 'center' })
      hs.position.set(s * 20.5, 10.1, Z1 + 1)
      g.add(f, fs, h, hs)
    }
    const hang = new THREE.Mesh(merge([-1, 1].flatMap((s) => [
      { geo: boxSpan(s * 20.5 - 2.4, s * 20.5 + 2.4, 9.72, 9.76, Z1 + 0.9, Z1 + 0.94) },
      { geo: boxSpan(s * 20.5 - 2.4, s * 20.5 - 2.37, 9.72, 16, Z1 + 0.9, Z1 + 0.93) },
      { geo: boxSpan(s * 20.5 + 2.37, s * 20.5 + 2.4, 9.72, 16, Z1 + 0.9, Z1 + 0.93) },
    ])), chrome())
    g.add(hang)
  }

  // ------------------------------------------------------------------ hover targets
  buildHits() {
    const B = (x0, x1, y0, y1, z0, z1) => new THREE.Box3(V3(x0, y0, z0), V3(x1, y1, z1))
    this.hits = [
      ...SERVICES.map((s, i) => ({ box: B(s.x - 2.8, s.x + 2.8, 0, 3.2, s.z - 2.8, s.z + 2.8), key: s.id, value: s.hover, group: i, rare: i === 1 })),
      ...NODES.map((z, i) => ({ box: B(NODE_X - 2.4, NODE_X + 2.4, 0, 2.6, z - 4.6, z + 4.6), key: `NODE-0${i + 1}`, value: 'LINUX · 4 PODS · READY', group: 3 + i })),
      { box: B(LANE_X - 1.6, LANE_X + 1.6, 0, 3.3, BELT_Z1 - 2, BELT_Z0 + 2), key: 'GITHUB ACTIONS', value: 'COMMIT → BUILD → TEST → IMAGE → DEPLOY', group: 9 },
    ]
  }

  mount(el) {
    const skills = allSkills['Cloud & DevOps']
    const msg = 'AI is only useful when you can actually ship it.'.split(' ')
    el.innerHTML = `
      <div class="w-head ih-head fx">
        <span class="w-code">WORLD ${this.meta.code}</span>
        <h2 class="w-title">${this.meta.title}</h2>
        <p class="w-lede">${DEPLOY_BULLET}</p>
      </div>
      <div class="ih-stack fx">
        <span class="ih-k">CLOUD &amp; DEVOPS</span>
        <div class="ih-tags">${skills.map((s) => tag(s)).join('')}</div>
      </div>
      <div class="ih-msg">
        <span class="ih-pre fx">PRODUCTION LAYER</span>
        <p class="ih-line">${msg.map((w) => `<span class="ih-w fx">${w}</span>`).join(' ')}</p>
      </div>`
    this.dom = { head: this.$('.ih-head'), stack: this.$('.ih-stack'), pre: this.$('.ih-pre'), words: this.$$('.ih-w') }
  }

  cameraAt(p, out) {
    p = clamp(p)
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++
    const a = KEYS[i], b = KEYS[i + 1]
    const t = smoother(range(p, a.p, b.p)) * 0.35 + range(p, a.p, b.p) * 0.65
    const k0 = KEYS[Math.max(0, i - 1)], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)]
    cr(k0.pos, a.pos, b.pos, k3.pos, t, out.pos)
    cr(k0.tgt, a.tgt, b.tgt, k3.tgt, t, out.target)
    let fov = lerp(a.fov, b.fov, t)
    const asp = this.ctx.camera.aspect
    if (asp < 1) {
      fov = Math.min(80, fov * (1 + (1 - asp) * 0.9))
      // portrait: the desktop establishing shot pushes the halls right of the text column; recentre them
      const c = 1 - smoothstep(0, 0.26, p)
      out.target.x += 44 * c; out.pos.x += 24 * c
    }
    out.fov = fov
  }

  update(p, dt, t, k = 0) {
    this.uTime.value = t
    const low = this.low
    // atmosphere: thin air high above, cold-aisle density inside the corridor, clearing on the way out
    const inside = smoothstep(0.22, 0.4, p) * (1 - smoothstep(0.84, 0.98, p))
    this.fog = lerp(0.0011, 0.0058, inside) + smoothstep(0.88, 1, p) * 0.0022
    this.bloom = lerp(0.95, 0.85, inside)
    this.hall.hazeMat.uniforms.uAmt.value = lerp(0.045, 0.085, inside) * (low ? 1.6 : 1) // low quality draws one haze sheet instead of two
    const px = this.ctx.renderer.getPixelRatio() * (innerHeight / 900)
    this.flows.uniforms.uPx.value = px
    this.dustMat.uniforms.uPx.value = px
    this.dustMat.uniforms.uA.value = inside

    const cam = this.localCamera(this._cam)

    this.updateBuilds(t, dt)

    // labels close to the lens dissolve instead of filling the frame
    for (const l of this.gateLabels) {
      const d = cam.distanceTo(l.position)
      l.opacity = l.userData.base * smoothstep(8, 14, d)
    }

    // holograms draw on as the camera approaches, and fade once it has passed
    for (let i = 0; i < this.plotCenters.length; i++) {
      const c = this.plotCenters[i]
      const dz = cam.z - c.z
      const d = cam.distanceTo(c)
      const v = clamp(1 - (d - 12) / 22) * clamp(1 + (dz + 2) / 6) * (low && i > 2 ? 0.8 : 1)
      const cur = this.plots.vis[i]
      this.plots.setVis(i, damp(cur, v, 3, dt))
    }
    // decorative TTFB readout, always consistent with the resume (under 300 ms)
    if (t - (this._tt || 0) > 0.3 && this.plots.vis[0] > 0.05) {
      this._tt = t
      const v = 238 + Math.round(22 * Math.sin(t * 0.7) + 14 * Math.sin(t * 2.3) + Math.random() * 8)
      this.ttfb.setText(`TTFB  ${Math.min(296, v)} ms`)
    }

    // hover: services, nodes and the conveyor answer the cursor
    let hov = -1
    if (p > 0.3 && p < 0.9 && !this.ctx.isMobile) {
      const ray = this.localRay(this._ray)
      let best = Infinity
      for (let i = 0; i < this.hits.length; i++) {
        const h = this.hits[i]
        const pt = ray.intersectBox(h.box, this._v)
        if (pt) { const d = pt.distanceTo(ray.origin); if (d < best) { best = d; hov = i } }
      }
    }
    if (hov !== this.hovered) {
      this.hovered = hov
      if (hov >= 0) this.ctx.cursor.hover(this.hits[hov].key, this.hits[hov].value, this)
      else this.ctx.cursor.hover(null, null, this)
      const gidx = hov >= 0 ? this.hits[hov].group : -1
      this.slitMat.uniforms.uHover.value = gidx
      this.ringMat.uniforms.uHover.value = gidx
      this.faceMat.uniforms.uHover.value = gidx
    }
    // Redis replica 3 occasionally goes amber and recovers: reflect it in the hover readout
    if (hov === 1) {
      const seed = 1 * 0.37 + 2 * 0.13, cyc = 13 + seed * 6
      const ph = ((t / cyc + seed) % 1 + 1) % 1
      this.ctx.cursor.hover('REDIS', ph < 0.2 ? 'REPLICA 3 · DEGRADED → RECOVERING' : 'CACHE · HEALTHY', this)
    }

    // overlay
    const D = this.dom
    if (D) {
      reveal(D.head, band(p, -0.01, 0.0, 0.11, 0.17))
      reveal(D.stack, band(p, 0.3, 0.36, 0.7, 0.76))
      reveal(D.pre, band(p, 0.85, 0.88, 0.978, 1.0))
      const n = D.words.length
      const out = 1 - range(p, 0.978, 1.0)
      for (let i = 0; i < n; i++) { const a = 0.87 + i * 0.0075; reveal(D.words[i], range(p, a, a + 0.03) * out, 8) }
    }
  }

  // Rolling deploys: a new build every T_ITEM seconds travels the conveyor, is flown into a pod slot, and
  // the container it replaces in that slot drains away as it lands.
  updateBuilds(t, dt) {
    const S = this.cState, im = this.cubes, m = this._m, q = this._q, s = this._s, v = this._v
    let n = 0
    const put = (x, y, z, sx, sy, sz, rotY, solid, layers, flash, alpha) => {
      if (n >= 40) return
      q.setFromAxisAngle(V3Y, rotY)
      s.set(sx, sy, sz)
      m.compose(v.set(x, y, z), q, s)
      im.setMatrixAt(n, m)
      S[n * 4] = solid; S[n * 4 + 1] = layers; S[n * 4 + 2] = flash; S[n * 4 + 3] = alpha
      n++
    }
    const hits = this.gateHit
    for (let i = 0; i < hits.length; i++) hits[i] = 0
    const kNow = Math.floor(t / T_ITEM)
    const kMin = Math.floor((t - T_BELT - T_FLY) / T_ITEM)
    const NS = SLOTS.length
    const landing = (this._landing ??= new Float32Array(NS)).fill(-1) // slot -> flight progress of an incoming build (for the drain)
    // builds on the belt / in the air
    for (let kk = kMin; kk <= kNow; kk++) {
      const age = t - kk * T_ITEM
      if (age < 0) continue
      const u = age / T_BELT
      if (u <= 1) {
        const z = lerp(BELT_Z0, BELT_Z1, u)
        let sy, sxz, solid, layers, flash
        if (z > GATES[1].z) { sxz = 0.8; sy = 0.08; solid = 0.12; layers = 0; flash = 0 }
        else if (z > GATES[2].z) { const q2 = smoother((GATES[1].z - z) / (GATES[1].z - GATES[2].z)); sxz = lerp(0.8, 0.9, q2); sy = lerp(0.08, 0.9, q2); solid = lerp(0.12, 0.3, q2); layers = 0; flash = 0 }
        else { sxz = 0.9; sy = 0.9; solid = 0.3; layers = 0; flash = 0 }
        flash = Math.max(0, 1 - Math.abs(z - GATES[2].z + 1.2) / 2.2)
        if (z < GATES[3].z + 0.6) { layers = smoothstep(GATES[3].z + 0.6, GATES[3].z - 1.2, z); solid = lerp(0.3, 0.55, layers) }
        const intro = smoothstep(0, 0.05, u)
        put(LANE_X, BELT_Y + sy / 2 + 0.02, z, sxz * intro, sy * intro, sxz * intro, 0, solid, layers, flash, 1)
        for (let gi = 0; gi < GATES.length; gi++) hits[gi] = Math.max(hits[gi], Math.max(0, 1 - Math.abs(z - GATES[gi].z) / 1.6))
      } else {
        const f = (age - T_BELT) / T_FLY
        if (f > 1) continue
        const slot = ((kk % NS) + NS) % NS
        const e = smoother(f)
        const a = this._v2.set(LANE_X, BELT_Y + 0.47, BELT_Z1)
        const b = SLOTS[slot]
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, cy = 4.6
        const it = 1 - e
        const x = it * it * a.x + 2 * it * e * cx + e * e * b.x
        const y = it * it * a.y + 2 * it * e * cy + e * e * b.y
        const z = it * it * a.z + 2 * it * e * cz + e * e * b.z
        put(x, y, z, 0.9, 0.9, 0.9, e * Math.PI, 0.55, 1, 0, 1)
        landing[slot] = f
        hits[4] = Math.max(hits[4], 1 - f * 2)
      }
    }
    // resident containers (the last build that landed in each slot)
    const pf = this.podFlash
    for (let sl = 0; sl < NS; sl++) {
      // latest kk with kk % NS == sl that has landed: kk*T + T_BELT + T_FLY <= t
      const kl = Math.floor((t - T_BELT - T_FLY) / T_ITEM)
      let kk = kl - ((((kl - sl) % NS) + NS) % NS)
      const landedAgo = t - (kk * T_ITEM + T_BELT + T_FLY)
      const inc = landing[sl]
      let sc = 0.9, alpha = 1
      if (inc > 0.45) { const d = smoothstep(0.45, 0.95, inc); sc = 0.9 * (1 - d * 0.6); alpha = 1 - d }
      const sp = SLOTS[sl]
      put(sp.x, sp.y, sp.z, sc, sc, sc, 0, 0.55, 1, 0, alpha)
      const fl = Math.max(0, 1 - landedAgo / 1.2)
      pf[sl] = Math.max(fl * fl, damp(pf[sl], 0, 3, dt))
    }
    im.count = n
    im.instanceMatrix.needsUpdate = true
    this.cAttr.needsUpdate = true
    const uh = this.curtainMat.uniforms.uHit.value
    for (let i = 0; i < hits.length; i++) uh[i] = damp(uh[i], hits[i], 8, dt)
    const up = this.podMat.uniforms.uFlash.value
    for (let i = 0; i < NS; i++) up[i] = pf[i]
  }
}

const V3Y = new THREE.Vector3(0, 1, 0)

/** Four thin chrome edges around a rectangle (a rim, not a lid, so it doesn't mirror the ceiling). */
function rim(x0, x1, z0, z1, y, t = 0.05, h = 0.045) {
  return [
    { geo: boxSpan(x0 - t, x1 + t, y, y + h, z0 - t, z0) },
    { geo: boxSpan(x0 - t, x1 + t, y, y + h, z1, z1 + t) },
    { geo: boxSpan(x0 - t, x0, y, y + h, z0, z1) },
    { geo: boxSpan(x1, x1 + t, y, y + h, z0, z1) },
  ]
}
