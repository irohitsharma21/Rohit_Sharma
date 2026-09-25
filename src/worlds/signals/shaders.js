import * as THREE from 'three'
import { NOISE } from '../../lib/glsl.js'

// Additive shaders for the SIGNAL RECEIVED world. Every one of them fades with the scene's FogExp2 by
// darkening (additive light can't be "mixed" toward fog colour without greying the black void).

const FOG_V = /* glsl */`varying float vFogD;`
const FOG_F = /* glsl */`uniform float fogDensity; varying float vFogD;
  float fogKeep(){ return exp(-fogDensity*fogDensity*vFogD*vFogD); }`

const fogUniforms = () => ({ fogDensity: { value: 0.0045 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } })

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }

/**
 * The receiver trace: a horizontal ribbon that shows the noise floor, and resolves into a clean
 * carrier sine spreading out from the point where the incoming carrier arrived (uArrive = x).
 */
export function waveMaterial(shared, refl = 0) {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { ...fogUniforms(), ...shared, uRefl: { value: refl } },
    vertexShader: /* glsl */`
      ${NOISE}
      uniform float uTime, uLock, uArrive, uSeed, uLen, uW;
      varying vec2 vUv; varying float vLocked; varying float vX;
      ${FOG_V}
      float edge(float x){ return smoothstep(uLen*0.5, uLen*0.5-uLen*0.18, abs(x)); }
      void main(){
        vec3 p = position;
        float x = p.x; vX = x;
        float d = abs(x - uArrive);
        float R = uLock * uLen * 1.2;
        float locked = smoothstep(R + 4.0, R - 4.0, d);
        vLocked = locked;
        float n = snoise(vec3(x*0.55 + uSeed, uTime*1.7, uSeed)) * 0.55 + snoise(vec3(x*2.1, uTime*3.1, uSeed*2.0)) * 0.22;
        float pk = exp(-pow((x - uArrive*0.35)/13.0, 2.0));
        float clean = sin(x*0.7 - uTime*2.2) * (0.16 + 0.95*pk);
        float y = mix(n * 0.42, clean, locked) * edge(x);
        // ribbon thickness in world units, widened with distance so far traces stay a crisp hairline
        vec4 c0 = modelViewMatrix * vec4(p.x, y, p.z, 1.0);
        float wd = uW * max(1.0, -c0.z / 70.0);
        p.y = y + (uv.y - 0.5) * wd;
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uLevel, uLen, uRefl, uFlash, uTime;
      uniform vec3 uCore, uHalo;
      varying vec2 vUv; varying float vLocked; varying float vX;
      ${FOG_F}
      void main(){
        float d = abs(vUv.y - 0.5) * 2.0;
        float core = exp(-d*d*260.0);
        float halo = exp(-d*d*9.0) * 0.07;
        float e = smoothstep(uLen*0.5, uLen*0.5 - uLen*0.22, abs(vX));
        float lit = mix(0.28, 1.0, vLocked);
        vec3 col = uCore * core * (0.5 + 0.42*vLocked) + uHalo * halo * (0.35 + vLocked*0.6);
        col *= lit * e * uLevel * (1.0 + uFlash*1.1);
        col *= mix(1.0, 0.16 * (1.0 - d), uRefl);
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Incoming carrier: a thin beam drawn from deep space to the receiver. t = 0 far end, 1 at the receiver. */
export function carrierMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uHead: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color('#bfe9ff') } },
    vertexShader: /* glsl */`varying float vT; ${FOG_V}
      void main(){ vT = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uHead, uFade; uniform vec3 uColor; varying float vT; ${FOG_F}
      void main(){
        float behind = uHead - vT;
        if (behind < 0.0) discard;
        float trail = exp(-behind * 7.0) * 1.6 + 0.12;
        float head = exp(-behind * 90.0) * 5.0;
        vec3 col = uColor * (trail + head) * uFade;
        // the far end is lost in the dark regardless of fog
        col *= smoothstep(0.0, 0.25, vT);
        gl_FragColor = vec4(col * fogKeep() * 0.9, 1.0);
      }`,
  })
}

/** Volumetric light shaft: open cone, bright where the view grazes the centre, streaked by slow noise. */
export function shaftMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.FrontSide,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: new THREE.Color('#9fd8ff') } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec2 vUv; ${FOG_V}
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz);
        vec4 mv = viewMatrix*w; vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      uniform float uTime, uLevel; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec2 vUv; ${FOG_F}
      void main(){
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 3.0);
        float y = vUv.y; // 0 bottom, 1 top
        float g = smoothstep(0.0, 0.18, y) * mix(0.55, 1.0, y) * smoothstep(1.0, 0.82, y);
        float a = vUv.x * 6.2831853;
        float s = 0.62 + 0.38 * sin(a * 7.0 + sin(a * 3.0 + uTime * 0.12) * 2.2 + y * 1.3) * sin(a * 3.0 - uTime * 0.05 + 1.7);
        vec3 col = uColor * f * g * s * uLevel * 0.2;
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Dust suspended in the shaft: drifts down slowly, only visible while the shaft is lit. */
export function dustMaterial(size = 1) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uLevel: { value: 0 }, uH: { value: 60 }, uSize: { value: size }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 seed; uniform float uTime, uH, uSize, uPx; varying float vA; ${FOG_V}
      void main(){
        vec3 p = position;
        p.y = mod(p.y - uTime * (0.35 + seed.x * 0.5), uH);
        p.x += sin(uTime * 0.3 + seed.y * 6.28) * 0.6;
        p.z += cos(uTime * 0.23 + seed.z * 6.28) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogD = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPx * (0.6 + seed.w) * (60.0 / -mv.z);
        vA = (0.4 + 0.6 * seed.w) * (0.6 + 0.4 * sin(uTime * (1.0 + seed.x * 2.0) + seed.y * 20.0)) * smoothstep(0.0, 6.0, p.y) * smoothstep(uH, uH - 12.0, p.y);
      }`,
    fragmentShader: /* glsl */`
      uniform float uLevel; varying float vA; ${FOG_F}
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
        gl_FragColor = vec4(vec3(0.75, 0.88, 1.0) * a * vA * uLevel * 0.9 * fogKeep(), 1.0); }`,
  })
}

