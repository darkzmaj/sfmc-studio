// Interactive WebGL viewer: orbit/pan/zoom, camera presets, perspective/ortho,
// lighting presets, background, grid/floor, high-resolution capture.
import {
  AmbientLight, Box3, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh, NeutralToneMapping,
  OrthographicCamera, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial,
  SRGBColorSpace, Vector3, WebGLRenderer, type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CharacterRig } from './rig';

export type LightingPreset = 'studio' | 'soft' | 'dramatic' | 'flat';
export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'three-quarter';
export interface ViewerOptions { background: string; transparent: boolean; grid: boolean; floor: boolean; lighting: LightingPreset; fov: number; ortho: boolean }
export const DEFAULT_VIEW: ViewerOptions = { background: '#1b1a19', transparent: false, grid: true, floor: true, lighting: 'studio', fov: 35, ortho: false };

const LIGHTS: Record<LightingPreset, { env: number; hemi: number; ambient: number; key: number; fill: number; rim: number }> = {
  studio: { env: 0.35, hemi: 0.5, ambient: 0.15, key: 2.2, fill: 0.7, rim: 1.4 },
  soft: { env: 0.75, hemi: 0.9, ambient: 0.35, key: 0.9, fill: 0.6, rim: 0.4 },
  dramatic: { env: 0.12, hemi: 0.15, ambient: 0.05, key: 3.2, fill: 0.15, rim: 2.4 },
  flat: { env: 0.0, hemi: 0.0, ambient: 2.6, key: 0, fill: 0, rim: 0 },
};

