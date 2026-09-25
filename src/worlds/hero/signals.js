import * as THREE from 'three'
import { rng } from '../../lib/math.js'

// Signals travelling through the void: WebSocket data streams converging on the core with
// packets riding them, and speech waveform ribbons (analog in, quantised out).

const BEND = /* glsl */`
  uniform vec3 uRayO, uRayD; uniform float uRayOn;
  vec3 bendToRay(vec3 p, float k){
    vec3 w = p - uRayO; float tt = max(dot(w, uRayD), 0.0);
    vec3 toC = uRayO + uRayD*tt - p; float dd = length(toC);
    float R = 3.0 + tt*0.08;
    return p + toC * exp(-dd*dd/(R*R)) * k * uRayOn;
  }
`

export function createStreams(U) {
  const r = rng(99)
  const S = 26, SEG = 90
  const pos = [], at = [], sd = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3()
  const bez = (t, out) => out.set(0, 0, 0).addScaledVector(a, (1 - t) ** 2).addScaledVector(c, 2 * (1 - t) * t).addScaledVector(b, t * t)
  for (let s = 0; s < S; s++) {
    const th = r() * Math.PI * 2, y = (r() * 2 - 1) * 0.55, q = Math.sqrt(1 - y * y)
    const R = 110 + r() * 90
    a.set(Math.cos(th) * q * R, y * R, Math.sin(th) * q * R - 30)
    b.copy(a).normalize().multiplyScalar(10.5)
    c.lerpVectors(a, b, 0.45).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(60))
    const seed = r()
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG, t1 = (i + 1) / SEG
      bez(t0, p0); bez(t1, p1)
      pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      at.push(t0, t1); sd.push(seed, seed)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
    vertexShader: /* glsl */`
      uniform float uTime, uFlow;
      attribute float aT, aSeed; varying float vT; varying float vS;
      ${BEND}
      void main(){ vT = aT; vS = aSeed; vec3 p = bendToRay(position, 0.35); gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBoot, uCore, uFlowT; varying float vT; varying float vS;
      void main(){
        float sp = 0.10 + vS*0.08;
        float h = fract(vT*3.0 - uFlowT*sp*3.0 + vS*7.0);
        float pk = smoothstep(0.955, 0.995, h) * (1.0 - smoothstep(0.995, 1.0, h));
        float fade = smoothstep(0.0, 0.25, vT) * (1.0 - smoothstep(0.93, 1.0, vT));
        vec3 c = vec3(0.38,0.84,1.0) * (0.045 + pk*1.5) * fade;
        gl_FragColor = vec4(c * (0.25 + 0.75*uBoot) * uCore, 1.0);
      }`,
  })
  const lines = new THREE.LineSegments(g, m)
  lines.frustumCulled = false
  return lines
}

export function createRibbons(U) {
  // One horizontal signal line through the core, drawn as a filled symmetric waveform:
  // analog speech flows in from the left, quantised action packets leave on the right.
  const grp = new THREE.Group()
  const g = new THREE.PlaneGeometry(150, 1, 900, 1)
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: U,
    vertexShader: /* glsl */`
      uniform float uTime, uPtrOn, uBoot; uniform vec3 uPtr;
      varying float vX; varying float vV; varying float vSide; varying float vAmp;
      float speech(float x, float t){
        float u = x + t*9.0;
        float s = abs(sin(u*5.3)*0.6 + sin(u*11.7)*0.3 + sin(u*23.0)*0.1);
        float syl = pow(max(0.0, sin(u*0.32)), 1.6) * (0.55 + 0.45*sin(u*0.071 + 1.0));
        float word = smoothstep(-0.3, 0.4, sin(u*0.09));
        return s * syl * word;
      }
      float digital(float x, float t){
        float u = x - t*8.0;
        float q = floor(u*0.9);
        float v = fract(sin(q*12.9898)*43758.5453);
        float gate = step(0.35, fract(sin(floor(u*0.12)*7.13)*912.7));
        float inb = step(0.12, fract(u*0.9));
        return (0.25 + 0.75*step(0.5, v)) * gate * inb;
      }
      void main(){
        float x = position.x;
        float near = smoothstep(9.0, 20.0, abs(x));
        float a = x < 0.0 ? speech(x, uTime) * 2.3 : digital(x, uTime) * 0.42;
        float dx = x - uPtr.x;
        float gpt = exp(-dx*dx/50.0) * uPtrOn;
        a = a * near * (0.25 + 0.75*uBoot) * (1.0 + gpt*1.8);
        float side = position.y > 0.0 ? 1.0 : -1.0;
        float y = side * (0.03 + a);
        // the cursor pulls the trace toward it
        float cy = (uPtr.y - 0.0) * gpt * 0.55;
        vec3 p = vec3(x, y + cy, -4.0);
        vX = x; vV = side; vSide = step(0.0, x); vAmp = a;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uBoot, uCore; varying float vX; varying float vV; varying float vSide; varying float vAmp;
      void main(){
        float fade = pow(smoothstep(74.0, 18.0, abs(vX)), 1.4) * smoothstep(9.0, 17.0, abs(vX));
        vec3 c = mix(vec3(0.42,0.84,1.0), vec3(0.24,0.52,1.0), vSide);
        float centre = 1.0 - abs(vV);   // interpolated: 1 at the axis, 0 at the envelope
        float body = 0.16 + 0.5*pow(1.0 - centre, 3.0);
        gl_FragColor = vec4(c * body * fade * uBoot * uCore * mix(1.3, 0.8, vSide), 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  grp.add(mesh)
  return grp
}
