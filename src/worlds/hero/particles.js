import * as THREE from 'three'
import { NOISE, POINT_FRAG } from '../../lib/glsl.js'
import { rng } from '../../lib/math.js'

// GPU particle systems for the core.
//  - morph: one Points cloud that is, in turn, speech waveform rings (VOICE), a layered neural
//    lattice (INTELLIGENCE) and directed action packets (ACTION). All three shapes are resolved
//    in the vertex shader; the CPU only advances a phase uniform.
//  - dust: the curl-noise particle field that fills the void and bends toward the pointer ray.

const POINT_FS = /* glsl */`
  varying vec3 vCol; varying float vA;
  ${POINT_FRAG}
  void main(){ float s = softPoint(gl_PointCoord); if (s < 0.01) discard; gl_FragColor = vec4(vCol * s * vA, 1.0); }
`

/** Node positions for the neural lattice: three Fibonacci shells, wired inner → outer. */
function lattice(r) {
  const shells = [[12, 3.4], [30, 6.2], [54, 9.0]]
  const nodes = [] // {p, s}
  shells.forEach(([n, R], s) => {
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 2, rr = Math.sqrt(1 - y * y), a = i * 2.39996 + s * 0.7
      nodes.push({ p: new THREE.Vector3(Math.cos(a) * rr * R, y * R, Math.sin(a) * rr * R), s })
    }
  })
  const edges = []
  const near = (from, shell, k) => nodes.filter((n) => n.s === shell && n !== from)
    .map((n) => [n, n.p.distanceToSquared(from.p)]).sort((a, b) => a[1] - b[1]).slice(0, k).map((x) => x[0])
  for (const n of nodes) {
    if (n.s < 2) for (const m of near(n, n.s + 1, 3)) edges.push([n, m, true])
    if (n.s === 2) for (const m of near(n, 2, 2)) if (nodes.indexOf(m) > nodes.indexOf(n)) edges.push([n, m, false])
  }
  return { nodes, edges }
}

