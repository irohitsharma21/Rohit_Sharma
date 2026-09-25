import * as THREE from 'three'
import { rng } from '../../lib/math.js'
import { chrome } from '../../lib/materials.js'
import { POINT_FRAG } from '../../lib/glsl.js'

// The luminous channel behind the core, down which the camera travels as the visitor scrolls in.
// Runs along -Z from the heart of the core.

export const TUNNEL = { z0: -12, z1: -236, R: 7.2 }

export function createTunnel(U, quality) {
  const grp = new THREE.Group()
  const { z0, z1, R } = TUNNEL
  const L = z0 - z1

  // glowing ring frames + longitudinal rails, one LineSegments
  const arr = [], kind = [], zz = []
  const M = 38, SEG = 96
  for (let i = 0; i < M; i++) {
    const z = z0 - i * (L / M)
    for (let s = 0; s < SEG; s++) {
      const a0 = s / SEG * Math.PI * 2, a1 = (s + 1) / SEG * Math.PI * 2
      arr.push(Math.cos(a0) * R, Math.sin(a0) * R, z, Math.cos(a1) * R, Math.sin(a1) * R, z)
      kind.push(0, 0); zz.push(i, i)
    }
  }
  const RAILS = 24, RS = 60
  for (let k = 0; k < RAILS; k++) {
    const a = k / RAILS * Math.PI * 2, rr = R * 0.985
    for (let s = 0; s < RS; s++) {
      const za = z0 - s / RS * L, zb = z0 - (s + 1) / RS * L
      arr.push(Math.cos(a) * rr, Math.sin(a) * rr, za, Math.cos(a) * rr, Math.sin(a) * rr, zb)
      kind.push(1, 1); zz.push(k + za * 0.001, k + zb * 0.001)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  g.setAttribute('aK', new THREE.Float32BufferAttribute(kind, 1))
  g.setAttribute('aI', new THREE.Float32BufferAttribute(zz, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
    vertexShader: /* glsl */`attribute float aK, aI; varying float vK; varying float vI; varying float vZ; varying float vD;
      void main(){ vK = aK; vI = aI; vZ = position.z; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uTime, uTun; varying float vK; varying float vI; varying float vZ; varying float vD;
      void main(){
        float depth = smoothstep(-236.0, -150.0, vZ);
        vec3 c;
        if (vK < 0.5) {
          float pulse = pow(0.5 + 0.5*sin(vI*0.55 + uTime*4.0), 10.0);
          c = vec3(0.3,0.55,1.0) * (0.08 + pulse*1.6);
        } else {
          float h = fract(-vZ*0.02 + uTime*0.9 + floor(vI)*0.37);
          float pk = smoothstep(0.93, 1.0, h);
          c = vec3(0.4,0.85,1.0) * (0.06 + pk*2.2);
        }
        float near = smoothstep(0.5, 6.0, vD);
        gl_FragColor = vec4(c * uTun * near * mix(0.35, 1.0, depth) * exp(-vD*0.004), 1.0);
      }`,
  })
  const lines = new THREE.LineSegments(g, m)
  lines.frustumCulled = false
  grp.add(lines)

  // structural chrome frames every few metres
  const F = 10
  const frames = new THREE.InstancedMesh(new THREE.TorusGeometry(R + 0.35, 0.16, 8, 128), chrome({ roughness: 0.34, color: new THREE.Color('#7d8896'), envMapIntensity: 0.45, transparent: true, opacity: 0 }), F)
  const mtx = new THREE.Matrix4()
  for (let i = 0; i < F; i++) { mtx.makeTranslation(0, 0, z0 - 6 - i * (L / F)); frames.setMatrixAt(i, mtx) }
  frames.instanceMatrix.needsUpdate = true
  grp.add(frames)
  grp.userData.frames = frames

  // particles streaming down the channel
  const N = quality === 'low' ? 2500 : 5000
  const r = rng(33)
  const pos = new Float32Array(N * 3), sd = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2, rr = R * (0.25 + 0.7 * Math.sqrt(r()))
    pos.set([Math.cos(a) * rr, Math.sin(a) * rr, z0 - r() * L], i * 3); sd[i] = r()
  }
  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  pg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  const pm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
    vertexShader: /* glsl */`uniform float uTime, uScale, uTun; attribute float aSeed; varying vec3 vCol; varying float vA;
      void main(){
        vec3 p = position;
        p.z = -12.0 - mod(-12.0 - p.z + uTime*(6.0 + aSeed*14.0), 224.0);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_PointSize = clamp((0.06 + aSeed*0.05) * uScale / -mv.z, 1.0, 4.0);
        vA = uTun * 0.7 * smoothstep(0.5, 4.0, -mv.z) * smoothstep(-236.0, -200.0, p.z) * smoothstep(-12.0, -24.0, p.z);
        vCol = mix(vec3(0.6,0.75,1.0), vec3(0.4,0.85,1.0), aSeed);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`varying vec3 vCol; varying float vA; ${POINT_FRAG}
      void main(){ float s = softPoint(gl_PointCoord); if (s < 0.01) discard; gl_FragColor = vec4(vCol*s*vA, 1.0); }`,
  })
  const pts = new THREE.Points(pg, pm)
  pts.frustumCulled = false
  grp.add(pts)

  // channel wall: dark machined panels with seams and light sweeping down the channel
  const wg = new THREE.CylinderGeometry(R + 0.6, R + 0.6, L, 64, 1, true)
  wg.rotateX(Math.PI / 2); wg.translate(0, 0, (z0 + z1) / 2)
  const wm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, uniforms: U,
    vertexShader: /* glsl */`varying vec3 vP; varying float vD; void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uTime, uTun; varying vec3 vP; varying float vD;
      void main(){
        float a = atan(vP.y, vP.x) / 6.28318 + 0.5;
        float z = vP.z;
        vec2 cell = vec2(a*24.0, z/5.9);
        vec2 f = abs(fract(cell) - 0.5);
        float seam = smoothstep(0.482, 0.5, max(f.x, f.y));
        float id = fract(sin(dot(floor(cell), vec2(12.9898, 78.233)))*43758.5453);
        float sweep = pow(0.5 + 0.5*sin(z*0.08 + uTime*2.2), 12.0);
        vec3 panel = vec3(0.012,0.018,0.028) * (0.5 + 0.9*id);
        vec3 col = panel + vec3(0.25,0.5,1.0) * seam * (0.035 + sweep*0.45) + vec3(0.3,0.6,1.0) * step(0.975, id) * 0.07;
        float fade = smoothstep(-12.0, -26.0, z) * exp(-vD*0.006);
        gl_FragColor = vec4(col * fade, 0.92 * fade * smoothstep(0.0, 1.0, uTun));
      }`,
  })
  const wall = new THREE.Mesh(wg, wm)
  wall.renderOrder = -1
  wall.frustumCulled = false
  grp.add(wall)

  // the luminous end of the channel (fog-free so it reads from the far end)
  const em = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: U,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`uniform float uTun, uTime; varying vec2 vUv;
      void main(){ float d = length(vUv-0.5)*2.0; float v = exp(-d*d*6.0)*1.6 + exp(-d*2.5)*0.3;
        gl_FragColor = vec4(vec3(0.55,0.8,1.0) * v * uTun * uTun, 1.0); }`,
  })
  const end = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), em)
  end.position.z = z1 + 2
  grp.add(end)
  return grp
}
