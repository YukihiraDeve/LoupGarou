// Game client: turns personalised snapshots, events, chat and presence into the 3D scene (avatars,
// sun, eyelids, markers), the HUD, audio and narration; turns input into intentions.
import * as THREE from 'three';
import {
  C2S, S2C, PHASES, NIGHT_STEPS, ACTIONS, EVENTS, CHANNELS, ROLES, EYES, GESTURES, TEAMS, LIMITS,
} from '@shared/protocol.js';
import { ROLE_INFO } from '@shared/roles.js';
import { Avatar } from '../characters/avatar.js';
import { SunClock } from '../world/timeOfDay.js';
import { banner, STEP_NARRATION, ACTION_TEXT, CAUSE_TEXT, WIN_TEXT, PHASE_SPEECH } from './texts.js';
import { roleName, roleIcon } from '../ui/roleArt.js';
import { escapeHtml } from '../ui/dom.js';
import { toast, bigAlert, flashRed } from '../ui/toast.js';
import { getSession, setSession } from './net.js';
import { isTouch } from '../config.js';
import { clamp, angleDelta } from '../util/math.js';

const TARGET_ACTIONS = [
  ACTIONS.CUPIDON_LINK, ACTIONS.VOYANTE_INSPECT, ACTIONS.LOUP_VOTE, ACTIONS.HUNTER_SHOOT, ACTIONS.CAPTAIN_DESIGNATE,
  ACTIONS.CAPTAIN_TIEBREAK, ACTIONS.ELECTION_VOTE, ACTIONS.DAY_VOTE,
];
const PEEK_MAX = LIMITS?.PEEK_SECONDS || 8;
const _v = new THREE.Vector3();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const FIRE_LOOK = new THREE.Vector3();

export class GameClient {
  constructor(ctx) {
    Object.assign(this, ctx); // net, scene, camera, camp, lib, env, quality, hud, labels, audio, narrator, eyelids, markers, cameraRig
    this.state = null;
    this.avatars = new Map();
    this.presence = new Map();
    this.idle = new Map();
    this.lastChat = new Map();
    this.lastSpeaker = null;
    this.offsets = [];
    this.offset = 0;
    this.sun = new SunClock();
    this.selection = [];
    this.hover = null;
    this.poisonMode = false;
    this.peekHeld = false;
    this.peekLocal = { left: 0, at: 0 };
    this.typingUntil = 0;
    this.emote = null;
    this.emoteUntil = 0;
    this.deadSeen = new Map(); // id -> phase key when first seen dead
    this.deathEntries = [];
    this.phaseKey = '';
    this.lastPresenceSent = 0;
    this.sentPresence = null;
    this.myGestureTarget = null;
    this.gameOver = null;
    this.spotted = new Map();
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
    this.revealShown = false;
    FIRE_LOOK.copy(this.camp.fire).setY(0.55);
    this.bindNet();
    this.bindInput();
  }

  now() { return Date.now() + this.offset; }
  get me() { return this.state?.me; }
  player(id) { return this.state?.players.find((p) => p.id === id); }
  get inGame() { return this.state && this.state.phase !== PHASES.LOBBY; }

  // -------------------------------------------------------------------------------------------
  // network
  // -------------------------------------------------------------------------------------------
  bindNet() {
    const n = this.net;
    n.on(S2C.STATE, (s) => this.onState(s));
    n.on(S2C.EVENT, (e) => this.onEvent(e));
    n.on(S2C.CHAT, (m) => this.onChat(m));
    n.on(S2C.PRESENCE, (p) => {
      if (!p || !p.id) return;
      const prev = this.presence.get(p.id);
      this.presence.set(p.id, { ...p, t: performance.now() });
      const a = this.avatars.get(p.id);
      if (a && p.gesture !== prev?.gesture && (p.gesture === GESTURES.NOD || p.gesture === GESTURES.SHAKE)) a.setGesture(p.gesture);
    });
    n.on(S2C.ERROR, (e) => {
      const msg = e?.message || 'Erreur du serveur.';
      toast(msg, 'error', 4500);
      if (e?.code === 'kicked' || e?.code === 'closed' || e?.code === 'replaced') {
        setSession(null);
        this.onLeft?.(msg);
      }
    });
    n.onStatus(async (status, prev) => {
      if (status === 'connected' && prev && prev !== 'connected' && prev !== 'connecting') {
        const s = getSession();
        if (s?.code && this.state) {
          const res = await n.request(C2S.JOIN, { code: s.code, name: s.name, avatar: s.avatar, token: s.token });
          if (res.ok) toast('Reconnecté au camp.', 'good');
          else toast(res.error || 'Impossible de reprendre la partie.', 'error');
        }
      } else if (status === 'disconnected' || status === 'reconnecting') {
        if (this.state && !this.discToast) {
          this.discToast = true;
          toast('Connexion perdue… reconnexion en cours', 'error', 5000);
          setTimeout(() => { this.discToast = false; }, 6000);
        }
      }
    });
  }

  onState(s) {
    // clock correction: keep the largest offset of the last samples (least delayed)
    this.offsets.push(s.serverNow - Date.now());
    if (this.offsets.length > 10) this.offsets.shift();
    this.offset = Math.max(...this.offsets);
    const prev = this.state;
    this.state = s;
    const key = `${s.phase}|${s.step}|${s.day}|${s.phaseStartedAt}`;
    const phaseChanged = !prev || prev.phase !== s.phase || prev.step !== s.step || prev.day !== s.day;
    if (phaseChanged) this.onPhase(s, prev);
    this.phaseKey = key;
    // peek gauge interpolation baseline
    this.peekLocal = { left: s.me?.peekLeft ?? 0, at: performance.now() };
    this.syncAvatars(s);
    // selection cleanup
    const tAction = this.targetAction();
    if (!tAction) this.selection = [];
    else this.selection = this.selection.filter((id) => this.validTargets(tAction).includes(id));
    if (!s.me?.actions?.includes(ACTIONS.SORCIERE_KILL)) this.poisonMode = false;
    if (!s.me?.actions?.includes(ACTIONS.PEEK) && this.peekHeld) this.setPeek(false);
    this.onStateUI?.(s, prev);
  }

