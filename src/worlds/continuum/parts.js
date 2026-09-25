// Continuum: shader materials and geometry builders.
// Everything animated here is driven by uniforms set from the world's update(); no per-frame CPU loops over buffers.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { POINT_FRAG } from '../../lib/glsl.js'
import { rng } from '../../lib/math.js'

export const FOG_V = /* glsl */`varying float vFogD;`
export const FOG_F = /* glsl */`uniform float uFog; varying float vFogD; float fogF(){ return exp(-uFog*uFog*vFogD*vFogD); }`
export const HASH = /* glsl */`float hash11(float p){ p=fract(p*0.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }`

export const FLOOR_Y = -4

// ------------------------------------------------------------------------------------------------ floor
/** Obsidian floor: fine grid, a light pool under the call, and a soft "reflection" streak of the thread. */
export function floorMesh(S) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: S.uFog, uDim: S.uDim, uLinkL: S.uLinkL, uLinkR: S.uLinkR, uGap: S.uGap, uVault: S.uVault },
    vertexShader: /* glsl */`varying vec2 vP; ${FOG_V}
      void main(){ vP = vec2(position.x, -position.y); vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uDim, uLinkL, uLinkR, uGap, uVault; varying vec2 vP; ${FOG_F}
      void main(){
        vec2 p = vP;
        vec2 q = p/2.0; vec2 gg = abs(fract(q-0.5)-0.5)/fwidth(q);
        float line = 1.0-min(min(gg.x,gg.y),1.0);
        vec2 q2 = p/10.0; vec2 g2 = abs(fract(q2-0.5)-0.5)/fwidth(q2);
        float line2 = 1.0-min(min(g2.x,g2.y),1.0);
        // thread reflection: a soft streak under the call, broken where the call is broken
        float s = (p.x + 19.0)/40.5;
        float inside = smoothstep(-0.02,0.02,s)*smoothstep(1.02,0.98,s);
        float link = mix(uLinkL, uLinkR, step(0.5, s));
        float gapM = smoothstep(uGap, uGap+0.03, abs(s-0.5));
        float streak = exp(-p.y*p.y/3.0)*inside*link*gapM;
        float pool = exp(-(p.x*p.x)/500.0 - (p.y-2.0)*(p.y-2.0)/90.0);
        vec2 dv = p - vec2(22.0,11.0); float vp = exp(-dot(dv,dv)/40.0)*uVault;
        float near = exp(-vFogD*0.01);
        vec3 col = vec3(0.008,0.011,0.016);
        col += vec3(0.05,0.14,0.34)*pool*0.35*uDim;
        col += vec3(0.25,0.62,1.0)*streak*0.10*uDim;
        col += vec3(0.1,0.5,0.35)*vp*0.10;
        col += vec3(0.24,0.42,0.62)*(line*0.035 + line2*0.06)*near*(0.4+pool*1.2)*(0.5+0.5*uDim);
        gl_FragColor = vec4(mix(vec3(0.0009,0.0015,0.0024), col, fogF()), 1.0);
      }`,
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(320, 240), mat)
  m.rotation.x = -Math.PI / 2
  m.position.set(0, FLOOR_Y, 0)
  return m
}

/** Dark soft ellipse on the floor under a solid object (fake contact shadow). */
export function contactShadow(w, d, strength = 0.6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uS: { value: strength } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uS; varying vec2 vUv; void main(){ vec2 q=(vUv-0.5)*2.0; float d=length(q); gl_FragColor=vec4(0.0,0.0,0.0,uS*smoothstep(1.0,0.1,d)); }',
  }))
  m.rotation.x = -Math.PI / 2
  m.position.y = FLOOR_Y + 0.02
  return m
}

