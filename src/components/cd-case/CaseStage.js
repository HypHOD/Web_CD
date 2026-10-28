import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { CASE, HALF, HINGE, discGeometry, lidGeometry, shelfGeometry, trayGeometry } from './caseGeometry';
import {
  BACKDROP_FRAG,
  BACKDROP_VERT,
  BLUR_FRAG,
  BRIGHT_FRAG,
  COPY_FRAG,
  DISC_FRAG,
  DISC_VERT,
  FINAL_FRAG,
  MIX_FRAG,
  ROD_FRAG,
  ROD_VERT,
  ROOM_BAKE_FRAG,
  SCREEN_VERT,
  SHEET_FRAG,
  SHEET_VERT,
  STREAK_FRAG,
} from './shaders';

const FOV = 28;
const IOR = 1.59;
const ABSORB = [0.0042, 0.003, 0.0026];
const DEPTH = 14;
const BACKDROP_Z = -70;
const LIGHT = new THREE.Vector3(-0.3, 0.48, 1).normalize();
const SPIN = THREE.MathUtils.degToRad(18);
const SPIN_EASE = 0.9;
const FIT = 0.6;
const DOCK_CLEAR = 84;
const MSAA = 4;
const ROOM_SIZE = 512;
const STARS = 1.6;
const STAR_THRESHOLD = 2.0;

const REST = 2.6;
const AGAIN = 5.5;
const OPEN_HOLD = 0.25;

const GRAB_RATE = 0.008;
const GRAB_YAW = 0.9;
const GRAB_TILT = 0.45;
const GRAB_K = 16;
const GRAB_C = 5.5;
const TAP_SLOP = 6;

