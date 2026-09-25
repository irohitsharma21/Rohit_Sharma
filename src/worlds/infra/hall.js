import * as THREE from 'three'
import { HASH, FOG_ADD, shader, additive, merge, boxSpan } from './gl.js'
import { rng } from '../../lib/math.js'

// The two region halls: long aisles of graphite racks with smoked-glass doors (LEDs drawn procedurally in
// the door shader), chrome caps, overhead cable trays carrying light pulses, a reflective gridded floor and
// cold-aisle haze. Everything is instanced / merged: ~9 draw calls for ~2,000 racks.

export const RACK = { D: 3, H: 7, W: 1.8, pitch: 1.9 }
export const Z0 = -150
const BLOCK = 14, GAP = 5, BLOCKS = 7
export const Z1 = Z0 + BLOCKS * (BLOCK * RACK.pitch + GAP) - GAP
export const FLOOR = 440

/** Row layout for one hall side (s = -1 AWS, +1 GCP). Each row: centre x, facing (+1 door faces +x). */
export function rowsFor(s, pairs) {
  const rows = [{ x: s * 15.5, face: -s, edge: true }]
  for (let j = 0; j < pairs; j++) {
    rows.push({ x: s * (21.5 + 14 * j), face: s })
    rows.push({ x: s * (29.5 + 14 * j), face: -s })
  }
  return rows
}
export function blocks() {
  const out = []
  for (let b = 0; b < BLOCKS; b++) {
    const z0 = Z0 + b * (BLOCK * RACK.pitch + GAP)
    out.push([z0, z0 + BLOCK * RACK.pitch])
  }
  return out
}

