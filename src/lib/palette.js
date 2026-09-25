import * as THREE from 'three'
// Obsidian / graphite / smoked glass / chrome / soft white, with electric blue + cyan accents.
// Violet exists but should be used almost never. Status colours are for "alive" signals only.
export const HEX = {
  obsidian: '#030507',
  void: '#05080c',
  graphite: '#15191f',
  graphiteLight: '#262c35',
  smoke: '#6b7684',
  chrome: '#c9d2dc',
  white: '#eaf0f6',
  blue: '#2d7dff',
  blueDeep: '#1447c4',
  cyan: '#62d8ff',
  ice: '#bfe9ff',
  violet: '#7d6bff',
  green: '#3ee6a1',
  amber: '#ffb547',
  red: '#ff4d5e',
}
export const COLOR = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new THREE.Color(v)]))
