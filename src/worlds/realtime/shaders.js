// GLSL for the real-time network. Link control points + per-link state live in a float DataTexture
// (uLinks, width = link count, 4 rows):
//   row0 = A.xyz, linkTime     row1 = C.xyz, highlight     row2 = B.xyz, pointerActivity     row3 = kind, period, offset, length
// Packets are points whose position along their link's quadratic bezier is computed on the GPU.

const COMMON = /* glsl */`
uniform sampler2D uLinks;
uniform float uFog;
vec3 bez(vec3 a, vec3 c, vec3 b, float s){ float i = 1.0 - s; return i*i*a + 2.0*i*s*c + s*s*b; }
float h11(float n){ return fract(sin(n*127.1 + 11.7)*43758.5453); }
float fogF(float depth){ float f = uFog*depth; return exp(-f*f); }
`

export const PACKET_VS = /* glsl */`
${COMMON}
uniform float uPx, uSize, uReveal, uPtr;
uniform vec3 uRayO, uRayD;
attribute vec3 aP2;          // dir (+1 a→b, -1 b→a), speed (world units / s), seed
varying vec3 vCol; varying float vA;
const vec3 CYAN = vec3(0.38, 0.85, 1.0);
const vec3 BLUE = vec3(0.24, 0.52, 1.0);
const vec3 ICE = vec3(0.78, 0.92, 1.0);
const vec3 AMBER = vec3(1.0, 0.66, 0.26);
const vec3 GREEN = vec3(0.3, 0.95, 0.62);
void main(){
  int L = int(position.x + 0.5);
  vec4 r0 = texelFetch(uLinks, ivec2(L, 0), 0);
  vec4 r1 = texelFetch(uLinks, ivec2(L, 1), 0);
  vec4 r2 = texelFetch(uLinks, ivec2(L, 2), 0);
  vec4 r3 = texelFetch(uLinks, ivec2(L, 3), 0);
  float kind = r3.x, per = r3.y, off = r3.z, len = max(r3.w, 1.0);
  float lt = r0.w, hl = r1.w, act = r2.w;
  float phase = position.y, role = position.z;
  float dir = aP2.x, spd = aP2.y / len, seed = aP2.z;
  float s = 0.0, a = 0.0, size = 1.0;
  vec3 col = CYAN;
  if (kind < 0.5) {                       // WEBRTC: continuous bidirectional media, dense + smooth
    s = fract(phase + lt*spd); a = 0.55; size = 0.75; col = mix(CYAN, ICE, 0.25*step(0.0, -dir));
  } else if (kind < 1.5) {                // WSS: persistent duplex channel, frequent small irregular frames
    float cyc = phase + lt*spd; s = fract(cyc);
    a = step(0.45, h11(floor(cyc)*7.13 + seed*91.0)) * 0.9; size = 0.9; col = mix(BLUE, ICE, 0.35);
  } else if (kind < 2.5) {                // SIP: INVITE → 200 OK handshake, then an RTP media stream opens
    float c = fract(lt/per + off);
    if (role < 0.5) { s = c/0.11; a = step(0.0, s)*step(s, 1.0)*1.5; size = 2.3; col = AMBER; }
    else if (role < 1.5) { s = 1.0 - (c - 0.12)/0.11; a = step(0.0, s)*step(s, 1.0)*1.5; size = 2.3; col = GREEN; }
    else { s = fract(phase + lt*spd); a = smoothstep(0.23, 0.27, c)*(1.0 - smoothstep(0.9, 0.95, c))*0.6; size = 0.75; col = mix(CYAN, ICE, 0.3); }
    dir = 1.0;
  } else if (kind < 3.5) {                // REDIS PUB/SUB: publish in, then synchronous fan-out burst to every subscriber
    float c = fract(lt/per + off);
    if (role < 0.5) { s = (c - phase)/0.26; }             // hub (a) → subscriber (b)
    else { s = 1.0 - (c - 0.58 - phase)/0.3; }            // subscriber publishes back to hub
    a = step(0.0, s)*step(s, 1.0)*1.1; size = role < 0.5 ? 1.35 : 1.0; col = role < 0.5 ? ICE : BLUE;
    dir = 1.0;
  } else if (kind < 4.5) {                // PIPE: one-way token / audio stream between services
    float cyc = phase + lt*spd; s = fract(cyc);
    a = (0.35 + 0.65*step(0.3, h11(floor(cyc)*3.7 + seed*17.0))) * 0.75; size = 0.85; col = mix(BLUE, CYAN, 0.45);
  } else {                                // inter-region backbone
    s = fract(phase + lt*spd); a = 0.8; size = 1.6; col = ICE;
  }
  if (dir < 0.0) s = 1.0 - s;
  s = clamp(s, 0.0, 1.0);
  a *= smoothstep(0.0, 0.035, s) * smoothstep(1.0, 0.965, s);
  vec3 p = bez(r0.xyz, r1.xyz, r2.xyz, s);
  // pointer proximity (angular distance to the pointer ray)
  vec3 w = p - uRayO; float tp = max(dot(w, uRayD), 0.001);
  float ang = length(w - uRayD*tp) / tp;
  float near = exp(-ang*ang/0.0016) * uPtr;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  a *= fogF(depth) * uReveal * (1.0 + hl*0.7 + act*0.35 + near*0.6);
  float px = uSize * size * (1.0 + 0.35*near + 0.25*hl) * uPx / max(depth, 0.1);
  // keep distant packets as sub-pixel sparks instead of vanishing: shrink energy, not presence
  a *= smoothstep(1.5, 8.0, depth);
  float cl = clamp(px, 1.6, 22.0);
  a *= min(1.0, px / 1.6);
  gl_PointSize = a > 0.003 ? cl : 0.0;
  gl_Position = projectionMatrix * mv;
  vCol = col * (1.4 + near*0.5 + hl*0.3);
  vA = a;
}`