  onPhase(s, prev) {
    const me = s.me;
    this.poisonMode = false;
    this.selection = [];
    if (s.phase !== PHASES.DAWN && s.phase !== PHASES.EXECUTION && s.phase !== PHASES.HUNTER) this.deathEntries = [];
    switch (s.phase) {
      case PHASES.LOBBY:
        this.gameOver = null;
        this.loversKey = null;
        this.revealShown = false;
        this.deadSeen.clear();
        this.hud.hideEnd();
        this.markers.setLovers([], this.avatars);
        this.cameraRig.toIntro(!prev);
        this.cameraRig.setGhost(false);
        this.eyelids.setClosedInstant(false);
        break;
      case PHASES.ROLE_REVEAL:
        this.audio.play('reveal');
        if (me?.role && !this.revealShown) {
          this.revealShown = true;
          setTimeout(() => { if (this.state?.phase === PHASES.ROLE_REVEAL) this.showMyCard(true); }, prev ? 1400 : 300);
        }
        break;
      case PHASES.NIGHT:
        if (s.step === NIGHT_STEPS.FALL) {
          this.hud.hideRoleCard();
          this.hud.deathlog?.remove();
          this.audio.play('night');
        }
        if (s.step === NIGHT_STEPS.LOUPS) {
          this.audio.howl(2 + Math.floor(Math.random() * 2));
          // werewolves visible to me throw their head back
          setTimeout(() => { for (const a of this.avatars.values()) if (a.wolfForm && !a.isSelf) a.react('howl'); }, 700);
        }
        if (this.net.offline) {
          const [t, sub] = STEP_NARRATION[s.step] || [];
          if (t) this.narrator.say(`${t}. ${sub}`);
        }
        break;
      case PHASES.DAWN:
        this.audio.play('dawn');
        break;
      case PHASES.EXECUTION:
        this.audio.play('bell');
        break;
      case PHASES.GAME_OVER:
        break;
      default:
    }
    if (this.net.offline && PHASE_SPEECH[s.phase] && s.phase !== PHASES.NIGHT) this.narrator.say(PHASE_SPEECH[s.phase]);
  }

  onEvent(e) {
    const s = this.state;
    switch (e.type) {
      case EVENTS.DEATH: {
        const p = this.player(e.playerId);
        const a = this.avatars.get(e.playerId);
        if (a) a.setPose('dead');
        if (e.cause === 'chasseur') {
          this.audio.play('shot');
          this.cameraRig.impulse(0.8);
        }
        this.audio.play('death');
        for (const [id, other] of this.avatars) {
          if (id !== e.playerId && this.player(id)?.alive) setTimeout(() => other.react('shocked'), 150 + Math.random() * 500);
        }
        this.deathEntries.push({ name: p?.name || '?', role: e.role, cause: CAUSE_TEXT[e.cause] || '' });
        const title = s?.phase === PHASES.DAWN ? 'Cette nuit…' : s?.phase === PHASES.HUNTER ? 'Le Chasseur a tiré' : 'Le village a tranché';
        this.hud.showDeathLog(title, this.deathEntries, 8000);
        if (e.playerId === s?.me?.id) {
          bigAlert('Vous êtes mort');
          flashRed();
          this.narrator.say('Vous êtes mort. Vous pouvez désormais tout voir, en silence.');
        } else if (this.net.offline) {
          this.narrator.say(`${p?.name || 'Un joueur'} est mort. Il était ${roleName(e.role)}.`);
        }
        break;
      }
      case EVENTS.NO_DEATH:
        this.hud.showDeathLog('Une nuit paisible', [], 6000);
        if (this.net.offline) this.narrator.say('Personne n’est mort cette nuit.');
        break;
      case EVENTS.INSPECT_RESULT: {
        const a = this.avatars.get(e.target);
        if (a) this.markers.showCard(a, e.role);
        this.audio.play('magic');
        toast(`${this.player(e.target)?.name || '?'} est ${roleName(e.role)} ${roleIcon(e.role)}`, 'good', 6000);
        break;
      }
      case EVENTS.LOVERS: {
        this.markers.setLovers(e.ids || [], this.avatars);
        const key = (e.ids || []).slice().sort().join();
        if (key === this.loversKey) break;
        this.loversKey = key;
        this.audio.play('heart');
        const me = s?.me;
        if (me && e.ids?.includes(me.id)) {
          const other = this.player(e.ids.find((id) => id !== me.id));
          toast(`💘 Vous êtes amoureux de ${other?.name || '?'}`, 'good', 6000);
        }
        break;
      }
      case EVENTS.WOLF_VICTIM:
        this.wolfVictim = e.target ?? null;
        break;
      case EVENTS.VOTE_CAST: {
        const a = this.avatars.get(e.voterId);
        if (a && e.target) this.audio.play('click');
        break;
      }
      case EVENTS.CAPTAIN: {
        this.markers.setCaptain(e.playerId);
        this.audio.play('bell');
        const p = this.player(e.playerId);
        toast(`⭐ ${p?.id === s?.me?.id ? 'Vous êtes' : `${p?.name || '?'} est`} le nouveau Capitaine`, 'good', 5000);
        break;
      }
      case EVENTS.NO_LYNCH:
        toast('Égalité : personne n’est exécuté aujourd’hui.', '', 5000);
        break;
      case EVENTS.PEEK_SPOTTED: {
        const me = s?.me;
        if (e.playerId === me?.id) {
          flashRed();
          bigAlert('Repérée !');
          this.audio.play('gasp');
          this.cameraRig.impulse(0.6);
        } else {
          bigAlert('Surprise !');
          this.audio.play('gasp');
          this.spotted.set(e.playerId, performance.now() + 5000);
          toast(`👁 La Petite Fille vous espionne : c’est ${this.player(e.playerId)?.name || '?'} !`, 'error', 6000);
        }
        break;
      }
      case EVENTS.GAME_OVER:
        this.gameOver = e;
        setTimeout(() => this.showEnd(), 2200);
        break;
      default:
    }
  }

