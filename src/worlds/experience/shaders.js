import * as THREE from 'three'
import { NOISE } from '../../lib/glsl.js'

// Shaders for the PRODUCTION tower. Additive pieces darken with FogExp2 instead of mixing toward fog colour.

const FOG_V = /* glsl */`varying float vFogD;`
const FOG_F = /* glsl */`uniform float fogDensity; varying float vFogD;
  float fogKeep(){ return exp(-fogDensity*fogDensity*vFogD*vFogD); }`
const fogUniforms = () => ({ fogDensity: { value: 0.0045 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } })
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }

/** Energy conduit up the spine: lit from the base up to uFill (local y), streaks rising. */
export function spineMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uFill: { value: -80 }, uBase: { value: 0.12 } },
    vertexShader: /* glsl */`varying vec3 vL; varying vec3 vN; varying vec3 vV; ${FOG_V}
      void main(){ vL = position; vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-w.xyz);
        vec4 mv = viewMatrix*w; vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFill, uBase; varying vec3 vL; varying vec3 vN; varying vec3 vV; ${FOG_F}
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float on = smoothstep(uFill + 2.0, uFill - 2.0, vL.y);
        float streak = pow(0.5 + 0.5*sin(vL.y*0.9 - uTime*9.0 + sin(atan(vL.z, vL.x)*3.0)*0.6), 6.0);
        float head = exp(-abs(vL.y - uFill) * 0.6) * on;
        vec3 c = vec3(0.35, 0.7, 1.0);
        vec3 col = c * (uBase * 0.3 + on * (0.25 + 1.0*streak) * (0.4 + 0.6*f)) + vec3(0.8, 0.95, 1.0) * head * 1.4;
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** 30 parallel TTS lanes, merged into one geometry with a `lane` attribute. uOn = number of live lanes. */
export function laneMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uOn: { value: 0 }, uH: { value: 20 } },
    vertexShader: /* glsl */`attribute float lane; varying float vLane; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_V}
      void main(){ vLane = lane; vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-w.xyz);
        vec4 mv = viewMatrix*w; vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uOn, uH; varying float vLane; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_F}
      float h(float n){ return fract(sin(n*91.7)*43758.5); }
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float live = clamp(uOn - vLane, 0.0, 1.0);
        float sp = 0.9 + h(vLane)*0.5;
        float y = vUv.y * uH;
        float pk = fract(y*0.16 - uTime*sp*1.6 + h(vLane+3.0));
        float packet = smoothstep(0.0, 0.03, pk) * smoothstep(0.2, 0.03, pk);
        vec3 glass = vec3(0.5, 0.65, 0.8) * (0.015 + f*0.1);
        vec3 col = glass + vec3(0.35, 0.75, 1.0) * live * (0.07 + packet * 1.25);
        col *= smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y) * 0.5 + 0.5;
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Pipe from the DEPLOY hub to a port: grows out (uGrow) then carries pulses (uFlow). */
export function pipeMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uGrow: { value: 0 }, uFlow: { value: 0 }, uSeed: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_V}
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-w.xyz);
        vec4 mv = viewMatrix*w; vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uGrow, uFlow, uSeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${FOG_F}
      void main(){
        float t = vUv.y; // 0 at hub, 1 at port
        if (t > uGrow) discard;
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float pk = fract(t*2.5 - uTime*1.3 + uSeed);
        float pulse = smoothstep(0.0, 0.04, pk) * smoothstep(0.22, 0.04, pk);
        float tip = exp(-(uGrow - t) * 30.0) * (1.0 - uFlow);
        vec3 col = vec3(0.45, 0.7, 0.95) * (0.1 + f*0.35) + vec3(0.4, 0.8, 1.0) * (pulse * 1.8 * uFlow + tip * 2.5);
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Holographic telemetry ring (MONITOR): ticks, a latency trace around the circumference, a sweep. */
export function ringMaterial(r0, r1) {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uOn: { value: 0 }, uR0: { value: r0 }, uR1: { value: r1 } },
    vertexShader: /* glsl */`varying vec2 vP; ${FOG_V}
      void main(){ vP = position.xy; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      uniform float uTime, uOn, uR0, uR1; varying vec2 vP; ${FOG_F}
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float u = (a + 3.14159265) / 6.2831853; // 0..1 around
        float t = (r - uR0) / (uR1 - uR0);      // 0 inner, 1 outer
        float px = fwidth(r) * 1.2;
        float lines = smoothstep(px, 0.0, abs(r - uR0 - 0.05)) + smoothstep(px, 0.0, abs(r - uR1 + 0.05)) * 0.7;
        float minor = step(fract(u*120.0), 0.08) * step(0.82, t) ;
        float major = step(fract(u*12.0), 0.006) * step(0.62, t);
        // latency trace, hovering in a band (decorative telemetry)
        float v = 0.34 + 0.12*snoise(vec3(u*14.0, uTime*0.25, 0.0)) + 0.05*snoise(vec3(u*60.0, uTime*0.6, 3.0));
        float tr = smoothstep(0.035, 0.0, abs(t - v));
        float fill = step(t, v) * step(0.12, t) * 0.07;
        // sweep
        float sw = fract(u - uTime*0.05);
        float sweep = pow(sw, 14.0);
        float live = smoothstep(0.0, 0.05, uOn * 1.02 - u) ; // ring draws on around the circumference
        vec3 c = vec3(0.4, 0.82, 1.0);
        vec3 col = c * (lines*0.6 + minor*0.35 + major*0.8 + tr*(1.1 + sweep*2.0) + fill*(1.0+sweep*3.0)) + vec3(0.8,0.95,1.0)*sweep*0.1*step(0.1,t);
        col *= live;
        gl_FragColor = vec4(col * fogKeep() * 0.9, 1.0);
      }`,
  })
}

/** Prosody band (OPTIMIZE): a curved holographic strip whose contour goes from flat/jagged to shaped. */
export function prosodyMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uTune: { value: 0 }, uOn: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V} void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vFogD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      uniform float uTime, uTune, uOn; varying vec2 vUv; ${FOG_F}
      void main(){
        float x = vUv.x; float y = vUv.y;
        float rough = 0.5 + 0.03*snoise(vec3(x*80.0, uTime*4.0, 0.0)) ;
        float shaped = 0.5 + 0.26*sin(x*9.0 - uTime*0.8) * sin(x*3.14159) + 0.08*sin(x*23.0 + uTime*1.3);
        float c = mix(rough, shaped, uTune);
        float px = fwidth(y) * 1.5;
        float line = smoothstep(px*1.6, 0.0, abs(y - c));
        float glow = exp(-abs(y - c) * 30.0) * 0.25;
        float grid = step(fract(x*24.0), 0.03) * 0.08 + smoothstep(px, 0.0, abs(y-0.5)) * 0.08;
        float edge = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.92, x);
        vec3 col = vec3(0.4, 0.82, 1.0) * (line*1.5 + glow + grid) * edge * uOn;
        gl_FragColor = vec4(col * fogKeep(), 1.0);
      }`,
  })
}

/** Soft dark contact shadow / halo disc. */
export function discMaterial(color = new THREE.Color(0, 0, 0), opacity = 0.8, additiveBlend = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additiveBlend ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uColor: { value: color }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a; gl_FragColor = vec4(uColor, a * uOpacity); }`,
  })
}
