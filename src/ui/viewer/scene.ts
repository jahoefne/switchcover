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
 *  - Bilresa: the reference STLs (BASE_URL + variant.model, flat back at z = 0, body towards
 *    −z) rotated 180° about Y (back faces −z, body towards +z — a rotation, never a mirror),
 *    moved to (pocket.x, pocket.y, pocket.floorZ) and rotated by pocket.rotDeg about Z
 *    around the pocket centre.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BILRESA_VARIANTS } from '../../config/defaults';
import type { BilresaVariant, CoverFrame } from '../../geometry/contract';

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
  background: 0x15171c,
  wall: 0x1d2026,
  gridMajor: 0x3a404c,
  gridMinor: 0x272b33,
  cover: 0xd8d4cc,
  plate: 0x5aa9ff,
  bilresa: 0xf2efe8,
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
  private options: SceneOptions = { showPlate: true, showBilresa: true, wireframe: false };
  private ghostGeneration = 0;
  private hasMesh = false;
  /** Outer w × h the camera was last fitted to (refit when either changes a lot). */
  private fittedSize: [number, number] = [0, 0];
  private raf = 0;
  private disposed = false;
  /** Called when a ghost model fails to load (once per variant). */
  onGhostError: ((message: string) => void) | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLORS.background, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '3D preview of the cover');
    this.canvas.setAttribute('role', 'img');
    host.appendChild(this.canvas);

    const { scene } = this;
    scene.background = new THREE.Color(COLORS.background);

    // Soft lighting: sky/ground hemisphere + a key light from the upper left front + a fill.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2d35, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-120, 160, 260);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde6ff, 0.45);
    fill.position.set(200, -80, 140);
    scene.add(fill);

    // Wall plane at z = 0 (slightly behind to avoid z-fighting with the cover base) + grid.
    const wallGeo = new THREE.PlaneGeometry(3000, 3000);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 1, metalness: 0 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.z = -0.3;
    scene.add(wall);
    const grid = new THREE.GridHelper(1000, 100, COLORS.gridMajor, COLORS.gridMinor);
    grid.rotation.x = Math.PI / 2; // XZ → XY (the wall)
    grid.position.z = -0.15;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.55;
    scene.add(grid);
    this.disposables.push(wallGeo, wallMat, grid.geometry, gridMat);

    // Cover.
    this.coverMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.cover,
      roughness: 0.82,
      metalness: 0,
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
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
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
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
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
      if (first) this.fitView();
    }
    old.dispose();
    this.requestRender();
  }

  setFrame(frame: CoverFrame | null): void {
    if (this.disposed) return;
    this.frame = frame;
    this.rebuildGhosts();
    if (frame) {
      const [fw, fh] = this.fittedSize;
      const moved = (a: number, b: number) => Math.abs(a - b) > 0.15 * b;
      if (fw === 0 || moved(frame.outer.w, fw) || moved(frame.outer.h, fh)) this.fitView();
    }
    this.requestRender();
  }

  setOptions(options: Partial<SceneOptions>): void {
    if (this.disposed) return;
    this.options = { ...this.options, ...options };
    this.coverMaterial.wireframe = this.options.wireframe;
    // Lit wire lines read too dark on the dark background; lift them a little.
    this.coverMaterial.emissive.setHex(this.options.wireframe ? 0x6a6660 : 0x000000);
    this.plateGroup.visible = this.options.showPlate;
    this.bilresaGroup.visible = this.options.showBilresa;
    this.requestRender();
  }

  /** Frame the cover (or, before the first mesh, the resolved outline) from the front. */
  fitView(): void {
    if (this.disposed) return;
    const box = new THREE.Box3();
    if (this.hasMesh && this.cover.geometry.boundingBox) box.copy(this.cover.geometry.boundingBox);
    if (this.frame) {
      const { outer, frontZ } = this.frame;
      box.expandByPoint(new THREE.Vector3(outer.cx - outer.w / 2, outer.cy - outer.h / 2, 0));
      box.expandByPoint(new THREE.Vector3(outer.cx + outer.w / 2, outer.cy + outer.h / 2, frontZ));
      this.fittedSize = [outer.w, outer.h];
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08;
    // Mostly frontal, slightly from the upper right so the depth reads.
    const dir = new THREE.Vector3(0.22, 0.28, 1).normalize();
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
      holder.position.set(f.placed.x, f.placed.y, f.floorZ);
      holder.rotation.z = THREE.MathUtils.degToRad(f.placed.rotDeg);
      this.bilresaGroup.add(holder);
      this.loadVariant(f.variant).then(
        (geo) => {
          if (this.disposed || gen !== this.ghostGeneration) return;
          const mesh = new THREE.Mesh(geo, this.bilresaMaterial);
          mesh.rotation.y = Math.PI; // (x, y, z) → (−x, y, −z): body now extends towards +z
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