export function createMorph(U, quality) {
  const N = quality === 'low' ? 7000 : 14000
  const r = rng(7)
  const pos = new Float32Array(N * 3), aV = new Float32Array(N * 4), aDir = new Float32Array(N * 3), aOff = new Float32Array(N * 3), aS = new Float32Array(N * 4)
  const { nodes, edges } = lattice(r)

  // action lanes: structured, quantised directions (every 30° in the core's plane, a few tilted)
  const lanes = []
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6 + Math.PI / 12
    const tilt = (k % 3 - 1) * 0.28
    const d = new THREE.Vector3(Math.cos(a), Math.sin(a), tilt).normalize()
    const perp = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0)
    for (let l = -1; l <= 1; l++) lanes.push({ d, off: perp.clone().multiplyScalar(l * 0.42), sp: 0.2 + r() * 0.08 })
  }
  const PK = 5 // packets per lane

  const v = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    const seed = r()
    // --- intelligence: node cluster or a point on an edge
    let u = -1
    if (r() < 0.16) {
      const n = nodes[Math.floor(r() * nodes.length)]
      v.copy(n.p).addScaledVector(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5), 0.22)
    } else {
      const e = edges[Math.floor(r() * edges.length)]
      u = r()
      v.lerpVectors(e[0].p, e[1].p, u)
      if (!e[2]) u = r() * 0.999 // intra-shell: random pulse phase
    }
    pos.set([v.x, v.y, v.z], i * 3)
    // --- voice: ring index, angle, z jitter, fill
    aV.set([Math.floor(r() * 6), r() * Math.PI * 2, r() * 2 - 1, r()], i * 4)
    // --- action: lane + packet
    const lane = lanes[Math.floor(r() * lanes.length)]
    aDir.set([lane.d.x, lane.d.y, lane.d.z], i * 3)
    aOff.set([lane.off.x + (r() - 0.5) * 0.05, lane.off.y + (r() - 0.5) * 0.05, lane.off.z], i * 3)
    const pk = Math.floor(r() * PK)
    aS.set([seed, (pk / PK + lanes.indexOf(lane) * 0.137) % 1, Math.pow(r(), 0.6), u], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aV', new THREE.BufferAttribute(aV, 4))
  g.setAttribute('aDir', new THREE.BufferAttribute(aDir, 3))
  g.setAttribute('aOff', new THREE.BufferAttribute(aOff, 3))
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 4))
  // lane speeds are baked per point via aS.x in-shader

  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: U,
    vertexShader: /* glsl */`
      uniform float uTime, uBoot, uPh, uPtrOn, uScale, uCore;
      uniform vec3 uPtr;
      attribute vec4 aV; attribute vec3 aDir; attribute vec3 aOff; attribute vec4 aS;
      varying vec3 vCol; varying float vA;
      ${NOISE}
      mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
      void main(){
        float t = uTime;
        // ---------------- VOICE: speech waveform rings
        float ri = aV.x, a = aV.y;
        float R = 3.9 + ri*1.12;
        float sig = sin(a*6.0 + t*2.1 + ri)*0.5 + sin(a*13.0 - t*3.3 + ri*2.0)*0.3 + sin(a*29.0 + t*5.1 + ri)*0.2;
        float env = pow(0.5+0.5*sin(a*2.0 - t*1.5 + ri*0.9), 2.0) * (0.55 + 0.45*sin(t*3.7 + ri*1.3));
        vec2 bxy = vec2(cos(a), sin(a))*R;
        float dp = distance(bxy, uPtr.xy);
        float amp = 0.95 * (1.0 + 2.4*uPtrOn*exp(-dp*dp/9.0));
        float fill = aV.w < 0.3 ? aV.w/0.3 : 1.0;
        float rr = R + sig*env*amp*fill;
        vec3 pV = vec3(cos(a)*rr, sin(a)*rr, (ri-2.5)*0.5 + aV.z*0.05);
        float bV = aV.w < 0.3 ? 0.28 : 0.95 + env*0.9;

        // ---------------- INTELLIGENCE: neural lattice with activations flowing outward
        vec3 pI = position;
        pI.xz = rot(t*0.07) * pI.xz;
        pI.yz = rot(0.35) * pI.yz;
        float node = aS.w < 0.0 ? 1.0 : 0.0;
        float pulse = node > 0.5 ? 0.0 : smoothstep(0.9, 1.0, fract(aS.w - t*0.55 + aS.x*0.35));
        float bI = node > 0.5 ? 1.15 : 0.26 + pulse*2.0;

        // ---------------- ACTION: directed packets leaving the core
        float s = fract(t*(0.19 + aS.x*0.018) + aS.y);
        float ra = 3.0 + s*27.0 + aS.z*1.5;
        vec3 pA = aDir*ra + aOff;
        float bA = (0.35 + 2.3*aS.z*aS.z) * smoothstep(3.0, 6.5, ra) * (1.0 - smoothstep(17.0, 30.0, ra));
        // packets steer toward the cursor the further out they fly
        vec3 toP = uPtr - pA;
        pA += toP * uPtrOn * smoothstep(5.0, 22.0, ra) * exp(-dot(toP,toP)/260.0) * 0.75;

        // ---------------- phase blend, staggered per point so the transformation ripples
        float ph = mod(uPh - aS.x*0.3, 3.0);
        float seg = floor(ph); float tr = smoothstep(0.62, 1.0, ph - seg);
        float nx = mod(seg + 1.0, 3.0);
        vec3 W = (1.0-tr)*vec3(step(seg,0.5), step(abs(seg-1.0),0.5), step(1.5,seg))
               + tr*vec3(step(nx,0.5), step(abs(nx-1.0),0.5), step(1.5,nx));
        vec3 p = pV*W.x + pI*W.y + pA*W.z;
        float sw = sin(tr*3.14159);
        if (sw > 0.01) p += curlNoise(p*0.16 + t*0.12) * sw * 1.3;

        // ---------------- boot: converge from a dormant, scattered cloud
        float b = 1.0 - pow(1.0 - uBoot, 3.0);
        vec3 scat = normalize(p + vec3(0.001)) * (7.0 + aS.x*22.0) + vec3(sin(aS.x*91.0), cos(aS.x*57.0), sin(aS.x*33.0))*6.0;
        p = mix(scat, p, b);

        // ---------------- pointer attraction
        vec3 tp = uPtr - p;
        p += tp * uPtrOn * 0.3 * exp(-dot(tp,tp)/12.0);

        vec3 cV = vec3(0.42, 0.80, 1.0), cI = vec3(0.72, 0.84, 1.0), cA = vec3(0.22, 0.52, 1.0);
        vec3 col = cV*bV*W.x + cI*bI*W.y + mix(cA, vec3(0.8,0.92,1.0), aS.z*aS.z)*bA*W.z;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = 0.1 + W.y*node*0.16 + W.z*aS.z*0.05;
        gl_PointSize = clamp(size * uScale / -mv.z, 1.0, 6.0);
        vCol = col;
        vA = 0.95 * (0.12 + 0.88*uBoot) * smoothstep(0.4, 3.0, -mv.z) * uCore;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: POINT_FS,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false

  // faint wiring for the lattice, visible only while INTELLIGENCE dominates
  const lp = new Float32Array(edges.length * 6), lu = new Float32Array(edges.length * 2)
  edges.forEach((e, i) => { lp.set([e[0].p.x, e[0].p.y, e[0].p.z, e[1].p.x, e[1].p.y, e[1].p.z], i * 6); lu.set([0, 1], i * 2) })
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3))
  lg.setAttribute('aU', new THREE.BufferAttribute(lu, 1))
  const lm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uW: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uTime; attribute float aU; varying float vU;
      mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
      void main(){ vec3 p = position; p.xz = rot(uTime*0.07)*p.xz; p.yz = rot(0.35)*p.yz; vU = aU; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uW, uBoot, uCore; varying float vU;
      void main(){ gl_FragColor = vec4(vec3(0.35,0.55,1.0) * (0.25 + 0.5*vU) * uW * uBoot * uCore, 1.0); }`,
  })
  const wires = new THREE.LineSegments(lg, lm)
  wires.frustumCulled = false
  return { points: pts, wires, wireMat: lm }
}

