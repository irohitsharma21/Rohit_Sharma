// Building blocks for the MeetAI world: abstract human bust geometry, caption strips (text planes that
// assemble word by word, dissolve into points, and highlight spans), and canvas-backed holographic panels.
import * as THREE from 'three'

export const FONT_MONO = '"Geist Mono", ui-monospace, monospace'
export const FONT_SANS = '"Geist", "Inter", system-ui, sans-serif'

// ---------------------------------------------------------------- shared GLSL
/** Manual exp2 fog for custom shaders (fades additive things to black, blended things toward the void). */
export const FOG_V = /* glsl */`varying float vFogD;`
export const FOG_F = /* glsl */`uniform float uFog; varying float vFogD; float fogF(){ return exp(-uFog*uFog*vFogD*vFogD); }`
export const HASH = /* glsl */`float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }`

// ---------------------------------------------------------------- bust
/**
 * One smooth closed surface: a lathe whose cross-section is elliptical and changes with height
 * (wide, shallow shoulders → round neck → head). Reads as a person without any face or cartoon cues.
 */
export function bustGeometry() {
  const prof = [
    [0.0, -1.3], [0.8, -1.3], [0.83, -0.2], [0.9, 0.7], [0.93, 1.18], [0.86, 1.42], [0.66, 1.6], [0.36, 1.74],
    [0.25, 1.9], [0.25, 2.02], [0.33, 2.12], [0.45, 2.3], [0.52, 2.52], [0.53, 2.72], [0.49, 2.92], [0.38, 3.08], [0.2, 3.19], [0.0, 3.23],
  ]
  const curve = new THREE.CatmullRomCurve3(prof.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal')
  const pts = curve.getPoints(70).map((v) => new THREE.Vector2(Math.max(0, v.x), v.y))
  pts[0].set(0, -1.3); pts[pts.length - 1].set(0, 3.23)
  const g = new THREE.LatheGeometry(pts, 56)
  const pos = g.attributes.position
  const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const h = sm(1.62, 2.0, y) // 0 torso → 1 head
    const sx = 1.28 + (0.86 - 1.28) * h
    const sz = 0.5 + (0.98 - 0.5) * h
    // slight forward lean of the head, and a chest that's a touch fuller in front
    const zf = pos.getZ(i) * sz + h * 0.1 + (1 - h) * (pos.getZ(i) > 0 ? 0.05 : 0)
    pos.setXYZ(i, pos.getX(i) * sx, y, zf)
  }
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- caption strip
const _one = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); t.needsUpdate = true; return t })()

/**
 * A live-caption strip: "SPEAKER  text…". Rendered once to a canvas; the shader reveals it word by word
 * with a caret, can dissolve it into grains (embedding), highlight spans (commitment), and sweep a scan line.
 */
