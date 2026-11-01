// Loup-Garou de Thiercelieux — client entry point.
import * as THREE from 'three';
import './style.css';
import { C2S, PHASES, AVATARS } from '@shared/protocol.js';
import { params, settings, isMobile, storageGet, storageSet } from './config.js';
import { Quality } from './engine/quality.js';
import { onProgress, reportProgress } from './engine/assets.js';
import { Environment } from './world/environment.js';
import { loadCamp } from './world/camp.js';
import { Campfire, Fireflies } from './world/fire.js';
import { Markers } from './world/markers.js';
import { CharacterLibrary } from './characters/library.js';
import { CameraRig } from './view/cameraRig.js';
import { Eyelids } from './view/eyelids.js';
import { AvatarPreview } from './view/preview.js';
import { Labels } from './ui/labels.js';
import { Hud } from './ui/hud.js';
import { HomeScreen, LobbyScreen } from './ui/screens.js';
import { LOGO_SVG } from './ui/roleArt.js';
import { toast } from './ui/toast.js';
import { AudioEngine, Narrator } from './audio/audio.js';
import { SocketNet, getSession, setSession } from './game/net.js';
import { GameClient } from './game/gameClient.js';

const $ = (id) => document.getElementById(id);
const loadingEl = $('loading');
loadingEl.querySelector('.loading-logo').innerHTML = `<div class="logo"><div class="emblem">${LOGO_SVG}</div><div class="words"><span class="w1">Loup-Garou</span><span class="w2">de Thiercelieux</span></div></div>`;
onProgress((v) => { loadingEl.querySelector('.loading-bar span').style.width = `${Math.round(v * 100)}%`; });
const setLoadingText = (t) => { loadingEl.querySelector('.loading-text').textContent = t; };