export function createDust(U, quality) {
  const N = quality === 'low' ? 8000 : 17000
  const r = rng(21)
  const pos = new Float32Array(N * 3), seed = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const u = r(), rad = 7 + 150 * Math.pow(u, 2.1)
    const th = r() * Math.PI * 2, y = r() * 2 - 1, q = Math.sqrt(1 - y * y)
    pos.set([Math.cos(th) * q * rad, y * rad * 0.62, Math.sin(th) * q * rad], i * 3)
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
    vertexShader: /* glsl */`
      uniform float uTime, uBoot, uPtrOn, uRayOn, uScale;
      uniform vec3 uRayO, uRayD;
      attribute float aSeed; varying vec3 vCol; varying float vA;
      ${NOISE}
      void main(){
        vec3 p = position;
        float r = length(p);
        // slow orbit, faster close to the core
        float ang = uTime * (0.012 + 0.5/(r+8.0));
        float c = cos(ang), s = sin(ang);
        p.xz = mat2(c,-s,s,c) * p.xz;
        p += curlNoise(p*0.02 + vec3(0.0, uTime*0.025, aSeed*0.2)) * (1.5 + r*0.045);
        float b = 1.0 - pow(1.0 - uBoot, 3.0);
        p *= mix(1.45, 1.0, b);
        // bend toward the pointer ray
        vec3 w = p - uRayO; float tt = max(dot(w, uRayD), 0.0);
        vec3 toC = uRayO + uRayD*tt - p; float dd = length(toC);
        float R = 2.0 + tt*0.07;
        p += toC * exp(-dd*dd/(R*R)) * 0.55 * uRayOn;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float z = -mv.z;
        gl_PointSize = clamp((0.07 + aSeed*0.07) * uScale / z, 1.0, 5.0);
        float tw = 0.55 + 0.45*sin(uTime*(0.6+aSeed*1.7) + aSeed*40.0);
        vA = (0.1 + 0.28*b) * tw * smoothstep(0.5, 4.0, z) * (1.0 + 1.3*exp(-dd*dd/(R*R*3.0))*uRayOn);
        vCol = mix(vec3(0.62,0.74,0.9), vec3(0.45,0.8,1.0), step(0.85, aSeed));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: POINT_FS,
  })
  const pts = new THREE.Points(g, m)
  pts.frustumCulled = false
  return pts
}
