import * as THREE from 'three'
import { NOISE } from '../../lib/glsl.js'
import { Label } from '../../lib/label.js'
import { HEX } from '../../lib/palette.js'
import { chrome } from '../../lib/materials.js'

// The physical hardware of the core: machined rings, smoked glass shell, faceted crystal heart,
// a spectrogram band, and the light at the centre.

/** Machined washer (lathe profile with small bevels), lying in the XY plane. */
function washer(R, w, h, seg = 220) {
  const a = R - w, b = Math.min(h * 0.45, w * 0.12)
  const pts = [[a + b, -h], [R - b, -h], [R, -h + b], [R, h - b], [R - b, h], [a + b, h], [a, h - b], [a, -h + b], [a + b, -h]]
    .map(([x, y]) => new THREE.Vector2(x, y))
  const g = new THREE.LatheGeometry(pts, seg)
  g.rotateX(Math.PI / 2)
  return g
}

/** Engraved tick marks on both faces of a washer (XY plane). */
function ticks(R, w, h, n, major, color, opacity) {
  const arr = []
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, M = i % major === 0
    const r0 = R - w * 0.12, r1 = R - w * (M ? 0.55 : 0.3)
    const c = Math.cos(a), s = Math.sin(a)
    for (const z of [h + 0.004, -h - 0.004]) arr.push(c * r0, s * r0, z, c * r1, s * r1, z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
  return new THREE.LineSegments(g, m)
}

export function createRings() {
  // All rings are COAXIAL: one machined stack sharing the core's axis, like a lens barrel / turbine
  // stator, never crossing orbits. Each differs in radius, section, finish and axial station (z0).
  // [radius, width, half-thickness, ticks, major, material, spin speed, axial station z0, aligned z]
  const defs = [
    { R: 12.4, w: 1.15, h: 0.34, n: 180, major: 15, mat: chrome({ roughness: 0.32, color: new THREE.Color('#6f7a88'), envMapIntensity: 0.75 }), spin: 0.22, z0: 2.2, z: -3 },
    { R: 14.6, w: 0.34, h: 0.5, n: 72, major: 6, mat: chrome({ roughness: 0.2, envMapIntensity: 0.85 }), spin: -0.15, z0: -1.6, z: 7 },
    { R: 19.2, w: 1.5, h: 0.09, n: 360, major: 10, mat: chrome({ roughness: 0.34, color: new THREE.Color('#8e9aab'), envMapIntensity: 0.8 }), spin: 0.06, z0: 0.4, z: 17 },
    { R: 23.6, w: 0.16, h: 0.16, n: 0, major: 1, mat: chrome({ roughness: 0.2, envMapIntensity: 0.8 }), spin: -0.09, z0: -3.4, z: 31 },
  ]
  const rings = defs.map((d, i) => {
    const pivot = new THREE.Group()
    const spinner = new THREE.Group()
    pivot.add(spinner)
    const mesh = new THREE.Mesh(washer(d.R, d.w, d.h), d.mat)
    spinner.add(mesh)
    if (d.n) spinner.add(ticks(d.R, d.w, d.h, d.n, d.major, i === 2 ? HEX.ice : HEX.cyan, i === 2 ? 0.55 : 0.4))
    pivot.position.z = d.z0
    return { ...d, pivot, spinner, mesh, angle: i * 1.3 }
  })

  // the big graduated ring carries the pipeline stages it orchestrates
  const big = rings[2]
  const stages = ['STT', 'LLM', 'TOOLS', 'TTS']
  stages.forEach((s, i) => {
    const a = i / stages.length * Math.PI * 2 + Math.PI / 4
    const l = new Label(s, { height: 0.42, color: HEX.chrome, tracking: 0.3, align: 'center', opacity: 0.85 })
    const r = big.R - big.w * 0.78
    l.position.set(Math.cos(a) * r, Math.sin(a) * r, big.h + 0.01)
    l.rotation.z = a - Math.PI / 2
    big.spinner.add(l)
  })
  return rings
}

const cubeUVDefines = (env) => {
  const H = env.image.height, maxMip = Math.log2(H) - 2
  return {
    ENVMAP_TYPE_CUBE_UV: '',
    CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
    CUBEUV_TEXEL_HEIGHT: 1 / H,
    CUBEUV_MAX_MIP: maxMip.toFixed(1),
  }
}

/**
 * Bake the scene's PMREM environment, pre-filtered at one roughness, into a small cube map.
 * A material with a fixed roughness then reads its IBL radiance with a single hardware cube
 * fetch instead of three's textureCubeUV (face maths + two taps into the large PMREM atlas).
 */
export function bakeEnvCube(renderer, env, roughness, size = 128) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, defines: cubeUVDefines(env),
    uniforms: { envMap: { value: env }, uR: { value: roughness } },
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`uniform sampler2D envMap; uniform float uR; varying vec3 vD;
      #include <common>
      #include <cube_uv_reflection_fragment>
      void main(){ gl_FragColor = vec4(textureCubeUV(envMap, normalize(vD), uR).rgb, 1.0); }`,
  })
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), m)
  const scene = new THREE.Scene()
  scene.add(box)
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, scene)
  m.dispose(); box.geometry.dispose()
  return rt.texture
}

