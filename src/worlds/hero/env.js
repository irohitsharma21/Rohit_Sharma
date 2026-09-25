import * as THREE from 'three'
import { Label } from '../../lib/label.js'
import { HEX } from '../../lib/palette.js'
import { rng } from '../../lib/math.js'

// The void around the core: a faint infrastructure grid far below, a pipeline diagram etched
// into it, holographic coordinates, and small fragments of code drifting past.

const FLOOR_Y = -42

export function createGrid() {
  const arr = [], w = []
  const E = 420, S = 12
  for (let x = -E; x <= E; x += S) {
    const M = x % (S * 5) === 0 ? 1 : 0
    arr.push(x, 0, -E, x, 0, E, -E, 0, x, E, 0, x); w.push(M, M, M, M)
  }
  // concentric range rings under the core
  for (const R of [30, 60, 120]) {
    const n = 160
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2
      arr.push(Math.cos(a0) * R, 0, Math.sin(a0) * R, Math.cos(a1) * R, 0, Math.sin(a1) * R); w.push(1, 1)
      if (i % 4 === 0) { const c = Math.cos(a0), s = Math.sin(a0); arr.push(c * R, 0, s * R, c * (R - 1.6), 0, s * (R - 1.6)); w.push(1, 1) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  g.setAttribute('aM', new THREE.Float32BufferAttribute(w, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uO: { value: 1 } },
    vertexShader: /* glsl */`attribute float aM; varying float vM; varying float vD; varying vec3 vP;
      void main(){ vM = aM; vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`uniform float uO; varying float vM; varying float vD; varying vec3 vP;
      void main(){
        float fade = exp(-vD*0.0075) * smoothstep(420.0, 120.0, length(vP.xz));
        gl_FragColor = vec4(vec3(0.42,0.6,0.9) * (0.05 + vM*0.08) * fade * uO, 1.0);
      }`,
  })
  const lines = new THREE.LineSegments(g, m)
  lines.position.y = FLOOR_Y
  lines.frustumCulled = false
  return lines
}

/** The pipeline this core runs, drawn on the floor like a schematic: AUDIO IN → STT → LLM · TOOLS → TTS → AUDIO OUT. */
export function createDiagram() {
  const grp = new THREE.Group()
  grp.position.set(30, FLOOR_Y + 0.05, -140)
  const names = ['AUDIO IN', 'STT', 'LLM · TOOLS', 'TTS', 'AUDIO OUT']
  const arr = []
  const W = 15, D = 6, gap = 22
  names.forEach((n, i) => {
    const cx = (i - 2) * gap
    const x0 = cx - W / 2, x1 = cx + W / 2, z0 = -D / 2, z1 = D / 2
    arr.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0)
    // corner brackets slightly outside
    if (i < names.length - 1) arr.push(x1, 0, 0, x1 + gap - W, 0, 0)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(0.7), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
  grp.add(new THREE.LineSegments(g, m))
  // a packet running the pipeline
  const pk = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), new THREE.MeshBasicMaterial({ color: new THREE.Color(HEX.cyan).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  pk.rotation.x = -Math.PI / 2
  pk.position.y = 0.05
  grp.add(pk)
  grp.userData.packet = pk
  grp.userData.span = [-2 * gap - W / 2, 2 * gap + W / 2]
  return grp
}

const CODE = [
  'ws.send(pcm16_frame)',
  'async for chunk in stt.stream(audio):',
  'reply = await llm.generate(ctx, tools)',
  'tts.synthesize(text, prosody=style)',
  'await tools.call(intent, args)',
  'yield audio_chunk  # 20 ms',
  'if ttfb_ms < 300: stream()',
  'POST /v1/agent/session',
]

export function createCode() {
  const r = rng(5)
  return CODE.map((c, i) => {
    const l = new Label(c, { height: 0.5, color: i % 3 === 0 ? HEX.cyan : HEX.chrome, tracking: 0.04, opacity: 0.0 })
    const a = (i / CODE.length) * Math.PI * 2 + r() * 0.5
    const R = 24 + r() * 20
    l.userData = { base: new THREE.Vector3(Math.cos(a) * R * 1.25, (r() * 2 - 1) * 16, Math.sin(a) * R * 0.6 - 6), sp: 0.25 + r() * 0.35, ph: r() * 40, o: 0.22 + r() * 0.16 }
    return l
  })
}

/** Holographic crosshair + coordinate readout that tracks the pointer on the core plane. */
export function createCrosshair() {
  const grp = new THREE.Group()
  const s = 1.5, gp = 0.45
  const arr = [-s, 0, 0, -gp, 0, 0, gp, 0, 0, s, 0, 0, 0, -s, 0, 0, -gp, 0, 0, gp, 0, 0, s, 0]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(HEX.ice).multiplyScalar(1.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  grp.add(new THREE.LineSegments(g, m))
  const label = new Label('X 0.000  Y 0.000', { height: 0.62, color: HEX.ice, tracking: 0.1, opacity: 0 })
  label.position.set(1.8, 0.9, 0)
  grp.add(label)
  return { group: grp, mat: m, label }
}