  onChat(m) {
    const p = this.player(m.from);
    this.hud.addMessage({ name: m.name || p?.name || '?', text: m.text, channel: m.channel, seat: p?.seat, system: !m.from });
    if (m.from) {
      this.lastChat.set(m.from, performance.now());
      if (m.from !== this.me?.id) this.lastSpeaker = m.from;
      this.audio.play('chat');
    } else if (m.channel === CHANNELS.SYSTEM && !this.net.offline) {
      this.narrator.say(m.text);
    }
  }

  // -------------------------------------------------------------------------------------------
  // avatars
  // -------------------------------------------------------------------------------------------
  syncAvatars(s) {
    const ids = new Set(s.players.map((p) => p.id));
    for (const [id, a] of this.avatars) {
      if (!ids.has(id)) {
        a.dispose();
        this.avatars.delete(id);
        this.labels.remove(id);
      }
    }
    for (const p of s.players) {
      let a = this.avatars.get(p.id);
      if (a && a.avatarId !== p.avatar) {
        a.dispose();
        this.avatars.delete(p.id);
        a = null;
      }
      if (!a) {
        a = new Avatar({ lib: this.lib, playerId: p.id, avatarId: p.avatar, isSelf: p.id === s.me?.id, quality: this.quality });
        this.scene.add(a.root);
        this.avatars.set(p.id, a);
        if (!p.alive) {
          a.setPose('dead');
          a.deadSince = 1; // already dead: jump to the end of the fall
        }
      }
      if (a.seat?.index !== p.seat) a.setSeat(this.camp.seats[p.seat] || this.camp.seats[0]);
      if (!p.alive && !this.deadSeen.has(p.id)) this.deadSeen.set(p.id, { key: this.phaseKey, t: performance.now() });
      if (p.alive) this.deadSeen.delete(p.id);
    }
    // own avatar: first person
    const meA = s.me?.id && this.avatars.get(s.me.id);
    if (meA) {
      this.env.setFocus(meA.root.position);
      meA.hideHead(true);
      meA.capsule.userData.self = true;
      if (s.phase !== PHASES.LOBBY && !(s.phase === PHASES.GAME_OVER && this.cameraRig.mode === 'intro')) {
        const rig = meA.human;
        // eyes of the sitting pose, pulled back above the pelvis so the knees and hands enter the frame
        const sit = rig.template.sit;
        const eye = sit.eyes.clone();
        const seatY = sit.pelvis.y - sit.pelvisAboveSeat;
        // slightly behind and above the real eyes (over the shoulders): sleeves, hands and knees enter
        // the bottom of the frame like in the reference shot
        eye.z = sit.pelvis.z - 0.1;
        eye.y = Math.max(sit.eyes.y, seatY + 0.68) + 0.02;
        eye.add(rig.root.position).add(new THREE.Vector3(0, 0.02, 0));
        this.cameraRig.sitOn(meA, eye);
        // dead: the ghost camera rises and sees its own body lying on the ground
        meA.setFirstPersonClip(!!s.me.alive);
      }
    }
    if (s.phase === PHASES.LOBBY || !meA) {
      if (this.cameraRig.mode !== 'intro') this.cameraRig.toIntro();
    }
    // lovers / captain markers
    const lovers = s.players.filter((p) => p.isLover).map((p) => p.id);
    this.markers.setLovers(s.phase === PHASES.LOBBY ? [] : lovers, this.avatars);
    this.markers.setCaptain(s.players.find((p) => p.isCaptain)?.id || null);
  }

  presenceFor(id) {
    const p = this.presence.get(id);
    if (!p) return null;
    const age = performance.now() - p.t;
    if (age > 3000) return null;
    // presence from before the current night step is stale
    if (this.state?.phase === PHASES.NIGHT && p.t < this.phaseStartPerf) return null;
    return p;
  }

  /** Night visibility: can I see the real state of this player? */
  visibleToMe(id) {
    const s = this.state;
    if (!s) return true;
    return this.eyelids.open > 0.15 || !s.me?.alive;
  }

  updateAvatars(dt, time) {
    const s = this.state;
    if (!s) return;
    const me = s.me || {};
    const now = performance.now();
    const night = s.phase === PHASES.NIGHT;
    const lobby = s.phase === PHASES.LOBBY;
    const over = s.phase === PHASES.GAME_OVER;
    const iAmWolf = me.role === ROLES.LOUP;
    const iSeeAll = !me.alive || me.spectator;
    const voteish = s.phase === PHASES.VOTE || s.phase === PHASES.ELECTION || s.phase === PHASES.EXECUTION
      || (night && s.step === NIGHT_STEPS.LOUPS);
    const tAction = this.targetAction();
    const valid = tAction ? this.validTargets(tAction) : null;
    _pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);

