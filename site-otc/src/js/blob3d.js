import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Blob de vidro iridescente em 3D REAL (Three.js), renderizado ao vivo no hero.
// MeshPhysicalMaterial com transmission + iridescence + clearcoat, deformado
// por noise orgânico nos vértices. Reage ao mouse.
//
// Robustez:
// - sem WebGL → fallback CSS (.blob-ph) permanece;
// - o loop só liga depois do preloader (initBlob3D().start());
// - watchdog de FPS: se a máquina não segura 24fps, o 3D se desliga
//   sozinho e o fallback CSS volta — o site nunca fica pesado.
export function initBlob3D({ reduced }) {
  const noop = { start() {} };
  const canvas = document.getElementById('heroCanvas');
  const media = document.getElementById('heroMedia');
  if (!canvas || !media) return noop;
  // ?no3d na URL desliga o 3D (útil para QA e devices problemáticos)
  if (new URLSearchParams(location.search).has('no3d')) return noop;

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

  // Ambiente para reflexos realistas no vidro
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Luzes coloridas → reflexos iridescentes
  const l1 = new THREE.PointLight(0xa78bfa, 30);
  l1.position.set(4, 3, 4);
  const l2 = new THREE.PointLight(0x7dd3fc, 24);
  l2.position.set(-4, -2, 3);
  const l3 = new THREE.PointLight(0xfbbf24, 16);
  l3.position.set(0, -4, -3);
  scene.add(l1, l2, l3);

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

  // Noise orgânico barato (camadas de senoides) para o morphing
  const pos = geometry.attributes.position;
  function morph(t) {
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = basePositions[ix];
      const y = basePositions[ix + 1];
      const z = basePositions[ix + 2];
      const n =
        0.16 * Math.sin(x * 2.1 + t * 0.9) * Math.sin(y * 1.7 - t * 0.7) +
        0.09 * Math.sin(y * 3.3 + t * 1.3) * Math.sin(z * 2.6 + t * 0.5) +
        0.05 * Math.sin(z * 4.7 - t * 1.1) * Math.sin(x * 3.9 + t * 0.8);
      const s = 1 + n;
      pos.array[ix] = x * s;
      pos.array[ix + 1] = y * s;
      pos.array[ix + 2] = z * s;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // Mouse parallax com suavização
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function resize() {
    const w = media.clientWidth * 1.24;
    const h = media.clientHeight * 1.24;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // Só renderiza com o hero visível
  let running = true;
  new IntersectionObserver(
    ([entry]) => {
      running = entry.isIntersecting;
    },
    { threshold: 0 }
  ).observe(media);

  function teardown() {
    renderer.setAnimationLoop(null);
    media.classList.remove('has-3d');
    canvas.classList.remove('is-live');
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  }

  function start() {
    media.classList.add('has-3d');
    canvas.classList.add('is-live');

    const clock = new THREE.Clock();

    if (reduced) {
      morph(0.6);
      renderer.render(scene, camera);
      return;
    }

    let frame = 0;
    let slowFrames = 0;
    let lastT = 0;

    renderer.setAnimationLoop(() => {
      if (!running) return;
      const t = clock.getElapsedTime();
      const dt = t - lastT;
      lastT = t;

      // Watchdog: nos primeiros ~110 frames, conta frames abaixo de 24fps.
      // Máquina fraca → desliga o 3D e devolve o fallback CSS.
      frame++;
      if (frame > 10 && frame <= 110 && dt > 1 / 24) {
        if (++slowFrames > 25) {
          teardown();
          return;
        }
      }

      // morph a cada 2 frames — CPU leve, diferença invisível a olho
      if (frame % 2 === 0) morph(t * 0.55);

      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;

      blob.rotation.y = t * 0.12 + mouse.x * 0.35;
      blob.rotation.x = Math.sin(t * 0.08) * 0.15 + mouse.y * 0.25;

      renderer.render(scene, camera);
    });
  }

  return { start };
}