export const PACKET_FS = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){
  vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
  float m = smoothstep(0.5, 0.0, d); m = m*m*(0.4 + 0.6*smoothstep(0.22, 0.0, d));
  if (m*vA < 0.002) discard;
  gl_FragColor = vec4(vCol, m*vA);
}`

export const LINK_VS = /* glsl */`
${COMMON}
uniform float uTime;
attribute vec2 aL;           // link id, t along link
varying float vA; varying float vT; varying float vKind; varying float vHl; varying float vSig;
void main(){
  int L = int(aL.x + 0.5);
  vec4 r0 = texelFetch(uLinks, ivec2(L, 0), 0);
  vec4 r1 = texelFetch(uLinks, ivec2(L, 1), 0);
  vec4 r2 = texelFetch(uLinks, ivec2(L, 2), 0);
  vec4 r3 = texelFetch(uLinks, ivec2(L, 3), 0);
  vec3 p = bez(r0.xyz, r1.xyz, r2.xyz, aL.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sig = 0.0;
  if (r3.x > 1.5 && r3.x < 2.5) { float c = fract(r0.w/r3.y + r3.z); sig = smoothstep(0.23, 0.3, c)*(1.0 - smoothstep(0.88, 0.95, c)); }
  vSig = sig; vT = aL.y; vKind = r3.x; vHl = r1.w + r2.w*0.35;
  vA = fogF(-mv.z);
  gl_Position = projectionMatrix * mv;
}`

export const LINK_FS = /* glsl */`
uniform float uReveal;
varying float vA; varying float vT; varying float vKind; varying float vHl; varying float vSig;
void main(){
  float base = vKind > 4.5 ? 0.16 : (vKind > 2.5 && vKind < 3.5 ? 0.14 : 0.11);
  base += vSig*0.12;
  vec3 col = mix(vec3(0.5, 0.72, 0.95), vec3(0.38, 0.85, 1.0), clamp(vHl + vSig, 0.0, 1.0));
  float a = (base + vHl*0.28) * vA * uReveal;
  gl_FragColor = vec4(col*(1.0 + vHl*0.5), a);
}`

// Hero request trail: dense points along the route polyline, bright just behind the packet head.
export const TRAIL_VS = /* glsl */`
uniform float uFog, uPx, uProg, uShow, uTime;
attribute float aU;           // arc-length position along the route (0..1)
varying float vA; varying float vHot;
float fogF(float depth){ float f = uFog*depth; return exp(-f*f); }
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float behind = uProg - aU;
  float trail = behind >= 0.0 ? exp(-behind*14.0) : 0.0;
  float ahead = behind < 0.0 ? 0.13 * (0.6 + 0.4*sin(aU*420.0 - uTime*6.0)) : 0.0;
  float done = behind >= 0.0 ? 0.09 : 0.0;
  float a = (trail*0.7 + ahead + done) * uShow * fogF(-mv.z) * smoothstep(4.0, 14.0, -mv.z);
  vHot = trail;
  vA = a;
  float px = (0.12 + trail*0.1) * uPx / max(-mv.z, 0.1);
  gl_PointSize = a > 0.003 ? clamp(px, 1.4, 18.0) : 0.0;
  gl_Position = projectionMatrix * mv;
}`

export const TRAIL_FS = /* glsl */`
varying float vA; varying float vHot;
void main(){
  vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
  float m = smoothstep(0.5, 0.0, d);
  vec3 col = mix(vec3(0.38, 0.85, 1.0)*1.1, vec3(0.85, 0.95, 1.0)*1.9, vHot*vHot);
  gl_FragColor = vec4(col, m*vA);
}`

// Node status LEDs / apertures: one point per node.
export const LED_VS = /* glsl */`
uniform float uFog, uPx, uTime, uReveal;
attribute float aAct; attribute float aSize; attribute vec3 aCol; attribute float aSeed;
varying vec3 vCol; varying float vA;
float fogF(float depth){ float f = uFog*depth; return exp(-f*f); }
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float blink = 0.75 + 0.25*step(0.5, fract(sin(floor(uTime*3.0 + aSeed*40.0)*12.9898 + aSeed)*43758.5));
  float a = fogF(-mv.z) * uReveal * smoothstep(3.0, 16.0, -mv.z);
  vA = a;
  vCol = aCol * (0.9*blink + aAct*1.8);
  float px = aSize * (1.0 + aAct*0.9) * uPx / max(-mv.z, 0.1);
  gl_PointSize = clamp(px, 1.5, 26.0);
  gl_Position = projectionMatrix * mv;
}`

export const LED_FS = /* glsl */`
varying vec3 vCol; varying float vA;
void main(){
  vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
  float m = smoothstep(0.5, 0.0, d); m = m*m*(0.3 + 0.7*smoothstep(0.16, 0.0, d));
  gl_FragColor = vec4(vCol, m*vA);
}`

// Polar floor grid under each region: faint rings / sector spokes, fades with radius.
export const FLOOR_VS = /* glsl */`
varying vec3 vP; varying float vD;
void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`

export const FLOOR_FS = /* glsl */`
uniform float uFog, uR, uYaw, uReveal, uPulse;
varying vec3 vP; varying float vD;
float line(float x, float w){ float d = abs(fract(x - 0.5) - 0.5); float fw = fwidth(x); return 1.0 - smoothstep(w*fw, (w + 1.5)*fw, d); }
void main(){
  vec2 q = vP.xy / uR;            // plane is built in XY then rotated flat
  float r = length(q);
  float ang = atan(q.y, q.x) + 1.5707963 - uYaw;
  float rings = line(r*24.0, 0.0) * 0.35;
  float fw = fwidth(r);
  float tiers = 0.0;
  tiers += 1.0 - smoothstep(0.0, fw*1.6, abs(r - 1.0));
  tiers += (1.0 - smoothstep(0.0, fw*1.6, abs(r - 0.74)))*0.7;
  tiers += (1.0 - smoothstep(0.0, fw*1.6, abs(r - 0.54)))*0.5;
  float spokes = line(ang/6.2831853*72.0, 0.0) * smoothstep(0.2, 0.5, r) * 0.25;
  float sector = line(ang/6.2831853*3.0 - 0.5, 0.4) * smoothstep(0.15, 0.3, r);
  float fade = smoothstep(1.35, 0.35, r);
  float glowC = exp(-r*r*18.0) * 0.5;
  float pulse = exp(-pow((r - uPulse*1.2)*9.0, 2.0)) * (1.0 - uPulse) * 0.6;
  float v = (rings*0.035 + tiers*0.09 + spokes*0.03 + sector*0.05 + pulse*0.2) * fade + glowC*0.06;
  float f = uFog*vD; float fog = exp(-f*f);
  gl_FragColor = vec4(vec3(0.45, 0.7, 1.0) * v * fog * uReveal, 1.0);
}`

// Pub/sub fan-out burst: a thin ring expanding out of the Redis hub on every publish cycle.
export const PULSE_FS = /* glsl */`
uniform float uC, uFog, uReveal;
varying vec2 vUv; varying float vD;
void main(){
  vec2 q = vUv*2.0 - 1.0; float r = length(q);
  float rr = uC; float w = 0.012 + uC*0.02;
  float ring = exp(-pow((r - rr)/w, 2.0)) * pow(1.0 - uC, 1.6);
  float f = uFog*vD; float fog = exp(-f*f);
  gl_FragColor = vec4(vec3(0.62, 0.88, 1.0)*1.6, ring*0.8*fog*uReveal);
}`

export const UV_VS = /* glsl */`
varying vec2 vUv; varying float vD;
void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`

// Soft volumetric haze billboard (the network "glowing in fog").
export const HAZE_FS = /* glsl */`
uniform vec3 uColor; uniform float uI, uFog;
varying vec2 vUv; varying float vD;
void main(){
  vec2 q = vUv*2.0 - 1.0; float r = dot(q, q);
  float m = exp(-r*3.2);
  float f = uFog*vD*0.6; float fog = exp(-f*f);
  gl_FragColor = vec4(uColor, m*uI*fog*smoothstep(4.0, 60.0, vD));
}`

export const DUST_VS = /* glsl */`
uniform float uTime, uPx, uFog, uReveal;
attribute float aSeed;
varying float vA;
void main(){
  vec3 p = position;
  p.y += mod(uTime*(0.6 + aSeed*0.8) + aSeed*140.0, 140.0) - 20.0;
  p.x += sin(uTime*0.07 + aSeed*30.0)*3.0;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  float f = uFog*(-mv.z); float fog = exp(-f*f);
  vA = fog * uReveal * (0.25 + 0.75*aSeed);
  float px = 0.22 * uPx / max(-mv.z, 0.1);
  vA *= min(1.0, px/1.2);
  gl_PointSize = max(px, 1.2);
  gl_Position = projectionMatrix*mv;
}`

export const DUST_FS = /* glsl */`
varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float m = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.6, 0.78, 1.0), m*vA*0.35); }`
