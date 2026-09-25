// Layout of the knowledge network: topic clusters ("galaxies") of chunk points, a few hundred concept hubs,
// and a sparse fibre graph between hubs. Pure data, deterministic (seeded), built once at init.
import { rng } from '../../lib/math.js'

// Twelve named concepts (every term appears in content.js). Related concepts sit near each other,
// so the space reads like an embedding space: retrieval on +x, agents on -x, training below/behind.
export const CONCEPTS = [
  { name: 'LLMs', c: [0, 0, 0], w: 0.75, s: 8, tint: [0.85, 0.92, 1.0] },
  { name: 'Prompt Engineering', c: [-26, 40, 28], w: 0.8, s: 16, tint: [0.8, 0.88, 1.0] },
  { name: 'RAG', c: [46, 12, 20], w: 1.0, s: 18, tint: [0.62, 0.86, 1.0] },
  { name: 'Embeddings', c: [94, -30, -24], w: 1.25, s: 24, tint: [0.6, 0.84, 1.0] },
  { name: 'Semantic Search', c: [80, 42, 52], w: 1.05, s: 20, tint: [0.64, 0.9, 1.0] },
  { name: 'Qdrant', c: [124, 8, 4], w: 0.9, s: 17, tint: [0.56, 0.82, 1.0] },
  { name: 'Agents', c: [-54, -20, 36], w: 1.0, s: 19, tint: [0.62, 0.72, 1.0] },
  { name: 'Tool Calling', c: [-88, 30, -14], w: 0.95, s: 19, tint: [0.6, 0.7, 1.0] },
  { name: 'MCP', c: [-114, -18, 30], w: 0.75, s: 16, tint: [0.58, 0.7, 1.0] },
  { name: 'LangChain', c: [-66, -44, -44], w: 0.9, s: 19, tint: [0.66, 0.74, 1.0] },
  { name: 'Fine-Tuning', c: [-6, -42, -80], w: 1.0, s: 21, tint: [0.82, 0.86, 0.95] },
  { name: 'LoRA/PEFT', c: [42, -18, -110], w: 0.85, s: 18, tint: [0.8, 0.84, 0.94] },
]

// Semantic relations between concepts (drawn as long fibres between the named hubs).
const RELATIONS = [
  ['LLMs', 'RAG'], ['LLMs', 'Prompt Engineering'], ['LLMs', 'Agents'], ['LLMs', 'Fine-Tuning'], ['LLMs', 'Tool Calling'],
  ['RAG', 'Embeddings'], ['RAG', 'Semantic Search'], ['RAG', 'Qdrant'], ['Embeddings', 'Qdrant'], ['Semantic Search', 'Qdrant'],
  ['Embeddings', 'Semantic Search'], ['Agents', 'Tool Calling'], ['Tool Calling', 'MCP'], ['Agents', 'LangChain'], ['LangChain', 'RAG'],
  ['Fine-Tuning', 'LoRA/PEFT'], ['Prompt Engineering', 'Agents'], ['Agents', 'MCP'], ['LangChain', 'Tool Calling'],
]

function gauss(r) { // Box-Muller
  const u = Math.max(1e-6, r()), v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const dist = (a, b) => len(sub(a, b))
function randDir(r) { const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, z, Math.sin(a) * s] }
function bez(p0, p1, p2, t) { const u = 1 - t; return add(add(mul(p0, u * u), mul(p1, 2 * u * t)), mul(p2, t * t)) }