/** Distant vertical light strata behind everything: depth cue, consistent with the Voice AI chamber. */
export function strata() {
  const pos = [], col = []
  const r = rng(505)
  for (let x = -110; x <= 110; x += 3.2) {
    const z = -62 - r() * 8
    const h = 30 + r() * 34
    const c = (r() < 0.07 ? 0.075 : 0.028) + r() * 0.02
    pos.push(x, FLOOR_Y, z, x, FLOOR_Y + h, z)
    col.push(c * 0.7, c, c * 1.35, 0, 0, 0)
  }
  pos.push(-110, FLOOR_Y + 0.02, -62, 110, FLOOR_Y + 0.02, -62); col.push(0.05, 0.08, 0.12, 0.05, 0.08, 0.12)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  l.frustumCulled = false
  return l
}

// ------------------------------------------------------------------------------------------------ thread
/**
 * The call: a duplex thread from caller (x0) to agent (x1). Built as a thin cylinder along X whose
 * centreline is displaced in the vertex shader into a helix (two strands, opposite pulse directions).
 * It can snap at the middle: a gap opens, the halves recoil, droop and whip, then later rejoin.
 */
export function threadMat(S, o) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: S.uTime, uFog: S.uFog, uDim: S.uDim, uGap: S.uGap, uRecoil: S.uRecoil, uDroop: S.uDroop, uWhip: S.uWhip,
      uLinkL: S.uLinkL, uLinkR: S.uLinkR, uVoice: S.uVoice, uBarge: S.uBarge, uJoin: S.uJoin, uFlash: S.uFlash,
      uX0: { value: o.x0 }, uL: { value: o.x1 - o.x0 }, uR: { value: o.r }, uPhase: { value: o.phase }, uDir: { value: o.dir },
      uColor: { value: new THREE.Color(o.color) }, uHalo: { value: o.halo ? 1 : 0 }, uOp: { value: o.opacity ?? 1 },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uGap, uRecoil, uDroop, uWhip, uVoice, uX0, uL, uR, uPhase, uDir, uHalo;
      varying float vS; varying vec3 vN; varying vec3 vV; ${FOG_V}
      void main(){
        vec3 p = position;
        float s = clamp((p.x - uX0)/uL, 0.0, 1.0);
        vS = s;
        float env = pow(sin(3.14159*s), 0.5);
        float ang = s*uL*0.55 + uPhase - uTime*1.6*uDir;
        float voice = 0.65 + 0.35*sin(s*31.0 - uTime*5.0)*sin(s*9.0 + uTime*1.7);
        float r = uR * env * mix(0.8, voice*1.3, uVoice) * (1.0 - uHalo);
        vec3 off = vec3(0.0, cos(ang)*r, sin(ang)*r);
        // snap mechanics: halves recoil towards their anchors, droop and whip, stronger near the break
        float side = s < 0.5 ? -1.0 : 1.0;
        float d = abs(s - 0.5);
        float near = smoothstep(0.5, 0.0, d);
        float n2 = near*near;
        p.x += side * uRecoil * uL * 0.07 * n2;
        float whip = sin(uWhip*7.0 + side)*exp(-uWhip*1.3);
        p.y += -uDroop * 3.2 * n2 + whip * 1.1 * n2 * step(0.001, uRecoil);
        p.z += whip * 0.6 * n2 * side * step(0.001, uRecoil);
        p += off;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vFogD = -mv.z;
        vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uDim, uGap, uLinkL, uLinkR, uDir, uL, uBarge, uJoin, uFlash, uHalo, uOp; uniform vec3 uColor;
      varying float vS; varying vec3 vN; varying vec3 vV; ${FOG_F}
      void main(){
        float s = vS;
        float d = abs(s - 0.5);
        float gapM = uGap < 0.0005 ? 1.0 : smoothstep(uGap, uGap + 0.012, d);
        if (gapM < 0.01) discard;
        float link = mix(uLinkL, uLinkR, step(0.5, s));
        // duplex pulses: one strand carries caller → agent, the other agent → caller
        float ph = s*uL*0.7 - uTime*6.0*uDir;
        float pulse = pow(0.5 + 0.5*sin(ph), 14.0);
        float pulse2 = pow(0.5 + 0.5*sin(ph*0.37 + 1.7), 30.0);
        // barge-in pulse travelling caller → agent
        float barge = exp(-pow((s - uBarge)*22.0, 2.0)) * step(0.001, uBarge) * step(uBarge, 0.999);
        // fracture tip glow at the moment of the snap
        float tip = exp(-pow((d - uGap)*70.0, 2.0)) * step(0.004, uGap);
        // rejoin: a wave of light spreading outward from the join point
        float join = exp(-pow((d - uJoin*0.55)*16.0, 2.0)) * step(0.001, uJoin) * step(uJoin, 0.999);
        float ends = smoothstep(0.0, 0.03, s) * smoothstep(1.0, 0.97, s);
        float e = (0.55 + pulse*1.6 + pulse2*1.2) * link + barge*3.5 + tip*uFlash*5.0 + join*3.0;
        float a = gapM * ends * uOp;
        if (uHalo > 0.5) {
          float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          e = (0.35 + pulse*0.25) * link + barge*1.2 + join*0.8;
          a *= f * 0.22;
        }
        vec3 col = uColor * e * mix(0.6, 1.0, uDim);
        gl_FragColor = vec4(col * fogF(), a);
      }`,
  })
}

export function threadGeometry(x0, x1, r = 0.045, segs = 420) {
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, 6, segs, true)
  g.rotateZ(-Math.PI / 2)
  g.translate((x0 + x1) / 2, 0, 0)
  return g
}

// ------------------------------------------------------------------------------------------------ TTS waveform
/**
 * The agent's sentence as a waveform + caption on one plane. `uPlay` = how much has been spoken,
 * `uCut` = where the caller barged in, `uDiss` = how far the unheard remainder has dissolved.
 */
export function waveMat(S, tex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, uTime: S.uTime, uFog: S.uFog, uPlay: { value: 0 }, uCut: { value: 1 }, uDiss: { value: 0 }, uOp: { value: 0 }, uTextY: { value: 0.4 } },
    vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V} void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform sampler2D map; uniform float uTime, uPlay, uCut, uDiss, uOp, uTextY; varying vec2 vUv; ${FOG_F} ${HASH}
      float amp(float i){
        float w = 0.3 + 0.7*smoothstep(-0.35, 0.5, sin(i*0.43 + 1.3)*sin(i*0.11 + 0.4));
        return (0.25 + 0.75*hash11(i*1.37 + 3.1)) * w;
      }
      void main(){
        float x = vUv.x;
        float N = 190.0;
        float i = floor(x*N); float fx = fract(x*N);
        float bx = (i + 0.5)/N;
        float a = amp(i);
        // live bars near the playhead breathe
        float live = exp(-pow((bx - uPlay)*18.0, 2.0)) * step(bx, uPlay);
        a *= 1.0 + live*0.35*sin(uTime*14.0 + i);
        float h = a*0.27;
        float bar = smoothstep(0.3, 0.2, abs(fx - 0.5)) * smoothstep(h + 0.012, h, abs(vUv.y - 0.72));
        float spoken = step(bx, uPlay);
        float unheard = step(uCut, bx);
        // erosion of the unheard remainder
        float n = hash12(floor(vUv*vec2(420.0, 64.0)));
        float keep = 1.0 - unheard * step(n, uDiss*1.15);
        vec3 heardC = vec3(0.7, 0.88, 1.0) * 1.12;
        vec3 queuedC = vec3(0.22, 0.34, 0.5);
        vec3 ghostC = vec3(0.3, 0.55, 0.9);
        vec3 bc = mix(queuedC, heardC, spoken);
        bc = mix(bc, ghostC, unheard * smoothstep(0.0, 0.2, uDiss));
        float ba = bar * mix(0.4, 1.0, spoken) * keep;
        ba *= mix(1.0, 0.7 * (1.0 - uDiss), unheard * step(0.001, uDiss));
        // caption text (drawn in the lower band of the texture)
        vec4 t = texture2D(map, vUv);
        float ta = t.a * keep * mix(1.0, (1.0 - uDiss), unheard);
        vec3 tc = mix(vec3(0.34, 0.4, 0.48), vec3(0.8, 0.84, 0.88), spoken);
        tc = mix(tc, ghostC*0.8, unheard * step(0.001, uDiss));
        // playhead / cut marker
        float head = exp(-pow((x - min(uPlay, uCut))*900.0, 2.0)) * smoothstep(0.1, 0.95, vUv.y) * step(0.001, uPlay);
        vec3 col = bc*ba + tc*ta + vec3(0.6, 0.9, 1.3)*head*1.6;
        float al = max(max(ba, ta), head*0.9) * uOp;
        gl_FragColor = vec4(col * fogF(), al);
      }`,
  })
}

