import * as THREE from 'three'
import { POINT_FRAG } from '../../lib/glsl.js'

// Luminous connections between every environment and the core. Each arc is a quadratic bezier that
// draws itself in (from A to B) once scroll passes its start time; packets travel along it in the
// shader. A second Points draw carries brighter packets with real size so they read from far away.

const SEG = 56
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Vector3()

/**
 * links: [{ a: Vector3, b: Vector3, ia, ib (ids, -1 = core), start, kind: 'core'|'chain'|'cross' }]
 */
export function buildArcs(links, uniforms) {
  const n = links.length
  const pos = new Float32Array(n * SEG * 2 * 3)
  const t = new Float32Array(n * SEG * 2)
  const st = new Float32Array(n * SEG * 2)
  const ids = new Float32Array(n * SEG * 2 * 2)
  const sd = new Float32Array(n * SEG * 2)
  const kd = new Float32Array(n * SEG * 2)
  const dir = new Float32Array(n * SEG * 2 * 3)
  const PK = 5
  const pA = new Float32Array(n * PK * 3), pB = new Float32Array(n * PK * 3), pC = new Float32Array(n * PK * 3)
  const pSt = new Float32Array(n * PK), pPh = new Float32Array(n * PK), pIds = new Float32Array(n * PK * 2), pSp = new Float32Array(n * PK)
  const pPos = new Float32Array(n * PK * 3)
  let v = 0
  links.forEach((L, li) => {
    _a.copy(L.a); _b.copy(L.b)
    _m.addVectors(_a, _b).multiplyScalar(0.5)
    const len = _a.distanceTo(_b)
    if (L.kind === 'core') _c.copy(_b).multiplyScalar(0.5).setY(_b.y * 0.6 + 90 + len * 0.1)
    else if (L.kind === 'chain') _c.copy(_m).multiplyScalar(1.1).setY(_m.y + 140 + len * 0.1)
    else _c.copy(_m).multiplyScalar(0.55).setY(_m.y + 420 + len * 0.14)
    L.c = _c.clone()
    const seed = (li * 0.618) % 1
    const kind = L.kind === 'core' ? 0 : L.kind === 'chain' ? 1 : 2
    const bez = (u, out) => {
      const iu = 1 - u
      out[0] = iu * iu * _a.x + 2 * iu * u * _c.x + u * u * _b.x
      out[1] = iu * iu * _a.y + 2 * iu * u * _c.y + u * u * _b.y
      out[2] = iu * iu * _a.z + 2 * iu * u * _c.z + u * u * _b.z
    }
    const q = [0, 0, 0], q0 = [0, 0, 0], q1 = [0, 0, 0]
    for (let s = 0; s < SEG; s++) {
      bez(s / SEG, q0); bez((s + 1) / SEG, q1)
      for (let e = 0; e < 2; e++) {
        const u = (s + e) / SEG
        bez(u, q)
        dir.set([q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], v * 3)
        pos.set(q, v * 3); t[v] = u; st[v] = L.start; ids[v * 2] = L.ia; ids[v * 2 + 1] = L.ib; sd[v] = seed; kd[v] = kind
        v++
      }
    }
    for (let k = 0; k < PK; k++) {
      const j = li * PK + k
      pA.set([_a.x, _a.y, _a.z], j * 3); pB.set([_b.x, _b.y, _b.z], j * 3); pC.set([_c.x, _c.y, _c.z], j * 3)
      pSt[j] = L.start; pPh[j] = k / PK + seed * 0.37; pIds[j * 2] = L.ia; pIds[j * 2 + 1] = L.ib
      pSp[j] = (kind === 0 ? 0.11 : kind === 1 ? 0.075 : 0.06) * (k % 2 ? 1 : -1) * (0.8 + 0.4 * ((k * 0.37 + seed) % 1))
      pPos.set([_m.x, _m.y, _m.z], j * 3)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aStart', new THREE.BufferAttribute(st, 1))
  g.setAttribute('aIds', new THREE.BufferAttribute(ids, 2))
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  g.setAttribute('aKind', new THREE.BufferAttribute(kd, 1))
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3))
  const HI = /* glsl */`
    float hiOf(vec2 ids){ return (abs(ids.x - uHover) < 0.5 || abs(ids.y - uHover) < 0.5) ? 1.0 : 0.0; }
  `
  const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: /* glsl */`
      attribute float aT; attribute float aStart; attribute vec2 aIds; attribute float aSeed; attribute float aKind; attribute vec3 aDir;
      uniform float uProg, uTime, uHover, uHoverOn, uDraw, uGlobal, uCamD;
      varying float vA; varying vec3 vC;
      ${HI}
      void main(){
        vec4 mv0 = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv0;
        // arcs that pass close to the lens fade out instead of streaking across the frame (scale-free: relative to the pull-back)
        float lens = smoothstep(0.1, 0.38, -mv0.z / max(uCamD, 1.0));
        // segments aimed down the view axis pile up into comet-like streaks: thin them out
        float along = abs(dot(normalize(mat3(modelViewMatrix) * aDir), normalize(mv0.xyz)));
        lens *= 1.0 - 0.85 * smoothstep(0.8, 0.985, along);
        float d = clamp((uProg - aStart) / uDraw, 0.0, 1.0);
        float vis = (1.0 - smoothstep(d - 0.02, d + 0.001, aT)) * step(0.0001, d);
        float head = (1.0 - smoothstep(0.0, 0.03, max(d - aT, 0.0) + max(aT - d, 0.0) * 3.0)) * (1.0 - step(0.999, d));
        float ph = fract(aT * 1.5 - uTime * (0.16 + aSeed*0.08) + aSeed);
        float pk = smoothstep(0.975, 1.0, ph) * 0.8;
        float hi = hiOf(aIds);
        float focus = mix(1.0, mix(0.25, 2.4, hi), uHoverOn);
        float base = aKind < 0.5 ? 0.26 : aKind < 1.5 ? 0.34 : 0.2;
        float nearCore = aIds.x < -0.5 ? smoothstep(0.0, 0.12, aT) : 1.0;
        vA = uGlobal * nearCore * lens * (vis * (base + pk) * focus + head * 0.75);
        vC = mix(vec3(0.16, 0.42, 1.0), vec3(0.45, 0.88, 1.0) * 2.4, clamp(pk + head + hi*uHoverOn*0.35, 0.0, 1.0));
      }`,
    fragmentShader: /* glsl */`varying float vA; varying vec3 vC; void main(){ if (vA < 0.003) discard; gl_FragColor = vec4(vC, vA); }`,
  }))
  lines.frustumCulled = false
  lines.renderOrder = 3

  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pg.setAttribute('aA', new THREE.BufferAttribute(pA, 3))
  pg.setAttribute('aB', new THREE.BufferAttribute(pB, 3))
  pg.setAttribute('aC', new THREE.BufferAttribute(pC, 3))
  pg.setAttribute('aStart', new THREE.BufferAttribute(pSt, 1))
  pg.setAttribute('aPh', new THREE.BufferAttribute(pPh, 1))
  pg.setAttribute('aSp', new THREE.BufferAttribute(pSp, 1))
  pg.setAttribute('aIds', new THREE.BufferAttribute(pIds, 2))
  const packets = new THREE.Points(pg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: /* glsl */`
      attribute vec3 aA; attribute vec3 aB; attribute vec3 aC; attribute float aStart; attribute float aPh; attribute float aSp; attribute vec2 aIds;
      uniform float uProg, uTime, uHover, uHoverOn, uDraw, uDpr, uGlobal, uCamD;
      varying float vA; varying float vHi;
      ${HI}
      void main(){
        float u = fract(aPh + uTime * aSp);
        float iu = 1.0 - u;
        vec3 p = iu*iu*aA + 2.0*iu*u*aC + u*u*aB;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = clamp((uProg - aStart) / uDraw, 0.0, 1.0);
        float vis = step(u, d) * step(0.999, d + 0.2);
        float hi = hiOf(aIds);
        float focus = mix(1.0, mix(0.2, 2.0, hi), uHoverOn);
        float edge = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.92, 1.0, u));
        vA = uGlobal * vis * edge * focus * smoothstep(0.1, 0.38, -mv.z / max(uCamD, 1.0));
        vHi = hi * uHoverOn;
        gl_PointSize = uDpr * (3.2 + 2.0*vHi);
      }`,
    fragmentShader: /* glsl */`varying float vA; varying float vHi; ${POINT_FRAG}
      void main(){ float a = softPoint(gl_PointCoord) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * (2.6 + vHi), a); }`,
  }))
  packets.frustumCulled = false
  packets.renderOrder = 5
  return { lines, packets }
}