/** Band of the shell (open at both poles) closed with flat caps on the same 72-gon rims: a convex
 * polyhedron, so every camera ray from outside meets exactly one front-facing triangle. */
function shellGeometry(R, seg, rows, th0) {
  const band = new THREE.SphereGeometry(R, seg, rows, 0, Math.PI * 2, th0, Math.PI - 2 * th0).toNonIndexed()
  const bp = band.attributes.position.array, bn = band.attributes.normal.array
  const cap = []
  for (const sgn of [1, -1]) {
    const y = sgn * R * Math.cos(th0), r = R * Math.sin(th0)
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2
      const p0 = [-Math.cos(a0) * r, y, Math.sin(a0) * r], p1 = [-Math.cos(a1) * r, y, Math.sin(a1) * r] // SphereGeometry's rim vertices
      cap.push(0, y, 0, ...(sgn > 0 ? [...p0, ...p1] : [...p1, ...p0])) // wound to face outward
    }
  }
  const n = bp.length / 3, m = cap.length / 3
  const pos = new Float32Array((n + m) * 3), nor = new Float32Array((n + m) * 3), isCap = new Float32Array(n + m)
  pos.set(bp); pos.set(cap, n * 3); nor.set(bn)
  for (let i = n; i < n + m; i++) { nor[i * 3 + 1] = cap[(i - n) * 3 + 1] > 0 ? 1 : -1; isCap[i] = 1 }
  band.dispose()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('aCap', new THREE.BufferAttribute(isCap, 1))
  return { g, bandCount: n, total: n + m }
}

/**
 * Smoked glass shell with its fresnel hologram rim.
 * It used to be a MeshPhysicalMaterial (clearcoat, double sided) plus a separate additive holo()
 * mesh on the same geometry: when the camera flies in, the shell fills the screen and those
 * four full-screen layers (two sides x two materials) cost ~13 ms/frame on an iGPU.
 * Now, seen from outside, the shell is ONE front-facing layer: each pixel of the near wall (or
 * of an invisible cap, where the ray enters through a pole opening) resolves the far wall along
 * its view ray analytically (ray/sphere exit, band test, antialiased edge) and composites it
 * underneath, exactly as the back-then-front passes did. From inside, it's the back faces.
 * Shading is the physical material's, reduced to what's visible: environment reflection
 * (pre-filtered at the glass roughness, see bakeEnvCube) through the base and clearcoat DFG
 * terms (three's LUT), the dark diffuse, fog, and the rim added on top (premultiplied output, so
 * the smoked tint and the additive rim share one blend). Multiscatter is dropped (~0 at r 0.08).
 */