export function buildHalls(root, uTime, { low }) {
  const pairs = low ? 4 : 5
  const rows = [...rowsFor(-1, pairs), ...rowsFor(1, pairs)]
  const B = blocks()
  const count = rows.length * B.length * BLOCK
  const R = rng(7)

  // ---- racks: body, cap, door
  const bodyGeo = new THREE.BoxGeometry(RACK.D, RACK.H, RACK.W); bodyGeo.translate(0, RACK.H / 2, 0)
  const capGeo = new THREE.BoxGeometry(0.1, 0.06, RACK.W + 0.02); capGeo.translate(RACK.D / 2 - 0.02, RACK.H + 0.03, 0)
  const doorGeo = new THREE.PlaneGeometry(RACK.W * 0.93, RACK.H * 0.95); doorGeo.rotateY(Math.PI / 2); doorGeo.translate(RACK.D / 2 + 0.015, RACK.H / 2, 0)

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x080a0d, metalness: 0.35, roughness: 0.55, envMapIntensity: 0.3 })
  const capMat = new THREE.MeshStandardMaterial({ color: 0xaab4c0, metalness: 1, roughness: 0.25, envMapIntensity: 0.5 })
  const doorMat = shader({
    uniforms: { uTime },
    vertexShader: /* glsl */`
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      void main(){
        vUv = uv; vSeed = aSeed;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv; varying float vSeed; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_fragment>
      ${HASH}
      void main(){
        vec2 uv = vUv;
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN);
        float ndv = abs(dot(N, V));
        float fr = pow(1.0 - ndv, 4.0);
        // smoked glass: near-black with a soft vertical studio streak and grazing reflection
        vec3 col = vec3(0.008, 0.010, 0.014);
        float streak = smoothstep(0.15, 0.0, abs(uv.x - 0.72 + uv.y * 0.18)) * smoothstep(0.0, 0.8, uv.y);
        col += vec3(0.030, 0.040, 0.052) * streak * (0.4 + fr);
        col += vec3(0.05, 0.07, 0.095) * fr;

        // 1U server faces behind the glass
        const float U = 20.0;
        float y = (uv.y - 0.035) / 0.93;
        float inside = step(0.0, y) * step(y, 1.0) * step(0.07, uv.x) * step(uv.x, 0.93);
        float row = floor(y * U);
        float fy = fract(y * U);
        float fwY = fwidth(y * U);
        float lod = clamp((fwY - 0.18) * 2.2, 0.0, 1.0);          // 1 = a unit is sub-pixel: average instead of detail
        float filled = step(0.2, h21(vec2(vSeed * 91.0, row)));
        float sep = 1.0 - smoothstep(0.0, max(fwY * 1.2, 0.05), abs(fy - 0.03));
        col += vec3(0.020, 0.026, 0.034) * sep * inside * (1.0 - lod);
        col += vec3(0.007, 0.009, 0.012) * filled * inside;

        // status LEDs: power (green), activity (cyan), link (blue). A very rare unit shows amber.
        vec3 led = vec3(0.0);
        vec3 avg = vec3(0.0);
        if (inside * filled > 0.5) {
          float rare = step(0.9965, h21(vec2(vSeed * 17.0, row + 3.0)));
          if (lod > 0.98) {
            // sub-pixel: a cheap per-unit average (power LED + flickering activity)
            float act = step(0.35, h21(vec2(vSeed * 13.0 + row * 7.0, floor(uTime * 2.0 + vSeed * 10.0))));
            avg = (mix(vec3(0.24, 0.9, 0.62), vec3(1.0, 0.62, 0.2), rare) * 0.55 + vec3(0.38, 0.85, 1.0) * act + vec3(0.18, 0.49, 1.0) * 0.3) * 0.035;
          } else {
            for (int k = 0; k < 3; k++) {
              float fk = float(k);
              float cx = 0.13 + fk * 0.06;
              vec2 d = vec2((uv.x - cx) / 0.022, (fy - 0.52) / 0.13);
              float dot_ = 1.0 - smoothstep(0.55, 1.0 + fwY * 6.0, length(d));
              float rate = 0.6 + 4.0 * h11(row * 3.1 + vSeed * 7.0 + fk);
              float on = step(0.32, h21(vec2(vSeed * 13.0 + row * 7.0 + fk, floor(uTime * rate + h11(vSeed + fk) * 10.0))));
              vec3 c = k == 0 ? vec3(0.24, 0.9, 0.62) : (k == 1 ? vec3(0.38, 0.85, 1.0) : vec3(0.18, 0.49, 1.0));
              if (k == 0) { on = 1.0; c = mix(c, vec3(1.0, 0.62, 0.2), rare); on *= mix(1.0, step(0.5, fract(uTime * 0.9)), rare); }
              float w = k == 1 ? 1.0 : 0.55;
              led += c * dot_ * on * w;
              avg += c * on * w;
            }
            avg *= 0.035;
          }
        }
        col += mix(led * 3.2, avg, lod);

        // slim edge light along the door frame
        float edge = smoothstep(0.012, 0.0, abs(uv.x - 0.965));
        col += vec3(0.12, 0.35, 0.9) * edge * 0.55;

        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  })

  const body = new THREE.InstancedMesh(bodyGeo, bodyMat, count)
  const cap = new THREE.InstancedMesh(capGeo, capMat, count)
  const door = new THREE.InstancedMesh(doorGeo, doorMat, count)
  const seeds = new Float32Array(count)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
  let i = 0
  // near-to-far instance order (corridor rows first, +z first) so early depth rejects hidden door fragments
  const order = [...rows].sort((a, b) => Math.abs(a.x) - Math.abs(b.x))
  for (const r of order) {
    q.setFromAxisAngle(up, r.face > 0 ? 0 : Math.PI)
    for (const [z0] of [...B].reverse()) {
      for (let k = BLOCK - 1; k >= 0; k--) {
        p.set(r.x, 0, z0 + (k + 0.5) * RACK.pitch)
        m.compose(p, q, one)
        body.setMatrixAt(i, m); cap.setMatrixAt(i, m); door.setMatrixAt(i, m)
        seeds[i] = R()
        i++
      }
    }
  }
  door.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  body.renderOrder = -2; cap.renderOrder = -1; door.renderOrder = 0
  for (const o of [body, cap, door]) { o.frustumCulled = false; o.instanceMatrix.needsUpdate = true; root.add(o) }

  // ---- cable trays with light pulses (one merged tray mesh + one merged pulse mesh)
  const trays = [], pulses = []
  const cross = []
  for (const r of rows) {
    trays.push({ geo: boxSpan(r.x - 0.45, r.x + 0.45, 8.7, 8.86, Z0 - 2, Z1 + 2) })
    const sd = R()
    pulses.push({ geo: boxSpan(r.x - 0.17, r.x + 0.17, 8.62, 8.92, Z0 - 2, Z1 + 2), attrs: { aAlong: (x, y, z) => z * (r.face), aSeed: sd } })
  }
  for (let b = 0; b < B.length - 1; b++) {
    const zc = (B[b][1] + B[b + 1][0]) / 2
    for (const s of [-1, 1]) {
      const xa = s * 14, xb = s * (31 + 14 * pairs)
      trays.push({ geo: boxSpan(Math.min(xa, xb), Math.max(xa, xb), 9.3, 9.46, zc - 0.5, zc + 0.5) })
      pulses.push({ geo: boxSpan(Math.min(xa, xb), Math.max(xa, xb), 9.22, 9.52, zc - 0.17, zc + 0.17), attrs: { aAlong: (x) => x * s, aSeed: R() } })
      cross.push({ zc, s })
    }
  }
  const trayMesh = new THREE.Mesh(merge(trays), new THREE.MeshStandardMaterial({ color: 0x14181e, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.3 }))
  const pulseMat = shader({
    uniforms: { uTime },
    vertexShader: /* glsl */`
      attribute float aAlong; attribute float aSeed;
      varying float vA; varying float vS;
      #include <fog_pars_vertex>
      void main(){ vA = aAlong; vS = aSeed; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying float vA; varying float vS;
      #include <fog_pars_fragment>
      ${HASH}
      void main(){
        float sp = 9.0 + h11(vS * 11.0) * 14.0;
        float len = 26.0 + h11(vS * 5.0) * 40.0;
        float f = fract((vA - uTime * sp) / len + vS);
        float head = smoothstep(0.0, 0.01, f) * (1.0 - smoothstep(0.01, 0.16, f));
        float f2 = fract((vA - uTime * sp * 0.63) / (len * 1.7) + vS * 3.0);
        float head2 = smoothstep(0.0, 0.01, f2) * (1.0 - smoothstep(0.01, 0.1, f2));
        vec3 col = vec3(0.02, 0.05, 0.11) + vec3(0.38, 0.85, 1.0) * head * 3.2 + vec3(0.18, 0.49, 1.0) * head2 * 2.2;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  })
  const pulseMesh = new THREE.Mesh(merge(pulses, ['aAlong', 'aSeed']), pulseMat)
  root.add(trayMesh, pulseMesh)

  // ---- floor reflection/contact map painted once on a canvas
  const map = paintFloor(rows, B, pairs)
  const floorMat = shader({
    uniforms: { uTime, uMap: { value: map } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uTime; varying vec3 vW;
      #include <fog_pars_fragment>
      float gridL(float c){ float w = fwidth(c); return 1.0 - smoothstep(0.0, w * 1.2, abs(fract(c - 0.5) - 0.5)); }
      void main(){
        vec2 uv = vW.xz / ${FLOOR.toFixed(1)} + 0.5;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.5);
        vec2 wob = vec2(sin(vW.z * 0.9 + uTime * 0.3), cos(vW.x * 0.8)) * 0.0006 * fres;
        vec4 m = texture2D(uMap, uv + wob);
        vec3 col = vec3(0.005, 0.0065, 0.009);
        float fw = length(fwidth(vW.xz));
        float g1 = max(gridL(vW.x / 1.2), gridL(vW.z / 1.2)) * (1.0 - smoothstep(0.08, 0.5, fw));
        float g2 = max(gridL(vW.x / 7.2), gridL(vW.z / 7.2)) * (1.0 - smoothstep(0.5, 2.2, fw));
        col += vec3(0.020, 0.030, 0.042) * g1 * 0.5 + vec3(0.03, 0.06, 0.09) * g2 * 0.32 * (1.0 - smoothstep(0.25, 1.4, fw));
        vec3 spill = vec3(0.07, 0.22, 0.6) * m.r * 0.22 + vec3(0.30, 0.66, 1.0) * m.b * 0.16;
        col += spill * (0.35 + 1.9 * fres);
        col *= 1.0 - m.g * 0.85;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  })
  const floorGeo = new THREE.PlaneGeometry(FLOOR, FLOOR); floorGeo.rotateX(-Math.PI / 2)
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.renderOrder = 1
  root.add(floor)

  // ---- cold-aisle haze: two sheets of slow value noise, strongest at grazing angles
  const noise = noiseTex()
  const hazeMat = shader({
    uniforms: { uTime, uNoise: { value: noise }, uAmt: { value: 0.07 } },
    ...additive,
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime, uAmt; varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        float n = texture2D(uNoise, vW.xz * 0.010 + vec2(uTime * 0.003, vW.y * 0.1)).r * 0.6 + texture2D(uNoise, vW.xz * 0.031 - vec2(0.0, uTime * 0.005)).r * 0.4;
        n = smoothstep(0.25, 0.85, n);
        vec3 D = cameraPosition - vW;
        float graze = 1.0 - abs(normalize(D).y);
        float a = uAmt * n * (0.25 + 1.4 * graze * graze);
        a *= smoothstep(3.0, 18.0, length(D));
        vec2 e = abs(vW.xz - vec2(0.0, -40.0)) / 170.0;
        a *= 1.0 - smoothstep(0.7, 1.0, max(e.x, e.y));
        gl_FragColor = vec4(vec3(0.34, 0.55, 0.85) * a, 1.0);
        ${FOG_ADD}
      }`,
  })
  const hazeGeo = merge((low ? [2.6] : [1.4, 4.2]).map((y) => { const g = new THREE.PlaneGeometry(340, 340); g.rotateX(-Math.PI / 2); g.translate(0, y, -40); return { geo: g } }))
  const haze = new THREE.Mesh(hazeGeo, hazeMat)
  haze.renderOrder = 2
  root.add(haze)

  return { rows, blocks: B, pairs, cross, hazeMat, count }
}

function paintFloor(rows, B, pairs) {
  const S = 1024
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S)
  const X = (x) => (x / FLOOR + 0.5) * S
  const rect = (x0, x1, z0, z1) => g.fillRect(X(Math.min(x0, x1)), X(Math.min(z0, z1)), Math.abs(X(x1) - X(x0)), Math.abs(X(z1) - X(z0)))
  g.globalCompositeOperation = 'lighter'
  // contact shadows under racks (G)
  g.filter = 'blur(2px)'
  g.fillStyle = 'rgba(0,255,0,0.9)'
  for (const r of rows) for (const [z0, z1] of B) rect(r.x - 1.9, r.x + 1.9, z0 - 0.6, z1 + 0.6)
  // light spilling from the door faces into cold aisles (R)
  g.filter = 'blur(5px)'
  for (const r of rows) {
    const xd = r.x + r.face * RACK.D / 2
    for (const [z0, z1] of B) {
      g.fillStyle = 'rgba(255,0,0,0.55)'; rect(xd, xd + r.face * 3.2, z0 + 0.4, z1 - 0.4)
      g.fillStyle = 'rgba(255,0,0,0.5)'; rect(xd, xd + r.face * 1.2, z0 + 0.4, z1 - 0.4)
    }
  }
  // corridor: pools under the services, the conveyor and the cluster (B)
  g.filter = 'blur(10px)'
  const pool = (x, z, rx, rz, a) => { g.fillStyle = `rgba(0,0,255,${a})`; g.beginPath(); g.ellipse(X(x), X(z), rx / FLOOR * S, rz / FLOOR * S, 0, 0, Math.PI * 2); g.fill() }
  pool(-7, 50, 5, 5, 0.55); pool(7, 44, 5, 5, 0.45); pool(-7, 34, 5, 5, 0.45)
  pool(6.5, -6, 3, 26, 0.5)
  pool(-6.5, -38, 5, 17, 0.5)
  g.fillStyle = 'rgba(0,0,255,0.18)'; rect(-1.2, 1.2, Z0, Z1 + 10)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = 4
  return tex
}

function noiseTex() {
  const N = 64, R = rng(3)
  const d = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) { const v = (R() * 255) | 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255 }
  const t = new THREE.DataTexture(d, N, N)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
