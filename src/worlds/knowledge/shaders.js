// GLSL for the knowledge network. Everything moves on the GPU: drift, breathing, pointer lensing,
// activation waves (per-hub hop distance from a tiny float texture), retrieval cone, depth of field.
import { POINT_FRAG } from '../../lib/glsl.js'

// Shared uniforms/functions. Hubs, chunks, fibres all use the same displacement so fibres stay attached.
export const COMMON = /* glsl */ `
uniform float uTime;
uniform sampler2D uHop;      // H x 1 RGBA float: weighted hop distance of each hub from the source of wave slot 0..3
uniform vec4 uWaveT;         // start time of each wave slot
uniform vec4 uWaveA;         // amplitude of each wave slot
uniform float uSpeed;        // hops per second
uniform vec3 uRayO;          // pointer ray (local space)
uniform vec3 uRayD;
uniform float uPtr;          // pointer influence 0..1
uniform float uBreath;       // 0..1 breathing amplitude
uniform float uFocus;        // focus distance (view space)
uniform float uAperture;     // blur per unit of defocus
uniform float uPx;           // pixels per world unit at distance 1
uniform float uHaze;         // distance haze density
uniform float uFade;         // global opacity

vec4 hubHops(float idx){ return texelFetch(uHop, ivec2(int(idx + 0.5), 0), 0); }

float wv(float h, float t0, float a){
  float s = uTime - t0;
  if (a <= 0.0 || s < 0.0) return 0.0;
  float d = s * uSpeed - h;
  float crest = exp(-d * d * 1.4);
  float tail = d > 0.0 ? exp(-d * 0.5) * 0.4 : 0.0;
  return (crest + tail) * a * exp(-h * 0.045) * exp(-s * 0.26);
}
float activation(vec4 h){
  return wv(h.x, uWaveT.x, uWaveA.x) + wv(h.y, uWaveT.y, uWaveA.y) + wv(h.z, uWaveT.z, uWaveA.z) + wv(h.w, uWaveT.w, uWaveA.w);
}
vec3 drift(vec3 p){
  float t = uTime * 0.22;
  vec3 d = vec3(sin(p.y * 0.07 + t * 1.3 + p.z * 0.031), sin(p.z * 0.061 + t * 1.1 + p.x * 0.043), sin(p.x * 0.052 + t * 0.9 + p.y * 0.05));
  float r = length(p);
  return d * 0.8 + p * (uBreath * 0.02 * sin(uTime * 0.85 - r * 0.045));
}
// Nodes near the pointer ray drift away from it (a lens opening around the cursor) and brighten.
vec3 lens(vec3 p, out float f){
  vec3 v = p - uRayO;
  float t = max(dot(v, uRayD), 0.0);
  vec3 dv = v - uRayD * t;
  float d = length(dv);
  float R = 1.8 + t * 0.045;
  f = exp(-d * d / (R * R)) * uPtr * step(0.5, t);
  return p + dv / max(d, 1e-3) * f * R * 0.55;
}
`

const pointVert = (hub) => /* glsl */ `
${COMMON}
attribute float aHub;
attribute vec4 aRand;   // x twinkle phase, y size, z hop jitter, w top-k rank (chunks) / named (hubs)
attribute vec3 aCol;
uniform float uSize;
uniform float uBase;
uniform vec3 uQDir;       // retrieval cone axis (from origin)
uniform float uConeCos;
uniform float uCone;      // cone visibility
uniform float uTopK;      // top-k highlight
uniform float uHover;     // hovered hub index (-1 none)
uniform float uNamed;     // named hub emphasis
varying vec3 vCol;
varying float vA;
varying float vBlur;
varying float vHot;
void main(){
  vec3 p = position + drift(position);
  ${hub ? '' : 'p += vec3(sin(uTime*0.6 + aRand.x*40.0), sin(uTime*0.5 + aRand.x*57.0), sin(uTime*0.55 + aRand.x*23.0)) * 0.45;'}
  float fp;
  p = lens(p, fp);
  vec4 h = hubHops(aHub) + ${hub ? '0.0' : '(0.4 + aRand.z * 0.8)'};
  float act = 1.0 - exp(-activation(h) * 0.9);
  ${hub ? '' : 'act *= 0.2 + 0.8 * fract(aRand.x * 13.71);'}

  float cone = 0.0, top = 0.0;
  ${hub ? '' : `
  float rl = length(position);
  float ca = dot(position / max(rl, 1e-3), uQDir);
  cone = smoothstep(uConeCos - 0.004, uConeCos + 0.012, ca) * smoothstep(18.0, 36.0, rl) * uCone;
  top = step(0.5, aRand.w) * uTopK;`}
  float hov = ${hub ? '1.0 - step(0.5, abs(aHub - uHover))' : '0.0'};
  float named = ${hub ? 'aRand.w * uNamed' : '0.0'};

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float blur = clamp(abs(depth - uFocus) * uAperture / max(uFocus, 1.0), 0.0, 1.0);
  float tw = 0.75 + 0.25 * sin(uTime * (0.8 + aRand.x * 1.7) + aRand.x * 60.0);
  float size = uSize * aRand.y * (1.0 + blur * 1.1) * (1.0 + act * 0.9 + fp * 0.9 + top * 1.6 + cone * 0.6 + hov * 1.6 + named * 0.8);
  float px = size * uPx / max(depth, 0.5);
  float a = 1.0;
  if (px < 1.6) { a *= (px * px) / 2.56; px = 1.6; }
  px = min(px, 40.0);
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;

  vec3 ice = vec3(0.55, 0.86, 1.0);
  vec3 col = aCol * uBase * tw;
  col += ice * act * ${hub ? '2.2' : '1.05'} + vec3(1.0) * act * act * act * ${hub ? '1.2' : '0.45'};
  col += vec3(0.6, 0.85, 1.0) * fp * 0.9;
  col += vec3(0.35, 0.7, 1.0) * cone * 0.55;
  col += vec3(0.8, 0.95, 1.0) * top * 1.6;
  col += vec3(0.7, 0.9, 1.0) * hov * 2.0 + vec3(0.7, 0.85, 1.0) * named * 0.5;
  a /= pow(1.0 + blur * 2.0, 2.2);
  a *= exp(-depth * uHaze) * smoothstep(1.5, 9.0, depth) * uFade;
  vCol = col; vA = a; vBlur = blur; vHot = act + top + hov;
}`