export function createShell(envCube, irrCube, envIntensity = 1) {
  const R = 8.3, TH0 = 0.55
  const { g, bandCount, total } = shellGeometry(R, 72, 36, TH0)
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    tEnv: { value: envCube }, tIrr: { value: irrCube }, dfgLUT: { value: null }, envI: { value: envIntensity },
    uColor: { value: new THREE.Color(0x0b1118) }, uOpacity: { value: 0.1 },
    uRim: { value: new THREE.Color(HEX.cyan) }, uRimOpacity: { value: 0.06 }, uTime: { value: 0 },
  }
  const vertexShader = /* glsl */`
    attribute float aCap; varying vec3 vW; varying vec3 vN; varying float vCap;
    #include <fog_pars_vertex>
    void main(){
      vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = mat3(modelMatrix)*normal; vCap = aCap;
      vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`
  const fragmentShader = /* glsl */`
    uniform mat4 modelMatrix;
    uniform samplerCube tEnv, tIrr; uniform sampler2D dfgLUT; uniform float envI, uOpacity, uRimOpacity, uTime; uniform vec3 uColor, uRim;
    varying vec3 vW; varying vec3 vN; varying float vCap;
    #include <fog_pars_fragment>
    // one glass surface sample, premultiplied (alpha = uOpacity). n0: outward normal, V: to camera.
    vec3 glassAt(vec3 P, vec3 n0, vec3 V, float fogDepth, bool front, bool underFront){
      vec3 N = front ? n0 : -n0;
      float nv = clamp(dot(N, V), 0.0, 1.0);
      vec3 rad = textureCubeLodEXT(tEnv, reflect(-V, N), 0.0).rgb * envI;
      // environment BRDF from three's own DFG LUT (the renderer fills the dfgLUT uniform), at the
      // base roughness 0.08 and the clearcoat's 0.0525; both lobes share the pre-filtered radiance
      vec2 fab = texture2DLodEXT(dfgLUT, vec2(0.08, nv), 0.0).rg;
      vec2 fcc = texture2DLodEXT(dfgLUT, vec2(0.0525, nv), 0.0).rg;
      vec3 single = mix(vec3(0.04*fab.x + fab.y), uColor*fab.x + fab.y, 0.1); // metalness 0.1
      float Fcc = 0.04 + 0.96*pow(1.0 - nv, 5.0);
      vec3 diffuse = uColor * 0.9 * (1.0 - (0.04*fab.x + fab.y)) * textureCubeLodEXT(tIrr, N, 0.0).rgb * envI;
      vec3 col = (rad*single + diffuse)*(1.0 - Fcc) + rad*(0.04*fcc.x + fcc.y);
      #ifdef USE_FOG
        col = mix(col, fogColor, 1.0 - exp(-fogDensity*fogDensity*fogDepth*fogDepth));
      #endif
      // hologram rim (was a separate additive mesh: power 4, scan 0.6)
      float f = pow(1.0 - abs(dot(n0, V)), 4.0);
      float scan = 0.75 + 0.25*sin(P.y*18.0 - uTime*3.0);
      float ra = (f*0.9 + 0.06) * mix(1.0, scan, 0.6) * uRimOpacity;
      if (underFront) ra /= 1.0 - uOpacity; // the back rim used to be added after the front glass, not under it
      return col*uOpacity + uRim*(0.6 + f*2.2)*ra;
    }
    void main(){
      vec3 V = normalize(cameraPosition - vW);
      #ifdef OUTSIDE
        vec3 C = modelMatrix[3].xyz, Y = normalize(modelMatrix[1].xyz);
        float Rw = ${R.toFixed(2)} * length(modelMatrix[0].xyz);
        vec3 D = -V, oc = cameraPosition - C;
        float b = dot(oc, D);
        vec3 Q = cameraPosition + D * (-b + sqrt(max(b*b - dot(oc, oc) + Rw*Rw, 0.0))); // far wall
        float yq = ${Math.cos(TH0).toFixed(5)} * Rw - abs(dot(Q - C, Y)); // > 0 inside the band
        float cov = clamp(yq / max(fwidth(yq), 1e-5) + 0.5, 0.0, 1.0);
        vec3 B = vec3(0.0);
        if (cov > 0.0) {
          vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          B = cov * glassAt(Q, (Q - C) / Rw, V, dot(Q - cameraPosition, fwd), false, vCap < 0.5);
        }
        float aB = uOpacity * cov;
        if (vCap > 0.5) { // entering through a pole opening: only the far wall
          if (aB <= 0.0) discard;
          gl_FragColor = vec4(B, aB);
        } else {
          vec3 F = glassAt(vW, normalize(vN), V, vFogDepth, true, false);
          gl_FragColor = vec4(F + (1.0 - uOpacity)*B, 1.0 - (1.0 - uOpacity)*(1.0 - aB));
        }
      #else
        gl_FragColor = vec4(glassAt(vW, normalize(vN), V, vFogDepth, false, false), uOpacity);
      #endif
    }`
  const common = {
    transparent: true, depthWrite: false, fog: true, uniforms, vertexShader, fragmentShader,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }
  const outer = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...common, side: THREE.FrontSide, defines: { OUTSIDE: '' } }))
  const inner = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...common, side: THREE.BackSide }))
  // the outside mesh draws band + caps, the inside one only the band
  outer.onBeforeRender = () => g.setDrawRange(0, total)
  inner.onBeforeRender = () => g.setDrawRange(0, bandCount)
  const grp = new THREE.Group()
  grp.add(outer, inner)
  grp.rotation.set(0.5, 0, 0.25)
  return { group: grp, outer, inner, uniforms, R }
}

