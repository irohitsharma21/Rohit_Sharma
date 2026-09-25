import * as THREE from 'three'

/**
 * A World is one physical environment in the single continuous scene.
 *
 * The engine places `this.group` at the world's offset in space, owns the camera, and drives
 * everything from scroll. A world only has to:
 *   - build its 3D content into `this.group` in init()           (local coordinates, keep within ~250 units of origin)
 *   - build its DOM overlay in mount(el)                         (el is a full-viewport sticky layer)
 *   - describe the camera path in cameraAt(p, out)               (local coordinates, p = 0..1 scroll progress)
 *   - animate in update(p, dt, t)                                (only called while visible)
 *
 * Scroll length of the world is `static height` in viewport heights (vh units, e.g. 400 = 4 screens).
 * Transitions between worlds are handled by the engine: it flies the camera from the previous world's
 * cameraAt(1) to this world's cameraAt(0) with a warp effect, so make those two poses read well.
 */
export class World {
  static height = 300

  constructor(ctx, meta) {
    this.ctx = ctx
    this.meta = meta
    this.group = new THREE.Group()
    this.group.name = meta.id
    this.el = null
    this.p = 0
    this.active = false
    /** Scene fog density while this world is on screen (FogExp2). Lower = see further. */
    this.fog = 0.0045
    /** Bloom strength while this world is on screen. */
    this.bloom = 0.85
    /** Exposure while this world is on screen. */
    this.exposure = 1.0
  }

  async init() {}
  mount(_el) {}
  cameraAt(_p, out) { out.pos.set(0, 0, 60); out.target.set(0, 0, 0); out.fov = 42 }
  update(_p, _dt, _t) {}
  onEnter() {}
  onLeave() {}
  dispose() {}

  // ---- helpers available to every world ----

  /** Pointer ray transformed into this world's local space (for raycasting / proximity effects). */
  localRay(target = new THREE.Ray()) {
    this._inv ??= new THREE.Matrix4()
    this._inv.copy(this.group.matrixWorld).invert()
    return target.copy(this.ctx.pointer.ray).applyMatrix4(this._inv)
  }

  /** Intersect the pointer ray with a local-space plane. Returns Vector3 or null. */
  pointerOnPlane(plane, target = new THREE.Vector3()) {
    this._ray ??= new THREE.Ray()
    return this.localRay(this._ray).intersectPlane(plane, target)
  }

  /** Raycast pointer against objects (world space), returns intersections. */
  pick(objects, recursive = false) {
    this._rc ??= new THREE.Raycaster()
    this._rc.ray.copy(this.ctx.pointer.ray)
    return this._rc.intersectObjects(objects, recursive)
  }

  /** Camera position in this world's local space. */
  localCamera(target = new THREE.Vector3()) {
    return this.group.worldToLocal(target.copy(this.ctx.camera.position))
  }

  /** Query inside this world's overlay. */
  $(sel) { return this.el?.querySelector(sel) }
  $$(sel) { return this.el ? [...this.el.querySelectorAll(sel)] : [] }
}