/** Ghost particles: the unheard remainder of the sentence dissolving upward. Plane-local coordinates. */
export function ghostPoints(S, count, w, h, cutU) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count)
  const r = rng(77)
  for (let i = 0; i < count; i++) {
    const u = cutU + r() * (1 - cutU)
    const bi = Math.floor(u * 190)
    const w0 = 0.3 + 0.7 * Math.max(0, Math.min(1, (Math.sin(bi * 0.43 + 1.3) * Math.sin(bi * 0.11 + 0.4) + 0.35) / 0.85))
    const amp = 0.25 + 0.75 * r()
    const v = r() < 0.72 ? 0.72 + (r() * 2 - 1) * amp * w0 * 0.27 : 0.18 + r() * 0.22
    pos[i * 3] = (u - 0.5) * w
    pos[i * 3 + 1] = (v - 0.5) * h
    pos[i * 3 + 2] = (r() - 0.5) * 0.1
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: S.uTime, uFog: S.uFog, uDiss: { value: 0 }, uPx: S.uPx },
    vertexShader: /* glsl */`attribute float aSeed; uniform float uTime, uDiss, uPx; varying float vA; ${FOG_V}
      void main(){
        vec3 p = position;
        float t = clamp(uDiss*1.25 - aSeed*0.25, 0.0, 1.0);
        float e = t*t*(3.0-2.0*t);
        p.y += e*(1.4 + aSeed*3.2);
        p.x += e*(sin(aSeed*40.0 + uTime*0.6)*1.2 - 0.9);
        p.z += e*cos(aSeed*23.0 + uTime*0.5)*1.4;
        vA = step(0.001, t) * (1.0 - e) * (0.5 + 0.5*aSeed);
        vec4 mv = modelViewMatrix*vec4(p,1.0); vFogD=-mv.z;
        gl_PointSize = uPx * (1.6 + aSeed*2.2) * (24.0 / -mv.z);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`varying float vA; ${FOG_F} ${POINT_FRAG}
      void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.55,0.8,1.3)*s*vA*fogF(), s*vA); }`,
  })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  return pts
}

// ------------------------------------------------------------------------------------------------ memory lattice
/** Faceted crystal shading with a fake key light; instanced; reacts to pointer and to retrieval. */
export function shardInstMat(S) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: S.uTime, uFog: S.uFog, uDim: S.uDim, uMouse: S.uMouse, uHover: S.uHover,
      uDense: S.uDense, uKwX: S.uKwX, uKw: S.uKw, uFuse: S.uFuse, uExt: S.uExt, uOp: S.uLatOp,
    },
    vertexShader: /* glsl */`
      attribute float aSeed; attribute float aRole;
      uniform float uTime, uHover, uDense, uKwX, uKw, uFuse, uOp; uniform vec3 uMouse, uExt;
      varying vec3 vN; varying vec3 vV; varying float vHi; varying float vSeed; varying float vFall; ${FOG_V}
      void main(){
        vec3 c = instanceMatrix[3].xyz;
        float ang = uTime*(0.12 + aSeed*0.25) + aSeed*6.28;
        float cs = cos(ang), sn = sin(ang);
        mat2 R = mat2(cs, -sn, sn, cs);
        vec3 p = position; p.xz = R*p.xz;
        vec3 n = normal; n.xz = R*n.xz;
        vec3 dm = c - uMouse;
        float h = uHover * exp(-dot(dm,dm)/14.0);
        vec3 push = normalize(dm + vec3(1e-4)) * h * 0.9;
        vec3 wp = (instanceMatrix * vec4(p*(1.0 + h*0.7), 1.0)).xyz + push;
        float dense = uDense * step(0.5, aRole) * step(aRole, 1.5);
        float kw = uKw * step(1.5, aRole) * smoothstep(0.0, -1.5, c.x - uKwX);
        float both = step(2.5, aRole) * max(uDense, uKw * smoothstep(0.0, -1.5, c.x - uKwX));
        vHi = h*0.9 + (dense + kw + both) * (1.0 - uFuse*0.85);
        vSeed = aSeed;
        vFall = smoothstep(1.15, 0.5, length(c/uExt)) * mix(0.45, 1.0, uOp);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        vFogD = -mv.z;
        vN = normalize(normalMatrix * (mat3(instanceMatrix) * n));
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uDim; varying vec3 vN; varying vec3 vV; varying float vHi; varying float vSeed; varying float vFall; ${FOG_F}
      void main(){
        vec3 N = normalize(vN), V = normalize(vV);
        float f = pow(1.0 - abs(dot(N, V)), 2.4);
        vec3 L = normalize(vec3(-0.35, 0.85, 0.4));
        float diff = max(dot(N, L), 0.0);
        float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0);
        vec3 col = vec3(0.018, 0.028, 0.04) + vec3(0.05, 0.075, 0.1)*diff + vec3(0.8, 0.9, 1.0)*spec*0.55 + vec3(0.2, 0.5, 0.95)*f*0.45;
        col *= 0.25 + 0.75*vFall;
        col += vec3(0.45, 0.85, 1.35) * vHi * (0.55 + f*1.6);
        col *= mix(0.55, 1.0, uDim);
        gl_FragColor = vec4(mix(vec3(0.0009,0.0015,0.0024), col, fogF()), 1.0);
      }`,
  })
}

/** The caller's own memory shard: brighter, ice-core crystal. */
export function heroShardMat(S) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: S.uTime, uFog: S.uFog, uGlow: { value: 0 }, uOp: { value: 1 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vP; ${FOG_V}
      void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uTime, uGlow, uOp; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${FOG_F}
      void main(){
        vec3 N = normalize(vN), V = normalize(vV);
        float f = pow(1.0 - abs(dot(N, V)), 2.0);
        vec3 L = normalize(vec3(-0.35, 0.85, 0.4));
        float diff = max(dot(N, L), 0.0);
        float spec = pow(max(dot(reflect(-L, N), V), 0.0), 40.0);
        float core = 0.5 + 0.5*sin(vP.y*6.0 - uTime*2.4);
        vec3 col = vec3(0.03, 0.06, 0.1) + vec3(0.1, 0.16, 0.24)*diff + vec3(1.0)*spec*0.9 + vec3(0.35, 0.75, 1.25)*f*(0.9 + uGlow*1.6);
        col += vec3(0.3, 0.65, 1.1) * uGlow * (0.4 + core*0.5);
        gl_FragColor = vec4(mix(vec3(0.0009,0.0015,0.0024), col, fogF()) , uOp);
      }`,
    transparent: true,
  })
}