/**
 * Geometry for the centre light: the visible footprint of the glow shader instead of a full
 * 18x18 quad (which filled the screen on the fly-in). A disc, which the vertex shader sizes each
 * frame to where the halo is still above 5e-4 (uDisc), plus the thin horizontal
 * band the streak needs out to the quad's edge. The fragment shader partitions them by radius
 * (aPart) so no pixel is lit twice.
 */
function glowGeometry(S = 18, band = 0.036) {
  const seg = 28, Rc = S / 2 / Math.cos(Math.PI / seg), h = band * S, e = S / 2 // unit disc = the full quad's inscribed circle
  const pos = [], part = []
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2
    pos.push(0, 0, 0, Math.cos(a0) * Rc, Math.sin(a0) * Rc, 0, Math.cos(a1) * Rc, Math.sin(a1) * Rc, 0); part.push(0, 0, 0)
  }
  pos.push(-e, -h, 0, e, -h, 0, e, h, 0, -e, -h, 0, e, h, 0, -e, h, 0); part.push(1, 1, 1, 1, 1, 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1))
  return g
}

/** Faceted crystal heart + inner wire lattice + the light at the centre. */
export function createHeart(U) {
  const grp = new THREE.Group()
  // Fake crystal: faceted normals, studio-strip reflections, fresnel edges and an inner light.
  // (Cheaper than a transmission pass and it can glow from inside.)
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { ...U, uLit: { value: 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */`varying vec3 vW; varying vec3 vL;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vL = position; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLit, uFade; varying vec3 vW; varying vec3 vL;
      void main(){
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 v = normalize(cameraPosition - vW);
        if (dot(n, v) < 0.0) n = -n;
        float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 r = reflect(-v, n);
        // studio softboxes: a few horizontal strips and a key from the upper left
        float strips = smoothstep(0.55, 0.62, r.y) * 0.9 + smoothstep(0.1, 0.14, r.y) * smoothstep(0.2, 0.16, r.y) * 0.35;
        float key = pow(max(dot(r, normalize(vec3(-0.5, 0.7, 0.6))), 0.0), 24.0) * 1.6;
        float facet = fract(sin(dot(floor(n*7.0), vec3(12.9898, 78.233, 37.719)))*43758.5453);
        vec3 inner = mix(vec3(0.05,0.18,0.55), vec3(0.35,0.75,1.0), facet*0.6) * (0.25 + 0.75*uLit);
        float depth = 1.0 - clamp(length(vL)/2.6, 0.0, 1.0);
        vec3 col = inner * (0.35 + 0.65*(1.0 - fr)) + vec3(0.85,0.93,1.0) * (strips*0.55 + key + fr*0.9);
        col += vec3(0.4,0.75,1.0) * uLit * 0.35 * (0.6 + 0.4*sin(uTime*2.2 + facet*6.0));
        gl_FragColor = vec4(col, (0.55 + 0.4*fr) * uFade);
      }`,
  })
  const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), mat)
  gem.scale.set(1, 1.35, 1)
  grp.add(gem)
  const inner = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.25, 1)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(1.6), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  grp.add(inner)
  // light at the centre: a camera-facing radial glow (not a sphere)
  const gm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, uniforms: { ...U, uI: { value: 0 }, uDisc: { value: 0.72 } },
    vertexShader: /* glsl */`uniform float uDisc; attribute float aPart; varying vec2 vUv; varying float vPart;
      void main(){
        vec2 xy = aPart < 0.5 ? position.xy * uDisc : position.xy;
        vUv = xy / 18.0 + 0.5; vPart = aPart;
        vec4 mv = modelViewMatrix*vec4(0.0,0.0,0.0,1.0); mv.xy += xy; gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uI, uTime, uDisc; varying vec2 vUv; varying float vPart;
      void main(){
        vec2 c = vUv - 0.5; float d = length(c)*2.0;
        if ((d > uDisc) != (vPart > 0.5)) discard; // halo disc inside d = uDisc, streak band outside it
        float core = exp(-d*d*140.0), halo = exp(-d*9.0)*0.16;
        float streak = exp(-abs(c.y)*160.0) * exp(-abs(c.x)*4.0) * 0.3;
        vec3 col = vec3(0.6,0.84,1.0)*(core*2.2 + halo) + vec3(0.3,0.6,1.0)*streak;
        gl_FragColor = vec4(col * uI * 0.7 * (0.94 + 0.06*sin(uTime*7.0)), 1.0);
      }`,
  })
  const glowQ = new THREE.Mesh(glowGeometry(), gm)
  glowQ.frustumCulled = false
  glowQ.renderOrder = 5
  grp.add(glowQ)
  return { group: grp, crystal: gem, inner, glow: gm, mat }
}