    for (const p of s.players) {
      const a = this.avatars.get(p.id);
      if (!a) continue;
      const isMe = p.id === me.id;
      const pres = isMe ? null : this.presenceFor(p.id);
      // --- pose
      let pose = 'idle';
      if (!p.alive) pose = 'dead';
      else if (isMe) pose = 'idle'; // the first-person camera is calibrated on the idle sitting pose
      else if (night) {
        if (p.awake || (pres && pres.eyes === EYES.OPEN)) pose = 'awake';
        else pose = 'sleep';
      }
      a.setPose(pose);
      // ghost: dead in an earlier phase -> a candle on the seat
      const ds = this.deadSeen.get(p.id);
      a.setGhost(!p.alive && !!ds && ds.key !== this.phaseKey && now - ds.t > 9000 && !over);
      // --- eyes
      let eyes = pose === 'sleep' ? EYES.CLOSED : EYES.OPEN;
      if (pres?.eyes) eyes = pres.eyes;
      if (isMe) eyes = this.myEyes();
      a.setEyes(eyes);
      // --- gestures: votes are shown in 3D (point / raised hand)
      let gesture = null;
      let target = null;
      const vote = voteish ? s.votes?.[p.id] : null;
      if (vote) {
        gesture = s.phase === PHASES.ELECTION ? GESTURES.RAISE : GESTURES.POINT;
        target = vote;
      }
      if (pres && (pres.gesture === GESTURES.POINT || pres.gesture === GESTURES.RAISE)) {
        gesture = pres.gesture;
        target = pres.target || target;
      }
      if (isMe) {
        if (this.selection.length && tAction && tAction !== ACTIONS.CUPIDON_LINK) {
          gesture = tAction === ACTIONS.ELECTION_VOTE ? GESTURES.RAISE : GESTURES.POINT;
          target = this.selection[0];
        }
        if (this.emote && now < this.emoteUntil && this.emote === GESTURES.RAISE) gesture = GESTURES.RAISE;
        this.myGestureTarget = target;
      }
      // own pointing arm would hide half of the screen in first person: others see it via presence
      const shown = isMe && gesture === GESTURES.POINT ? null : gesture;
      a.setGesture(shown === GESTURES.POINT || shown === GESTURES.RAISE ? shown : null);
      const targetAvatar = target ? this.avatars.get(target) : null;
      a.setTwistTowards(gesture === GESTURES.POINT && targetAvatar ? targetAvatar.root.position : null);
      // --- talking
      const chatT = this.lastChat.get(p.id) || 0;
      const talking = isMe ? now < this.typingUntil : (pres?.gesture === GESTURES.TALK || now - chatT < 2600);
      a.setTalking(talking && pose === 'idle' && !isMe);
      // --- look
      if (isMe) {
        const ang = this.cameraRig.presenceAngles();
        a.setLook(ang.yaw, ang.pitch);
      } else if (pres && (night || lobby || true)) {
        a.setLook(pres.yaw, pres.pitch);
      } else if (targetAvatar) {
        a.lookAtPoint(targetAvatar.headAnchor);
      } else {
        this.idleLook(p, a, now);
      }
      // --- wolf form: wolves see each other as werewolves during their step; revealed wolves too
      const wolfStep = night && s.step === NIGHT_STEPS.LOUPS && p.role === ROLES.LOUP && p.alive && !isMe
        && ((iAmWolf && me.awake) || iSeeAll);
      const revealed = p.role === ROLES.LOUP && (!p.alive || over) && !isMe;
      a.setWolfForm(wolfStep || revealed);
      // the real werewolf.glb has its own glowing eyes (EMIT_eyes); sprites only for stand-ins
      a.setGlowEyes((wolfStep || (revealed && over)) && pose !== 'dead' && a.wolf?.kind !== 'glb');
      // --- highlight
      let hl = 'none';
      if (this.selection.includes(p.id)) hl = 'select';
      else if (this.hover === p.id && valid?.includes(p.id)) hl = 'hover';
      else if ((this.spotted.get(p.id) || 0) > now) hl = 'select';
      else if (wolfStep && iAmWolf && me.alive) hl = 'ally';
      else if (night && s.step === NIGHT_STEPS.LOVERS && p.isLover && me.awake) hl = 'lover';
      a.setHighlight(hl);
      a.targetable = !!valid?.includes(p.id);
      // frustum culling (skinned bounds are unreliable): whole avatar at once
      _sphere.center.copy(a.root.position);
      _sphere.center.y += 0.3;
      a.root.visible = isMe || _frustum.intersectsSphere(_sphere);
      a.update(dt, time, now);
      // labels
      const icons = [];
      if (p.isCaptain) icons.push('⭐');
      if (p.isLover) icons.push('💘');
      const knownRole = p.role && (!p.alive || over || (iAmWolf && p.role === ROLES.LOUP) || iSeeAll) ? p.role : me.inspected?.[p.id];
      if (knownRole && !isMe) icons.push(roleIcon(knownRole));
      if (!p.connected && !p.isBot) icons.push('💤');
      const votes = this.voteCounts?.get(p.id) || 0;
      this.labels.set(p.id, {
        name: p.name,
        icons: icons.join(''),
        votes,
        cls: `${isMe ? 'me' : ''} ${p.alive ? '' : 'dead'} ${hl === 'select' ? 'selected' : hl === 'hover' ? 'hover' : ''} ${p.connected ? '' : 'off'}`,
      });
    }
  }

  idleLook(p, a, now) {
    let st = this.idle.get(p.id);
    if (!st) {
      st = { next: 0, target: null };
      this.idle.set(p.id, st);
    }
    if (now > st.next) {
      st.next = now + 1800 + Math.random() * 4200;
      const r = Math.random();
      const speakerRecent = this.lastSpeaker && now - (this.lastChat.get(this.lastSpeaker) || 0) < 9000 && this.lastSpeaker !== p.id;
      if (speakerRecent && r < 0.55) st.target = this.lastSpeaker;
      else if (r < 0.75) st.target = null; // the fire
      else {
        const others = this.state.players.filter((o) => o.id !== p.id && o.alive);
        const meP = others.find((o) => o.id === this.me?.id);
        st.target = (meP && Math.random() < 0.3 ? meP : others[Math.floor(Math.random() * others.length)])?.id || null;
      }
    }
    const t = st.target && this.avatars.get(st.target);
    if (t) {
      _v.copy(t.headAnchor);
      if (st.target === this.me?.id) _v.copy(this.camera.position);
      a.lookAtPoint(_v);
    } else a.lookAtPoint(FIRE_LOOK);
  }

  // -------------------------------------------------------------------------------------------
  // my state
  // -------------------------------------------------------------------------------------------
  myEyes() {
    if (this.eyelids.closed && !this.eyelids.peek) return EYES.CLOSED;
    if (this.eyelids.peek && this.eyelids.base === 0) return EYES.PEEK;
    return this.eyelids.open < 0.3 ? EYES.CLOSED : EYES.OPEN;
  }

  /** Should my eyes be closed right now? */
  wantClosed() {
    const s = this.state;
    if (!s || s.phase !== PHASES.NIGHT) return false;
    const me = s.me;
    if (!me || me.spectator || !me.alive) return false;
    if (s.step === NIGHT_STEPS.FALL) return true;
    return !me.awake;
  }

  targetAction() {
    const acts = this.me?.actions || [];
    if (this.poisonMode && acts.includes(ACTIONS.SORCIERE_KILL)) return ACTIONS.SORCIERE_KILL;
    return TARGET_ACTIONS.find((a) => acts.includes(a)) || null;
  }

  validTargets(action) {
    const s = this.state;
    const me = s?.me;
    if (!me) return [];
    if (me.targets?.[action]) return me.targets[action];
    const alive = s.players.filter((p) => p.alive);
    const others = alive.filter((p) => p.id !== me.id);
    switch (action) {
      case ACTIONS.CUPIDON_LINK: return alive.map((p) => p.id);
      case ACTIONS.LOUP_VOTE: return others.filter((p) => p.role !== ROLES.LOUP).map((p) => p.id);
      case ACTIONS.ELECTION_VOTE: return alive.map((p) => p.id);
      case ACTIONS.CAPTAIN_TIEBREAK: return (s.tie || me.tie || others.map((p) => p.id));
      default: return others.map((p) => p.id);
    }
  }

  pick(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = [];
    for (const a of this.avatars.values()) if (!a.ghost && !a.capsule.userData.self) list.push(a.capsule);
    const hit = this.raycaster.intersectObjects(list, false)[0];
    return hit ? hit.object.userData.playerId : null;
  }

  bindInput() {
    this.cameraRig.onTap = (ndc) => {
      if (!this.inGame) return;
      if (this.eyelids.open < 0.3) return;
      const id = this.pick(ndc);
      if (id) this.selectPlayer(id);
    };
    let lastHover = 0;
    this.cameraRig.onHover = (ndc) => {
      const t = performance.now();
      if (t - lastHover < 60 || !this.inGame) return;
      lastHover = t;
      const id = this.eyelids.open > 0.3 ? this.pick(ndc) : null;
      if (id !== this.hover) {
        this.hover = id;
        const action = this.targetAction();
        const valid = action && id && this.validTargets(action).includes(id);
        this.cameraRig.dom.style.cursor = valid ? 'pointer' : '';
        if (valid) this.audio.play('hover');
      }
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (!e.repeat) this.setPeek(true);
      }
      if (e.key === 'Escape') {
        this.selection = [];
        this.refreshUI();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.setPeek(false);
    });
  }

  selectPlayer(id) {
    const action = this.targetAction();
    if (!action) {
      // no action: just look at them (feels natural) — nothing else
      return;
    }
    if (!this.validTargets(action).includes(id)) {
      toast(id === this.me?.id ? 'Vous ne pouvez pas vous désigner.' : 'Ce joueur ne peut pas être désigné.', 'error', 2000);
      this.audio.play('error');
      return;
    }
    if (action === ACTIONS.CUPIDON_LINK) {
      if (this.selection.includes(id)) this.selection = this.selection.filter((x) => x !== id);
      else this.selection = [...this.selection, id].slice(-2);
    } else {
      this.selection = this.selection[0] === id ? [] : [id];
    }
    this.audio.play('select');
    this.refreshUI();
  }

  async act(payload, okText) {
    const res = await this.net.request(C2S.ACTION, payload);
    if (!res.ok) {
      toast(res.error || 'Action refusée.', 'error');
      this.audio.play('error');
      return false;
    }
    this.audio.play('confirm');
    if (okText) toast(okText, 'good', 2500);
    return true;
  }

  async confirmTarget() {
    const action = this.targetAction();
    if (!action) return;
    const names = this.selection.map((id) => this.player(id)?.name || '?');
    if (action === ACTIONS.CUPIDON_LINK) {
      if (this.selection.length !== 2) return;
      if (await this.act({ type: action, targets: [...this.selection] }, `💘 ${names.join(' et ')} sont unis.`)) this.selection = [];
      return;
    }
    const target = this.selection[0];
    if (!target) return;
    const ok = await this.act({ type: action, target });
    if (ok) {
      if (action === ACTIONS.SORCIERE_KILL) this.poisonMode = false;
      if (action !== ACTIONS.DAY_VOTE && action !== ACTIONS.LOUP_VOTE && action !== ACTIONS.ELECTION_VOTE) this.selection = [];
    }
    this.refreshUI();
  }

  setPeek(on) {
    const can = this.me?.actions?.includes(ACTIONS.PEEK);
    if (on && !can) return;
    if (on === this.peekHeld) return;
    this.peekHeld = on;
    this.eyelids.setPeek(on);
    // the slit is narrow: lift the gaze to the faces around the fire
    if (on && this.cameraRig.pitchTarget < -0.12) this.cameraRig.pitchTarget = -0.1;
    this.audio.heartbeat = on;
    this.net.emit(C2S.ACTION, { type: ACTIONS.PEEK, active: on });
  }

  emoteGesture(g) {
    if (!this.inGame && this.state?.phase !== PHASES.LOBBY) return;
    const a = this.avatars.get(this.me?.id);
    if (g === 'nod' || g === 'shake') a?.setGesture(g);
    this.emote = g;
    this.emoteUntil = performance.now() + (g === 'raise' ? 3000 : 1500);
  }

  noteTyping() { this.typingUntil = performance.now() + 2500; }

  chatChannel() {
    const s = this.state;
    const me = s?.me;
    if (!s || !me) return null;
    if (s.phase === PHASES.LOBBY || s.phase === PHASES.GAME_OVER) return CHANNELS.VILLAGE;
    if (me.spectator || !me.alive) return CHANNELS.MORTS;
    if (s.phase === PHASES.NIGHT) return s.step === NIGHT_STEPS.LOUPS && me.role === ROLES.LOUP && me.awake ? CHANNELS.LOUPS : null;
    return CHANNELS.VILLAGE;
  }

  async sendChat(text) {
    const channel = this.chatChannel();
    if (!channel) {
      toast('Silence… vous dormez.', 'error', 2000);
      return;
    }
    this.noteTyping();
    const res = await this.net.request(C2S.CHAT, { text: text.slice(0, LIMITS?.CHAT_MAX || 200), channel });
    if (res && res.ok === false) toast(res.error || 'Message refusé.', 'error');
  }

  // -------------------------------------------------------------------------------------------
  // presence (≤ 10 Hz, only when it changed)
  // -------------------------------------------------------------------------------------------
  sendPresence(now) {
    const s = this.state;
    const me = s?.me;
    if (!s || !me || me.spectator || !me.id) return;
    if (now - this.lastPresenceSent < 1000 / (LIMITS?.PRESENCE_HZ || 10)) return;
    const { yaw, pitch } = this.cameraRig.presenceAngles();
    const eyes = this.myEyes();
    let gesture = null;
    const t = performance.now();
    if (t < this.typingUntil) gesture = GESTURES.TALK;
    if (this.emote && t < this.emoteUntil) gesture = this.emote;
    let target = this.myGestureTarget;
    if (target && gesture == null) gesture = this.targetAction() === ACTIONS.ELECTION_VOTE ? GESTURES.RAISE : GESTURES.POINT;
    if (!target) target = this.gazeTarget(yaw, pitch);
    const prev = this.sentPresence;
    const changed = !prev || Math.abs(prev.yaw - yaw) > 0.02 || Math.abs(prev.pitch - pitch) > 0.02 || prev.eyes !== eyes
      || prev.gesture !== gesture || prev.target !== target || now - this.lastPresenceSent > 4000;
    if (!changed) return;
    const p = { yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), eyes, gesture, target: target || null };
    this.net.emit(C2S.PRESENCE, p);
    this.sentPresence = p;
    this.lastPresenceSent = now;
  }

  /** Player id my gaze is aimed at (within ~0.3 rad), or null. */
  gazeTarget(yaw, pitch) {
    const meA = this.avatars.get(this.me?.id);
    if (!meA || pitch < -0.55) return null;
    let best = null;
    let bestD = 0.3;
    for (const [id, a] of this.avatars) {
      if (a === meA || a.ghost) continue;
      const ang = meA.anglesTo(a.headAnchor);
      const d = Math.abs(angleDelta(ang.yaw, yaw)) + Math.abs(ang.pitch - pitch) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // per frame
  // -------------------------------------------------------------------------------------------
  update(dt, time) {
    this.time = time;
    const s = this.state;
    const now = this.now();
    // sun
    const sun = this.sun.compute(s, now);
    if (s && this.phaseStartKey !== this.phaseKey) {
      this.phaseStartKey = this.phaseKey;
      this.phaseStartPerf = performance.now();
    }
    // eyelids follow the rules
    const closed = this.wantClosed();
    if (closed && this.eyelids.base !== 0) this.eyelids.close();
    if (!closed && this.eyelids.base !== 1) this.eyelids.wake();
    if (!closed && this.peekHeld) this.setPeek(false);
    this.updateAvatars(dt, time);
    this.updateHUDFrame(now);
    this.sendPresence(performance.now());
    return sun;
  }

  // -------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------
  showMyCard(intro = false) {
    const me = this.me;
    if (!me?.role) return;
    let extra = '';
    if (me.role === ROLES.LOUP) {
      const pack = this.state.players.filter((p) => p.role === ROLES.LOUP && p.id !== me.id).map((p) => escapeHtml(p.name));
      extra = pack.length ? `Votre meute : <b>${pack.join(', ')}</b>` : 'Vous êtes le seul Loup-Garou.';
    }
    if (me.lover) extra += `${extra ? '<br>' : ''}💘 Amoureux de <b>${escapeHtml(this.player(me.lover)?.name || '?')}</b>`;
    this.hud.showRoleCard(me.role, { intro, extra });
  }

  showEnd() {
    const s = this.state;
    const e = this.gameOver;
    if (!s || !e) return;
    const me = s.me;
    const [title, sub] = WIN_TEXT[e.winner] || ['Fin de la partie', ''];
    const winners = new Set(e.winners || s.result?.winners || []);
    const roles = e.roles || {};
    const iWon = winners.has(me?.id);
    this.audio.play(iWon ? 'win' : 'lose');
    this.narrator.say(title);
    this.hud.showEnd({
      title,
      sub: me?.spectator ? sub : `${sub} ${iWon ? 'Vous avez gagné !' : 'Vous avez perdu.'}`,
      players: s.players.map((p) => ({ ...p, role: roles[p.id] || p.role, winner: winners.has(p.id), me: p.id === me?.id, lover: p.isLover })),
      isHost: s.room.hostId === me?.id,
      onReplay: () => this.net.request(C2S.RESTART, {}).then((r) => { if (!r.ok) toast(r.error || 'Impossible de relancer.', 'error'); }),
      onQuit: () => this.onQuit?.(),
      win: iWon,
    });
    setTimeout(() => { if (this.state?.phase === PHASES.GAME_OVER) this.cameraRig.toIntro(); }, 2500);
  }

  refreshUI() { this.uiKey = null; }

  updateHUDFrame(now) {
    const s = this.state;
    const hud = this.hud;
    if (!s || s.phase === PHASES.LOBBY) return;
    const me = s.me || {};
    const alive = s.players.filter((p) => p.alive).length;
    const remaining = s.phaseEndsAt ? (s.phaseEndsAt - now) / 1000 : null;
    const progress = s.phaseEndsAt ? clamp((now - s.phaseStartedAt) / (s.phaseEndsAt - s.phaseStartedAt), 0, 1) : 0;
    hud.setTopRight({ alive, total: s.players.length, seconds: remaining, progress });
    hud.setBanner(banner(s));

    // vote counts (labels + recap)
    const counts = new Map();
    const voters = new Map();
    for (const [voter, target] of Object.entries(s.votes || {})) {
      if (!target) continue;
      const w = s.phase === PHASES.VOTE || s.phase === PHASES.EXECUTION ? (this.player(voter)?.isCaptain ? 2 : 1) : 1;
      counts.set(target, (counts.get(target) || 0) + w);
      if (!voters.has(target)) voters.set(target, []);
      voters.get(target).push(this.player(voter)?.name || '?');
    }
    this.voteCounts = counts;
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => ({ name: this.player(id)?.name || '?', count: c, voters: voters.get(id) }));
    const voteTitle = s.phase === PHASES.ELECTION ? 'Élection' : s.phase === PHASES.NIGHT ? 'Choix de la meute' : 'Votes du village';
    hud.setVotes(this.eyelids.open > 0.3 ? rows : null, voteTitle);

    // night narration over closed eyes
    const lidsClosed = this.eyelids.open < 0.12;
    if (s.phase === PHASES.NIGHT && lidsClosed && !this.eyelids.peek) {
      const [t, sub] = STEP_NARRATION[s.step] || ['La nuit', ''];
      hud.setNightNarration(t, me.alive ? `${sub}` : sub);
    } else hud.setNightNarration(null);

    // peek gauge (interpolated while peeking)
    const canPeek = me.actions?.includes(ACTIONS.PEEK) || (me.role === ROLES.PETITE_FILLE && s.phase === PHASES.NIGHT && s.step === NIGHT_STEPS.LOUPS && me.alive);
    let left = this.peekLocal.left;
    if (me.peeking || this.peekHeld) left = Math.max(0, left - (performance.now() - this.peekLocal.at) / 1000);
    hud.setPeek({ visible: !!canPeek && me.alive, active: this.peekHeld, left, max: PEEK_MAX });
    if (this.peekHeld && left <= 0) this.setPeek(false);

    // tints and crosshair
    const wolfNight = me.role === ROLES.LOUP && s.phase === PHASES.NIGHT && me.awake && me.alive;
    hud.setTint(!me.alive && !me.spectator ? 'ghost' : wolfNight ? 'wolf' : null);
    hud.setCrosshair(me.actions?.includes(ACTIONS.HUNTER_SHOOT));
    this.cameraRig.setGhost(!me.alive && !me.spectator && s.phase !== PHASES.GAME_OVER);
    this.eyelids.dread = s.phase === PHASES.NIGHT && !lidsClosed ? 0.35 : 0;
    hud.setMyCard(me.role || null);

    // chat channel
    const ch = this.chatChannel();
    const chLabel = ch === CHANNELS.LOUPS ? '🐺 Canal de la meute' : ch === CHANNELS.MORTS ? '👻 Canal des morts' : ch === CHANNELS.VILLAGE ? 'Village' : 'Silence, la nuit…';
    hud.setChannel(chLabel, !!ch, ch ? undefined : 'Vous dormez…');

    // players panel (only rendered while open)
    const tAction = this.targetAction();
    const valid = tAction ? this.validTargets(tAction) : [];
    if (hud.playersOpen) {
      hud.setPlayers(s.players.map((p) => ({
        id: p.id, name: p.name, seat: p.seat, alive: p.alive, me: p.id === me.id,
        selected: this.selection.includes(p.id), targetable: valid.includes(p.id),
        tag: [p.isCaptain ? '⭐' : '', p.isLover ? '💘' : '', p.role && (p.id === me.id || !p.alive || me.role === ROLES.LOUP) ? roleIcon(p.role) : '', p.isBot ? 'bot' : '', !p.connected ? 'absent' : ''].filter(Boolean).join(' '),
      })));
    }

    // consigne + action bar
    const key = JSON.stringify([s.phase, s.step, me.actions, this.selection, this.poisonMode, me.alive, me.awake, s.votes?.[me.id], me.wolfVictim, this.wolfVictim, me.potions, s.skip, me.skipped, this.eyelids.base, !!this.hud.endEl, !!this.gameOver]);
    if (key === this.uiKey) return;
    this.uiKey = key;
    const [cons, icon] = this.consigne(s, me, tAction);
    hud.setConsigne(cons, icon);
    hud.setActionBar(this.actionBar(s, me, tAction));
  }

  consigne(s, me, tAction) {
    if (me.spectator) return ['Vous observez la partie depuis l’ombre', 'eye'];
    if (s.phase === PHASES.GAME_OVER) return ['La partie est terminée', 'star'];
    if (!me.alive) return ['Vous êtes mort : vous voyez tout, en silence', 'skull'];
    if (tAction) return [ACTION_TEXT[tAction].consigne, ACTION_TEXT[tAction].icon];
    switch (s.phase) {
      case PHASES.ROLE_REVEAL: return ['Découvrez votre rôle', 'card'];
      case PHASES.NIGHT:
        if (s.step === NIGHT_STEPS.FALL) return ['Fermez les yeux…', 'eyeClosed'];
        if (me.actions?.includes(ACTIONS.PEEK)) return [isTouch ? 'Maintenez le bouton pour épier' : 'Maintenez le bouton (ou Espace) pour épier', 'eye'];
        if (me.actions?.includes(ACTIONS.SORCIERE_DONE)) return ['Choisissez vos potions', 'potion'];
        if (me.awake) return s.step === NIGHT_STEPS.LOVERS ? ['Découvrez votre amoureux…', 'heart'] : ['Vous êtes réveillé', 'eye'];
        return ['Vous dormez…', 'eyeClosed'];
      case PHASES.DAWN: return ['Le village se réveille', 'sunrise'];
      case PHASES.DEBATE: return ['Débattez : qui sont les Loups-Garous ?', 'chat'];
      case PHASES.EXECUTION: return ['Le village a tranché…', 'skull'];
      case PHASES.HUNTER: return ['Le Chasseur ajuste son tir…', 'target'];
      case PHASES.CAPTAIN_SUCCESSION: return ['Le Capitaine désigne son successeur…', 'star'];
      case PHASES.VOTE: return ['Le vote est en cours', 'vote'];
      case PHASES.ELECTION: return ['Élection du Capitaine', 'star'];
      default: return ['', 'eye'];
    }
  }

  actionBar(s, me, tAction) {
    const acts = me.actions || [];
    const name = (id) => escapeHtml(this.player(id)?.name || '?');
    // sorcière panel
    if (acts.includes(ACTIONS.SORCIERE_DONE) && !this.poisonMode) {
      const victim = me.wolfVictim ?? this.wolfVictim ?? null;
      const buttons = [];
      if (acts.includes(ACTIONS.SORCIERE_HEAL) && victim) buttons.push({ label: `🧪 Sauver ${this.player(victim)?.name || ''}`, kind: 'primary', onClick: () => this.act({ type: ACTIONS.SORCIERE_HEAL }, 'Potion de vie utilisée.') });
      if (acts.includes(ACTIONS.SORCIERE_KILL)) buttons.push({ label: '☠ Empoisonner…', kind: 'danger', onClick: () => { this.poisonMode = true; this.refreshUI(); } });
      buttons.push({ label: 'Terminer', onClick: () => this.act({ type: ACTIONS.SORCIERE_DONE }) });
      const pot = me.potions || {};
      return {
        key: `witch|${victim}|${acts.join()}`,
        html: `${victim ? `Les loups ont attaqué <b>${name(victim)}</b>.` : 'Les loups n’ont attaqué personne.'}<br><span class="muted">Potion de vie : ${pot.heal ? '1' : '0'} · Potion de mort : ${pot.kill ? '1' : '0'}</span>`,
        buttons,
      };
    }
    if (tAction) {
      const t = ACTION_TEXT[tAction];
      const sel = this.selection;
      const cancel = { label: 'Annuler', kind: 'ghost', onClick: () => { this.selection = []; if (tAction === ACTIONS.SORCIERE_KILL) this.poisonMode = false; this.refreshUI(); } };
      if (tAction === ACTIONS.CUPIDON_LINK) {
        return {
          key: `cup|${sel.join()}`,
          html: sel.length ? `Amoureux : <b>${sel.map(name).join(' ♥ ')}</b>${sel.length < 2 ? ' + …' : ''}` : 'Touchez deux joueurs (vous pouvez vous choisir).',
          buttons: [{ label: '💘 Unir', kind: 'primary', disabled: sel.length !== 2, onClick: () => this.confirmTarget() }, ...(sel.length ? [cancel] : [])],
        };
      }
      const current = tAction === ACTIONS.DAY_VOTE || tAction === ACTIONS.LOUP_VOTE || tAction === ACTIONS.ELECTION_VOTE ? s.votes?.[me.id] : null;
      if (!sel.length) {
        const buttons = [];
        if (tAction === ACTIONS.DAY_VOTE && current) buttons.push({ label: 'Retirer mon vote', kind: 'ghost', onClick: () => this.act({ type: ACTIONS.DAY_VOTE, target: null }) });
        if (tAction === ACTIONS.SORCIERE_KILL) buttons.push(cancel);
        if (!current && !buttons.length) return null; // the instruction line says it all
        return {
          key: `${tAction}|none|${current}`,
          html: current ? `Votre choix : <b>${name(current)}</b>` : '',
          buttons,
        };
      }
      if (current && sel[0] === current) {
        return { key: `${tAction}|done|${current}`, html: `Votre choix : <b>${name(current)}</b>`, buttons: tAction === ACTIONS.DAY_VOTE ? [{ label: 'Retirer mon vote', kind: 'ghost', onClick: () => { this.selection = []; this.act({ type: ACTIONS.DAY_VOTE, target: null }); } }] : [] };
      }
      return {
        key: `${tAction}|${sel[0]}|${current}`,
        html: t.confirm(name(sel[0])),
        buttons: [{ label: t.verb, kind: tAction === ACTIONS.HUNTER_SHOOT || tAction === ACTIONS.SORCIERE_KILL || tAction === ACTIONS.LOUP_VOTE ? 'danger' : 'primary', onClick: () => this.confirmTarget() }, cancel],
      };
    }
    if (acts.includes(ACTIONS.SKIP) || (s.phase === PHASES.DEBATE && me.skipped)) {
      const sk = s.skip;
      const count = sk ? ` (${sk.count}/${sk.needed})` : '';
      return me.skipped
        ? { key: `skip|done|${count}`, html: `<span class="muted">Vous voulez passer au vote${count}</span>` }
        : { key: `skip|${count}`, buttons: [{ label: `Passer au vote${count}`, kind: 'ghost', onClick: () => this.act({ type: ACTIONS.SKIP }) }] };
    }
    if (s.phase === PHASES.GAME_OVER && !this.hud.endEl && this.gameOver) {
      return { key: 'over', buttons: [{ label: 'Résultats', kind: 'primary', onClick: () => this.showEnd() }] };
    }
    return null;
  }
}