export class Strip extends THREE.Mesh {
  constructor(who, text, shared, o = {}) {
    const px = 60, pad = 26, gap = 22
    const c = document.createElement('canvas')
    const x = c.getContext('2d')
    const fWho = `500 ${px * 0.5}px ${FONT_MONO}`, fTxt = `400 ${px * 0.78}px ${FONT_SANS}`
    x.font = fWho; if ('letterSpacing' in x) x.letterSpacing = `${px * 0.09}px`
    const ww = x.measureText(who).width
    if ('letterSpacing' in x) x.letterSpacing = '0px'
    x.font = fTxt
    const tw = x.measureText(text).width
    const W = Math.ceil(pad + 6 + ww + gap + tw + pad), H = Math.round(px * 1.5)
    c.width = W; c.height = H
    // plate
    x.fillStyle = 'rgba(9,15,22,0.66)'; roundRect(x, 1, 1, W - 2, H - 2, 10); x.fill()
    x.strokeStyle = 'rgba(160,210,245,0.22)'; x.lineWidth = 2; roundRect(x, 1, 1, W - 2, H - 2, 10); x.stroke()
    x.fillStyle = '#62d8ff'; x.fillRect(pad * 0.5, H * 0.3, 3, H * 0.4)
    x.textBaseline = 'middle'
    x.font = fWho; if ('letterSpacing' in x) x.letterSpacing = `${px * 0.09}px`
    x.fillStyle = '#62d8ff'; x.fillText(who, pad + 6, H / 2 + 1)
    if ('letterSpacing' in x) x.letterSpacing = '0px'
    x.font = fTxt; x.fillStyle = '#eef4fa'
    const tx = pad + 6 + ww + gap
    x.fillText(text, tx, H / 2 + 2)
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4

    // highlight mask (commitment spans)
    let hiTex = _one
    const spans = []
    if (o.hi?.length) {
      const hc = document.createElement('canvas'); hc.width = W; hc.height = H
      const hx = hc.getContext('2d'); hx.font = fTxt; hx.fillStyle = '#fff'
      for (const s of o.hi) {
        const i = text.indexOf(s); if (i < 0) continue
        const x0 = tx + hx.measureText(text.slice(0, i)).width, w = hx.measureText(s).width
        hx.fillRect(x0 - 6, H * 0.2, w + 12, H * 0.6)
        spans.push({ u0: (x0 - 6) / W, u1: (x0 + w + 6) / W })
      }
      hiTex = new THREE.CanvasTexture(hc)
    }
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        map: { value: tex }, hiMap: { value: hiTex }, uReveal: { value: 1 }, uOpacity: { value: 1 }, uHi: { value: 0 },
        uScan: { value: -1 }, uDissolve: { value: 0 }, uTime: shared.uTime, uFog: shared.uFog, uHiColor: { value: new THREE.Color(o.hiColor || '#62d8ff') },
      },
      vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V}
        void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform sampler2D map; uniform sampler2D hiMap; uniform float uReveal,uOpacity,uHi,uScan,uDissolve,uTime; uniform vec3 uHiColor;
        varying vec2 vUv; ${FOG_F} ${HASH}
        void main(){
          vec4 c = texture2D(map, vUv);
          float e = uReveal*1.06;
          float r = smoothstep(e, e-0.05, vUv.x);
          float plate = smoothstep(e+0.12, e, vUv.x);        // plate runs slightly ahead of the words
          float isText = smoothstep(0.35, 0.8, dot(c.rgb, vec3(0.33)));
          float a = c.a * mix(plate*0.9, r, isText);
          vec3 col = c.rgb * 1.05;
          float caret = smoothstep(0.012, 0.0, abs(vUv.x-e+0.01)) * step(0.001,uReveal) * step(uReveal,0.985) * step(0.22,vUv.y) * step(vUv.y,0.78);
          col += vec3(0.6,1.4,2.2) * caret; a = max(a, caret);
          float h = texture2D(hiMap, vUv).a * uHi;
          col = mix(col, col*vec3(1.1,1.0,0.9) + uHiColor*0.25, h) + uHiColor*h*0.16*(1.0-c.a*isText);
          a = max(a, h*0.55*r);
          if (uScan > -0.5) { float s = exp(-pow((vUv.x-uScan)*28.0,2.0)); col += vec3(0.6,1.3,2.1)*s*0.8; a = max(a, s*0.5*plate); }
          if (uDissolve > 0.0) {
            float n = hash12(floor(vUv*vec2(140.0,14.0)));
            float d = smoothstep(uDissolve-0.08, uDissolve, n);
            col += vec3(0.4,1.1,1.8) * (1.0-d) * step(n, uDissolve+0.02) * step(uDissolve-0.12, n) * 2.0;
            a *= d;
          }
          gl_FragColor = vec4(col * fogF(), a * uOpacity * mix(0.35,1.0,fogF()));
        }`,
    })
    const g = new THREE.PlaneGeometry(1, 1)
    super(g, mat)
    this.aspect = W / H
    this.lineH = o.height ?? 0.72
    this.baseScale = new THREE.Vector3(); this.baseScale.set(this.lineH * (H / px) * this.aspect, this.lineH * (H / px), 1)
    this.scale.copy(this.baseScale)
    this.spans = spans
    this.textU0 = tx / W
    this.renderOrder = 12
    this.frustumCulled = false
  }
  set opacity(v) { this.material.uniforms.uOpacity.value = v; this.visible = v > 0.003 }
  get u() { return this.material.uniforms }
  /** local x (in scaled units) of a span centre, for connectors. */
  spanX(i) { const s = this.spans[i]; return s ? ((s.u0 + s.u1) / 2 - 0.5) : 0 }
}

// ---------------------------------------------------------------- canvas panel
/**
 * Plane with a canvas face drawn once by `draw(ctx, W, H)`. Shader: opacity, wipe reveal (top→bottom or
 * left→right) with a bright leading edge, optional edge glow.
 */
export class Panel extends THREE.Mesh {
  constructor(w, h, res, draw, shared, o = {}) {
    const c = document.createElement('canvas')
    c.width = Math.round(res * w / h); c.height = res
    const x = c.getContext('2d')
    draw(x, c.width, c.height)
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
    tex.minFilter = THREE.LinearMipmapLinearFilter
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: tex }, uOpacity: { value: 1 }, uReveal: { value: 1 }, uDir: { value: o.dir ?? 1 }, uGlow: { value: 0 }, uGain: { value: o.gain ?? 1.2 }, uTime: shared.uTime, uFog: shared.uFog },
      vertexShader: /* glsl */`varying vec2 vUv; ${FOG_V}
        void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vFogD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform sampler2D map; uniform float uOpacity,uReveal,uDir,uGlow,uGain,uTime; varying vec2 vUv; ${FOG_F}
        void main(){
          vec4 c = texture2D(map, vUv);
          float k = uDir > 0.5 ? 1.0 - vUv.y : vUv.x;
          float e = uReveal*1.04;
          float r = smoothstep(e, e-0.03, k);
          float lead = exp(-pow((k-e+0.012)*60.0,2.0)) * step(0.001,uReveal) * step(uReveal,0.99);
          vec2 q = abs(vUv-0.5)*2.0; float edge = smoothstep(0.985,1.0,max(q.x,q.y));
          vec3 col = c.rgb*uGain + vec3(0.4,1.0,1.7)*(lead*0.3 + edge*uGlow);
          float a = max(c.a*r, max(lead*0.35, edge*uGlow*0.8*r));
          float f = fogF();
          gl_FragColor = vec4(col*f, a*uOpacity*mix(0.3,1.0,f));
        }`,
    })
    super(new THREE.PlaneGeometry(w, h), mat)
    this.renderOrder = o.renderOrder ?? 8
    this.frustumCulled = false
  }
  get u() { return this.material.uniforms }
  set opacity(v) { this.material.uniforms.uOpacity.value = v; this.visible = v > 0.003 }
}

export function roundRect(x, l, t, w, h, r) {
  x.beginPath(); x.moveTo(l + r, t); x.lineTo(l + w - r, t); x.quadraticCurveTo(l + w, t, l + w, t + r); x.lineTo(l + w, t + h - r)
  x.quadraticCurveTo(l + w, t + h, l + w - r, t + h); x.lineTo(l + r, t + h); x.quadraticCurveTo(l, t + h, l, t + h - r); x.lineTo(l, t + r)
  x.quadraticCurveTo(l, t, l + r, t); x.closePath()
}

/** Set letter spacing if supported, returning ctx for chaining. */
export function track(x, em, px) { if ('letterSpacing' in x) x.letterSpacing = `${em * px}px`; return x }
