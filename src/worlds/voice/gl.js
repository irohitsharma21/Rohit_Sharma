import * as THREE from 'three'

// Shared GLSL for the voice chamber. Every signal shader reads the same uniforms:
//   uTime  - ambient clock (flow never stops)
//   uFront - x position of the signal front (scroll-driven): stages downstream of it are dormant
//   uPtr   - pointer on the z=0 plane (local), uPtrOn - 0..1 pointer presence
export const COMMON = /* glsl */ `
uniform float uTime; uniform float uFront; uniform vec3 uPtr; uniform float uPtrOn; uniform float uPx;
float act(float x){ return smoothstep(uFront + 3.0, uFront - 7.0, x); }
float ptrK(vec2 p){ vec2 d = p - uPtr.xy; return uPtrOn * exp(-dot(d, d) / 38.0); }
`
export const FOG_V = /* glsl */ `varying float vFogDepth;`
export const FOG_F = /* glsl */ `
uniform float fogDensity; uniform vec3 fogColor; varying float vFogDepth;
float fogK(){ float d = fogDensity * vFogDepth; return exp(-d * d); }
`

/** Additive (by default) shader material wired to the shared uniforms and to scene fog. */
export function fxMat(U, { vs, fs, uniforms = {}, ...rest }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: COMMON + FOG_V + vs,
    fragmentShader: COMMON + FOG_F + fs,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide,
    ...rest,
  })
}

/** Triangle strip(s) along x: position = (x, side(-1|1), lane). Displaced into ribbons in the vertex shader. */
export function stripGeo(x0, x1, n, lanes = 1) {
  const verts = (n + 1) * 2 * lanes
  const pos = new Float32Array(verts * 3)
  const idx = []
  let v = 0
  for (let l = 0; l < lanes; l++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      pos[v * 3] = x; pos[v * 3 + 1] = -1; pos[v * 3 + 2] = l; v++
      pos[v * 3] = x; pos[v * 3 + 1] = 1; pos[v * 3 + 2] = l; v++
      if (i < n) { const a = (l * (n + 1) + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

/** Common ribbon vertex tail: expects float W(float x, float lane) defined before, uniform uWidth. */
export const RIBBON_VS = /* glsl */ `
uniform float uWidth;
varying float vSide; varying float vX; varying float vA; varying float vLane;
void main(){
  float x = position.x; float lane = position.z;
  float y = W(x, lane); float y2 = W(x + 0.05, lane);
  vec2 t = normalize(vec2(0.05, y2 - y)); vec2 n = vec2(-t.y, t.x);
  vec3 p = vec3(x, y, Z(x, lane));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float dist = length(cameraPosition - wp.xyz);
  float w = max(uWidth, dist * 0.0021);
  p.xy += n * position.y * w;
  // A ribbon seen end-on piles hundreds of additive layers into a few pixels (HDR overflow → bloom blow-out).
  // Fade it where the pipeline axis points at the camera.
  float along = abs(normalize(wp.xyz - cameraPosition).x);
  vSide = position.y; vX = x; vLane = lane; vA = act(x) * (1.0 - smoothstep(0.8, 0.97, along));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