export const POINT_FRAG_SRC = /* glsl */ `
${POINT_FRAG}
varying vec3 vCol;
varying float vA;
varying float vBlur;
varying float vHot;
void main(){
  vec2 uv = gl_PointCoord;
  float d = length(uv - 0.5);
  float sharp = softPoint(uv);
  float bokeh = smoothstep(0.5, 0.36, d) * (0.8 + 0.2 * smoothstep(0.2, 0.46, d));
  float m = mix(sharp, bokeh * 0.42, smoothstep(0.08, 0.6, vBlur));
  if (m < 0.004) discard;
  gl_FragColor = vec4(vCol * m * vA, 1.0);
}`

export const CHUNK_VERT = pointVert(false)
export const HUB_VERT = pointVert(true)

// Fibres (hub-hub edges, curved) and dendrites (chunk-hub). Wave travels along by mixing both ends' hops.
export const FIBRE_VERT = /* glsl */ `
${COMMON}
attribute vec2 aHubs;   // hub at t=0, hub at t=1 (dendrites: both = parent)
attribute vec4 aInfo;   // x t along edge, y seed, z hop jitter at t=1 (dendrite), w kind (0 local, 1 relation, 2 cross, 3 dendrite)
attribute vec3 aJit;    // chunk wobble phase (dendrites)
uniform float uBaseA;
varying float vT;
varying float vSeed;
varying float vAct;
varying float vA;
varying float vKind;
varying float vF;
void main(){
  vec3 p = position + drift(position);
  if (aInfo.w > 2.5) p += vec3(sin(uTime*0.6 + aJit.x*40.0), sin(uTime*0.5 + aJit.x*57.0), sin(uTime*0.55 + aJit.x*23.0)) * 0.45 * aInfo.x;
  float fp;
  p = lens(p, fp);
  vec4 ha = hubHops(aHubs.x), hb = hubHops(aHubs.y) + aInfo.z;
  float act = 1.0 - exp(-activation(mix(ha, hb, aInfo.x)) * 0.9);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position = projectionMatrix * mv;
  vT = aInfo.x; vSeed = aInfo.y; vAct = act; vKind = aInfo.w; vF = fp;
  vA = exp(-depth * uHaze * 1.1) * smoothstep(14.0, 60.0, depth) * uFade;
}`

