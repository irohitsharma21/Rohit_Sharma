// Shaders for the technology constellation. Star/line brightness is driven by two uniform arrays
// (uLvl = illumination, uAct = "source" of a trace) indexed by star id, so hovering is a 40-float
// CPU update and everything else happens on the GPU.

const ICE = 'vec3(0.52, 0.81, 1.0)'

export const STAR_VERT = /* glsl */`
uniform float uLvl[40];
uniform float uTime;
uniform float uDpr;
attribute float aIdx;
attribute float aHub;
attribute float aSeed;
varying float vI;
varying float vSize;
varying float vCore;
varying float vHalo;
varying float vHub;
varying float vW;
void main(){
  float L = uLvl[int(aIdx + 0.5)];
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.1);
  float sc = clamp(34.0 / dist, 0.42, 1.5);
  float tw = 0.9 + 0.1 * sin(uTime * (1.1 + fract(aSeed) * 1.9) + aSeed);
  float lv = clamp(L, 0.0, 2.0);
  vI = L * tw;
  vHub = aHub;
  vW = 0.6 * uDpr;
  float hub = step(0.9, aHub);
  vCore = (1.05 + 0.5 * aHub + 0.9 * hub) * uDpr * mix(0.8, 1.05, sc) * (0.7 + 0.3 * lv);
  vHalo = (3.2 + 4.0 * aHub + 4.0 * hub) * uDpr * sc * (0.55 + 0.45 * lv);
  vSize = mix(36.0 + 24.0 * aHub, 150.0, hub) * uDpr * sc * (0.7 + 0.3 * lv);
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * mv;
}`

export const STAR_FRAG = /* glsl */`
varying float vI;
varying float vSize;
varying float vCore;
varying float vHalo;
varying float vHub;
varying float vW;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  vec2 q = uv * vSize;
  float r = length(q);
  float core = exp(-(r * r) / (vCore * vCore));
  float edge = 1.0 - smoothstep(0.3, 0.5, length(uv));
  float halo = exp(-r / vHalo) * edge;
  float spk = 0.0;
  if (vHub > 0.9) {
    float hx = pow(max(0.0, 1.0 - abs(q.x) / (vSize * 0.5)), 3.0);
    float hy = pow(max(0.0, 1.0 - abs(q.y) / (vSize * 0.5)), 3.0);
    spk = exp(-abs(q.y) / vW) * hx + exp(-abs(q.x) / vW) * hy;
    // faint secondary diagonal spikes, like a real secondary mirror support
    vec2 d = vec2(q.x + q.y, q.x - q.y) * 0.7071;
    float h2 = pow(max(0.0, 1.0 - length(q) / (vSize * 0.28)), 3.0);
    spk += (exp(-abs(d.x) / vW) + exp(-abs(d.y) / vW)) * h2 * 0.25;
  }
  vec3 ice = ${ICE};
  vec3 col = ice * (halo * 0.42 + spk * 0.55) + mix(ice, vec3(1.0), 0.85) * core * 1.7;
  col *= vI;
  gl_FragColor = vec4(col, 1.0);
}`

export const LINE_VERT = /* glsl */`
uniform float uLvl[40];
uniform float uAct[40];
uniform float uTime;
attribute float aT;
attribute float aA;
attribute float aB;
attribute float aKind;
varying float vI;
varying float vKind;
varying float vPulse;
void main(){
  int ia = int(aA + 0.5), ib = int(aB + 0.5);
  float la = uLvl[ia], lb = uLvl[ib], xa = uAct[ia], xb = uAct[ib];
  float act = max(xa, xb);
  float s = xa >= xb ? aT : 1.0 - aT;                 // travel away from the traced star
  float ph = fract(uTime * 0.42 + aA * 0.037);
  float w = aKind > 0.5 ? 11.0 : 4.0;
  float pulse = exp(-pow((s - ph) * w, 2.0)) * act;
  float lv = clamp(min(la, lb), 0.0, 1.4);
  float base = aKind > 0.5 ? 0.07 : 0.24;
  vI = base * lv + act * (aKind > 0.5 ? 0.2 : 0.16) + pulse * (aKind > 0.5 ? 2.2 : 1.1);
  if (aKind > 0.5) vI *= 0.35 + 0.65 * smoothstep(0.0, 0.08, aT) * smoothstep(1.0, 0.92, aT);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vI *= clamp(1.2 - (-mv.z) / 300.0, 0.3, 1.0);
  vKind = aKind;
  vPulse = pulse;
  gl_Position = projectionMatrix * mv;
}`