async function boot() {
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true; // first-person body (own torso clipped away)
  const quality = new Quality(renderer);
  renderer.setPixelRatio(quality.dpr);
  // never write an inline CSS size on the canvas (CSS keeps it at 100 %): a tab opened in the
  // background reports 0x0 at boot and would otherwise stay 0x0 forever
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, (window.innerWidth || 16) / (window.innerHeight || 9), 0.05, 900);
  scene.add(camera);
  const env = new Environment(scene, renderer, quality);

  setLoadingText('Montage des tentes…');
  reportProgress('boot', 1, 1);
  const camp = await loadCamp(quality);
  scene.add(camp.root);
  env.registerEmissives(camp.root);
  env.setLanternMarkers(camp.lights);
  const introTarget = camp.intro.target || camp.fire;
  env.setOrientation(camp.fire, introTarget.clone().sub(camp.intro.position));

  const fire = new Campfire(quality);
  fire.group.position.copy(camp.fire);
  scene.add(fire.group);
  const fireflies = new Fireflies(quality);
  fireflies.points.position.copy(camp.fire);
  scene.add(fireflies.points);

  setLoadingText('Les campeurs arrivent…');
  const lib = new CharacterLibrary();
  await lib.init();

  const cameraRig = new CameraRig(camera, canvas);
  cameraRig.setIntro(camp.intro);
  const eyelids = new Eyelids($('overlay'), canvas);
  const labels = new Labels($('labels'), camera);
  const markers = new Markers(scene);
  const audio = new AudioEngine();
  const narrator = new Narrator();
  const preview = new AvatarPreview(lib);

  let net;
  if (params.demo) {
    const { DemoNet } = await import('./game/demoServer.js');
    net = new DemoNet({ speed: params.speed, players: params.players, role: params.role, phase: params.phase });
  } else {
    net = new SocketNet();
  }

  let game = null;
  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
  };
  const quit = () => {
    net.emit(C2S.LEAVE, {});
    setSession(null);
    location.href = location.pathname;
  };
  const hud = new Hud($('hud'), {
    onChat: (t) => game.sendChat(t),
    onTyping: () => game.noteTyping(),
    onEmote: (g) => game.emoteGesture(g),
    onPeek: (on) => game.setPeek(on),
    onPlayerClick: (id) => game.selectPlayer(id),
    onMyCard: () => game.showMyCard(false),
    onQuality: (q) => quality.set(q),
    onGyro: (on) => cameraRig.setGyro(on),
    onNarratorOff: () => narrator.stop(),
    onFullscreen: fullscreen,
    onQuit: quit,
    onClick: () => audio.play('click'),
  });
  const updateQualityInfo = () => hud.setQualityInfo(`Palier actuel : ${quality.tier.label}${quality.auto ? ' (auto)' : ''}`);
  updateQualityInfo();

  game = new GameClient({ net, scene, camera, camp, lib, env, quality, hud, labels, audio, narrator, eyelids, markers, cameraRig });
  game.onQuit = quit;
  game.onLeft = () => setTimeout(() => { location.href = location.pathname; }, 2500);

  // ------------------------------------------------------------------------------------------
  // screens
  // ------------------------------------------------------------------------------------------
  const screensEl = $('screens');
  let home = null;
  let lobby = null;
  let lobbyHidden = false;
  let backBtn = null;
  const profile = storageGet('lg_profile', {});

  const joined = (res, name, avatar) => {
    if (!res.ok) return res;
    storageSet('lg_profile', { name, avatar });
    if (!net.offline) {
      setSession({ code: res.code, token: res.token, name, avatar, playerId: res.playerId });
      const url = new URL(location.href);
      url.searchParams.set('room', res.code);
      history.replaceState(null, '', url);
    }
    return res;
  };
  const connectFirst = async () => {
    if (net.offline) return true;
    const ok = await net.waitConnected(5000);
    return ok;
  };
  const create = async (name, avatar) => {
    if (!(await connectFirst())) return { ok: false, error: 'Serveur injoignable. Essayez la démo hors ligne.' };
    return joined(await net.request(C2S.CREATE, { name, avatar }), name, avatar);
  };
  const join = async (code, name, avatar, token) => {
    if (!(await connectFirst())) return { ok: false, error: 'Serveur injoignable. Essayez la démo hors ligne.' };
    return joined(await net.request(C2S.JOIN, { code, name, avatar, token }), name, avatar);
  };

  function showHome() {
    if (home) return;
    home = new HomeScreen(screensEl, {
      lib, preview,
      defaults: { name: params.name || profile.name || '', avatar: profile.avatar, code: params.room },
      onCreate: create,
      onJoin: (code, name, avatar) => {
        const s = getSession();
        return join(code, name, avatar, s?.code === code ? s.token : undefined);
      },
      onDemo: () => { location.href = `${location.pathname}?demo=1`; },
    });
  }
  function hideHome() {
    home?.destroy();
    home = null;
  }
  function showLobby() {
    if (lobby || lobbyHidden) return;
    lobby = new LobbyScreen(screensEl, {
      lib, preview,
      onAvatar: (avatar) => {
        net.request(C2S.AVATAR, { avatar });
        storageSet('lg_profile', { ...storageGet('lg_profile', {}), avatar });
        const s = getSession();
        if (s) setSession({ ...s, avatar });
      },
      onConfig: (cfg) => net.request(C2S.CONFIG, cfg).then((r) => { if (!r.ok) toast(r.error || 'Réglage refusé.', 'error'); }),
      onAddBot: () => net.request(C2S.ADD_BOT, {}).then((r) => { if (!r.ok) toast(r.error || 'Impossible d’ajouter un bot.', 'error'); }),
      onKick: (playerId) => net.request(C2S.KICK, { playerId }),
      onStart: () => net.request(C2S.START, {}),
      onLeave: quit,
      onClose: () => {
        lobbyHidden = true;
        hideLobby();
        backBtn = document.createElement('button');
        backBtn.className = 'btn primary';
        backBtn.textContent = 'Retour au salon';
        Object.assign(backBtn.style, { position: 'absolute', left: '50%', bottom: 'calc(var(--sab) + 20px)', transform: 'translateX(-50%)' });
        backBtn.onclick = () => { lobbyHidden = false; backBtn.remove(); backBtn = null; showLobby(); lobby?.update(game.state); };
        screensEl.appendChild(backBtn);
      },
    });
  }
  function hideLobby() {
    lobby?.destroy();
    lobby = null;
  }

  game.onStateUI = (s) => {
    hideHome();
    if (s.phase === PHASES.LOBBY) {
      hud.show(false);
      showLobby();
      lobby?.update(s);
    } else {
      lobbyHidden = false;
      backBtn?.remove();
      backBtn = null;
      hideLobby();
      hud.show(true);
    }
  };

  // ------------------------------------------------------------------------------------------
  // quality, resize, visibility
  // ------------------------------------------------------------------------------------------
  quality.onChange((tier) => {
    renderer.setPixelRatio(quality.dpr);
    cw = 0; // force a resize with the new pixel ratio
    env.applyQuality(tier);
    fire.applyQuality(tier);
    fireflies.applyQuality(tier);
    for (const a of game.avatars.values()) a.applyOutlines();
    updateQualityInfo();
  });

  // ------------------------------------------------------------------------------------------
  // loop
  // ------------------------------------------------------------------------------------------
  let last = performance.now();
  let time = 0;
  let first = true;
  const fwd = new THREE.Vector3();
  const visibleFn = () => eyelids.open > 0.35;
  let cw = 0;
  let ch = 0;
  function frame(t) {
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    tick(dt, true);
  }
  function tick(dt, render) {
    // follow the canvas size (robust to tabs opened in the background, rotations, UI zoom)
    if (canvas.clientWidth !== cw || canvas.clientHeight !== ch) {
      cw = canvas.clientWidth;
      ch = canvas.clientHeight;
      if (cw && ch) {
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
      }
    }
    time += dt;
    quality.sample(dt);
    cameraRig.update(dt, time);
    const sun = game.update(dt, time);
    env.update(sun, dt, time, camera, first);
    first = false;
    fire.setPixelRatio(renderer.getPixelRatio());
    fire.update(dt, camera, env);
    fireflies.update(dt, env, renderer.getPixelRatio());
    markers.update(dt, time, camera, game.avatars, visibleFn);
    eyelids.update(dt);
    if (render) renderer.render(scene, camera);
    labels.update(game.avatars, visibleFn);
    camera.getWorldDirection(fwd);
    const dx = camp.fire.x - camera.position.x;
    const dz = camp.fire.z - camera.position.z;
    audio.update(dt, env, Math.atan2(fwd.z * dx - fwd.x * dz, fwd.x * dx + fwd.z * dz));
    if (home || lobby) preview.render(dt);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) renderer.setAnimationLoop(null);
    else {
      last = performance.now();
      renderer.setAnimationLoop(frame);
    }
  });

  setLoadingText('Le feu prend…');
  // warm up shaders (avoids hitches when the night falls)
  env.update({ elevation: 4, course: 0.88 }, 0.016, 0, camera, true);
  cameraRig.update(0.016, 0);
  try {
    await renderer.compileAsync(scene, camera);
  } catch { /* older drivers */ }
  renderer.setAnimationLoop(frame);
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 1200);

  // debug handle (tests, console)
  window.__lg = {
    game, env, quality, cameraRig, renderer, scene, camp, lib, eyelids, net, hud,
    /** Advance the client simulation by `seconds` synchronously (tests, screenshots of hidden tabs). */
    advance(seconds, step = 1 / 30) {
      for (let t = 0; t < seconds; t += step) tick(step, t + step >= seconds);
      return this.game.state?.phase;
    },
  };

  // ------------------------------------------------------------------------------------------
  // start
  // ------------------------------------------------------------------------------------------
  if (params.demo) {
    const name = params.name || profile.name || 'Alex';
    const avatar = profile.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)];
    await create(name, avatar);
    if (params.autostart) setTimeout(() => net.request(C2S.START, {}), 400);
    toast('Mode démo hors ligne : une partie simulée avec des bots.', 'good', 4000);
    return;
  }
  const session = getSession();
  if (session?.code && (!params.room || params.room === session.code)) {
    const res = await join(session.code, session.name, session.avatar, session.token);
    if (res.ok) return;
    setSession(null);
    toast(res.error || 'La partie précédente est introuvable.', 'error');
  }
  showHome();
  if (!net.offline) {
    net.onStatus((st) => {
      if (st === 'error' && home && !game.state) toast('Serveur injoignable. Le mode démo hors ligne reste disponible.', 'error', 5000);
    });
  }
}

boot().catch((err) => {
  console.error(err);
  setLoadingText(`Erreur au chargement : ${err.message}`);
});
