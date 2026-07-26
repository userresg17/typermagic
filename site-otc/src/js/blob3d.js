import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getWarp } from './interact.js';

// ============================================================
// O PERSONAGEM — blob de vidro iridescente que atravessa o site.
// A jornada (setProgress 0..1, dirigida pelo scroll em scenes.js):
//   0.00–0.14  longe, pequeno, à espreita          (cena 0)
//   0.14–0.26  quase some no ruído                 (cena 1)
//   0.26–0.36  a porta abre: ele se aproxima       (cena 2)
//   0.36–0.52  dominante, o centro da mesa         (cena 3)
//   0.52–0.62  deriva para o lado, o preço fala    (cena 4)
//   0.62–0.70  COLAPSA numa linha: a execução      (cena 5)
//   0.70–0.84  renasce dourado: a liquidação       (cena 6)
//   0.84–1.00  pequeno, calmo, em paz              (cenas 7–8)
// ============================================================

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function seg(p, a, b) {
  return (p - a) / (b - a);
}

export function initBlob3D({ reduced }) {
  const noop = { start() {}, setProgress() {} };
  const canvas = document.getElementById('heroCanvas');
  const stage = document.getElementById('stage');
  if (!canvas || !stage) return noop;
  if (new URLSearchParams(location.search).has('no3d')) return noop;
  // Mobile tem palco próprio (vídeo vertical 9:16) — 3D é experiência desktop
  if (window.matchMedia('(max-width: 720px), (pointer: coarse)').matches) return noop;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return noop;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.z = 6;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const violet = new THREE.PointLight(0xa78bfa, 30);
  violet.position.set(4, 3, 4);
  const sky = new THREE.PointLight(0x7dd3fc, 24);
  sky.position.set(-4, -2, 3);
  const amber = new THREE.PointLight(0xfbbf24, 16);
  amber.position.set(0, -4, -3);
  scene.add(violet, sky, amber);

  const geometry = new THREE.IcosahedronGeometry(1.65, 4);
  const basePositions = geometry.attributes.position.array.slice();

  const material = new THREE.MeshPhysicalMaterial({
    color: 0x9aa0c0,
    metalness: 0,
    roughness: 0.12,
    transmission: 0.92,
    thickness: 2.4,
    ior: 1.45,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [120, 700],
    envMapIntensity: 1.5,
  });

  const blob = new THREE.Mesh(geometry, material);
  scene.add(blob);

  const pos = geometry.attributes.position;
  function morph(t, amp) {
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = basePositions[ix];
      const y = basePositions[ix + 1];
      const z = basePositions[ix + 2];
      const n =
        amp * 0.16 * Math.sin(x * 2.1 + t * 0.9) * Math.sin(y * 1.7 - t * 0.7) +
        amp * 0.09 * Math.sin(y * 3.3 + t * 1.3) * Math.sin(z * 2.6 + t * 0.5) +
        amp * 0.05 * Math.sin(z * 4.7 - t * 1.1) * Math.sin(x * 3.9 + t * 0.8);
      const s = 1 + n;
      pos.array[ix] = x * s;
      pos.array[ix + 1] = y * s;
      pos.array[ix + 2] = z * s;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // ---------- A jornada ----------
  let journey = 0;
  const state = { s: 0.42, sx: 1, sy: 1, x: 0.9, y: -0.1, amber: 16, others: 1, amp: 1 };

  // p chega normalizado em "espaço de cenas": cada cena = 1/9 (0.111)
  function applyJourney(p) {
    let s = 0.42, x = 0.9, y = -0.1, sx = 1, sy = 1, amberI = 16, others = 1, amp = 1;

    if (p < 0.111) {
      // cena 0: longe, canto direito baixo
      s = lerp(0.4, 0.44, seg(p, 0, 0.111));
      x = 1.1; y = -0.4;
    } else if (p < 0.222) {
      // cena 1: quase engolido pelo ruído
      s = lerp(0.44, 0.3, seg(p, 0.111, 0.222));
      x = lerp(1.1, -1.4, seg(p, 0.111, 0.222));
      y = -0.6;
    } else if (p < 0.333) {
      // cena 2: a porta abre — aproximação
      const t = seg(p, 0.222, 0.333);
      s = lerp(0.3, 1.1, t * t);
      x = lerp(-1.4, 0, t);
      y = lerp(-0.6, 0, t);
    } else if (p < 0.444) {
      // cena 3: a mesa — dominante no centro
      s = 1.1; x = 0; y = 0;
      amp = 1.15;
    } else if (p < 0.556) {
      // cena 4: o preço — deriva para a direita, mais discreto
      const t = seg(p, 0.444, 0.556);
      s = lerp(1.1, 0.62, t);
      x = lerp(0, 1.5, t);
      y = lerp(0, 0.35, t);
    } else if (p < 0.667) {
      // cena 5: A EXECUÇÃO — colapsa numa linha horizontal
      const t = seg(p, 0.556, 0.667);
      const k = t < 0.5 ? t * 2 : (1 - t) * 2; // vai e volta
      s = 0.62;
      x = lerp(1.5, 0, t);
      y = lerp(0.35, 0, t);
      sy = lerp(1, 0.035, k);
      sx = lerp(1, 2.8, k);
      amp = lerp(1, 0.1, k);
    } else if (p < 0.833) {
      // cenas 6–7: renasce dourado — liquidação
      const t = seg(p, 0.667, 0.833);
      s = lerp(0.62, 0.85, t);
      x = 0; y = lerp(0, -0.15, t);
      amberI = lerp(16, 90, t);
      others = lerp(1, 0.35, t);
      amp = 0.8;
    } else {
      // cena 8: paz — pequeno e calmo no centro
      const t = seg(p, 0.833, 1);
      s = lerp(0.85, 0.55, t);
      x = 0; y = 0;
      amberI = lerp(90, 24, t);
      others = lerp(0.35, 0.8, t);
      amp = 0.6;
    }

    state.s = s; state.x = x; state.y = y; state.sx = sx; state.sy = sy;
    state.amber = amberI; state.others = others; state.amp = amp;
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function teardown() {
    renderer.setAnimationLoop(null);
    stage.classList.remove('has-3d');
    canvas.classList.remove('is-live');
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  }

  function start() {
    stage.classList.add('has-3d');
    canvas.classList.add('is-live');

    const clock = new THREE.Clock();

    if (reduced) {
      applyJourney(0);
      morph(0.6, 1);
      blob.scale.setScalar(0.7);
      renderer.render(scene, camera);
      return;
    }

    let frame = 0;
    let slowFrames = 0;
    let lastT = 0;
    let wt = 0; // relógio "warpado": o mouse acelera/reverte o tempo do blob

    renderer.setAnimationLoop(() => {
      const t = clock.getElapsedTime();
      const dt = t - lastT;
      lastT = t;
      wt += dt * (1 + getWarp() * 0.9);

      frame++;
      if (frame > 10 && frame <= 110 && dt > 1 / 24) {
        if (++slowFrames > 25) {
          teardown();
          return;
        }
      }

      applyJourney(journey);

      if (frame % 2 === 0) morph(wt * 0.55, state.amp);

      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;

      // interpolação suave até o alvo da jornada
      blob.scale.x = lerp(blob.scale.x, state.s * state.sx, 0.09);
      blob.scale.y = lerp(blob.scale.y, state.s * state.sy, 0.09);
      blob.scale.z = lerp(blob.scale.z, state.s, 0.09);
      blob.position.x = lerp(blob.position.x, state.x + mouse.x * 0.12, 0.08);
      blob.position.y = lerp(blob.position.y, state.y - mouse.y * 0.1, 0.08);

      amber.intensity = lerp(amber.intensity, state.amber, 0.06);
      violet.intensity = lerp(violet.intensity, 30 * state.others, 0.06);
      sky.intensity = lerp(sky.intensity, 24 * state.others, 0.06);

      blob.rotation.y = wt * 0.12 + mouse.x * 0.3;
      blob.rotation.x = Math.sin(wt * 0.08) * 0.15 + mouse.y * 0.22;

      renderer.render(scene, camera);
    });
  }

  return {
    start,
    setProgress(p) {
      journey = p;
    },
  };
}
