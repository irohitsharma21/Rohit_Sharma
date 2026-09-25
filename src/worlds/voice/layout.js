// The pipeline runs along +x through the chamber. All stage geometry and signal shaders share these numbers.
export const FLOOR_Y = -14
export const X = {
  inStart: -236,   // raw speech enters out of the fog
  speech: -120,    // intake aperture
  stt0: -84, stt1: -76,          // shredder blade stack
  llm0: -52, llmDX: 6.2, layers: 8, // lattice layers (x of layer l = llm0 + l*llmDX)
  toolBed: 2,      // left edge of the JSON packet bed
  port0: 20, port1: 32, // docking port
  tts: 41,         // resonator column
  lane0: 43, lane1: 108, // 30 parallel lanes
  resp: 112,       // exit aperture
  outEnd: 236,
}
export const LANES = 30
export const LLM_N = 7        // nodes per side per layer
export const LLM_H = 7        // half-extent of a layer (y,z)
