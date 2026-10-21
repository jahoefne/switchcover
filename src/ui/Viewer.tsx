/**
 * Minimal three.js viewer (Phase 0). WP3 replaces it with the full viewer (ghosts, wall,
 * toggles). Geometry arrives in world coordinates (mm, Y up, Z out of the wall), which is
 * three.js' convention, so no conversion is needed.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ViewerMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh;
  render(): void;
}

export function Viewer({ mesh }: { mesh: ViewerMesh | null }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<ViewerState | null>(null);
  /** Radius the camera was last fitted to; refit when the model size changes a lot. */
  const fittedRadius = useRef(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1d22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(80, 120, 200);
    scene.add(sun);
    const grid = new THREE.GridHelper(400, 40, 0x444a55, 0x2a2e36);
    grid.rotation.x = Math.PI / 2; // wall plane = XY
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    camera.position.set(120, -160, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;

    const material = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.85, flatShading: true });
    const meshObj = new THREE.Mesh(new THREE.BufferGeometry(), material);
    scene.add(meshObj);

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    state.current = { renderer, scene, camera, controls, mesh: meshObj, render };

    return () => {
      ro.disconnect();
      controls.dispose();
      meshObj.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s || !mesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    s.mesh.geometry.dispose();
    s.mesh.geometry = geometry;
    const sphere = geometry.boundingSphere;
    if (sphere && Math.abs(sphere.radius - fittedRadius.current) > 0.15 * Math.max(1, fittedRadius.current)) {
      fittedRadius.current = sphere.radius;
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(s.camera.fov / 2));
      const dir = new THREE.Vector3(0.35, -0.45, 1).normalize();
      s.controls.target.copy(sphere.center);
      s.camera.position.copy(sphere.center).addScaledVector(dir, dist * 1.1);
      s.controls.update();
    }
    s.render();
  }, [mesh]);

  return <div ref={host} className="viewer" />;
}