const SHELF_TILT = -1.22;
const SHELF_SIN = Math.abs(Math.sin(SHELF_TILT));
const SHELF_COS = Math.abs(Math.cos(SHELF_TILT));
const SHELF_FOOT = CASE * SHELF_COS + 12 * SHELF_SIN;
const SHELF_PACK_GAP = 14;
const SHELF_GAP = SHELF_FOOT + CASE * 0.14;
const SHELF_REST_Z = 8 - (CASE / 2) * SHELF_SIN - 6 * SHELF_COS - 3;
const SHELF_FIT = CASE * 5.6;
const SHELF_HOVER = 5;
const SHELF_ACTIVE_Z = 64;
const SHELF_ACTIVE_Y = 10;
const SHELF_ACTIVE_SCALE = 1.05;
const SCROLL_DECAY = 3.4;
const MAX_SHADOW = 16;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function curve(frames) {
  const n = frames.length;
  const ts = frames.map((f) => f[0]);
  const vs = frames.map((f) => f[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (t - ts[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * vs[i] +
      (u3 - 2 * u2 + u) * h * m[i] +
      (-2 * u3 + 3 * u2) * vs[i + 1] +
      (u3 - u2) * h * m[i + 1]
    );
  };
}

const OPEN_ANGLE = 3.05;
const OPEN_T = 2.3;
const OPEN = {
  yaw: curve([
    [0, 0],
    [0.55, 0.3],
    [1.0, 0.85],
    [1.2, 2.0],
    [1.41, 3.4],
    [1.63, 4.9],
    [1.85, 6.05],
    [2.05, 6.36],
    [2.3, 2 * Math.PI],
  ]),
  lid: curve([
    [0, 0],
    [0.97, 0],
    [1.2, 0.45],
    [1.41, 1.35],
    [1.63, 2.3],
    [1.85, 2.92],
    [2.05, 3.12],
    [2.3, OPEN_ANGLE],
  ]),
  spread: curve([
    [0, 0],
    [1.12, 0],
    [1.9, 0.9],
    [2.3, 1],
  ]),
  pitch: curve([
    [0, 0],
    [1.35, 0],
    [2.3, -0.1],
  ]),
};

const CLOSE_T = 1.95;
const CLOSE = {
  lid: curve([
    [0, OPEN_ANGLE],
    [0.22, 1.75],
    [0.48, 1.55],
    [1.05, 1.08],
    [1.42, 0.6],
    [1.6, 0.26],
    [1.7, 0],
    [1.78, 0.07],
    [1.88, 0],
  ]),
  spread: curve([
    [0, 1],
    [0.3, 0.92],
    [1.2, 0.55],
    [1.72, 0],
  ]),
  yaw: curve([
    [0, 0],
    [0.5, 0.2],
    [1.3, 0.12],
    [1.88, 0],
  ]),
  pitch: curve([
    [0, -0.1],
    [1.6, -0.05],
    [1.7, 0.035],
    [1.82, -0.01],
    [1.95, 0],
  ]),
  roll: curve([
    [0, 0],
    [0.8, -0.05],
    [1.95, 0],
  ]),
};

function sway(t, motion) {
  return {
    y: 1.8 * Math.sin(t * 1.1) * motion,
    yaw: -0.2 + (0.1 * Math.sin(t * 0.9) + 0.03 * Math.sin(t * 2.1)) * motion,
    pitch: -0.12 + 0.045 * Math.sin(t * 0.7) * motion,
    roll: 0.03 + 0.018 * Math.sin(t * 0.5) * motion,
    lid: 0,
    spread: 0,
  };
}

function createStage(container, disc, { getPaused, getSpin, getAutoShow, onOpen, onSelect, onReady, onFail }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = reduced ? 0.35 : 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'cd-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'A clear CD jewel case with its disc spinning inside. Tap a case to open it, or drag to browse.',
  );
  container.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    canvas.remove();
    onFail?.();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.setClearColor(0xffffff, 0);
  const hdr =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const target = (samples) =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples,
      depthBuffer: samples > 0,
      stencilBuffer: false,
      resolveDepthBuffer: false,
    });
  const rtPage = target(0);
  const rt = [target(MSAA), target(MSAA)];
  const rtBright = target(0);
  const rtStarA = target(0);
  const rtStarB = target(0);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 4000);
  const opaque = new THREE.Scene();
  const glass = new THREE.Scene();
  const hits = new THREE.Scene();

  const disposables = [];
  const track = (d) => {
    disposables.push(d);
    return d;
  };

  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const screenQuad = track(new THREE.PlaneGeometry(2, 2));
  const pass = (frag, uniforms) => {
    const material = track(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SCREEN_VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false,
      }),
    );
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(screenQuad, material));
    return { scene, material };
  };
  const copyMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null } },
      vertexShader: SCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const copyQuad = new THREE.Mesh(screenQuad, copyMat);
  copyQuad.frustumCulled = false;
  copyQuad.renderOrder = -10;
  const copyScene = new THREE.Scene();
  const copyOut = new THREE.Mesh(screenQuad, copyMat);
  copyOut.frustumCulled = false;
  copyScene.add(copyOut);
  const picked = {
    uTex: { value: rtPage.texture },
    uTexInside: { value: rtPage.texture },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const bright = pass(BRIGHT_FRAG, {
    ...picked,
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: STAR_THRESHOLD },
  });
  const streak = pass(STREAK_FRAG, {
    uTex: { value: null },
    uStep: { value: new THREE.Vector2() },
    uFalloff: { value: 0.7 },
  });
  const final = pass(FINAL_FRAG, {
    ...picked,
    uStarA: { value: rtStarA.texture },
    uStarB: { value: rtStarB.texture },
    uStars: { value: STARS },
  });
  const blur = pass(BLUR_FRAG, {
    uTex: { value: null },
    uStep: { value: new THREE.Vector2() },
  });
  const mix = pass(MIX_FRAG, {
    uSharp: { value: rtPage.texture },
    uBlur: { value: null },
    uMix: { value: 0 },
  });

  const roomRT = new THREE.WebGLCubeRenderTarget(ROOM_SIZE, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const bake = pass(ROOM_BAKE_FRAG, { uFace: { value: 0 }, uSize: { value: ROOM_SIZE } });
  const bakeRoom = () => {
    for (let face = 0; face < 6; face++) {
      bake.material.uniforms.uFace.value = face;
      renderer.setRenderTarget(roomRT, face);
      renderer.render(bake.scene, screenCam);
    }
    renderer.setRenderTarget(null);
  };
  bakeRoom();

  const shadowOf = {
    uLight: { value: LIGHT.clone() },
    uCount: { value: 0 },
    uTrayInv: { value: Array.from({ length: MAX_SHADOW }, () => new THREE.Matrix4()) },
    uLidInv: { value: Array.from({ length: MAX_SHADOW }, () => new THREE.Matrix4()) },
    uScale: { value: new Array(MAX_SHADOW).fill(1) },
    uShelfOn: { value: 0 },
    uShelfHalf: { value: 0 },
  };
  const backdrop = new THREE.Mesh(
    track(new THREE.PlaneGeometry(8000, 8000)),
    track(new THREE.ShaderMaterial({ uniforms: shadowOf, vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG })),
  );
  backdrop.position.z = BACKDROP_Z;
  opaque.add(backdrop);
  const depthOnly = track(new THREE.MeshBasicMaterial({ colorWrite: false }));
  glass.add(copyQuad);

  const samples = window.matchMedia('(pointer: coarse)').matches ? 1 : 2;

  const tray = trayGeometry();
  const lid = lidGeometry();
  const discGeo = discGeometry();
  for (const g of [tray.rods, tray.sheets, lid.rods, lid.sheets, discGeo]) track(g);

  const rodMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uBehind: { value: null },
        uRoom: { value: roomRT.texture },
        uRoomSize: { value: ROOM_SIZE },
        uProj: { value: camera.projectionMatrix },
        uDepth: { value: DEPTH },
        uIor: { value: IOR },
        uSamples: { value: samples },
        uAbsorb: { value: new THREE.Vector3(...ABSORB) },
      },
      vertexShader: ROD_VERT,
      fragmentShader: ROD_FRAG,
    }),
  );
  const sheetMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uIor: { value: IOR },
        uAbsorb: { value: new THREE.Vector3(...ABSORB) },
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  );

  const fixed = (mesh, scene) => {
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };

  const hitPlane = track(new THREE.PlaneGeometry(CASE, CASE));
  const hitMat = track(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  let mode = 'hero';
  let items = [];
  let active = -1;
  let shelfOpen = false;
  let shelfExpanded = false;
  let shelfExpandP = 0;
  let shelfScroll = 0;
  let shelfVel = 0;
  let shelfMeshes = null;
  let shelfGeos = [];
  let shelfHalf = 0;
  let shelfFullHalf = 0;
  let shelfPackScale = 1;
  let shelfRect = null;
  let deferredShelf = null;
  let defaultArt = null;

  function makeItem(artTex, index) {
    const discMat = new THREE.ShaderMaterial({
      uniforms: {
        uArt: { value: artTex },
        uArtIn: { value: disc.artIn },
        uPrintOut: { value: disc.printOut },
      },
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
    });
    const item = {
      index,
      discMat,
      artTex,
      ownArt: false,
      trayRods: fixed(new THREE.Mesh(tray.rods, rodMat), glass),
      traySheets: fixed(new THREE.Mesh(tray.sheets, sheetMat), glass),
      lidRods: fixed(new THREE.Mesh(lid.rods, rodMat), glass),
      lidSheets: fixed(new THREE.Mesh(lid.sheets, sheetMat), glass),
      discMesh: fixed(new THREE.Mesh(discGeo, discMat), opaque),
      discDepth: fixed(new THREE.Mesh(discGeo, depthOnly), glass),
      hitTray: fixed(new THREE.Mesh(hitPlane, hitMat), hits),
      hitLid: fixed(new THREE.Mesh(hitPlane, hitMat), hits),
      mCase: new THREE.Matrix4(),
      mLid: new THREE.Matrix4(),
      depthTray: 0,
      depthLid: 0,
      rect: null,
      centerX: 0,
      scale: 1,
      openP: 0,
      hoverP: 0,
      dead: false,
      artToken: 0,
    };
    item.traySheets.renderOrder = 1;
    item.lidSheets.renderOrder = 1;
    item.discDepth.renderOrder = -5;
    item.hitTray.userData.index = index;
    item.hitLid.userData.index = index;
    item.glassMeshes = [item.trayRods, item.traySheets, item.lidRods, item.lidSheets, item.discDepth];
    return item;
  }

  function disposeItems() {
    for (const it of items) {
      it.dead = true;
      for (const m of [
        it.trayRods,
        it.traySheets,
        it.lidRods,
        it.lidSheets,
        it.discMesh,
        it.discDepth,
        it.hitTray,
        it.hitLid,
      ]) {
        m.removeFromParent();
      }
      it.discMat.dispose();
      if (it.ownArt && it.artTex) it.artTex.dispose();
      it.artTex = null;
    }
    items = [];
    active = -1;
    shelfOpen = false;
    shelfRect = null;
  }

  function clearShelf() {
    if (shelfMeshes) {
      shelfMeshes.rods.removeFromParent();
      shelfMeshes.sheets.removeFromParent();
      shelfMeshes = null;
    }
    for (const g of shelfGeos) g.dispose();
    shelfGeos = [];
    shelfRect = null;
  }

  const pointer = { x: 0, y: 0, over: false };
  const lean = { x: 0, y: 0 };
  const grab = {
    active: false,
    start: null,
    last: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    flick: { x: 0, y: 0 },
    moved: 0,
    dist: 0,
    picked: -1,
    startScroll: 0,
  };
  const st = {
    t: 0,
    clock: 0,
    rest: REST,
    phase: 'rest',
    phaseAt: 0,
    auto: false,
    closeAfter: false,
    spin: 0,
    spinRate: SPIN,
    open: false,
  };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let disposed = false;
  let raf = 0;
  let last = 0;
  let view = { w: 1, h: 1, openScale: 1, visibleWidth: 1 };

  const setOpenFlag = (on) => {
    if (st.open === on) return;
    st.open = on;
    onOpen?.(on);
  };

  function startOpen(auto) {
    if (st.phase !== 'rest') return;
    st.phase = 'opening';
    st.phaseAt = st.t;
    st.auto = auto;
    setOpenFlag(true);
  }
  function startClose() {
    if (st.phase === 'opening') {
      st.auto = true;
      st.closeAfter = true;
      return;
    }
    if (st.phase !== 'open') return;
    st.phase = 'closing';
    st.phaseAt = st.t;
    setOpenFlag(false);
  }
  function expandShelf(on = true) {
    if (mode !== 'shelf' || shelfExpanded === on) return;
    shelfExpanded = on;
    if (!on) {
      shelfScroll = 0;
      shelfVel = 0;
    }
    layout();
  }

  function toggleOpen(on) {
    if (!items.length) return;
    if (mode === 'shelf') {
      const target = on === undefined ? !shelfOpen : on;
      if (target) {
        if (shelfOpen) return;
        if (!shelfExpanded) expandShelf();
        if (active < 0) active = 0;
        shelfOpen = true;
        setOpenFlag(true);
        onSelect?.(active);
      } else if (shelfOpen) {
        shelfOpen = false;
        setOpenFlag(false);
      }
      return;
    }
    const isOpen = st.phase === 'opening' || st.phase === 'open';
    const target = on === undefined ? !isOpen : on;
    if (target) startOpen(false);
    else startClose();
  }

  function selectShelf(i) {
    if (!items[i]) return;
    if (!shelfExpanded) {
      expandShelf();
      return;
    }
    if (shelfOpen && active === i) {
      shelfOpen = false;
      setOpenFlag(false);
      return;
    }
    const was = shelfOpen;
    active = i;
    shelfOpen = true;
    if (!was) setOpenFlag(true);
    onSelect?.(i);
  }

  function showPose(t) {
    const p = sway(t, motion);
    const since = t - st.phaseAt;
    if (st.phase === 'opening') {
      const q = Math.min(since, OPEN_T);
      p.yaw = lerp(p.yaw, 0, clamp01(q / 1.0)) + OPEN.yaw(q);
      p.lid = OPEN.lid(q);
      p.spread = OPEN.spread(q);
      p.pitch = lerp(p.pitch, OPEN.pitch(q), clamp01(q / 1.45));
      p.roll *= 1 - clamp01(q / 1.45);
    } else if (st.phase === 'open') {
      p.yaw = 0.06 * Math.sin(t * 0.6) * motion;
      p.pitch = -0.1 + 0.02 * Math.sin(t * 0.8) * motion;
      p.roll = 0;
      p.lid = OPEN_ANGLE + 0.025 * Math.sin(t * 1.3) * motion;
      p.spread = 1;
    } else if (st.phase === 'closing') {
      const q = Math.min(since, CLOSE_T);
      const back = clamp01((q - 0.9) / (CLOSE_T - 0.9));
      const rest = easeInOut(back);
      p.yaw = lerp(CLOSE.yaw(q), p.yaw, rest);
      p.pitch = lerp(CLOSE.pitch(q), p.pitch, rest);
      p.roll = lerp(CLOSE.roll(q), p.roll, rest);
      p.lid = CLOSE.lid(q);
      p.spread = CLOSE.spread(q);
    }
    return p;
  }

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'XYZ');
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _h = new THREE.Matrix4();
  const _hi = new THREE.Matrix4();

  function applyItemMatrices(it) {
    it.trayRods.matrix.copy(it.mCase);
    it.traySheets.matrix.copy(it.mCase);
    it.lidRods.matrix.copy(it.mLid);
    it.lidSheets.matrix.copy(it.mLid);
    it.discMesh.matrix.copy(it.mCase).multiply(_m.makeRotationZ(-st.spin));
    it.discDepth.matrix.copy(it.discMesh.matrix);
    it.hitTray.matrix.copy(it.mCase);
    it.hitLid.matrix.copy(it.mLid).multiply(_m.makeTranslation(0, 0, 4));
    for (const o of [
      it.trayRods,
      it.traySheets,
      it.lidRods,
      it.lidSheets,
      it.discMesh,
      it.discDepth,
      it.hitTray,
      it.hitLid,
    ]) {
      o.matrixWorld.copy(o.matrix);
    }
    _v.set(0, 0, -2).applyMatrix4(it.mCase).applyMatrix4(camera.matrixWorldInverse);
    it.depthTray = _v.z;
    _v.set(0, 0, 4).applyMatrix4(it.mLid).applyMatrix4(camera.matrixWorldInverse);
    it.depthLid = _v.z;
  }

  function placeHero(p) {
    const it = items[0];
    if (!it) return;
    const s = lerp(1, view.openScale, p.spread);
    _e.set(p.pitch + lean.x + grab.x, p.yaw + lean.y + grab.y, p.roll);
    _q.setFromEuler(_e);
    _v.set(HALF * s * p.spread * 0.92, p.y, 0);
    it.mCase.compose(_v, _q, _s.setScalar(s));
    it.scale = s;
    _h.makeTranslation(HINGE.x, 0, HINGE.z);
    _hi.makeTranslation(-HINGE.x, 0, -HINGE.z);
    _m.makeRotationY(-p.lid);
    it.mLid.copy(it.mCase).multiply(_h).multiply(_m).multiply(_hi);
    applyItemMatrices(it);
  }

  function placeShelfItem(it) {
    const n = items.length;
    const gap = lerp(SHELF_PACK_GAP, SHELF_GAP, easeInOut(shelfExpandP));
    const baseX = (it.index - (n - 1) / 2) * gap - shelfScroll;
    const p = easeInOut(it.openP);
    const x = baseX * (1 - p);
    const y = SHELF_ACTIVE_Y * p;
    const z = lerp(SHELF_REST_Z, SHELF_ACTIVE_Z, p) + SHELF_HOVER * it.hoverP;
    const s = 1 + (SHELF_ACTIVE_SCALE - 1) * p;
    const yaw = SHELF_TILT * (1 - p) + 0.14 * it.hoverP * (1 - p);
    _e.set(-0.03 * it.hoverP, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    it.mCase.compose(_v, _q, _s.setScalar(s));
    it.scale = s;
    _h.makeTranslation(HINGE.x, 0, HINGE.z);
    _hi.makeTranslation(-HINGE.x, 0, -HINGE.z);
    _m.makeRotationY(-OPEN_ANGLE * it.openP);
    it.mLid.copy(it.mCase).multiply(_h).multiply(_m).multiply(_hi);
    applyItemMatrices(it);
  }

  const _c = new THREE.Vector3();
  function rectOfBox(mats, bx, by, z0, z1) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of mats) {
      for (let i = 0; i < 8; i++) {
        _c.set(i & 1 ? bx : -bx, i & 2 ? by : -by, i & 4 ? z1 : z0);
        _c.applyMatrix4(m).project(camera);
        x0 = Math.min(x0, _c.x);
        x1 = Math.max(x1, _c.x);
        y0 = Math.min(y0, _c.y);
        y1 = Math.max(y1, _c.y);
      }
    }
    const w = rtPage.width;
    const h = rtPage.height;
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0) + 0.02;
    const px = (v) => Math.round(((v + 1) / 2) * w);
    const py = (v) => Math.round(((v + 1) / 2) * h);
    const r = {
      x: clamp(px(x0 - pad), 0, w),
      y: clamp(py(y0 - pad), 0, h),
      x1: clamp(px(x1 + pad), 0, w),
      y1: clamp(py(y1 + pad), 0, h),
    };
    return r.x1 > r.x && r.y1 > r.y ? r : null;
  }

  const shelfBase = new THREE.Matrix4();
  function updateRects() {
    for (const it of items) {
      it.rect = rectOfBox([it.mCase, it.mLid], HALF + 3, HALF + 3, -7, 7);
      it.centerX = it.rect ? (it.rect.x + it.rect.x1) / 2 : 0;
    }
    const shelfScale = lerp(shelfPackScale, 1, easeInOut(shelfExpandP));
    shelfHalf = shelfFullHalf * shelfScale;
    shelfBase.makeScale(shelfScale, 1, 1).setPosition(0, -HALF - 1, 0);
    shelfRect = shelfMeshes ? rectOfBox([shelfBase], shelfFullHalf + 2, 6.5, -142, 12) : null;
  }

  function updateShadows() {
    const casters = items.filter((it) => it.rect);
    if (casters.length > 1) {
      const cx = rtPage.width / 2;
      casters.sort((a, b) => Math.abs(a.centerX - cx) - Math.abs(b.centerX - cx));
    }
    const n = Math.min(casters.length, MAX_SHADOW);
    for (let i = 0; i < n; i++) {
      const it = casters[i];
      shadowOf.uTrayInv.value[i].copy(it.mCase).invert();
      shadowOf.uLidInv.value[i].copy(it.mLid).invert();
      shadowOf.uScale.value[i] = it.scale || 1;
    }
    shadowOf.uCount.value = n;
    shadowOf.uShelfOn.value = mode === 'shelf' && shelfMeshes ? 1 : 0;
    shadowOf.uShelfHalf.value = shelfHalf;
  }

  function pickItem(x, y) {
    if (!items.length) return -1;
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hits.children, false)[0];
    return hit ? hit.object.userData.index : -1;
  }

  const caseAt = (x, y) => pickItem(x, y) >= 0;
  const hovering = () => pointer.over && !grab.active && caseAt(pointer.x, pointer.y);

  const rowWidth = () => (items.length ? (items.length - 1) * SHELF_GAP + SHELF_FOOT : CASE);
  const packedRowWidth = () => (items.length ? (items.length - 1) * SHELF_PACK_GAP + SHELF_FOOT : CASE);
  const maxScroll = () => {
    if (mode !== 'shelf' || !items.length || !shelfExpanded) return 0;
    return Math.max(0, (rowWidth() - view.visibleWidth) / 2 + CASE * 0.1);
  };

  function frameHero(dt, t) {
    const hover = pointer.over && !grab.active;
    const ax = hover ? pointer.y * 0.22 : 0;
    const ay = hover ? -pointer.x * 0.35 : 0;
    const k = 1 - Math.exp(-dt * 4);
    lean.x += (ax - lean.x) * k;
    lean.y += (ay - lean.y) * k;
    if (!grab.active) {
      grab.vx += (-GRAB_K * grab.x - GRAB_C * grab.vx) * dt;
      grab.vy += (-GRAB_K * grab.y - GRAB_C * grab.vy) * dt;
      grab.x += grab.vx * dt;
      grab.y += grab.vy * dt;
    }

    const since = t - st.phaseAt;
    if (st.phase === 'opening' && since >= OPEN_T) {
      st.phase = 'open';
      st.phaseAt = t;
    } else if (st.phase === 'closing' && since >= CLOSE_T) {
      st.phase = 'rest';
      st.phaseAt = t;
      st.clock = 0;
      st.rest = AGAIN;
    }

    const held = grab.active || hovering() || (st.phase === 'open' && !st.auto);
    const showing = !getPaused() && !held;
    const autoShow = getAutoShow();
    if (st.phase === 'open' && (st.closeAfter || (st.auto && autoShow && showing && t - st.phaseAt >= OPEN_HOLD))) {
      st.closeAfter = false;
      startClose();
    }
    if (showing && autoShow) {
      st.clock += dt;
      if (st.phase === 'rest' && st.clock >= st.rest) startOpen(true);
    }

    placeHero(showPose(t));
  }

  function frameShelf(dt) {
    const expandTarget = shelfExpanded ? 1 : 0;
    shelfExpandP += (expandTarget - shelfExpandP) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(expandTarget - shelfExpandP) < 0.001) shelfExpandP = expandTarget;

    if (shelfExpanded && !grab.active) {
      shelfScroll += shelfVel * dt;
      shelfVel *= Math.exp(-dt * SCROLL_DECAY);
      if (Math.abs(shelfVel) < 2) shelfVel = 0;
      shelfScroll = clamp(shelfScroll, -maxScroll(), maxScroll());
    }

    let hovered = -1;
    if (shelfExpanded && pointer.over && !grab.active) hovered = pickItem(pointer.x, pointer.y);

    const k = 1 - Math.exp(-dt * 9);
    const kOpen = 1 - Math.exp(-dt * 6.5);
    for (const it of items) {
      const want = shelfOpen && it.index === active ? 1 : 0;
      it.openP += (want - it.openP) * kOpen;
      if (!want && it.openP < 0.001) it.openP = 0;
      const hov = hovered === it.index && want === 0 ? 1 : 0;
      it.hoverP += (hov - it.hoverP) * k;
      placeShelfItem(it);
    }
    if (shelfMeshes) {
      const shelfScale = lerp(shelfPackScale, 1, easeInOut(shelfExpandP));
      _m.makeScale(shelfScale, 1, 1);
      shelfMeshes.rods.matrixWorld.copy(_m);
      shelfMeshes.sheets.matrixWorld.copy(_m);
    }
  }

  function frame(dt) {
    st.t += dt;
    const { t } = st;

    const want = getSpin() ? SPIN : 0;
    st.spinRate += (want - st.spinRate) * (1 - Math.exp(-dt * SPIN_EASE * 3));
    st.spin += st.spinRate * dt;

    if (mode === 'shelf') frameShelf(dt);
    else frameHero(dt, t);

    updateRects();
    updateShadows();
    draw();
  }

  function copyRegion(tex, r) {
    rtPage.scissor.set(r.x, r.y, r.x1 - r.x, r.y1 - r.y);
    rtPage.scissorTest = true;
    renderer.setRenderTarget(rtPage);
    copyMat.uniforms.uTex.value = tex;
    renderer.render(copyScene, screenCam);
    rtPage.scissorTest = false;
  }

  const pageRect = { x: 0, y: 0, x1: 0, y1: 0 };

  function compositeItem(it) {
    const r = it.rect;
    for (const trg of rt) {
      trg.scissor.set(r.x, r.y, r.x1 - r.x, r.y1 - r.y);
      trg.scissorTest = true;
    }
    it.discDepth.visible = true;

    renderer.setRenderTarget(rt[0]);
    renderer.clear();
    it.trayRods.visible = true;
    it.traySheets.visible = true;
    copyMat.uniforms.uTex.value = rtPage.texture;
    rodMat.uniforms.uBehind.value = rtPage.texture;
    renderer.render(glass, camera);

    it.trayRods.visible = false;
    it.traySheets.visible = false;
    it.lidRods.visible = true;
    it.lidSheets.visible = true;

    renderer.setRenderTarget(rt[1]);
    renderer.clear();
    copyMat.uniforms.uTex.value = rt[0].texture;
    rodMat.uniforms.uBehind.value = rt[0].texture;
    renderer.render(glass, camera);

    it.lidRods.visible = false;
    it.lidSheets.visible = false;
    it.discDepth.visible = false;

    copyRegion(rt[1].texture, r);
    for (const trg of rt) trg.scissorTest = false;
  }

  function compositeShelf() {
    const r = shelfRect;
    for (const trg of rt) {
      trg.scissor.set(r.x, r.y, r.x1 - r.x, r.y1 - r.y);
      trg.scissorTest = true;
    }
    renderer.setRenderTarget(rt[0]);
    renderer.clear();
    shelfMeshes.rods.visible = true;
    shelfMeshes.sheets.visible = true;
    copyMat.uniforms.uTex.value = rtPage.texture;
    rodMat.uniforms.uBehind.value = rtPage.texture;
    renderer.render(glass, camera);
    shelfMeshes.rods.visible = false;
    shelfMeshes.sheets.visible = false;
    copyRegion(rt[0].texture, r);
    for (const trg of rt) trg.scissorTest = false;
  }

  function blurPage(k) {
    const bw = rtStarA.width;
    const bh = rtStarA.height;
    const u = blur.material.uniforms;
    u.uTex.value = rtPage.texture;
    u.uStep.value.set(2.2 / bw, 0);
    renderer.setRenderTarget(rtStarB);
    renderer.render(blur.scene, screenCam);
    u.uTex.value = rtStarB.texture;
    u.uStep.value.set(0, 2.2 / bh);
    renderer.setRenderTarget(rtStarA);
    renderer.render(blur.scene, screenCam);
    u.uTex.value = rtStarA.texture;
    u.uStep.value.set(4.2 / bw, 0);
    renderer.setRenderTarget(rtStarB);
    renderer.render(blur.scene, screenCam);
    u.uTex.value = rtStarB.texture;
    u.uStep.value.set(0, 4.2 / bh);
    renderer.setRenderTarget(rtStarA);
    renderer.render(blur.scene, screenCam);
    mix.material.uniforms.uBlur.value = rtStarA.texture;
    mix.material.uniforms.uMix.value = k;
    renderer.setRenderTarget(rt[0]);
    renderer.render(mix.scene, screenCam);
    pageRect.x1 = rtPage.width;
    pageRect.y1 = rtPage.height;
    copyRegion(rt[0].texture, pageRect);
  }

  function draw() {
    const focus =
      mode === 'shelf' &&
      active >= 0 &&
      items[active] &&
      items[active].rect &&
      (shelfOpen || items[active].openP > 0.004)
        ? items[active]
        : null;
    const blurK = focus ? clamp01((focus.openP - 0.08) / 0.6) : 0;

    renderer.setRenderTarget(rtPage);
    renderer.clear();
    backdrop.visible = true;
    for (const it of items) it.discMesh.visible = !!it.rect && it !== focus;
    renderer.render(opaque, camera);

    for (const it of items) {
      for (const m of it.glassMeshes) m.visible = false;
    }
    if (shelfMeshes) {
      shelfMeshes.rods.visible = false;
      shelfMeshes.sheets.visible = false;
    }

    const order = items.filter((it) => it.rect).sort((a, b) => a.depthTray - b.depthTray);
    for (const it of order) {
      if (it === focus) continue;
      compositeItem(it);
    }
    if (shelfMeshes && shelfRect) compositeShelf();

    if (focus && blurK > 0.004) blurPage(blurK);

    if (focus) {
      for (const it of items) it.discMesh.visible = false;
      focus.discMesh.visible = true;
      backdrop.visible = false;
      renderer.setRenderTarget(rtPage);
      renderer.render(opaque, camera);
      backdrop.visible = true;
      compositeItem(focus);
    }

    picked.uTex.value = rtPage.texture;
    picked.uTexInside.value = rtPage.texture;
    picked.uRect.value.set(0, 0, 1, 1);

    bright.material.uniforms.uTexel.value.set(1 / rtBright.width, 1 / rtBright.height);
    renderer.setRenderTarget(rtBright);
    renderer.render(bright.scene, screenCam);
    streak.material.uniforms.uTex.value = rtBright.texture;
    streak.material.uniforms.uStep.value.set(1.5 / rtBright.width, 0);
    renderer.setRenderTarget(rtStarA);
    renderer.render(streak.scene, screenCam);
    streak.material.uniforms.uStep.value.set(0, 1.5 / rtBright.height);
    renderer.setRenderTarget(rtStarB);
    renderer.render(streak.scene, screenCam);

    renderer.setRenderTarget(null);
    renderer.render(final.scene, screenCam);
  }

  function layout() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtPage.setSize(size.x, size.y);
    for (const r of rt) r.setSize(size.x, size.y);
    const hw = Math.max(1, Math.round(size.x / 2));
    const hh = Math.max(1, Math.round(size.y / 2));
    rtBright.setSize(hw, hh);
    rtStarA.setSize(hw, hh);
    rtStarB.setSize(hw, hh);
    camera.aspect = w / h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fitH = CASE / FIT / 2 / tanHalf;
    let fitW = (CASE * 1.3) / 2 / (tanHalf * camera.aspect);
    if (mode === 'shelf' && items.length) {
      const width = shelfExpanded ? rowWidth() : packedRowWidth();
      const span = Math.min(width + CASE * 0.5, SHELF_FIT);
      fitW = span / 2 / (tanHalf * camera.aspect);
    }
    const dist = Math.max(fitH, fitW);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(w, h, 0, DOCK_CLEAR / 2, w, h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const across = 2 * dist * tanHalf * camera.aspect;
    view = { w, h, openScale: Math.min(1.04, across / (CASE * 2.25)), visibleWidth: across };
    shelfScroll = clamp(shelfScroll, -maxScroll(), maxScroll());
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(container);
  canvas.addEventListener('webglcontextrestored', bakeRoom);

  const toNdc = (e) => {
    const r = container.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  const overShelf = (e) => {
    if (!shelfRect) return false;
    const bounds = container.getBoundingClientRect();
    const x = ((e.clientX - bounds.left) / bounds.width) * rtPage.width;
    const y = (1 - (e.clientY - bounds.top) / bounds.height) * rtPage.height;
    return x >= shelfRect.x && x <= shelfRect.x1 && y >= shelfRect.y && y <= shelfRect.y1;
  };
  const onMove = (e) => {
    [pointer.x, pointer.y] = toNdc(e);
    pointer.over = true;
    if (grab.active) {
      const dx = e.clientX - grab.last.x;
      const dy = e.clientY - grab.last.y;
      grab.last = { x: e.clientX, y: e.clientY };
      grab.dist = Math.max(grab.dist, Math.hypot(e.clientX - grab.start.x, e.clientY - grab.start.y));
      grab.moved = performance.now();
      if (mode === 'shelf' && shelfExpanded) {
        const wpp = view.visibleWidth / Math.max(view.w, 1);
        shelfScroll = clamp(
          grab.startScroll - (e.clientX - grab.start.x) * wpp,
          -maxScroll(),
          maxScroll(),
        );
        grab.flick = { x: 0, y: -dx * wpp * 60 };
      } else if (mode === 'shelf') {
        grab.flick = { x: 0, y: 0 };
      } else {
        grab.y = clamp(grab.y + dx * GRAB_RATE, -GRAB_YAW, GRAB_YAW);
        grab.x = clamp(grab.x + dy * GRAB_RATE, -GRAB_TILT, GRAB_TILT);
        grab.flick = { x: dy * GRAB_RATE * 60, y: dx * GRAB_RATE * 60 };
      }
    } else if (mode === 'shelf') {
      const onCase = pickItem(pointer.x, pointer.y) >= 0;
      container.style.cursor = onCase || (!shelfExpanded && overShelf(e)) ? 'pointer' : shelfExpanded ? 'grab' : '';
    } else {
      container.style.cursor = caseAt(pointer.x, pointer.y) ? 'pointer' : '';
    }
  };
  const onLeave = () => {
    pointer.over = false;
  };
  const onDown = (e) => {
    if (!items.length || e.button !== 0) return;
    const [x, y] = toNdc(e);
    const picked = pickItem(x, y);
    if (mode === 'shelf') {
      if (!shelfExpanded && picked < 0 && !overShelf(e)) return;
      grab.active = true;
      grab.start = { x: e.clientX, y: e.clientY };
      grab.last = { x: e.clientX, y: e.clientY };
      grab.startScroll = shelfScroll;
      grab.picked = picked;
      grab.dist = 0;
      grab.moved = performance.now();
      grab.flick = { x: 0, y: 0 };
      shelfVel = 0;
      container.setPointerCapture(e.pointerId);
      container.style.cursor = 'grabbing';
      return;
    }
    if (picked < 0) return;
    grab.active = true;
    grab.start = { x: e.clientX, y: e.clientY };
    grab.last = { x: e.clientX, y: e.clientY };
    grab.dist = 0;
    grab.flick = { x: 0, y: 0 };
    container.setPointerCapture(e.pointerId);
    container.style.cursor = 'grabbing';
  };
  const onUp = (e) => {
    if (!grab.active) return;
    grab.active = false;
    const still = performance.now() - grab.moved > 90;
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    container.style.cursor = '';
    if (mode === 'shelf') {
      if (!shelfExpanded) {
        if (e.type === 'pointerup' && grab.dist < TAP_SLOP) expandShelf();
        return;
      }
      if (e.type === 'pointerup' && grab.dist < TAP_SLOP) {
        if (grab.picked >= 0) selectShelf(grab.picked);
        else if (shelfOpen) {
          shelfOpen = false;
          setOpenFlag(false);
        } else {
          expandShelf(false);
        }
      } else if (e.type === 'pointerup') {
        shelfVel = still ? 0 : clamp(grab.flick.y, -2600, 2600);
      }
      return;
    }
    grab.vx = still ? 0 : grab.flick.x;
    grab.vy = still ? 0 : grab.flick.y;
    if (e.type === 'pointerup' && grab.dist < TAP_SLOP) toggleOpen();
  };
  const onWheel = (e) => {
    if (mode !== 'shelf' || !items.length || !shelfExpanded) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    shelfVel = 0;
    shelfScroll = clamp(shelfScroll + d, -maxScroll(), maxScroll());
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('wheel', onWheel, { passive: false });

  const gaps = [];
  let probing = true;
  const probe = (gap) => {
    if (!probing || document.hidden || gap > 0.1) return;
    gaps.push(gap);
    if (gaps.length < 120) return;
    gaps.sort((a, b) => a - b);
    const typical = gaps[gaps.length >> 1];
    gaps.length = 0;
    const ratio = renderer.getPixelRatio();
    if (typical < 1 / 40 || ratio <= 1) {
      probing = false;
      return;
    }
    renderer.setPixelRatio(
      Math.max(1, Math.min(ratio - 0.25, Math.round(ratio * Math.sqrt(1 / 45 / typical) * 4) / 4)),
    );
    layout();
  };
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const gap = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (!items.length) return;
    frame(Math.min(gap, 1 / 20));
    probe(gap);
  };

  const loader = new THREE.TextureLoader();
  const prepare = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };
  let artToken = 0;
  let pendingArt = null;

  function loadArt(it, blob) {
    it.artToken += 1;
    const token = it.artToken;
    const url = URL.createObjectURL(blob);
    loader
      .loadAsync(url)
      .then((tex) => {
        URL.revokeObjectURL(url);
        if (disposed || it.dead || token !== it.artToken) {
          tex.dispose();
          return;
        }
        prepare(tex);
        if (it.ownArt && it.artTex) it.artTex.dispose();
        it.artTex = tex;
        it.ownArt = true;
        it.discMat.uniforms.uArt.value = tex;
      })
      .catch(() => URL.revokeObjectURL(url));
  }

  const setArt = async (blob) => {
    const token = ++artToken;
    const url = blob ? URL.createObjectURL(blob) : disc.art;
    let tex;
    try {
      tex = await loader.loadAsync(url);
    } catch {
      if (blob) URL.revokeObjectURL(url);
      return;
    }
    if (blob) URL.revokeObjectURL(url);
    if (disposed || token !== artToken) {
      tex.dispose();
      return;
    }
    prepare(tex);
    if (mode !== 'hero') {
      tex.dispose();
      return;
    }
    const it = items[0];
    if (!it) {
      if (pendingArt) pendingArt.dispose();
      pendingArt = tex;
      return;
    }
    if (it.artTex === tex) {
      tex.dispose();
      return;
    }
    if (it.ownArt && it.artTex) it.artTex.dispose();
    it.artTex = tex;
    it.ownArt = true;
    it.discMat.uniforms.uArt.value = tex;
  };

  function showHero() {
    if (!defaultArt) return;
    disposeItems();
    clearShelf();
    mode = 'hero';
    shelfOpen = false;
    active = -1;
    shelfScroll = 0;
    shelfVel = 0;
    st.phase = 'rest';
    st.phaseAt = 0;
    st.auto = false;
    st.closeAfter = false;
    st.open = false;
    st.clock = 0;
    st.rest = REST;
    lean.x = 0;
    lean.y = 0;
    grab.x = 0;
    grab.y = 0;
    grab.vx = 0;
    grab.vy = 0;
    let art = defaultArt;
    let own = false;
    if (pendingArt) {
      art = pendingArt;
      own = true;
      pendingArt = null;
    }
    const it = makeItem(art, 0);
    it.ownArt = own;
    items = [it];
    layout();
  }

  function buildShelf(n) {
    clearShelf();
    const width = Math.max(CASE * 2.2, (n - 1) * SHELF_GAP + SHELF_FOOT + CASE * 0.5);
    const packedWidth = Math.max(CASE * 2.2, (n - 1) * SHELF_PACK_GAP + SHELF_FOOT + CASE * 0.5);
    const geo = shelfGeometry(width);
    shelfGeos.push(geo.rods, geo.sheets);
    shelfFullHalf = width / 2;
    shelfHalf = shelfFullHalf;
    shelfPackScale = packedWidth / width;
    shelfMeshes = {
      rods: fixed(new THREE.Mesh(geo.rods, rodMat), glass),
      sheets: fixed(new THREE.Mesh(geo.sheets, sheetMat), glass),
    };
  }

  function showShelf(list) {
    if (!defaultArt) {
      deferredShelf = list;
      return;
    }
    disposeItems();
    clearShelf();
    mode = 'shelf';
    active = -1;
    shelfOpen = false;
    shelfExpanded = false;
    shelfExpandP = 0;
    shelfScroll = 0;
    shelfVel = 0;
    st.phase = 'rest';
    st.auto = false;
    st.closeAfter = false;
    st.open = false;
    grab.x = 0;
    grab.y = 0;
    grab.vx = 0;
    grab.vy = 0;
    items = list.map((_, i) => makeItem(defaultArt, i));
    buildShelf(items.length);
    for (let i = 0; i < list.length; i++) {
      if (list[i]?.cover) loadArt(items[i], list[i].cover);
    }
    layout();
  }

  loader
    .loadAsync(disc.art)
    .then((tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      defaultArt = prepare(tex);
      if (deferredShelf) {
        const list = deferredShelf;
        deferredShelf = null;
        showShelf(list);
      } else {
        showHero();
      }
      onReady?.();
      raf = requestAnimationFrame(tick);
    })
    .catch((err) => {
      console.error(err);
      if (!disposed) onFail?.();
    });

  layout();

  return {
    setOpen: (on) => toggleOpen(on),
    setArt,
    setShelf: (list) => {
      if (list && list.length) showShelf(list);
      else showHero();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('webglcontextrestored', bakeRoom);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('wheel', onWheel);
      disposeItems();
      clearShelf();
      if (pendingArt) pendingArt.dispose();
      if (defaultArt) defaultArt.dispose();
      for (const d of disposables) d.dispose();
      for (const r of [rtPage, ...rt, rtBright, rtStarA, rtStarB, roomRT]) r.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

const CaseStage = forwardRef(function CaseStage(
  { disc, paused = false, spin = true, autoShow = true, onOpen, onSelect, onReady, onFail },
  ref,
) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const autoShowRef = useRef(autoShow);
  autoShowRef.current = autoShow;
  const callbacks = useRef({});
  callbacks.current = { onOpen, onSelect, onReady, onFail };

  useEffect(() => {
    const stage = createStage(containerRef.current, disc, {
      getPaused: () => pausedRef.current,
      getSpin: () => spinRef.current,
      getAutoShow: () => autoShowRef.current,
      onOpen: (on) => callbacks.current.onOpen?.(on),
      onSelect: (i) => callbacks.current.onSelect?.(i),
      onReady: () => callbacks.current.onReady?.(),
      onFail: () => callbacks.current.onFail?.(),
    });
    stageRef.current = stage;
    return () => {
      stage?.dispose();
      stageRef.current = null;
    };
  }, [disc]);

  useImperativeHandle(
    ref,
    () => ({
      setOpen: (on) => stageRef.current?.setOpen(on),
      setArt: (blob) => stageRef.current?.setArt(blob),
      setShelf: (list) => stageRef.current?.setShelf(list),
    }),
    [],
  );

  return (
    <div
      className="cd-stage"
      ref={containerRef}
    />
  );
});

export default CaseStage;
