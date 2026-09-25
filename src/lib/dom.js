/**
 * Scroll-driven reveal for overlay elements: v = 0 hidden, 1 fully shown.
 * Keeps work minimal: only touches styles when the value actually changes.
 */
export function reveal(el, v, dist = 14) {
  if (!el) return
  v = Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
  if (el._rv === v) return
  el._rv = v
  el.style.opacity = v
  el.style.transform = v >= 1 ? '' : `translate3d(0, ${((1 - v) * dist).toFixed(2)}px, 0)`
  el.style.visibility = v <= 0 ? 'hidden' : 'visible'
}

/** Tiny HTML builders for the shared overlay vocabulary (styles live in styles/base.css). */
export const readout = (k, v, n = '') => `<div class="ro"><span class="ro-k">${k}</span><span class="ro-v">${v}</span>${n ? `<span class="ro-n">${n}</span>` : ''}</div>`
export const tag = (t) => `<span class="tag">${t}</span>`
export const linkChip = (label, href) => `<a class="link-chip" href="${href}" target="_blank" rel="noopener" data-magnetic><span>${label}</span><i aria-hidden="true">↗</i></a>`
