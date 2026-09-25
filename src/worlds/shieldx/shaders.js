import * as THREE from 'three'
import { POINT_FRAG } from '../../lib/glsl.js'
import { HEX } from '../../lib/palette.js'

// Pipeline x-coordinates shared by the particle shader and the scene layout.
export const X = { spawn: -236, ingest: -125, detect: -84, correlate: -44, attack: 0, analyst: 42, policy: 84, respond: 124 }

const col = (h, s = 1) => new THREE.Color(h).multiplyScalar(s)

/**
 * The flow torrent. Every particle is one network flow replayed from the dataset.
 * Benign flows pour through the intake funnel, cross the two detector planes and peel away (cleared);
 * flagged flows (aKind.x = 1..3) look benign until the detector planes, turn amber/red there, and are
 * pulled into one of three incident clusters where they orbit (many alerts → one incident).
 * Everything is computed in the vertex shader from time; the CPU only updates a few uniforms.
 */
export function flowMaterial(px) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uPx: { value: px }, uOpacity: { value: 1 },
      uPtr: { value: new THREE.Vector3(0, 0, 999) }, uPtrOn: { value: 0 },
      uC0: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() },
      uHover: { value: -1 },
      uBenign: { value: col('#7fbfff', 0.85) }, uIce: { value: col(HEX.ice, 0.9) },
      uAmber: { value: col(HEX.amber, 1.6) }, uRed: { value: col(HEX.red, 1.8) },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uPx, uPtrOn, uHover;
      uniform vec3 uPtr, uC0, uC1, uC2, uBenign, uIce, uAmber, uRed;
      attribute vec4 aSeed;   // lane angle, lane radius, speed, phase
      attribute vec2 aKind;   // 0 benign / 1..3 incident, severity
      varying vec3 vCol; varying float vA;
      const float X0 = ${X.spawn.toFixed(1)};
      const float XI = ${X.ingest.toFixed(1)};
      const float XD = ${X.detect.toFixed(1)};
      const float XC = ${X.correlate.toFixed(1)};

      vec3 stream(float x, float ang, float rad){
        // wide torrent narrowing through the intake into a tight duct at the detectors
        float f = smoothstep(X0, XD - 6.0, x);
        float r = mix(22.0, 3.4, f) * rad;
        float twist = ang + x * 0.018;
        return vec3(x, sin(twist) * r * 0.8, cos(twist) * r);
      }

      void main(){
        float kind = aKind.x;
        float sp = mix(0.028, 0.05, aSeed.z);
        float ang = aSeed.x * 6.28318;
        float rad = sqrt(aSeed.y);
        vec3 p; vec3 c; float a = 1.0; float size = 0.32;
        float flash = 0.0;
        if (kind < 0.5) {
          float u = fract(aSeed.w + uTime * sp);
          float x = mix(X0, XC + 4.0, u);
          p = stream(x, ang, rad);
          // cleared traffic peels off below the duct after the detectors
          float after = smoothstep(XD + 2.0, XC + 4.0, x);
          p.y -= after * after * 20.0;
          p.z += after * (aSeed.x - 0.5) * 22.0;
          flash = exp(-pow((x - XD) * 0.35, 2.0));
          a = smoothstep(0.0, 0.12, u) * (1.0 - after) * 0.8;
          c = mix(uBenign, uIce, flash * 0.8);
          size = mix(0.34, 0.62, aSeed.z * aSeed.z);
        } else {
          float u = fract(aSeed.w + uTime * sp * 0.8);
          float x = mix(X0, XC + 170.0, u);
          vec3 C = kind < 1.5 ? uC0 : (kind < 2.5 ? uC1 : uC2);
          float xs = min(x, XC);
          vec3 s = stream(xs, ang, rad);
          float pull = smoothstep(XD, XC, xs);
          pull = pull * pull * (3.0 - 2.0 * pull);
          // orbit shell around the incident centre
          float oa = ang + uTime * (0.5 + aSeed.z * 0.9);
          float ob = aSeed.y * 6.28318 + uTime * 0.23;
          float orad = 1.4 + 2.2 * fract(aSeed.w * 7.13);
          vec3 orb = C + vec3(sin(oa) * cos(ob) * 0.6, sin(oa) * sin(ob), cos(oa)) * orad;
          float hv = step(abs(kind - 1.0 - uHover), 0.1);
          orb += (orb - C) * hv * 0.35;
          p = mix(s, orb, pull);
          float lit = smoothstep(XD - 1.0, XD + 1.5, xs);
          flash = exp(-pow((xs - XD) * 0.45, 2.0));
          vec3 threat = mix(uAmber, uRed, step(0.72, aKind.y));
          c = mix(uBenign, threat, lit) + uIce * flash * 1.5;
          c *= 1.0 + hv * 0.6;
          a = smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.93, 1.0, u)) * mix(0.55, 1.0, lit);
          size = mix(0.4, 0.75, lit);
        }
        // packets near the cursor deflect
        vec3 d = p - uPtr;
        float dl = length(d);
        p += d / max(dl, 0.001) * uPtrOn * smoothstep(9.0, 0.0, dl) * 3.2;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * uPx * (320.0 / max(-mv.z, 1.0));
        vCol = c; vA = a;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vCol; varying float vA;
      ${POINT_FRAG}
      void main(){
        float s = softPoint(gl_PointCoord);
        if (s < 0.01) discard;
        gl_FragColor = vec4(vCol * s * vA * uOpacity, 1.0);
      }`,
  })
}

/** Floor: dark lacquer with a fine survey grid, a faint cyan wash under the pipeline and a fade to the void. */
export function floorMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCyan: { value: col(HEX.cyan, 1) }, uBg: { value: new THREE.Color(HEX.obsidian) } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uCyan, uBg;
      varying vec3 vW;
      float gridLine(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) * s; vec2 fw = fwidth(p) * w; vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g); return max(l.x, l.y); }
      void main(){
        vec2 p = vW.xz;
        float dCam = length(cameraPosition.xz - p);
        float fine = gridLine(p, 4.0, 1.0) * 0.05;
        float major = gridLine(p, 20.0, 1.2) * 0.1;
        float lane = exp(-pow(p.y / 16.0, 2.0));
        float pulse = 0.5 + 0.5 * sin(p.x * 0.08 - uTime * 1.6);
        vec3 c = vec3(0.012, 0.016, 0.022) + uCyan * (fine + major) * (0.4 + 0.6 * lane);
        c += uCyan * lane * 0.022 * (0.6 + 0.4 * pulse);
        float fade = exp(-pow(dCam / 230.0, 2.0));
        float edge = smoothstep(260.0, 120.0, abs(p.y)) * smoothstep(260.0, 180.0, abs(p.x - 0.0));
        gl_FragColor = vec4(c, fade * edge * 0.96);
      }`,
  })
}

