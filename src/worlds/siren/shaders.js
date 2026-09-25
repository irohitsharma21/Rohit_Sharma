import * as THREE from 'three'

// Shared GLSL for the Siren Eyes intersection.

/** Cheap hash + value noise (much cheaper than simplex, plenty for asphalt grain and puddles). */
export const HASH = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + 1.0), f.x), f.y);
}
// Wet patches on the asphalt. Shared by the ground and the reflection streaks so they agree.
float wetMask(vec2 p){
  float n = vnoise(p*0.085)*0.7 + vnoise(p*0.31 + 7.1)*0.3;
  return smoothstep(0.42, 0.72, n);
}
`

/** Fog factor for additive materials (they must fade out, not tint toward the fog colour). */
export const FOGF = /* glsl */ `
float fogF(){
#ifdef USE_FOG
  return 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
#else
  return 0.0;
#endif
}
`

/** ShaderMaterial that participates in the scene's FogExp2. Access uniforms via material.uniforms afterwards. */
export function smat({ uniforms = {}, vertexShader, fragmentShader, ...rest }) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader, fragmentShader, fog: true, ...rest,
  })
}