export const FIBRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBaseA;
varying float vT;
varying float vSeed;
varying float vAct;
varying float vA;
varying float vKind;
varying float vF;
void main(){
  float base = vKind > 2.5 ? 0.06 * (1.0 - vT * 0.7) : (vKind > 0.5 ? 0.085 : 0.075);
  // packets: one per fibre, travelling along it; brighter while a wave passes
  float ph = fract(vT - uTime * (0.18 + vSeed * 0.22) + vSeed * 7.0);
  float pk = smoothstep(0.955, 0.995, ph) * (vKind > 2.5 ? 0.0 : (step(0.55, vSeed) * 0.5 + vAct * 2.5));
  vec3 cool = vec3(0.42, 0.62, 0.95);
  vec3 col = cool * base * uBaseA + vec3(0.45, 0.85, 1.0) * vAct * 0.5 + vec3(0.85, 0.96, 1.0) * pk * 1.6 + vec3(0.5, 0.8, 1.0) * vF * 0.3;
  gl_FragColor = vec4(col * vA, 1.0);
}`

// Story particles: retrieved chunks streaming into the LLM, tool calls out/in, query comet.
export const FLOW_VERT = /* glsl */ `
uniform float uTime;
uniform float uStream;
uniform float uTool;
uniform float uQuery;       // 0..1 query travel
uniform float uQVis;
uniform float uPx;
uniform float uHaze;
uniform float uFade;
attribute vec3 aStart;
attribute vec3 aCtrl;
attribute vec4 aMeta;       // x phase, y kind (0 stream, 1 tool out, 2 tool back, 3 query comet), z lane, w size
varying float vA;
varying vec3 vCol;
vec3 bez(vec3 a, vec3 b, vec3 c, float t){ float u = 1.0 - t; return a*u*u + b*2.0*u*t + c*t*t; }
void main(){
  float kind = aMeta.y;
  float t; float a; vec3 col;
  vec3 end = position;
  if (kind < 0.5) {
    t = fract(aMeta.x + uTime * 0.32);
    a = uStream * sin(3.14159 * t);
    col = vec3(0.6, 0.9, 1.0) * 2.2;
  } else if (kind < 2.5) {
    float cyc = fract(uTime * 0.23 + aMeta.z * 0.371);
    float burst = smoothstep(0.0, 0.05, cyc) * (1.0 - smoothstep(0.4, 0.5, cyc));
    float lt = clamp((cyc - (kind < 1.5 ? 0.0 : 0.22)) / 0.24 - aMeta.x * 0.35, 0.0, 1.0);
    t = lt;
    a = uTool * burst * step(0.001, lt) * (1.0 - step(0.999, lt)) * (1.0 - aMeta.x);
    col = kind < 1.5 ? vec3(0.55, 0.85, 1.0) * 2.4 : vec3(0.8, 0.95, 1.0) * 1.8;
  } else {
    t = clamp(uQuery - aMeta.x * 0.1, 0.0, 1.0);
    a = uQVis * (1.0 - aMeta.x) * step(0.001, uQuery);
    col = vec3(0.85, 0.97, 1.0) * 3.0;
  }
  vec3 p = kind > 2.5 ? mix(aStart, end, 1.0 - pow(1.0 - t, 3.0)) : bez(aStart, aCtrl, end, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float px = aMeta.w * uPx / max(depth, 0.5);
  gl_PointSize = clamp(px, 1.5, 40.0);
  gl_Position = projectionMatrix * mv;
  vA = a * exp(-depth * uHaze) * uFade * smoothstep(1.0, 6.0, depth);
  vCol = col;
}`

export const FLOW_FRAG = /* glsl */ `
${POINT_FRAG}
varying float vA;
varying vec3 vCol;
void main(){
  float m = softPoint(gl_PointCoord);
  if (m * vA < 0.003) discard;
  gl_FragColor = vec4(vCol * m * vA, 1.0);
}`

// Volumetric haze: very large, very faint soft sprites through the clusters.
export const HAZE_VERT = /* glsl */ `
uniform float uPx;
uniform float uTime;
uniform float uFade;
attribute vec4 aMeta; // x size, y alpha, z phase
varying float vA;
void main(){
  vec3 p = position + vec3(sin(uTime * 0.05 + aMeta.z), cos(uTime * 0.04 + aMeta.z * 1.3), 0.0) * 3.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_PointSize = clamp(aMeta.x * uPx / max(depth, 1.0), 2.0, 520.0);
  gl_Position = projectionMatrix * mv;
  vA = aMeta.y * smoothstep(8.0, 60.0, depth) * exp(-depth * 0.0028) * uFade;
}`
export const HAZE_FRAG = /* glsl */ `
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float m = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
  gl_FragColor = vec4(vec3(0.16, 0.34, 0.72) * m * vA, 1.0);
}`

// Retrieval cone: soft additive volume around the query axis, brightest near the axis and edges.
export const CONE_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`
export const CONE_FRAG = /* glsl */ `
uniform float uA; uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float f = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - f, 2.0);
  float along = vUv.y;   // 0 at the base (far end), 1 at the apex (origin)
  float fade = smoothstep(0.0, 0.35, along) * smoothstep(1.0, 0.8, along);
  float scan = 0.7 + 0.3 * sin(along * 60.0 + uTime * 6.0);
  float a = (0.006 + pow(1.0 - f, 1.5) * 0.036) * smoothstep(0.0, 0.3, f) * fade * uA * scan;
  gl_FragColor = vec4(vec3(0.35, 0.72, 1.0) * a, 1.0);
}`
