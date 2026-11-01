// Turntable avatar preview for the home / lobby screens (small dedicated canvas).
import * as THREE from 'three';

export class AvatarPreview {
  constructor(lib) {
    this.lib = lib;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.renderer = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.camera.position.set(0, 1.15, 3.6);
    this.camera.lookAt(0, 0.85, 0);
    const key = new THREE.DirectionalLight(0xffc890, 2.6);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0x88a8ff, 1.6);
    rim.position.set(-2, 2, -2.5);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffe0c0, 0x402818, 1.1));
    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.current = null;
    this.angle = 0;
    this.drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag == null) return;
      this.angle += (e.clientX - this.drag) * 0.012;
      this.drag = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.canvas.style.touchAction = 'none';
  }

  mount(container) {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    container.appendChild(this.canvas);
    this.container = container;
  }

  unmount() {
    this.canvas.remove();
    this.container = null;
  }

  setAvatar(id) {
    if (this.currentId === id) return;
    this.currentId = id;
    if (this.current) {
      this.turn.remove(this.current.root);
      this.current.mixer.stopAllAction();
    }
    const inst = this.lib.instantiate(id);
    const mixer = new THREE.AnimationMixer(inst.root);
    const clip = inst.clips.Stand_Idle || inst.clips.Sit_Idle;
    if (clip) mixer.clipAction(clip).play();
    this.turn.add(inst.root);
    this.current = { root: inst.root, mixer };
    this.angle = -0.5;
  }

  render(dt) {
    if (!this.container || !this.renderer || !this.container.isConnected) return;
    const w = this.container.clientWidth;
    const hh = this.container.clientHeight;
    if (!w || !hh) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    }
    if (this.drag == null) this.angle += dt * 0.5;
    this.turn.rotation.y = this.angle;
    this.current?.mixer.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
