// The narrative order of the experience. Each world lives in src/worlds/<id>/index.js and
// default-exports a class extending World (src/engine/World.js).
//
// Worlds sit on a wide spiral around the origin; the finale sits at the centre, so when the camera
// pulls back at the end the visitor sees every environment they travelled through arranged around one core.

export const WORLDS = [
  { id: 'hero', code: '00', title: 'BOOT', label: 'SYSTEM CORE', nav: 'ROHIT', load: () => import('./hero/index.js') },
  { id: 'voice', code: '01', title: 'VOICE AI', label: 'VOICE PROCESSING CHAMBER', nav: 'SYSTEMS', load: () => import('./voice/index.js') },
  { id: 'realtime', code: '02', title: 'REAL-TIME SYSTEMS', label: 'DISTRIBUTED NETWORK', load: () => import('./realtime/index.js') },
  { id: 'siren', code: '03', title: 'SIREN EYES', label: 'PERCEPTION · INTERSECTION 01', nav: 'PROJECTS', load: () => import('./siren/index.js') },
  { id: 'meetai', code: '04', title: 'MEETAI', label: 'MEETING INTELLIGENCE', load: () => import('./meetai/index.js') },
  { id: 'continuum', code: '05', title: 'CONTINUUM', label: 'VOICE MEMORY · STARFORGE 2026', load: () => import('./continuum/index.js') },
  { id: 'knowledge', code: '06', title: 'KNOWLEDGE NETWORK', label: 'SEMANTIC MEMORY', load: () => import('./knowledge/index.js') },
  { id: 'infra', code: '07', title: 'INFRASTRUCTURE', label: 'PRODUCTION LAYER', load: () => import('./infra/index.js') },
  { id: 'runbook', code: '08', title: 'COMMAND RUNBOOK', label: 'DEVELOPER TOOLING', load: () => import('./runbook/index.js') },
  { id: 'shieldx', code: '09', title: 'SHIELDX', label: 'SECURITY OPERATIONS', load: () => import('./shieldx/index.js') },
  { id: 'signals', code: '10', title: 'SIGNAL RECEIVED', label: 'ACHIEVEMENTS', load: () => import('./signals/index.js') },
  { id: 'experience', code: '11', title: 'PRODUCTION', label: 'EXPERIENCE', nav: 'EXPERIENCE', load: () => import('./experience/index.js') },
  { id: 'skills', code: '12', title: 'STACK', label: 'TECHNOLOGY CONSTELLATION', nav: 'STACK', load: () => import('./skills/index.js') },
  { id: 'finale', code: '13', title: 'COMPLETE SYSTEM', label: 'ROHIT SHARMA', nav: 'CONTACT', load: () => import('./finale/index.js') },
]

export const NAV = ['ROHIT', 'SYSTEMS', 'PROJECTS', 'EXPERIENCE', 'STACK', 'CONTACT']

/** World origin in scene space. Deterministic, so the finale can draw connections to each. */
export function worldOffset(i, n = WORLDS.length) {
  if (i === n - 1) return [0, 0, 0]
  const a = i * 0.6 + 0.3
  const r = 1500 + i * 55
  return [Math.sin(a) * r, Math.sin(i * 1.3) * 220, Math.cos(a) * r]
}
