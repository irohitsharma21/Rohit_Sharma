// Intersection layout (local units ≈ metres). Right-hand traffic.
//   N–S avenue along z, E–W street along x. North = −z.
//   Northbound (towards −z) uses x > 0, southbound x < 0, eastbound z > 0, westbound z < 0.
// The ambulance runs northbound in the inner lane (x = +1.75) and meets the main mast on the
// far-right (north-east) corner, which carries the camera, the stereo microphones and the controller.

export const ROAD = 7          // road half width
export const WALK = 11         // sidewalk outer edge
export const STOP = 12.2       // stop line distance from the centre
export const LANE = [1.75, 5.25]

export const MAST = { x: 9.5, z: -9.5, h: 6.2 }          // NE mast pole base
export const CAMERA = { x: 3.5, y: 6.62, z: -9.5 }       // traffic camera on the mast arm
export const MICS = { x: 9.5, y: 7.55, z: -9.5, half: 1.05 } // stereo pair on a crossbar (axis along x)
export const CABINET = { x: 11.7, z: -10.9, w: 1.0, h: 1.65, d: 0.62 }

export const AMB_X = LANE[0]

// Street lamps: along both roads, both sides, both directions.
export const LAMP_START = 18, LAMP_STEP = 26, LAMP_K = 7
export function lampList() {
  const out = []
  for (const s of [-1, 1]) for (const d of [-1, 1]) for (let k = 0; k < LAMP_K; k++) {
    const a = d * (LAMP_START + LAMP_STEP * k)
    out.push({ px: s * 9.2, pz: a, hx: s * 7.0, hz: a, rot: s > 0 ? 0 : Math.PI })            // along the avenue
    out.push({ px: a, pz: s * 9.2, hx: a, hz: s * 7.0, rot: s > 0 ? -Math.PI / 2 : Math.PI / 2 }) // along the street
  }
  return out
}

// Signal heads: two per approach (one over each lane), on the far-side corner pole.
// face = direction the lamps face (towards oncoming traffic). axis = which phase controls it.
export const HEADS = [
  { x: 1.75, z: -9.5, face: [0, 1], axis: 'NS' }, { x: 5.25, z: -9.5, face: [0, 1], axis: 'NS' },     // northbound (main mast)
  { x: -1.75, z: 9.5, face: [0, -1], axis: 'NS' }, { x: -5.25, z: 9.5, face: [0, -1], axis: 'NS' },   // southbound
  { x: 9.5, z: 1.75, face: [-1, 0], axis: 'EW' }, { x: 9.5, z: 5.25, face: [-1, 0], axis: 'EW' },     // eastbound
  { x: -9.5, z: -1.75, face: [1, 0], axis: 'EW' }, { x: -9.5, z: -5.25, face: [1, 0], axis: 'EW' },   // westbound
]
export const POLES = [
  { x: 9.5, z: -9.5, arm: [-1, 0], len: 8.9 },   // NE (main mast)
  { x: -9.5, z: 9.5, arm: [1, 0], len: 8.9 },    // SW
  { x: 9.5, z: 9.5, arm: [0, -1], len: 8.9 },    // SE
  { x: -9.5, z: -9.5, arm: [0, 1], len: 8.9 },   // NW
]
export const HEAD_Y = 5.35