/** A spectrogram wrapped on a band around the core: harmonics scrolling in time. */
export function createSpectrogram(U) {
  const g = new THREE.CylinderGeometry(10.2, 10.2, 2.2, 192, 1, true)
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: U,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBoot, uCore; varying vec2 vUv;
      ${NOISE}
      void main(){
        float col = floor(vUv.x * 320.0);
        float x = col / 320.0;
        float tt = x*24.0 - uTime*1.6;
        float e = smoothstep(-0.2, 0.7, snoise(vec3(tt*0.35, 1.3, 0.0))) ;
        float f0 = 0.085 + 0.03*snoise(vec3(tt*0.12, 4.0, 0.0));
        float y = floor(vUv.y*48.0)/48.0;
        float v = 0.0;
        for (int k=1;k<9;k++){ float fk = f0*float(k); v += exp(-pow((y - fk)/0.018, 2.0)) * pow(0.78, float(k)); }
        v = v*e + 0.05*e*(1.0-y);
        vec3 c = mix(vec3(0.05,0.18,0.5), vec3(0.4,0.85,1.0), clamp(v*1.4,0.0,1.0));
        float edge = smoothstep(0.0,0.08,vUv.y)*smoothstep(1.0,0.92,vUv.y);
        float gap = step(0.18, fract(vUv.x*320.0));
        gl_FragColor = vec4(c * v * 0.9 * edge * gap * uBoot * uCore, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  return mesh
}
