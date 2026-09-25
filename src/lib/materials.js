import * as THREE from 'three'
import { COLOR } from './palette.js'

// Physically based materials read the scene environment (engine sets scene.environment),
// so chrome and glass pick up soft studio reflections without any extra setup.

export const chrome = (o = {}) => new THREE.MeshStandardMaterial({ color: COLOR.chrome, metalness: 1, roughness: 0.16, envMapIntensity: 1.1, ...o })
export const graphite = (o = {}) => new THREE.MeshStandardMaterial({ color: COLOR.graphite, metalness: 0.7, roughness: 0.42, envMapIntensity: 0.6, ...o })
export const obsidian = (o = {}) => new THREE.MeshPhysicalMaterial({ color: COLOR.obsidian, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.7, ...o })

/** Cheap smoked glass: reflective, translucent, no transmission pass. Use this by default. */
export const smokedGlass = (o = {}) => new THREE.MeshPhysicalMaterial({
  color: 0x0b1118, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.35,
  clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide, ...o,
})

/** Real refractive crystal (adds a transmission pass the first time it is used). Use sparingly, hero pieces only. */
export const crystal = (o = {}) => new THREE.MeshPhysicalMaterial({
  color: 0xdcecff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 1.2, ior: 1.45,
  attenuationColor: new THREE.Color('#7fb8ff'), attenuationDistance: 6, envMapIntensity: 1.2, ...o,
})

/** Unlit emissive colour that feeds bloom. intensity > 1 pushes it above the bloom threshold. */
export const glow = (color = COLOR.cyan, intensity = 2.5, o = {}) => {
  const c = new THREE.Color(color).multiplyScalar(intensity)
  return new THREE.MeshBasicMaterial({ color: c, ...o })
}

export const lineGlow = (color = COLOR.cyan, opacity = 0.6, intensity = 1.5) =>
  new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })

/** Fresnel rim hologram: silhouettes, scanned objects, ghost geometry. Additive, no depth write. */
export function holo(color = COLOR.cyan, o = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: o.opacity ?? 1 }, uPower: { value: o.power ?? 2.2 }, uScan: { value: o.scan ?? 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uPower; uniform float uScan;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))), uPower);
        float scan = 0.75 + 0.25*sin(vW.y*18.0 - uTime*3.0);
        float a = (f*0.9 + 0.06) * mix(1.0, scan, uScan) * uOpacity;
        gl_FragColor = vec4(uColor*(0.6+f*2.2), a);
      }`,
  })
}
