import * as THREE from 'three'
import { rng } from '../../lib/math.js'

// Protocol kinds. The packet shader switches behaviour on these.
export const K = { WEBRTC: 0, WSS: 1, SIP: 2, PUBSUB: 3, PIPE: 4, BACKBONE: 5 }
export const KIND_NAME = ['WEBRTC', 'WSS', 'SIP', 'REDIS PUB/SUB', 'STREAM', 'BACKBONE']

const UP = new THREE.Vector3(0, 1, 0)
const TAU = Math.PI * 2

// Where a link attaches on each node type (height above the node origin, in node scale).
const PORT = { browser: 0.8, phone: 1.0, sip: 0.4, lb: 2.8, gw: 3.0, redis: 1.2, stt: 1.4, llm: 1.4, tts: 1.4 }

// Hover copy for the cursor readout: what each node is for in the system.
export const ROLE = {
  browser: ['EDGE · BROWSER', 'client · WebRTC / WSS'],
  phone: ['EDGE · MOBILE', 'client · WebRTC media'],
  sip: ['EDGE · SIP TRUNK', 'telephony · INVITE → 200 OK → media'],
  lb: ['LOAD BALANCER', 'routes sessions to FastAPI'],
  gw: ['FASTAPI', 'async gateway · WSS ⇄ Redis'],
  redis: ['REDIS PUB/SUB', 'session state · fan-out bus'],
  stt: ['STT WORKER', 'streaming speech-to-text'],
  llm: ['LLM WORKER', 'inference · tool calling'],
  tts: ['TTS WORKER', 'streaming speech synthesis'],
}

const PATTERN = ['browser', 'phone', 'browser', 'sip', 'phone', 'browser', 'sip', 'phone', 'browser', 'browser']

/**
 * Builds the distributed network: one primary cluster (region) at the origin plus two smaller
 * remote regions joined by backbone links. Every cluster has the same tiers:
 *   edge clients (r 100) → load balancers (r 74) → FastAPI gateways (r 54) → Redis hub (centre)
 *   → AI workers STT / LLM / TTS on an elevated ring (r 30, y 30).
 */