/** Lock flare: soft radial bloom + a thin anamorphic horizontal streak. Billboard plane. */
export function flareMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uLevel: { value: 0 }, uStreak: { value: 0 }, uColor: { value: new THREE.Color('#62d8ff') } },
    vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V} void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uLevel, uStreak; uniform vec3 uColor; varying vec2 vUv; ${FOG_F}
      void main(){
        vec2 c = (vUv - 0.5) * vec2(8.0, 1.0); // plane is 8:1
        float r = length(c);
        float glow = exp(-r * 9.0) * 1.2 + exp(-r * 3.2) * 0.07;
        float streak = exp(-abs(c.y) * 90.0) * exp(-abs(c.x) * 0.9) * uStreak;
        float win = smoothstep(0.5, 0.3, abs(vUv.y - 0.5)) * smoothstep(0.5, 0.35, abs(vUv.x - 0.5));
        vec3 col = (vec3(0.85, 0.95, 1.0) * glow * uLevel + uColor * streak * 1.4) * win;
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Obsidian floor: near-black with the pools of light each shaft lays down, and fog. */
export function floorMaterial(pools) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...fogUniforms(), uPools: { value: pools }, uI: { value: new THREE.Vector3() }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vW; ${FOG_V} void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uPools[3]; uniform vec3 uI; uniform vec3 fogColor; varying vec3 vW; ${FOG_F}
      float pool(vec3 c, float i){ vec2 d = (vW.xz - (c.xz)) / vec2(14.0, 9.0); float r = dot(d,d); return i * (exp(-r * 1.6) * 0.5 + exp(-r * 9.0) * 0.6); }
      void main(){
        vec3 base = vec3(0.004, 0.006, 0.009);
        float l = pool(uPools[0], uI.x) + pool(uPools[1], uI.y) + pool(uPools[2], uI.z);
        // hairline survey grid, barely there
        vec2 g = abs(fract(vW.xz / 12.0) - 0.5);
        float grid = smoothstep(0.49, 0.5, max(g.x, g.y)) * 0.012;
        vec3 col = base + vec3(0.30, 0.52, 0.72) * l * 0.16 + vec3(0.5, 0.7, 0.9) * grid * (0.4 + l * 4.0);
        float k = fogKeep();
        gl_FragColor = vec4(mix(fogColor, col, k), 1.0);
      }`,
  })
}

/** Sparse deep-space dust for the whole world. */
export function starMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uPx: { value: 1 }, uLevel: { value: 1 } },
    vertexShader: /* glsl */`attribute vec2 seed; uniform float uTime, uPx; varying float vA; ${FOG_V}
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD = -mv.z * 0.35; gl_Position = projectionMatrix*mv;
        gl_PointSize = uPx * (1.0 + seed.x * 1.6);
        vA = (0.25 + 0.75 * seed.x) * (0.55 + 0.45 * sin(uTime * (0.4 + seed.y) + seed.y * 40.0)); }`,
    fragmentShader: /* glsl */`uniform float uLevel; varying float vA; ${FOG_F}
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d);
        gl_FragColor = vec4(vec3(0.7, 0.82, 1.0) * a * vA * 0.55 * uLevel * fogKeep(), 1.0); }`,
  })
}