export function shardGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0)
  g.scale(0.34, 1, 0.34)
  return g
}

/** Lattice edges (+x, +y, +z neighbours) as faint additive lines that brighten near the pointer. */
export function latticeLines(S, nodes, nx, ny, nz) {
  const pos = []
  const id = (i, j, k) => (i * ny + j) * nz + k
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const a = nodes[id(i, j, k)]
    if (i + 1 < nx) { const b = nodes[id(i + 1, j, k)]; pos.push(a.x, a.y, a.z, b.x, b.y, b.z) }
    if (j + 1 < ny) { const b = nodes[id(i, j + 1, k)]; pos.push(a.x, a.y, a.z, b.x, b.y, b.z) }
    if (k + 1 < nz) { const b = nodes[id(i, j, k + 1)]; pos.push(a.x, a.y, a.z, b.x, b.y, b.z) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uFog: S.uFog, uDim: S.uDim, uMouse: S.uMouse, uHover: S.uHover, uOp: S.uLatOp, uSlot: { value: new THREE.Vector3() }, uSlotGlow: S.uSlotGlow, uExt: S.uExt },
    vertexShader: /* glsl */`uniform vec3 uMouse, uSlot, uExt; uniform float uHover, uSlotGlow; varying float vA; ${FOG_V}
      void main(){ vec3 dm = position - uMouse; vec3 ds = position - uSlot;
        float fall = smoothstep(1.08, 0.45, length(position/uExt));
        vA = (0.1*fall + uHover*exp(-dot(dm,dm)/16.0)*0.6*fall) + uSlotGlow*exp(-dot(ds,ds)/10.0)*0.7;
        vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uOp, uDim; varying float vA; ${FOG_F}
      void main(){ gl_FragColor = vec4(vec3(0.42,0.68,1.0)*vA*mix(0.35,1.0,uOp)*mix(0.5,1.0,uDim)*fogF(), 1.0); }`,
  })
  const l = new THREE.LineSegments(g, mat)
  l.frustumCulled = false
  return l
}