/** Camera distance that fits a box's height and horizontal extent into the view, with a margin. */
function fitDistance(box: Box3, fovDeg: number, aspect: number, margin: number) {
  const size = box.getSize(new Vector3());
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const horiz = Math.max(size.x, size.z);
  return Math.max(size.y / 2 / tanV, horiz / 2 / tanH) * margin + horiz / 2;
}

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CharacterRig();
  private persp = new PerspectiveCamera(35, 1, 0.5, 5000);
  private ortho = new OrthographicCamera(-50, 50, 50, -50, -5000, 5000);
  private camera: PerspectiveCamera | OrthographicCamera = this.persp;
  readonly controls: OrbitControls;
  private lights = new Group();
  private key = new DirectionalLight(0xfff4e8, 2);
  private fill = new DirectionalLight(0xdfe8ff, 0.7);
  private rim = new DirectionalLight(0xffffff, 1.4);
  private hemi = new HemisphereLight(0xffffff, 0x3a3530, 0.5);
  private ambient = new AmbientLight(0xffffff, 0.15);
  private envTex: Texture;
  private grid = new GridHelper(256, 16, 0x5a524b, 0x34302c);
  private floor = new Mesh(new PlaneGeometry(600, 600), new ShadowMaterial({ opacity: 0.28 }));
  private opts: ViewerOptions = { ...DEFAULT_VIEW };
  private needsRender = true;
  private raf = 0;
  private ro: ResizeObserver;
  private host: HTMLElement;
  private framed = new Box3(new Vector3(-20, 0, -20), new Vector3(20, 80, 20));

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = 'viewer-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D character preview. Drag to rotate, right-drag or shift-drag to pan, scroll to zoom.');
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);

    const pmrem = new PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;

    this.key.position.set(60, 120, 90);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -80, right: 80, top: 120, bottom: -20, near: 1, far: 400 });
    this.key.shadow.bias = -0.0005;
    this.fill.position.set(-90, 60, 60);
    this.rim.position.set(-30, 90, -120);
    this.lights.add(this.key, this.fill, this.rim, this.hemi, this.ambient);
    this.scene.add(this.lights, this.rig.root, this.grid, this.floor);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.grid.position.y = 0.02;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 1500;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.listenToKeyEvents(this.renderer.domElement);

    this.rig.onChange = (fit) => {
      this.rig.root.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; } });
      if (fit) this.frame();
      this.invalidate();
    };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.setOptions(this.opts);
    this.view('three-quarter');
    this.loop();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__viewer = this;
  }

  invalidate() { this.needsRender = true; }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const moved = this.controls.update();
    if (moved || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.invalidate();
  }

  private updateOrtho() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const size = this.framed.getSize(new Vector3());
    const dist = this.persp.position.distanceTo(this.controls.target);
    const half = Math.max(size.y * 0.6, (dist * Math.tan((this.persp.fov * Math.PI) / 360)));
    this.ortho.left = (-half * w) / h; this.ortho.right = (half * w) / h;
    this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  setOptions(patch: Partial<ViewerOptions>) {
    this.opts = { ...this.opts, ...patch };
    const o = this.opts;
    this.scene.background = o.transparent ? null : new Color(o.background);
    this.renderer.setClearColor(0x000000, 0);
    this.grid.visible = o.grid;
    this.floor.visible = o.floor;
    const L = LIGHTS[o.lighting];
    this.scene.environmentIntensity = L.env;
    this.hemi.intensity = L.hemi; this.ambient.intensity = L.ambient;
    this.key.intensity = L.key; this.fill.intensity = L.fill; this.rim.intensity = L.rim;
    this.key.castShadow = L.key > 0;
    if (this.persp.fov !== o.fov) { this.persp.fov = o.fov; this.persp.updateProjectionMatrix(); }
    const wantOrtho = o.ortho;
    if (wantOrtho !== (this.camera === this.ortho)) {
      const from = this.camera;
      const to = wantOrtho ? this.ortho : this.persp;
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
      this.camera = to;
      this.controls.object = to;
      this.updateOrtho();
    }
    this.invalidate();
  }

  get options() { return this.opts; }

  /** Frame the character's bounds. */
  frame() {
    const b = this.rig.bounds();
    if (!b.isEmpty()) this.framed = b;
    const size = this.framed.getSize(new Vector3());
    const center = this.framed.getCenter(new Vector3());
    const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(0.6, 0.15, 0.8).normalize();
    const dist = fitDistance(this.framed, this.persp.fov, this.persp.aspect, 1.15);
    this.controls.target.copy(center);
    this.persp.position.copy(center).addScaledVector(dir, dist);
    this.ortho.position.copy(this.persp.position);
    this.camera.lookAt(center);
    this.grid.scale.setScalar(Math.max(1, size.y / 80));
    this.updateOrtho();
    this.controls.update();
    this.invalidate();
  }

  view(preset: ViewPreset) {
    // Source models face +X; after the Z-up -> Y-up root rotation they still face +X.
    const dirs: Record<ViewPreset, Vector3> = {
      front: new Vector3(1, 0.04, 0), back: new Vector3(-1, 0.04, 0), left: new Vector3(0, 0.04, -1),
      right: new Vector3(0, 0.04, 1), top: new Vector3(0.001, 1, 0), 'three-quarter': new Vector3(0.75, 0.12, 0.55),
    };
    const center = this.framed.getCenter(new Vector3());
    const dist = Math.max(this.persp.position.distanceTo(this.controls.target), 60);
    this.controls.target.copy(center);
    this.persp.position.copy(center).addScaledVector(dirs[preset].normalize(), dist);
    this.ortho.position.copy(this.persp.position);
    this.camera.lookAt(center);
    this.controls.update();
    this.invalidate();
  }

  reset() {
    this.persp.position.set(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.view('three-quarter');
    this.frame();
  }

  zoom(factor: number) {
    const t = this.controls.target;
    if (this.camera === this.ortho) { this.ortho.zoom = Math.min(20, Math.max(0.1, this.ortho.zoom / factor)); this.ortho.updateProjectionMatrix(); }
    else this.persp.position.sub(t).multiplyScalar(factor).add(t);
    this.controls.update();
    this.invalidate();
  }

  get maxCaptureSize() {
    const gl = this.renderer.getContext();
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, dims[0], dims[1]);
  }

  /** Render at an exact resolution and return a PNG. The visible canvas is restored afterwards. */
  async capture(opts: { width: number; height: number; transparent?: boolean; background?: string; hideHelpers?: boolean; fit?: boolean }): Promise<Blob> {
    const max = this.maxCaptureSize;
    const width = Math.min(Math.round(opts.width), max), height = Math.min(Math.round(opts.height), max);
    const prev = { bg: this.scene.background, grid: this.grid.visible, floor: this.floor.visible, ratio: this.renderer.getPixelRatio() };
    const cam = this.camera.clone() as PerspectiveCamera | OrthographicCamera;
    if ((cam as PerspectiveCamera).isPerspectiveCamera) {
      const pc = cam as PerspectiveCamera;
      pc.aspect = width / height;
      if (opts.fit) {
        // Re-fit the character to the output aspect along the current viewing direction.
        const b = this.rig.bounds();
        if (!b.isEmpty()) {
          const center = b.getCenter(new Vector3());
          const dir = pc.position.clone().sub(this.controls.target).normalize();
          pc.position.copy(center).addScaledVector(dir, fitDistance(b, pc.fov, pc.aspect, 1.08));
          pc.lookAt(center);
        }
      }
    }
    else {
      const o = cam as OrthographicCamera;
      const half = (o.top - o.bottom) / 2;
      o.left = -half * width / height; o.right = half * width / height;
    }
    cam.updateProjectionMatrix();
    this.scene.background = opts.transparent ? null : new Color(opts.background ?? this.opts.background);
    if (opts.hideHelpers ?? true) { this.grid.visible = false; }
    if (opts.transparent) this.floor.visible = false;
    let blob: Promise<Blob | null>;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.renderer.render(this.scene, cam);
      // toBlob copies the bitmap synchronously, so restoring the canvas afterwards is safe.
      blob = new Promise((res) => this.renderer.domElement.toBlob(res, 'image/png'));
    } finally {
      this.scene.background = prev.bg; this.grid.visible = prev.grid; this.floor.visible = prev.floor;
      this.renderer.setPixelRatio(prev.ratio);
      this.resize();
      this.renderer.render(this.scene, this.camera);
    }
    const out = await blob;
    if (!out) throw new Error('Capture failed (canvas too large for this GPU?)');
    return out;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.rig.dispose();
    this.envTex.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as ShadowMaterial).dispose();
    this.grid.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
