import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Small GLSL/geometry helpers shared by the infra world (kept local to this folder).

export const HASH = /* glsl */`
float h11(float n){ return fract(sin(n*127.1)*43758.5453123); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
`

/** Additive materials fade to black in fog instead of mixing towards the fog colour. */
export const FOG_ADD = /* glsl */`
#ifdef FOG_EXP2
  float fogF = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  gl_FragColor.rgb *= 1.0 - fogF;
  gl_FragColor.a *= 1.0 - fogF;
#endif
`

/** ShaderMaterial with fog uniforms merged in (shared uniform objects are kept by reference). */
export function shader({ uniforms = {}, ...o }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    fog: true,
    ...o,
  })
}

export const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }

/** Merge a list of { geo, attrs: {name: value|fn(pos)} } into one geometry with per-vertex float attributes. */
export function merge(items, attrNames = []) {
  const geos = items.map(({ geo, attrs = {} }) => {
    const g = geo.index ? geo.toNonIndexed() : geo
    const n = g.attributes.position.count
    const pos = g.attributes.position
    for (const name of attrNames) {
      const a = new Float32Array(n)
      const v = attrs[name] ?? 0
      for (let i = 0; i < n; i++) a[i] = typeof v === 'function' ? v(pos.getX(i), pos.getY(i), pos.getZ(i), i) : v
      g.setAttribute(name, new THREE.BufferAttribute(a, 1))
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && !attrNames.includes(k)) g.deleteAttribute(k)
    return g
  })
  return mergeGeometries(geos, false)
}

/** Axis-aligned box geometry spanning [x0,x1]×[y0,y1]×[z0,z1]. */
export function boxSpan(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}
