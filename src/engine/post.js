import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// Lens pass: warp radial blur (world transitions), edge chromatic aberration,
// vignette, and fine film grain. Runs in linear HDR before tone mapping.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.02 },
    uCA: { value: 1.0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uWarp, uVignette, uGrain, uCA, uFlash; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float r = length(c * vec2(uRes.x/uRes.y, 1.0));
      vec3 col = vec3(0.0);
      float ca = (0.0009 * smoothstep(0.35, 1.0, r) * r + uWarp*0.006*r) * uCA;
      vec2 d = normalize(c+1e-5)*ca;
      if (uWarp < 0.002) {
        // resting: edge chromatic aberration only (3 taps)
        col = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
      } else {
        // in flight: short radial zoom blur toward the destination
        float blur = uWarp * 0.016;
        const int N = 8;
        for (int i=0;i<N;i++){
          vec2 suv = 0.5 + c*(1.0 - blur*float(i)/float(N-1));
          col.r += texture2D(tDiffuse, suv + d).r;
          col.g += texture2D(tDiffuse, suv).g;
          col.b += texture2D(tDiffuse, suv - d).b;
        }
        col /= float(N);
      }
      // vignette
      float v = smoothstep(1.15, 0.25, r);
      col *= mix(1.0, v, 0.85*uVignette);
      // flash (boot ignition)
      col += vec3(0.55,0.75,1.0)*uFlash;
      // grain
      float g = hash(uv*uRes + fract(uTime*7.13)*100.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65*(1.0 - clamp(dot(col,vec3(0.333)),0.0,1.0)));
      gl_FragColor = vec4(max(col,0.0), 1.0);
    }`,
}

// Guards bloom against a single NaN/Inf pixel (e.g. a degenerate additive sliver) blacking out the frame.
const ClampShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // D3D/ANGLE may fold isnan() away, so also rely on max() dropping NaN (IEEE fmax semantics)
      // and on a range test that is false for NaN.
      bool bad = any(isnan(c)) || any(isinf(c)) || !(c.r < 1e5 && c.g < 1e5 && c.b < 1e5);
      c = bad ? vec3(0.0) : min(max(c, vec3(0.0)), vec3(48.0));
      gl_FragColor = vec4(c, 1.0);
    }`,
}

export function createPost(renderer, scene, camera, quality = 'high') {
  const size = renderer.getSize(new THREE.Vector2())
  // 2x MSAA is the sweet spot on integrated GPUs: 4x costs a full extra resolve for little visible gain
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 2 })
  const composer = new EffectComposer(renderer, rt)
  const renderPass = new RenderPass(scene, camera)
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.55, 0.82)
  const lens = new ShaderPass(LensShader)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(new ShaderPass(ClampShader))
  composer.addPass(bloom)
  composer.addPass(lens)
  composer.addPass(output)
  return {
    composer, bloom, lens,
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr)
      composer.setSize(w, h)
      // bloom is a blur: half resolution is visually identical and roughly 4x cheaper
      bloom.setSize(Math.max(1, Math.round(w * dpr * 0.5)), Math.max(1, Math.round(h * dpr * 0.5)))
      lens.uniforms.uRes.value.set(w * dpr, h * dpr)
    },
    render(dt) { composer.render(dt) },
  }
}