export function nodePoints(S, nodes) {
  const pos = new Float32Array(nodes.length * 3)
  nodes.forEach((n, i) => { pos[i * 3] = n.x; pos[i * 3 + 1] = n.y; pos[i * 3 + 2] = n.z })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uFog: S.uFog, uDim: S.uDim, uPx: S.uPx, uMouse: S.uMouse, uHover: S.uHover, uExt: S.uExt, uOp: S.uLatOp },
    vertexShader: /* glsl */`uniform float uPx, uHover, uOp; uniform vec3 uMouse, uExt; varying float vA; ${FOG_V}
      void main(){ vec3 dm = position - uMouse; float h = uHover*exp(-dot(dm,dm)/12.0);
        float fall = smoothstep(1.08, 0.45, length(position/uExt));
        vA = (0.35 + h*1.2)*fall*mix(0.4,1.0,uOp); vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z;
        gl_PointSize = uPx*(2.2 + h*3.0)*(30.0 / -mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uDim; varying float vA; ${FOG_F} ${POINT_FRAG}
      void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.6,0.85,1.2)*s*vA*mix(0.5,1.0,uDim)*fogF(), s); }`,
  })
  const p = new THREE.Points(g, mat)
  p.frustumCulled = false
  return p
}

/** Retrieval beams from the query vector to candidates; revealed outward from the query. Positions set from JS. */
export function beamLines(S, n) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3))
  const t = new Float32Array(n * 2), w = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) { t[i * 2] = 0; t[i * 2 + 1] = 1; w[i * 2] = w[i * 2 + 1] = i === 0 ? 1 : 0 }
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aWin', new THREE.BufferAttribute(w, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uFog: S.uFog, uTime: S.uTime, uGrow: { value: 0 }, uFuse: S.uFuse, uOp: { value: 0 } },
    vertexShader: /* glsl */`attribute float aT; attribute float aWin; varying float vT; varying float vWin; ${FOG_V}
      void main(){ vT = aT; vWin = aWin; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uGrow, uFuse, uOp, uTime; varying float vT; varying float vWin; ${FOG_F}
      void main(){
        if (vT > uGrow) discard;
        float head = exp(-pow((vT - uGrow)*14.0, 2.0));
        float flow = 0.6 + 0.4*sin(vT*40.0 - uTime*10.0);
        float a = mix(1.0 - uFuse, 1.0 + uFuse*1.5, vWin) * (0.35 + head*0.9) * flow * uOp;
        gl_FragColor = vec4(vec3(0.5,0.85,1.4)*a*fogF(), 1.0);
      }`,
  })
  const l = new THREE.LineSegments(g, mat)
  l.frustumCulled = false
  return l
}

