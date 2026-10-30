/**
 * Imperative three.js scene for the cover preview. React only calls setters; rendering is
 * on demand (coalesced into one requestAnimationFrame), never per frame through React.
 *
 * Coordinates are the app's world coordinates (mm, X right, Y up, Z out of the wall), which
 * is three.js' own convention, so meshes and ghosts need no conversion.
 *
 * Ghosts:
 *  - plate: translucent rounded box frame.plate.w × h × protrusion standing on the wall at
 *    the origin; its edges are drawn x-ray style (no depth test) so they show through the
 *    cover, its faces only where nothing is in front (openings, wireframe mode).
 *  - Bilresa: the reference STLs (BASE_URL + variant.model). Their flat z = 0 face is the
 *    FRONT (buttons) and the rounded body runs towards −z to the back flat at −depth, which is
 *    already the mounting orientation, so the STL is NOT rotated about X/Y: it is moved to
 *    (pocket.x, pocket.y, floorZ + depth) — back flat on the pocket floor, front facing out —
 *    and rotated by pocket.rotDeg about Z around the pocket centre (bilresaGhostPlacement,
 *    shared with the geometry tests).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BILRESA_VARIANTS } from '../../config/defaults';
import type { BilresaVariant, CoverFrame } from '../../geometry/contract';
import { needsRefit } from './fit';
import { bilresaGhostPlacement } from './ghost';
import { assemblyOffsets } from './assembly';

export interface ViewerMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface SceneOptions {
  showPlate: boolean;
  showBilresa: boolean;
  wireframe: boolean;
}

const COLORS = {
  cover: 0xe1e5db,
  plate: 0x46f6ff,
  bilresa: 0xf4f1e6,
};

/** Crease angle for normals: smooth across gentle curvature, sharp at real edges. */
const CREASE = THREE.MathUtils.degToRad(35);

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3));
  const x0 = -w / 2;
  const y0 = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x0 + w - rr, y0);
  if (rr > 0) s.absarc(x0 + w - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x0 + w, y0 + h - rr);
  if (rr > 0) s.absarc(x0 + w - rr, y0 + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y0 + h);
  if (rr > 0) s.absarc(x0 + rr, y0 + h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);
  if (rr > 0) s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