/** Glass detector pane with a sweeping scan line and a hot seam where the duct crosses it. */
export function paneMaterial(color = HEX.cyan) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: col(color, 1) }, uOpacity: { value: 1 }, uSpeed: { value: 0.35 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity, uSpeed; uniform vec3 uColor;
      varying vec2 vUv;
      void main(){
        vec2 q = vUv - 0.5;
        float scan = fract(uTime * uSpeed);
        float line = exp(-pow((vUv.y - scan) * 60.0, 2.0));
        float trail = smoothstep(0.0, 0.25, scan - vUv.y) * (1.0 - smoothstep(0.25, 0.5, scan - vUv.y)) * step(vUv.y, scan);
        float edge = max(smoothstep(0.485, 0.5, abs(q.x)), smoothstep(0.485, 0.5, abs(q.y)));
        float core = exp(-dot(q, q) * 30.0);
        float a = 0.025 + line * 0.35 + trail * 0.03 + edge * 0.35 + core * 0.08;
        gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
      }`,
  })
}

/**
 * Thread lines with a travelling pulse (evidence → claim, incident → technique).
 * Geometry: LineSegments with attribute `aT` (0 at the start, 1 at the end of each segment pair).
 */
export function threadMaterial(color = HEX.cyan, o = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: col(color, o.intensity ?? 1.4) }, uOpacity: { value: 1 }, uGrow: { value: 1 }, uDash: { value: o.dash ?? 0 } },
    vertexShader: /* glsl */`
      attribute float aT; attribute float aSeed;
      varying float vT; varying float vS;
      void main(){ vT = aT; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity, uGrow, uDash; uniform vec3 uColor;
      varying float vT; varying float vS;
      void main(){
        if (vT > uGrow) discard;
        float head = fract(uTime * 0.45 + vS);
        float pulse = exp(-pow((vT - head) * 9.0, 2.0));
        float dash = mix(1.0, step(0.5, fract(vT * 22.0 - uTime * 0.8)), uDash);
        float a = (0.22 + pulse * 0.9) * dash * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  })
}

/** Soft radial contact shadow / light pool. */
export function poolMaterial(color = '#000000', strength = 0.8, additive = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength; gl_FragColor = vec4(uColor, a); }`,
  })
}

/** Glowing core for the analyst: fresnel shell with an inner breathing light. */
export function coreMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: col(HEX.cyan, 1) }, uIce: { value: col(HEX.ice, 1) }, uLevel: { value: 0.5 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLevel; uniform vec3 uColor, uIce;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(f, 3.0);
        float breathe = 0.8 + 0.2 * sin(uTime * 1.7);
        vec3 c = mix(uColor, uIce, core) * (core * 1.9 * breathe + pow(1.0 - f, 3.0) * 0.5) * uLevel;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
}