export const LINE_FRAG = /* glsl */`
varying float vI;
varying float vKind;
varying float vPulse;
void main(){
  vec3 intra = vec3(0.6, 0.76, 0.95);
  vec3 cross = vec3(0.1, 0.42, 1.0);
  vec3 c = mix(intra, cross, vKind);
  c = mix(c, ${ICE}, clamp(vPulse, 0.0, 1.0));
  gl_FragColor = vec4(c * vI, 1.0);
}`

export const FIELD_VERT = /* glsl */`
uniform float uTime;
uniform float uDpr;
attribute float aSize;
attribute float aTemp;
varying vec3 vC;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 0.1);
  float s = abs(aSize);
  if (aSize < 0.0) {
    // dust inside the chart: close = larger + dimmer, gives depth when the camera moves
    gl_PointSize = max(1.0, s * uDpr * 36.0 / d);
    vA = 0.14 * clamp(36.0 / d, 0.25, 1.0) * smoothstep(2.0, 10.0, d);
  } else {
    gl_PointSize = max(1.0, s * uDpr);
    vA = (0.28 + 0.3 * min(s, 2.5)) * (0.78 + 0.22 * sin(uTime * (0.4 + aTemp * 2.3) + aTemp * 71.0));
  }
  vC = aTemp < 0.72 ? vec3(0.72, 0.84, 1.0) : aTemp < 0.92 ? vec3(1.0) : vec3(1.0, 0.86, 0.72);
  gl_Position = projectionMatrix * mv;
}`

export const FIELD_FRAG = /* glsl */`
varying vec3 vC;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vC * a * vA, 1.0);
}`

export const RETICLE_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

export const RETICLE_FRAG = /* glsl */`
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float aa = fwidth(r) * 1.2;
  float ring = 1.0 - smoothstep(0.0, aa, abs(r - 0.5));
  float ang = atan(p.y, p.x);
  float dash = step(0.55, fract(ang / 6.2832 * 60.0 - uTime * 0.25));
  float ring2 = (1.0 - smoothstep(0.0, aa, abs(r - 0.62))) * dash * 0.45;
  vec2 ap = abs(p);
  float m = min(ap.x, ap.y), M = max(ap.x, ap.y);
  float tick = (1.0 - smoothstep(0.0, fwidth(m) * 1.2, m)) * step(0.72, M) * step(M, 0.95);
  float a = (ring * 0.85 + ring2 + tick * 0.9) * uOpacity;
  gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * 1.25 * a, 1.0);
}`

// Great graduated circle: fades out as the camera comes close so it never slices across a close-up.
export const MASTER_VERT = /* glsl */`
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  vA = smoothstep(45.0, 130.0, d) * clamp(1.4 - d / 420.0, 0.3, 1.0);
  gl_Position = projectionMatrix * mv;
  // keep the great circle out of the legend (lower-left overlay) so it never underlines the UI text
  vec2 ndc = gl_Position.xy / max(gl_Position.w, 1e-3);
  vA *= 1.0 - 0.8 * (1.0 - smoothstep(-0.95, -0.3, ndc.x)) * (1.0 - smoothstep(-0.35, 0.05, ndc.y));
}`

export const MASTER_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vA;
void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }`
