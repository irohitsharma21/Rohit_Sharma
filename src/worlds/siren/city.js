import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../../lib/math.js'
import { smat, HASH, FOGF } from './shaders.js'
import { ROAD, WALK, STOP, LAMP_START, LAMP_STEP, LAMP_K, lampList, POLES, HEADS, HEAD_Y, MAST, CAMERA, MICS, CABINET } from './layout.js'

const CYAN = /* glsl */ `vec3(0.30, 0.78, 1.0)`

// ---------------------------------------------------------------- ground
// One plane carries the whole street surface: wet asphalt, markings, sidewalks, lamp pools, the
// ambulance's beacon spill and headlight throw, and the perception overlays that the system projects
// onto the street (siren wavefronts, the direction-of-arrival fan, the preemption corridor, the map grid).
export function buildGround() {
  const g = new THREE.PlaneGeometry(520, 520, 1, 1)
  g.rotateX(-Math.PI / 2)
  const m = smat({
    uniforms: {
      uTime: { value: 0 }, uMap: { value: 0 }, uFan: { value: 0 }, uBearing: { value: 0 }, uFanR: { value: 30 },
      uRing: { value: 0 }, uCorr: { value: 0 }, uAmb: { value: new THREE.Vector2(1.75, 200) },
      uBeacon: { value: new THREE.Vector2() }, uPole: { value: new THREE.Vector2(MAST.x, MAST.z) },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec3 vP;
      void main(){
        vP = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform float uTime, uMap, uFan, uBearing, uFanR, uRing, uCorr;
      uniform vec2 uAmb, uBeacon, uPole;
      varying vec3 vP;
      ${HASH}
      ${FOGF}
      float lm(float d, float w){ float aa = fwidth(d); return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
      float pool(vec2 p, vec2 c, float r){ vec2 d = p - c; return exp(-dot(d, d) / (r*r)); }
      void main(){
        vec2 p = vP.xz;
        float ax = abs(p.x), az = abs(p.y);
        float rNS = step(ax, ${ROAD.toFixed(1)}), rEW = step(az, ${ROAD.toFixed(1)});
        float road = max(rNS, rEW);
        float walk = (1.0 - road) * step(min(ax, az), ${WALK.toFixed(1)});
        float grain = h21(floor(p*7.0));
        float wet = wetMask(p);

        vec3 asphalt = vec3(0.0085, 0.010, 0.013) * (0.8 + 0.4*grain) * mix(1.0, 0.5, wet);
        vec2 tile = abs(fract(p/1.8) - 0.5);
        vec3 concrete = vec3(0.020, 0.023, 0.028) * (0.85 + 0.3*grain) * (1.0 - 0.4*smoothstep(0.46, 0.5, max(tile.x, tile.y)));
        vec3 lot = vec3(0.007, 0.008, 0.010) * (0.8 + 0.4*grain);
        vec3 col = road > 0.5 ? asphalt : (walk > 0.5 ? concrete : lot);

        // ---- markings
        float mk = 0.0;
        float dashNS = step(0.45, fract(p.y/7.0)), dashEW = step(0.45, fract(p.x/7.0));
        if (rNS > 0.5 && az > ${STOP.toFixed(1)}) {
          mk += lm(p.x - 0.16, 0.06) + lm(p.x + 0.16, 0.06);
          mk += lm(ax - 3.5, 0.07) * dashNS;
          mk += lm(ax - 6.65, 0.08);
        }
        if (rEW > 0.5 && ax > ${STOP.toFixed(1)}) {
          mk += lm(p.y - 0.16, 0.06) + lm(p.y + 0.16, 0.06);
          mk += lm(az - 3.5, 0.07) * dashEW;
          mk += lm(az - 6.65, 0.08);
        }
        // stop lines (on the approach half of each road)
        mk += lm(p.y - ${STOP.toFixed(1)}, 0.22) * step(0.0, p.x) * step(p.x, 6.8);
        mk += lm(p.y + ${STOP.toFixed(1)}, 0.22) * step(p.x, 0.0) * step(-6.8, p.x);
        mk += lm(p.x + ${STOP.toFixed(1)}, 0.22) * step(0.0, p.y) * step(p.y, 6.8);
        mk += lm(p.x - ${STOP.toFixed(1)}, 0.22) * step(p.y, 0.0) * step(-6.8, p.y);
        // zebra crossings
        if (rNS > 0.5 && az > 8.0 && az < 11.2 && ax < 6.5) mk += step(0.5, fract(p.x/1.15 + 0.25));
        if (rEW > 0.5 && ax > 8.0 && ax < 11.2 && az < 6.5) mk += step(0.5, fract(p.y/1.15 + 0.25));
        mk = clamp(mk, 0.0, 1.0) * road * (0.75 + 0.25*h21(floor(p*3.0)));
        col = mix(col, vec3(0.13, 0.14, 0.15) * mix(1.0, 0.55, wet), mk);

        // curbs
        float dc = min(az > ${ROAD.toFixed(1)} ? abs(ax - ${ROAD.toFixed(1)}) : 1e3, ax > ${ROAD.toFixed(1)} ? abs(az - ${ROAD.toFixed(1)}) : 1e3);
        col += vec3(0.035, 0.04, 0.047) * lm(dc, 0.1);

        // ---- street lamps (analytic: the same regular pattern the poles are placed on)
        float kz = clamp(floor((az - ${LAMP_START.toFixed(1)}) / ${LAMP_STEP.toFixed(1)} + 0.5), 0.0, ${(LAMP_K - 1).toFixed(1)});
        float kx = clamp(floor((ax - ${LAMP_START.toFixed(1)}) / ${LAMP_STEP.toFixed(1)} + 0.5), 0.0, ${(LAMP_K - 1).toFixed(1)});
        float lz = sign(p.y) * (${LAMP_START.toFixed(1)} + ${LAMP_STEP.toFixed(1)}*kz);
        float lx = sign(p.x) * (${LAMP_START.toFixed(1)} + ${LAMP_STEP.toFixed(1)}*kx);
        float L = pool(p, vec2(sign(p.x)*7.0, lz), 6.5) * step(${(LAMP_START - 10).toFixed(1)}, az)
                + pool(p, vec2(lx, sign(p.y)*7.0), 6.5) * step(${(LAMP_START - 10).toFixed(1)}, ax);
        vec3 lampC = vec3(0.55, 0.68, 0.85);
        col += L * lampC * (0.045 + 0.55*mk) * mix(1.0, 0.45, wet);
        // faint sky / city glow so the far avenue has form
        col += vec3(0.003, 0.004, 0.006) * road;

        // ---- ambulance: beacon spill + headlight throw
        vec2 da = p - uAmb;
        float bs = exp(-dot(da, da) / 42.0);
        col += bs * (vec3(1.0, 0.05, 0.06)*uBeacon.x + vec3(0.1, 0.25, 1.0)*uBeacon.y) * (0.10 + 0.25*wet);
        float ahead = uAmb.y - 3.2 - p.y;
        float ah = max(ahead, 0.0); float bx = p.x - uAmb.x;
        float beam = smoothstep(0.0, 2.0, ahead) * exp(-ah/16.0) * exp(-bx*bx / (1.2 + ah*0.22));
        col += beam * vec3(0.55, 0.6, 0.66) * (0.12 + 0.5*mk);

        vec3 cy = ${CYAN};
        vec3 fx = vec3(0.0);
        // ---- siren wavefronts spreading from the ambulance towards the microphones
        if (uRing > 0.001) {
          float d = length(da);
          float r = mod(d - uTime*22.0, 9.0);
          float front = exp(-r*4.0) * smoothstep(9.0, 8.7, r);
          fx += vec3(0.55, 0.80, 1.0) * front * exp(-d/48.0) * smoothstep(2.0, 5.0, d) * uRing * 0.35;
        }
        // ---- direction of arrival: polar fan on the street from the mast, 5° grid, fused lobe + beam
        if (uFan > 0.001) {
          vec2 v = p - uPole;
          float r = length(v);
          float ang = degrees(atan(v.x, v.y));
          float inSector = step(abs(ang), 62.0) * smoothstep(3.6, 4.2, r) * (1.0 - smoothstep(uFanR, uFanR + 4.0, r));
          float arcW = fwidth(r)*1.2;
          float rings = 0.0;
          for (int i = 1; i <= 6; i++) { float rr = 5.0*float(i); rings += 1.0 - smoothstep(0.0, 0.035 + arcW, abs(r - rr)); }
          float tk = abs(fract(ang/5.0 + 0.5) - 0.5)*5.0;           // degrees to nearest 5° tick
          float major = step(abs(fract(ang/15.0 + 0.5) - 0.5)*15.0, 0.6);
          float ticks = (1.0 - smoothstep(0.0, 0.05 + fwidth(ang*0.0174*r), radians(tk)*r)) * step(4.2, r) * step(r, 4.9 + major*1.2);
          float db = ang - uBearing;
          float e1 = db/13.0, e2 = (db + 3.0)/21.0; float itd = exp(-e1*e1), ild = exp(-e2*e2);
          float lobe = itd*ild;                                        // product of the two estimates
          float beamD = abs(radians(db))*r;
          float beamL = (1.0 - smoothstep(0.0, 0.06 + fwidth(beamD)*1.2, beamD)) * step(4.2, r) * (1.0 - smoothstep(uFanR - 4.0, uFanR + 2.0, r));
          float edge = (1.0 - smoothstep(0.0, 0.05 + fwidth(ang)*0.02*r, abs(abs(ang) - 62.0)*0.0174*r)) * step(4.2, r) * step(r, 30.0);
          fx += cy * inSector * (rings*0.06 + ticks*0.45 + itd*0.012 + ild*0.006 + lobe*0.09 + edge*0.08) * (1.0 - smoothstep(22.0, 46.0, r)) * uFan;
          fx += cy * beamL * 0.9 * uFan;
        }
        // ---- preemption corridor: the ambulance's lane lights up ahead of it
        if (uCorr > 0.001) {
          float inLane = step(0.05, p.x) * step(p.x, 3.45);
          float ahead2 = uAmb.y - p.y;
          float span = smoothstep(-2.0, 2.0, ahead2) * (1.0 - smoothstep(60.0, 90.0, ahead2));
          float edges = lm(p.x - 0.12, 0.05) + lm(p.x - 3.38, 0.05);
          float chev = step(0.72, fract((p.y + uTime*9.0)/3.2 - abs(p.x - 1.75)*0.22));
          fx += cy * span * (edges*0.55 + chev*inLane*0.10 + inLane*0.025) * uCorr;
        }
        // ---- perception map: the street as the system models it
        if (uMap > 0.001) {
          vec2 g = abs(fract(p/5.0 - 0.5) - 0.5)*5.0;
          vec2 fw = fwidth(p);
          float minor = 1.0 - smoothstep(0.0, max(fw.x, fw.y)*1.2, min(g.x, g.y));
          vec2 g2 = abs(fract(p/25.0 - 0.5) - 0.5)*25.0;
          float majorG = 1.0 - smoothstep(0.0, max(fw.x, fw.y)*1.6, min(g2.x, g2.y));
          col *= 1.0 - uMap*0.35;
          fx += cy * (minor*0.035 + majorG*0.09 + lm(dc, 0.08)*0.3 + mk*0.06) * uMap;
        }
        float f = fogF();
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        gl_FragColor.rgb += fx * (1.0 - f);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.renderOrder = -2
  return mesh
}

// ---------------------------------------------------------------- reflections
// Wet-asphalt reflections: each light source gets an elongated streak on the street, placed at the
// mirror point between the light and the camera and stretched toward the viewer. Static lamps plus
// dynamic car lights, signal lamps and the ambulance's beacons share one instanced draw.
export function buildStreaks(max) {
  const base = new THREE.PlaneGeometry(2, 1, 1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.attributes.position)
  g.setAttribute('uv', base.attributes.uv)
  const aL = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4)
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
  aL.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('aL', aL); g.setAttribute('aC', aC)
  g.instanceCount = 0
  const m = smat({
    uniforms: { uCam: { value: new THREE.Vector3(0, 10, 0) }, uWet: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec4 aL; attribute vec3 aC;
      uniform vec3 uCam;
      varying vec2 vUv; varying vec3 vC; varying vec2 vXZ;
      void main(){
        vec2 L = aL.xz; float h = max(aL.y, 0.2);
        vec2 d = uCam.xz - L; float dist = max(length(d), 0.001); vec2 dir = d / dist; vec2 perp = vec2(-dir.y, dir.x);
        float H = max(uCam.y, 0.5);
        float c = dist * h / (H + h);                  // mirror point
        float graze = clamp(dist / H, 0.35, 9.0);
        float len = h * (0.5 + graze*0.9) + 0.6;
        float w = aL.w * (0.7 + dist*0.004);
        float along = mix(-len*0.22, len, uv.y);
        vec2 P = L + dir*(c + along) + perp*(position.x*w);
        vUv = vec2(position.x, uv.y); vC = aC; vXZ = P;
        vec4 mvPosition = modelViewMatrix * vec4(P.x, 0.035, P.y, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      varying vec2 vUv; varying vec3 vC; varying vec2 vXZ;
      uniform float uWet;
      ${HASH}
      ${FOGF}
      void main(){
        float across = exp(-vUv.x*vUv.x*4.0);
        float v = vUv.y;
        float along = smoothstep(0.0, 0.2, v) * (1.0 - smoothstep(0.25, 1.0, v));
        if (across * along < 0.01) discard;   // quad corners: skip the noise lookups
        float wet = wetMask(vXZ);
        float ripple = 0.75 + 0.25*vnoise(vXZ*vec2(2.2, 0.6));
        float a = across * along * (0.25 + 0.75*wet) * ripple * uWet;
        gl_FragColor = vec4(vC * a * (1.0 - fogF()), 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return { mesh, aL, aC, max, set(i, x, h, z, w, r, gg, b) { aL.setXYZW(i, x, h, z, w); aC.setXYZ(i, r, gg, b) } }
}

// ---------------------------------------------------------------- buildings
// Dark glass / graphite blocks with sparse cool window lights. One instanced draw.
export function buildBuildings(quality) {
  const R = rng(3031)
  const mats = []
  const seeds = []
  const tmp = new THREE.Matrix4()
  const add = (cx, cz, w, h, d) => { tmp.makeScale(w, h, d).setPosition(cx, 0, cz); mats.push(tmp.clone()); seeds.push(R()) }
  const blocks = quality === 'low' ? 4 : 5
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let bx = 0; bx < blocks; bx++) for (let bz = 0; bz < blocks; bz++) {
      const x0 = 12.6 + bx * 39, z0 = 12.6 + bz * 39
      if (Math.hypot(x0, z0) > 230) continue
      const plaza = sx < 0 && sz < 0 && bx === 0 && bz === 0
      if (plaza) { add(sx * (x0 + 22), sz * (z0 + 22), 14, 4.5, 14); continue }
      const nx = R() < 0.55 ? 2 : 1, nz = R() < 0.55 ? 2 : 1
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const w = 31 / nx - 1.4, d = 31 / nz - 1.4
        const cx = x0 + (i + 0.5) * (31 / nx), cz = z0 + (j + 0.5) * (31 / nz)
        const front = bx === 0 || bz === 0
        let h = 12 + R() * 26
        if (!front && R() < 0.22) h = 48 + R() * 55
        if (front && R() < 0.2) h = 34 + R() * 12
        // stepped towers: a narrower upper volume on some tall buildings
        add(sx * cx, sz * cz, w, h, d)
        if (h > 40 && R() < 0.6) add(sx * cx, sz * cz, w * 0.62, h * (1.18 + R() * 0.2), d * 0.62)
      }
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1)
  geo.translate(0, 0.5, 0)
  const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1)
  geo.setAttribute('aSeed', aSeed)
  const m = smat({
    uniforms: { uCam: { value: new THREE.Vector3() }, uMap: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute float aSeed;
      varying vec3 vL; varying vec3 vN; varying vec3 vU; varying vec3 vS; varying float vSeed;
      void main(){
        vec4 lp = instanceMatrix * vec4(position, 1.0);
        vL = lp.xyz; vU = position; vN = normal; vSeed = aSeed;
        vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 mvPosition = modelViewMatrix * lp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform vec3 uCam; uniform float uMap;
      varying vec3 vL; varying vec3 vN; varying vec3 vU; varying vec3 vS; varying float vSeed;
      ${HASH}
      void main(){
        vec3 n = normalize(vN);
        vec3 V = normalize(uCam - vL);
        float h = vL.y;
        vec3 col;
        vec3 edgeC = vec3(0.018, 0.024, 0.032);
        if (n.y > 0.5) {
          vec2 e = (0.5 - abs(vU.xz)) * vS.xz; float ed = min(e.x, e.y);
          col = vec3(0.005, 0.006, 0.008) + edgeC * (1.0 - smoothstep(0.0, 0.4, ed));
          float fwd = fwidth(ed);
          col += vec3(0.30, 0.78, 1.0) * uMap * (1.0 - smoothstep(0.0, 0.2 + fwd*1.5, ed)) * 0.45;
          col = mix(col, col*0.5, uMap*0.5);
        } else {
          bool sideX = abs(n.x) > 0.5;
          float u = sideX ? vL.z : vL.x;
          float glassy = step(0.62, fract(vSeed*7.13));
          vec2 cs = glassy > 0.5 ? vec2(1.5, 3.7) : vec2(2.6, 3.5);
          vec2 c = vec2(u, h) / cs; vec2 id = floor(c); vec2 f = fract(c);
          float win = glassy > 0.5
            ? step(0.05, f.x)*step(f.x, 0.95)*step(0.08, f.y)*step(f.y, 0.94)
            : step(0.16, f.x)*step(f.x, 0.84)*step(0.24, f.y)*step(f.y, 0.84);
          float r = h21(id + vec2(vSeed*37.1, vSeed*11.7) + (sideX ? 13.0 : 0.0));
          float litp = 0.03 + 0.05*fract(vSeed*3.7);
          float lit = step(1.0 - litp, r) * step(4.0, h) * step(h, vS.y - 1.0);
          // a few buildings keep one office floor lit
          float band = step(0.8, fract(vSeed*5.3)) * step(abs(id.y - floor(fract(vSeed*9.1)*6.0 + 3.0)), 0.1) * step(0.35, h21(id*0.37));
          lit = max(lit, band * step(4.0, h));
          float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
          vec3 wall = vec3(0.0065, 0.0075, 0.0095);
          vec3 sky = mix(vec3(0.010, 0.016, 0.026), vec3(0.020, 0.030, 0.045), clamp(h/60.0, 0.0, 1.0));
          vec3 glass = vec3(0.003, 0.004, 0.006) + sky*(0.3 + fres*0.9);
          col = mix(wall, glass, win*(0.7 + 0.3*glassy));
          vec3 lc = mix(vec3(0.42, 0.56, 0.78), vec3(0.72, 0.78, 0.84), h21(id*1.7 + 2.0));
          col += lit * win * lc * (0.04 + 0.14*h21(id + 3.1)) * (1.0 - 0.6*glassy*step(0.5, 1.0 - band));
          // vertical corners and parapet catch a little light
          float ex = (0.5 - abs(sideX ? vU.z : vU.x)) * (sideX ? vS.z : vS.x);
          col += edgeC * (1.0 - smoothstep(0.0, 0.22, ex));
          col += edgeC * 1.4 * (1.0 - smoothstep(0.0, 0.3, vS.y - h));
          // street-level spill from lamps and storefronts
          col += vec3(0.020, 0.028, 0.040) * exp(-max(h, 0.0)*0.28);   // clamp: extrapolated varyings on far, grazing faces can go very negative → exp overflow → NaN
          col += vec3(0.05, 0.07, 0.09) * step(h, 3.2) * step(0.6, h) * step(0.55, h21(vec2(floor(u/5.0), vSeed*19.0))) * 0.6;
          col *= 1.0 - uMap*0.5;
        }
        // low urban haze, thicker near the street
        float d = length(uCam - vL);
        float haze = (1.0 - exp(-d*0.006)) * exp(-max(h, 0.0)*0.028);
        col = mix(col, vec3(0.010, 0.015, 0.022), haze*0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  })
  const mesh = new THREE.InstancedMesh(geo, m, mats.length)
  mats.forEach((mm, i) => mesh.setMatrixAt(i, mm))
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

// ---------------------------------------------------------------- street lamps
export function buildLamps(quality, streaks) {
  const L = lampList()
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 8, 6); pole.translate(0, 4, 0)
  const arm = new THREE.BoxGeometry(2.3, 0.08, 0.1); arm.translate(-1.1, 7.92, 0)
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8); base.translate(0, 0.25, 0)
  const poleGeo = mergeGeometries([pole, arm, base])
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.35 })
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, L.length)
  const head = new THREE.BoxGeometry(0.95, 0.1, 0.34); head.translate(-2.2, 7.86, 0)
  const heads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.86, 1.0).multiplyScalar(2.1) }), L.length)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  L.forEach((l, i) => {
    q.setFromAxisAngle(up, l.rot); pos.set(l.px, 0, l.pz)
    m4.compose(pos, q, s); poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4)
    streaks.set(i, l.hx, 7.8, l.hz, 0.8, 0.2, 0.25, 0.33)
  })
  const group = new THREE.Group()
  group.add(poles, heads)
  // soft light volumes under each lamp
  if (quality !== 'low') {
    const cone = new THREE.CylinderGeometry(0.25, 4.6, 7.6, 14, 1, true); cone.translate(0, 3.8, 0)
    const cm = smat({
      uniforms: { uCam: { value: new THREE.Vector3() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){
          vY = position.y / 7.6;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        ${FOGF}
        varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){
          float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float a = facing * pow(max(vY, 0.0), 1.4) * 0.022;
          gl_FragColor = vec4(vec3(0.55, 0.68, 0.9) * a * (1.0 - fogF()), 1.0);
        }`,
    })
    // only the nearer lamps get a volume: beyond ~100 m the fog has already eaten it
    const LN = L.filter((l) => Math.max(Math.abs(l.hx), Math.abs(l.hz)) < LAMP_START + LAMP_STEP * 3.5)
    const cones = new THREE.InstancedMesh(cone, cm, LN.length)
    LN.forEach((l, i) => { m4.makeTranslation(l.hx, 0, l.hz); cones.setMatrixAt(i, m4) })
    cones.frustumCulled = false
    cones.renderOrder = 3
    group.add(cones)
  }
  return { group, count: L.length }
}

// ---------------------------------------------------------------- signal infrastructure
// Poles, mast arms, signal housings, the camera, the stereo microphones and the controller cabinet.
export function buildInfra() {
  const parts = []
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(b); return b }
  for (const P of POLES) {
    const c = new THREE.CylinderGeometry(0.14, 0.19, P.len === 0 ? 6 : 7.0, 10); c.translate(P.x, 3.5, P.z); parts.push(c)
    const bse = new THREE.CylinderGeometry(0.34, 0.4, 0.45, 10); bse.translate(P.x, 0.22, P.z); parts.push(bse)
    // arm
    const ax = P.arm[0], az = P.arm[1]
    const len = P.len
    const arm = new THREE.CylinderGeometry(0.075, 0.1, len, 8)
    arm.rotateZ(Math.PI / 2)
    if (az !== 0) arm.rotateY(Math.PI / 2)
    arm.translate(P.x + ax * len / 2, 6.2, P.z + az * len / 2); parts.push(arm)
  }
  for (const H of HEADS) {
    // housing: thin along the facing axis
    const fx = H.face[0] !== 0
    box(fx ? 0.42 : 0.62, 1.85, fx ? 0.62 : 0.42, H.x, HEAD_Y, H.z)
    box(fx ? 0.05 : 0.05, 0.9, 0.05, H.x, HEAD_Y + 1.35, H.z) // hanger
    // backplate
    box(fx ? 0.04 : 0.95, 2.2, fx ? 0.95 : 0.04, H.x - H.face[0] * 0.23, HEAD_Y, H.z - H.face[1] * 0.23)
  }
  // camera housing on the NE mast arm, looking down the approach (+z)
  box(0.42, 0.36, 0.95, CAMERA.x, CAMERA.y, CAMERA.z + 0.1)
  box(0.5, 0.05, 1.15, CAMERA.x, CAMERA.y + 0.21, CAMERA.z + 0.14)
  box(0.08, 0.3, 0.08, CAMERA.x, CAMERA.y - 0.3, CAMERA.z)
  // mic crossbar at the top of the mast
  box(MICS.half * 2 + 0.2, 0.07, 0.07, MICS.x, MICS.y, MICS.z)
  box(0.08, 0.9, 0.08, MICS.x, MICS.y - 0.45, MICS.z)
  // controller cabinet
  box(CABINET.w, CABINET.h, CABINET.d, CABINET.x, CABINET.h / 2 + 0.05, CABINET.z)
  box(CABINET.w + 0.08, 0.06, CABINET.d + 0.08, CABINET.x, CABINET.h + 0.08, CABINET.z)
  box(CABINET.w + 0.2, 0.08, CABINET.d + 0.2, CABINET.x, 0.04, CABINET.z)
  const geo = mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p))
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b2027, metalness: 0.75, roughness: 0.38, envMapIntensity: 0.45 })
  const mesh = new THREE.Mesh(geo, mat)
  const group = new THREE.Group()
  group.add(mesh)
  // chrome mic capsules + camera lens
  const cap = new THREE.CapsuleGeometry(0.075, 0.26, 4, 10); cap.rotateX(Math.PI / 2)
  const caps = mergeGeometries([cap.clone().translate(MICS.x - MICS.half, MICS.y, MICS.z + 0.08), cap.clone().translate(MICS.x + MICS.half, MICS.y, MICS.z + 0.08)])
  group.add(new THREE.Mesh(caps, new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 1, roughness: 0.18, envMapIntensity: 0.9 })))
  const lens = new THREE.CircleGeometry(0.12, 20); lens.translate(CAMERA.x, CAMERA.y, CAMERA.z + 0.585)
  group.add(new THREE.Mesh(lens, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.75, 1.0).multiplyScalar(1.6) })))
  // curbs catch a sliver of light
  const curbs = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = new THREE.BoxGeometry(0.28, 0.14, 240); a.translate(sx * ROAD, 0.07, sz * (ROAD + 120)); curbs.push(a)
    const b = new THREE.BoxGeometry(240, 0.14, 0.28); b.translate(sx * (ROAD + 120), 0.07, sz * ROAD); curbs.push(b)
  }
  group.add(new THREE.Mesh(mergeGeometries(curbs), new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.1, roughness: 0.6, envMapIntensity: 0.25 })))
  return group
}

// ---------------------------------------------------------------- sky
export function buildSky() {
  const g = new THREE.SphereGeometry(420, 32, 16)
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    uniforms: { uO: { value: 1 } },
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vD; uniform float uO;
      void main(){
        float y = vD.y;
        vec3 c = mix(vec3(0.010, 0.016, 0.024), vec3(0.0012, 0.0018, 0.0028), smoothstep(0.0, 0.45, y));
        c = mix(c, vec3(0.004, 0.006, 0.009), smoothstep(0.0, -0.2, y));
        gl_FragColor = vec4(c, uO);
      }`,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}

// ---------------------------------------------------------------- drizzle
// Fine rain catching the street light: why the asphalt is wet. Animated entirely in the vertex shader.
export function buildRain(quality) {
  const N = quality === 'low' ? 1200 : 2600
  const R = rng(911)
  const pos = new Float32Array(N * 6)
  for (let i = 0; i < N; i++) {
    const x = (R() - 0.5) * 110, y = R() * 42, z = -60 + R() * 140
    pos.set([x, y, z, x, y, z], i * 6)
  }
  const top = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) { top[i * 2] = 0; top[i * 2 + 1] = 1 }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aTop', new THREE.BufferAttribute(top, 1))
  const sd = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) { const s = R(); sd[i * 2] = s; sd[i * 2 + 1] = s }
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
  const m = smat({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute float aTop; attribute float aSeed; uniform float uTime; varying float vA; varying float vY;
      void main(){
        vec3 p = position;
        float sp = 14.0 + aSeed*6.0;
        p.y = mod(p.y - uTime*sp, 42.0);
        p.x += p.y*0.06;
        p.y += aTop*0.55; p.x += aTop*0.033;
        vA = aTop; vY = p.y;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${FOGF}
      varying float vA; varying float vY;
      void main(){
        float a = (0.25 + 0.75*vA) * smoothstep(0.0, 3.0, vY) * 0.07;
        gl_FragColor = vec4(vec3(0.62, 0.74, 0.9) * a * (1.0 - fogF()), 1.0);
      }`,
  })
  const mesh = new THREE.LineSegments(g, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return { mesh, uniforms: m.uniforms }
}