export function buildGraph({ chunks = 9000, hubs = 300 } = {}) {
  const r = rng(505)
  const W = CONCEPTS.reduce((s, c) => s + c.w, 0)

  // ---- hubs: each concept gets a manifold (a bent filament) and sub-hubs along it
  const hubPos = [] // [x,y,z]
  const hubCluster = []
  const hubName = []
  const clusterHubs = CONCEPTS.map(() => [])
  const curves = []
  CONCEPTS.forEach((C, ci) => {
    const n = Math.max(6, Math.round((hubs - CONCEPTS.length) * C.w / W))
    const d = norm(randDir(r))
    const p0 = add(C.c, mul(d, -C.s * 1.3)), p2 = add(add(C.c, mul(d, C.s * 1.3)), mul(randDir(r), C.s * 0.7))
    const p1 = add(C.c, mul(randDir(r), C.s * 0.5))
    curves.push([p0, p1, p2])
    // named hub sits at the concept centre
    clusterHubs[ci].push(hubPos.length)
    hubPos.push(C.c.slice()); hubCluster.push(ci); hubName.push(C.name)
    for (let i = 0; i < n; i++) {
      const t = r()
      let p = bez(p0, p1, p2, t)
      const sp = ci === 0 ? C.s * 0.9 : C.s * 0.32
      p = add(p, [gauss(r) * sp, gauss(r) * sp * 0.7, gauss(r) * sp])
      clusterHubs[ci].push(hubPos.length)
      hubPos.push(p); hubCluster.push(ci); hubName.push(null)
    }
  })
  const H = hubPos.length

  // ---- edges: MST inside each cluster + extra nearest links + relations + a few cross-cluster links
  const edgeSet = new Set()
  const edges = []
  const addEdge = (a, b, kind = 0) => {
    if (a === b) return
    const k = a < b ? a * 4096 + b : b * 4096 + a
    if (edgeSet.has(k)) return
    edgeSet.add(k); edges.push([a, b, kind])
  }
  clusterHubs.forEach((ids) => {
    // Prim's MST
    const inT = new Set([ids[0]])
    while (inT.size < ids.length) {
      let best = null, bd = Infinity
      for (const a of inT) for (const b of ids) {
        if (inT.has(b)) continue
        const dd = dist(hubPos[a], hubPos[b])
        if (dd < bd) { bd = dd; best = [a, b] }
      }
      inT.add(best[1]); addEdge(best[0], best[1])
    }
    // extra local links (make it a web, not a tree)
    for (const a of ids) {
      if (r() > 0.45) continue
      let best = -1, bd = Infinity
      for (const b of ids) {
        if (b === a || edgeSet.has(a < b ? a * 4096 + b : b * 4096 + a)) continue
        const dd = dist(hubPos[a], hubPos[b])
        if (dd < bd) { bd = dd; best = b }
      }
      if (best >= 0) addEdge(a, best)
    }
    // a few spokes to the named hub
    for (const a of ids) if (a !== ids[0] && r() < 0.12) addEdge(ids[0], a)
  })
  const byName = Object.fromEntries(CONCEPTS.map((c, i) => [c.name, clusterHubs[i][0]]))
  RELATIONS.forEach(([a, b]) => addEdge(byName[a], byName[b], 1))
  // cross-cluster: nearest sub-hub pairs between related clusters
  RELATIONS.forEach(([an, bn]) => {
    const A = clusterHubs[CONCEPTS.findIndex((c) => c.name === an)], B = clusterHubs[CONCEPTS.findIndex((c) => c.name === bn)]
    const pairs = []
    for (const a of A) for (const b of B) pairs.push([dist(hubPos[a], hubPos[b]), a, b])
    pairs.sort((x, y) => x[0] - y[0])
    addEdge(pairs[0][1], pairs[0][2], 2)
    if (pairs[3] && r() < 0.6) addEdge(pairs[3][1], pairs[3][2], 2)
  })
  const adj = Array.from({ length: H }, () => [])
  edges.forEach(([a, b]) => {
    const w = 0.35 + dist(hubPos[a], hubPos[b]) / 14
    adj[a].push([b, w]); adj[b].push([a, w])
  })

  // ---- chunks: gaussian blobs around sub-hubs, filaments along the manifolds, and a sparse loose field
  const cPos = new Float32Array(chunks * 3)
  const cHub = new Float32Array(chunks)
  const cCluster = new Uint8Array(chunks)
  const nearestHub = (p) => { let b = 0, bd = Infinity; for (let h = 0; h < H; h++) { const dd = dist(p, hubPos[h]); if (dd < bd) { bd = dd; b = h } } return b }
  const nearestInCluster = (p, ci) => { let b = clusterHubs[ci][0], bd = Infinity; for (const h of clusterHubs[ci]) { const dd = dist(p, hubPos[h]); if (dd < bd) { bd = dd; b = h } } return b }
  for (let i = 0; i < chunks; i++) {
    const kind = r()
    let p, hub, ci
    if (kind < 0.08) { // loose field (the long tail of the corpus)
      const d = randDir(r); const rr = 40 + Math.pow(r(), 0.7) * 150
      p = [d[0] * rr * 1.1, d[1] * rr * 0.45, d[2] * rr * 0.9]
      hub = nearestHub(p); ci = hubCluster[hub]
    } else if (kind < 0.3) { // filament along the concept manifold
      ci = pickCluster(r, W)
      const [p0, p1, p2] = curves[ci]; const C = CONCEPTS[ci]
      p = bez(p0, p1, p2, r())
      const sp = C.s * 0.2
      p = add(p, [gauss(r) * sp, gauss(r) * sp, gauss(r) * sp])
      hub = nearestInCluster(p, ci)
    } else { // blob around a hub (a document's chunks)
      ci = pickCluster(r, W)
      const ids = clusterHubs[ci]
      hub = ids[Math.floor(Math.pow(r(), 1.3) * ids.length)]
      const s = (ci === 0 ? 1.5 : 1.8 + r() * 3.6)
      const ax = norm(randDir(r)), st = 1 + r() * 1.6
      const g = [gauss(r) * s, gauss(r) * s, gauss(r) * s]
      const along = gauss(r) * s * st
      p = add(add(hubPos[hub], g), mul(ax, along))
    }
    cPos[i * 3] = p[0]; cPos[i * 3 + 1] = p[1]; cPos[i * 3 + 2] = p[2]
    cHub[i] = hub; cCluster[i] = ci
  }

  return { hubPos, hubCluster, hubName, clusterHubs, edges, adj, H, byName, cPos, cHub, cCluster, N: chunks }

  function pickCluster(r, W) {
    let x = r() * W
    for (let i = 0; i < CONCEPTS.length; i++) { x -= CONCEPTS[i].w; if (x <= 0) return i }
    return CONCEPTS.length - 1
  }
}

/** Weighted shortest-path distance (in "hops") from `src` to every hub. O(H^2) Dijkstra: H is a few hundred. */
export function hopField(g, src, out) {
  const H = g.H
  const done = new Uint8Array(H)
  out.fill(1e4)
  out[src] = 0
  for (let it = 0; it < H; it++) {
    let u = -1, bd = 1e9
    for (let i = 0; i < H; i++) if (!done[i] && out[i] < bd) { bd = out[i]; u = i }
    if (u < 0) break
    done[u] = 1
    for (const [v, w] of g.adj[u]) if (out[u] + w < out[v]) out[v] = out[u] + w
  }
  return out
}