/** Keyword (sparse) pass: a thin plane sweeping through the lattice. */
export function sweepPlane(S, h, d) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uFog: S.uFog, uOp: { value: 0 }, uTime: S.uTime },
    vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V} void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uOp, uTime; varying vec2 vUv; ${FOG_F}
      void main(){
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.012, 0.0, min(e.x, e.y));
        float scan = 0.5 + 0.5*sin(vUv.y*120.0 - uTime*4.0);
        float a = (edge*0.14 + 0.006 + scan*0.008) * uOp;
        gl_FragColor = vec4(vec3(0.45,0.75,1.25)*a*fogF(), 1.0);
      }`,
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(d, h), mat)
  m.rotation.y = Math.PI / 2
  return m
}

// ------------------------------------------------------------------------------------------------ vault
/** MongoDB vault: a graphite cabinet with chrome trims, an open-top drawer and a lock ring. */
export function buildVault(mats) {
  const g = new THREE.Group()
  const W = 6.4, H = 4.6, D = 4.2
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.22), mats.body)
  g.add(body)
  // chrome trim bands
  const trimG = mergeGeometries([
    new THREE.BoxGeometry(W + 0.06, 0.07, D + 0.06).translate(0, H / 2 - 0.5, 0),
    new THREE.BoxGeometry(W + 0.06, 0.07, D + 0.06).translate(0, -H / 2 + 0.35, 0),
  ])
  g.add(new THREE.Mesh(trimG, mats.chrome))
  // recessed drawer mouth (dark) on the front face
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 1.75), new THREE.MeshBasicMaterial({ color: 0x010203 }))
  mouth.position.set(-0.4, -0.35, D / 2 + 0.005)
  g.add(mouth)
  // engraved slot lines (filing rows)
  const slotG = mergeGeometries([0, 1, 2].map((i) => new THREE.BoxGeometry(4.7, 0.025, 0.02).translate(-0.4, 1.05 - i * 0.28, D / 2 + 0.01)))
  g.add(new THREE.Mesh(slotG, mats.chrome))
  // drawer (open top): bottom + 3 walls + chrome front plate
  const dw = 4.4, dh = 1.45, dd = 3.6, t = 0.08
  const drawer = new THREE.Group()
  const shell = mergeGeometries([
    new THREE.BoxGeometry(dw, t, dd).translate(0, -dh / 2, 0),
    new THREE.BoxGeometry(t, dh, dd).translate(-dw / 2, 0, 0),
    new THREE.BoxGeometry(t, dh, dd).translate(dw / 2, 0, 0),
    new THREE.BoxGeometry(dw, dh, t).translate(0, 0, -dd / 2),
  ])
  drawer.add(new THREE.Mesh(shell, mats.inner))
  const front = new THREE.Mesh(new RoundedBoxGeometry(dw + 0.24, dh + 0.2, 0.16, 2, 0.05), mats.chrome)
  front.position.z = dd / 2
  drawer.add(front)
  const handle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, 0.1), mats.body)
  handle.position.set(0, 0.25, dd / 2 + 0.12)
  drawer.add(handle)
  drawer.position.set(-0.4, -0.35, D / 2 - dd / 2 - 0.02)
  drawer.userData.closedZ = drawer.position.z
  g.add(drawer)
  // lock ring on the right of the face
  const lock = new THREE.Group()
  lock.position.set(W / 2 - 0.75, -0.35, D / 2 + 0.03)
  lock.add(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 48), mats.chrome))
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.05), mats.chrome)
  tick.position.y = 0.14
  lock.add(tick)
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), mats.status)
  dot.position.set(0, -0.62, 0)
  lock.add(dot)
  g.add(lock)
  return { group: g, drawer, lock, dot, W, H, D, drawerInner: { w: dw, h: dh, d: dd, t } }
}

// ------------------------------------------------------------------------------------------------ ambient dust
export function dust(S, count) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count)
  const r = rng(909)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() - 0.5) * 110
    pos[i * 3 + 1] = FLOOR_Y + r() * 30
    pos[i * 3 + 2] = -45 + r() * 80
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: S.uTime, uFog: S.uFog, uPx: S.uPx, uDim: S.uDim },
    vertexShader: /* glsl */`attribute float aSeed; uniform float uTime, uPx; varying float vA; ${FOG_V}
      void main(){ vec3 p = position;
        p.y = ${FLOOR_Y.toFixed(1)} + mod(position.y - ${FLOOR_Y.toFixed(1)} + uTime*(0.12 + aSeed*0.2), 30.0);
        p.x += sin(uTime*0.2 + aSeed*20.0)*1.5;
        vec4 mv = modelViewMatrix*vec4(p,1.0); vFogD=-mv.z;
        vA = 0.25 + 0.75*aSeed;
        gl_PointSize = uPx*(1.0 + aSeed*1.6)*(26.0 / -mv.z);
        gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uDim; varying float vA; ${FOG_F} ${POINT_FRAG}
      void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.5,0.7,0.95)*s*vA*0.45*mix(0.5,1.0,uDim)*fogF(), s); }`,
  })
  const p = new THREE.Points(g, mat)
  p.frustumCulled = false
  return p
}

// ------------------------------------------------------------------------------------------------ crystallisation
/** Particles pulled from the broken call into one point: the task condensing into a memory shard. */
export function crystalPoints(S, count, center, gapX, y) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count)
  const r = rng(314)
  for (let i = 0; i < count; i++) {
    let x, yy, z
    if (r() < 0.6) { // shed from the two fracture tips
      const side = r() < 0.5 ? -1 : 1
      x = gapX + side * (2.2 + r() * 7); yy = y - r() * 2.2 * (1 - Math.abs(x - gapX) / 12); z = (r() - 0.5) * 1.2
    } else {
      const a = r() * Math.PI * 2, b = Math.acos(r() * 2 - 1), rad = 3 + r() * 4
      x = center.x + Math.sin(b) * Math.cos(a) * rad; yy = center.y + Math.cos(b) * rad * 0.6; z = center.z + Math.sin(b) * Math.sin(a) * rad
    }
    pos[i * 3] = x; pos[i * 3 + 1] = yy; pos[i * 3 + 2] = z
    seed[i] = r()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: S.uTime, uFog: S.uFog, uPx: S.uPx, uForm: { value: 0 }, uC: { value: center.clone() } },
    vertexShader: /* glsl */`attribute float aSeed; uniform float uTime, uPx, uForm; uniform vec3 uC; varying float vA; ${FOG_V}
      void main(){
        float t = clamp((uForm - aSeed*0.35)/0.65, 0.0, 1.0);
        float e = t*t*t*(t*(t*6.0-15.0)+10.0);
        vec3 d = position - uC;
        float ang = e*2.4*(aSeed > 0.5 ? 1.0 : -1.0);
        float cs = cos(ang), sn = sin(ang);
        d.xz = mat2(cs,-sn,sn,cs)*d.xz;
        vec3 p = uC + d*(1.0 - e);
        vA = sin(3.14159*t) * (0.5 + 0.5*aSeed);
        vec4 mv = modelViewMatrix*vec4(p,1.0); vFogD=-mv.z;
        gl_PointSize = uPx*(1.4 + aSeed*2.0)*(28.0 / -mv.z);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`varying float vA; ${FOG_F} ${POINT_FRAG}
      void main(){ float s = softPoint(gl_PointCoord); gl_FragColor = vec4(vec3(0.55,0.85,1.35)*s*vA*fogF(), s*vA); }`,
  })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  return pts
}