export class CoverScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
  private readonly controls: OrbitControls;
  private readonly coverMaterial: THREE.MeshStandardMaterial;
  private readonly cover: THREE.Mesh;
  private readonly plateMaterial: THREE.MeshBasicMaterial;
  private readonly plateEdgeMaterial: THREE.LineBasicMaterial;
  private readonly bilresaMaterial: THREE.MeshStandardMaterial;
  private readonly plateGroup = new THREE.Group();
  private readonly bilresaGroup = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly stlCache = new Map<BilresaVariant, Promise<THREE.BufferGeometry>>();
  private readonly loader = new STLLoader();
  private frame: CoverFrame | null = null;
  private options: SceneOptions = { showPlate: false, showBilresa: true, wireframe: false };
  private assemblyProgress = 0;
  private exploded = false;
  private motionEnabled = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  private animation: { start: number; from: number; to: number; duration: number } | null = null;
  private pulseUntil = 0;
  private ghostGeneration = 0;
  private hasMesh = false;
  /** Outer w, h, cx, cy the camera was last fitted to (refit when the outline changes a lot). */
  private fitted: [number, number, number, number] = [0, 0, 0, 0];
  private raf = 0;
  private disposed = false;
  /** Called when a ghost model fails to load (once per variant). */
  onGhostError: ((message: string) => void) | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '3D preview of the cover');
    this.canvas.setAttribute('role', 'img');
    host.appendChild(this.canvas);

    const { scene } = this;

    // Soft lighting: sky/ground hemisphere + a key light from the upper left front + a fill.
    scene.add(new THREE.HemisphereLight(0xd8f4ff, 0x1b1638, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-120, 160, 260);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x46f6ff, 1.3);
    fill.position.set(200, -80, 140);
    scene.add(fill);

    // Transparent canvas lets the animated reactor chamber surround the real geometry.
    const rim = new THREE.DirectionalLight(0xff4cce, 2.2);
    rim.position.set(-180, 70, -90);
    scene.add(rim);

    // Cover.
    this.coverMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.cover,
      roughness: 0.46,
      metalness: 0.15,
      flatShading: false,
      side: THREE.FrontSide,
    });
    this.cover = new THREE.Mesh(new THREE.BufferGeometry(), this.coverMaterial);
    scene.add(this.cover);

    // Ghost materials.
    // Plate faces are depth-tested (visible through openings / in wireframe); its edges are
    // drawn x-ray style so the plate outline always shows through the cover.
    this.plateMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.plate,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.plateEdgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.plate, transparent: true, opacity: 0.7, depthTest: false });
    this.bilresaMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.bilresa,
      roughness: 0.55,
      metalness: 0,
      transparent: false,
      opacity: 1,
      depthWrite: true,
    });
    this.plateGroup.renderOrder = 10;
    scene.add(this.plateGroup, this.bilresaGroup);
    this.disposables.push(this.coverMaterial, this.plateMaterial, this.plateEdgeMaterial, this.bilresaMaterial);

    this.camera.position.set(0, 0, 400);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', this.requestRender);
  }

  /** Coalesce renders into the next animation frame. */
  readonly requestRender = (): void => {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.disposed) {
        this.tick(performance.now());
        this.renderer.render(this.scene, this.camera);
        if (this.animation || performance.now() < this.pulseUntil) this.requestRender();
      }
    });
  };

  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setMesh(mesh: ViewerMesh | null): void {
    if (this.disposed) return;
    const old = this.cover.geometry;
    if (!mesh || mesh.indices.length === 0) {
      this.cover.geometry = new THREE.BufferGeometry();
      this.hasMesh = false;
    } else {
      const indexed = new THREE.BufferGeometry();
      indexed.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      indexed.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const geometry = toCreasedNormals(indexed, CREASE);
      if (geometry !== indexed) indexed.dispose();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      this.cover.geometry = geometry;
      const first = !this.hasMesh;
      this.hasMesh = true;
      if (first) {
        this.fitView();
        this.revealAssembly();
      } else if (this.motionEnabled) this.pulseUntil = performance.now() + 650;
    }
    old.dispose();
    this.requestRender();
  }

  setFrame(frame: CoverFrame | null): void {
    if (this.disposed) return;
    this.frame = frame;
    this.rebuildGhosts();
    if (frame && needsRefit(this.fitted, frame.outer)) this.fitView();
    this.requestRender();
  }

  setOptions(options: Partial<SceneOptions>): void {
    if (this.disposed) return;
    this.options = { ...this.options, ...options };
    this.coverMaterial.wireframe = this.options.wireframe;
    // Lit wire lines read too dark on the dark background; lift them a little.
    this.coverMaterial.emissive.setHex(this.options.wireframe ? 0x0a7b85 : 0x000000);
    this.plateGroup.visible = this.options.showPlate || this.assemblyProgress > 0.001;
    this.bilresaGroup.visible = this.options.showBilresa;
    this.requestRender();
  }

  setMotionEnabled(enabled: boolean): void {
    this.motionEnabled = enabled;
    if (!enabled) {
      this.animation = null;
      this.pulseUntil = 0;
      this.assemblyProgress = this.exploded ? 1 : 0;
    }
    this.requestRender();
  }

  setExploded(exploded: boolean): void {
    this.exploded = exploded;
    this.animateAssembly(exploded ? 1 : 0);
  }

  revealAssembly(): void {
    if (this.disposed || !this.hasMesh) return;
    this.exploded = false;
    this.assemblyProgress = this.motionEnabled ? 1 : 0;
    this.animateAssembly(0, 1600);
  }

  private animateAssembly(to: number, duration = 1100): void {
    if (this.disposed) return;
    if (this.motionEnabled) this.animation = { start: performance.now(), from: this.assemblyProgress, to, duration };
    else { this.assemblyProgress = to; this.animation = null; }
    this.requestRender();
  }

  private tick(now: number): void {
    if (this.animation) {
      const { start, from, to, duration } = this.animation;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      this.assemblyProgress = from + (to - from) * eased;
      if (t >= 1) this.animation = null;
    }
    const size = this.frame ? Math.max(this.frame.outer.w, this.frame.outer.h) : 90;
    const offsets = assemblyOffsets(this.assemblyProgress, size);
    this.cover.position.z = offsets.cover;
    this.plateGroup.position.z = offsets.plate;
    this.bilresaGroup.position.z = offsets.bilresa;
    this.plateGroup.visible = this.options.showPlate || this.assemblyProgress > 0.001;
    const pulse = Math.max(0, (this.pulseUntil - now) / 650);
    this.coverMaterial.emissive.setHex(this.options.wireframe ? 0x0a7b85 : 0x0b6973);
    this.coverMaterial.emissiveIntensity = this.options.wireframe ? 1 : pulse * 0.5;
  }

  /**
   * Frame the cover (or, before the first mesh, the resolved outline) and the plate from the
   * front (an extension plate lies beside the plate; a cap's outline contains it anyway).
   */
  fitView(): void {
    if (this.disposed) return;
    const box = new THREE.Box3();
    if (this.hasMesh && this.cover.geometry.boundingBox) box.copy(this.cover.geometry.boundingBox);
    if (this.frame) {
      const { outer, frontZ, plate } = this.frame;
      box.expandByPoint(new THREE.Vector3(outer.cx - outer.w / 2, outer.cy - outer.h / 2, 0));
      box.expandByPoint(new THREE.Vector3(outer.cx + outer.w / 2, outer.cy + outer.h / 2, frontZ));
      box.expandByPoint(new THREE.Vector3(-plate.w / 2, -plate.h / 2, 0));
      box.expandByPoint(new THREE.Vector3(plate.w / 2, plate.h / 2, plate.protrusion));
      this.fitted = [outer.w, outer.h, outer.cx, outer.cy];
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.3;
    // Mostly frontal, slightly from the upper right so the depth reads.
    const dir = new THREE.Vector3(0.48, 0.3, 1).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.5, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.clearGroup(this.plateGroup, true);
    this.clearGroup(this.bilresaGroup, false);
    this.cover.geometry.dispose();
    for (const d of this.disposables) d.dispose();
    for (const p of this.stlCache.values()) p.then((g) => g.dispose()).catch(() => {});
    this.stlCache.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---------------------------------------------------------------------------------

  private clearGroup(group: THREE.Group, disposeGeometry: boolean): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (disposeGeometry) {
        child.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
        });
      }
    }
  }

  private rebuildGhosts(): void {
    const frame = this.frame;
    const gen = ++this.ghostGeneration;
    this.clearGroup(this.plateGroup, true);
    this.clearGroup(this.bilresaGroup, false); // STL geometries are cached and shared
    if (!frame) return;

    // Plate ghost.
    const { w, h, protrusion, cornerR } = frame.plate;
    if (protrusion > 0) {
      const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, cornerR), { depth: protrusion, bevelEnabled: false, curveSegments: 6 });
      const body = new THREE.Mesh(geo, this.plateMaterial);
      body.renderOrder = 10;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), this.plateEdgeMaterial);
      edges.renderOrder = 11;
      this.plateGroup.add(body, edges);
    }

    // Bilresa ghosts.
    for (const f of frame.features) {
      if (f.kind !== 'pocket') continue;
      const holder = new THREE.Group();
      const g = bilresaGhostPlacement(f);
      holder.position.set(...g.position);
      holder.rotation.z = THREE.MathUtils.degToRad(g.rotZDeg);
      this.bilresaGroup.add(holder);
      this.loadVariant(f.variant).then(
        (geo) => {
          if (this.disposed || gen !== this.ghostGeneration) return;
          const mesh = new THREE.Mesh(geo, this.bilresaMaterial); // as modelled: front at +z, back towards the wall
          mesh.renderOrder = 5;
          holder.add(mesh);
          this.requestRender();
        },
        () => {},
      );
    }
  }

  private loadVariant(variant: BilresaVariant): Promise<THREE.BufferGeometry> {
    let p = this.stlCache.get(variant);
    if (!p) {
      const url = import.meta.env.BASE_URL + BILRESA_VARIANTS[variant].model;
      p = this.loader.loadAsync(url).then((geo) => {
        geo.computeBoundingSphere();
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        return geo;
      });
      // The failed promise stays cached, so the error is reported (and fetched) only once.
      p.catch((e: unknown) => {
        this.onGhostError?.(`Could not load the ${BILRESA_VARIANTS[variant].label} model: ${e instanceof Error ? e.message : String(e)}`);
      });
      this.stlCache.set(variant, p);
    }
    return p;
  }
}