export function buildTopology(quality = 'high') {
  const R = rng(20251)
  const nodes = [], links = [], clusters = []

  const addLink = (a, b, kind, o = {}) => {
    const A = (o.A || a.port).clone(), B = (o.B || b.port).clone()
    const d = A.distanceTo(B)
    const C = o.C ? o.C.clone() : A.clone().add(B).multiplyScalar(0.5).addScaledVector(UP, d * (o.lift ?? 0.12))
    let len = 0
    const pv = A.clone(), q = new THREE.Vector3()
    for (let i = 1; i <= 24; i++) { bez(A, C, B, i / 24, q); len += q.distanceTo(pv); pv.copy(q) }
    const l = { id: links.length, a: a.id, b: b.id, kind, A, C, B, len, per: o.per ?? 1.8, off: o.off ?? R(), timer: o.timer ?? -1, cluster: a.cluster }
    links.push(l)
    return l
  }

  function cluster(ci, origin, S, yaw, perSector, region) {
    const cl = { ci, origin, S, yaw, region, lbs: [], gws: [], edges: [], stt: [], llm: [], tts: [], sectors: [] }
    const at = (ang, r, y) => new THREE.Vector3(origin.x + Math.sin(ang) * r * S, origin.y + y * S, origin.z + Math.cos(ang) * r * S)
    const count = { gw: 0, edge: 0 }
    const mk = (kind, pos, extra = {}) => {
      const n = { id: nodes.length, kind, pos, S, cluster: ci, yaw: Math.atan2(pos.x - origin.x, pos.z - origin.z), ...extra }
      n.port = pos.clone().addScaledVector(UP, PORT[kind] * S)
      nodes.push(n)
      return n
    }
    const redis = (cl.redis = mk('redis', at(0, 0, 15)))
    redis.yaw = yaw
    redis.name = ci === 0 ? 'redis-primary' : `redis-${region.split('-')[0]}`
    for (let s = 0; s < 3; s++) {
      const a = yaw + s * TAU / 3
      cl.sectors.push(a)
      const lb = mk('lb', at(a, 74, 4), { name: `lb-0${s + 1}` })
      const g1 = mk('gw', at(a - 0.26, 54, 8), { name: `gw-0${++count.gw}` })
      const g2 = mk('gw', at(a + 0.26, 54, 8), { name: `gw-0${++count.gw}` })
      cl.lbs.push(lb); cl.gws.push(g1, g2)
      for (let i = 0; i < perSector; i++) {
        const t = perSector > 1 ? i / (perSector - 1) - 0.5 : 0
        const ang = a + t * 1.55 + (R() - 0.5) * 0.05
        const r = 100 + (R() - 0.5) * 6 + (i % 2) * 7
        const kind = PATTERN[(i + s * 3) % PATTERN.length]
        const e = mk(kind, at(ang, r, (R() - 0.5) * 3), { name: `edge-${String(++count.edge).padStart(2, '0')}` })
        cl.edges.push(e)
        const proto = kind === 'sip' ? K.SIP : kind === 'phone' ? K.WEBRTC : (i % 3 === 0 ? K.WSS : K.WEBRTC)
        e.proto = proto
        e.link = addLink(e, lb, proto, { per: 5.5 + R() * 3.5, lift: 0.1 })
      }
      addLink(lb, g1, K.WSS, { lift: 0.08 })
      addLink(lb, g2, K.WSS, { lift: 0.08 })
      addLink(redis, g1, K.PUBSUB, { timer: 0, off: ci * 0.37, lift: 0.18 })
      addLink(redis, g2, K.PUBSUB, { timer: 0, off: ci * 0.37, lift: 0.18 })
    }
    const kinds = ['stt', 'llm', 'tts']
    for (let w = 0; w < 3; w++) {
      const ca = yaw + Math.PI / 3 + w * TAU / 3
      for (let j = 0; j < 3; j++) {
        const n = mk(kinds[w], at(ca + (j - 1) * 0.2, 30, 30), { name: `${kinds[w]}-0${j + 1}` })
        cl[kinds[w]].push(n)
        addLink(redis, n, K.PUBSUB, { timer: 0, off: ci * 0.37, lift: 0.05 })
      }
    }
    // STT → LLM → TTS token/audio streams run around the elevated ring.
    const ringPipe = (a, b) => {
      const A = a.pos.clone().addScaledVector(UP, 6.2 * S), B = b.pos.clone().addScaledVector(UP, 6.2 * S)
      const m = A.clone().add(B).multiplyScalar(0.5)
      const dir = new THREE.Vector3(m.x - origin.x, 0, m.z - origin.z).normalize()
      const C = new THREE.Vector3(origin.x, (A.y + B.y) / 2 + 3 * S, origin.z).addScaledVector(dir, 44 * S)
      return addLink(a, b, K.PIPE, { A, B, C })
    }
    for (let j = 0; j < 3; j++) { ringPipe(cl.stt[j], cl.llm[j]); ringPipe(cl.llm[j], cl.tts[j]) }
    // TTS audio returns to a gateway, which streams it back out to the edge.
    cl.ret = []
    for (let j = 0; j < 3; j++) cl.ret.push(addLink(cl.tts[j], cl.gws[j * 2], K.PIPE, { A: cl.tts[j].port, lift: 0.1 }))
    clusters.push(cl)
    return cl
  }

  const main = cluster(0, new THREE.Vector3(0, 0, 0), 1, 0, quality === 'low' ? 8 : 10, 'ap-south-1')
  const s1 = cluster(1, new THREE.Vector3(-178, -14, -92), 0.44, 0.9, 6, 'eu-west-1')
  const s2 = cluster(2, new THREE.Vector3(150, 26, -150), 0.44, -0.6, 6, 'us-east-1')
  for (const s of [s1, s2]) {
    const mid = main.redis.port.clone().add(s.redis.port).multiplyScalar(0.5).addScaledVector(UP, 70)
    addLink(main.redis, s.redis, K.BACKBONE, { C: mid })
    const g = main.gws[s === s1 ? 3 : 5], g2 = s.gws[0]
    addLink(g, g2, K.BACKBONE, { C: g.port.clone().add(g2.port).multiplyScalar(0.5).addScaledVector(UP, 40) })
  }

  // The request the camera follows: a SIP call from an edge trunk in sector 0 of the primary region.
  const client = main.edges.find((e) => e.kind === 'sip' && Math.abs(e.yaw + 0.26) < 0.3) || main.edges.find((e) => e.kind === 'sip')
  const lb = main.lbs[0]
  const d1 = main.gws[0].pos.distanceTo(client.pos), d2 = main.gws[1].pos.distanceTo(client.pos)
  const gw = d1 < d2 ? main.gws[0] : main.gws[1]
  const findLink = (a, b) => links.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id))
  // make sure TTS returns to the gateway we entered through
  const ret = main.ret[0]
  if (ret.b !== gw.id) { ret.b = gw.id; ret.B = gw.port.clone(); ret.C = ret.A.clone().add(ret.B).multiplyScalar(0.5).addScaledVector(UP, ret.A.distanceTo(ret.B) * 0.1) }
  const hops = [client, lb, gw, main.redis, main.stt[0], main.llm[0], main.tts[0], gw, lb, client]
  const routeLinks = []
  for (let i = 0; i < hops.length - 1; i++) {
    const l = findLink(hops[i], hops[i + 1])
    routeLinks.push({ link: l, rev: l.a !== hops[i].id })
  }

  return { nodes, links, clusters, main, route: { hops, links: routeLinks } }
}

export function bez(A, C, B, s, out) {
  const i = 1 - s
  return out.set(
    i * i * A.x + 2 * i * s * C.x + s * s * B.x,
    i * i * A.y + 2 * i * s * C.y + s * s * B.y,
    i * i * A.z + 2 * i * s * C.z + s * s * B.z,
  )
}
