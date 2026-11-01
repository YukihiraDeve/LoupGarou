import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES as R, PHASES, NIGHT_STEPS as S, ACTIONS as A, EVENTS, DEATH_CAUSES, EYES, CHANNELS, PROTOCOL_VERSION,
} from '../../shared/protocol.js';
import { buildSnapshot } from '../src/engine/snapshot.js';
import { presenceRecipients, effectivePresence, chatError, chatRecipients, isObserver } from '../src/engine/visibility.js';
import { simulateGame } from '../src/sim.js';
import { makeGame, goTo, act, endPhase } from './helpers.js';

const V = R.VILLAGEOIS;

describe('buildSnapshot : non-divulgation', () => {
  test('forme générale du snapshot', () => {
    const { game, ids } = makeGame(5, { start: false });
    const s = buildSnapshot(game, ids[0]);
    assert.equal(s.v, PROTOCOL_VERSION);
    assert.equal(s.phase, PHASES.LOBBY);
    assert.equal(s.room.hostId, ids[0]);
    assert.equal(s.room.canStart, true);
    assert.equal(s.room.config.rolesAuto, true);
    assert.equal(Object.values(s.room.config.roles).reduce((a, b) => a + b, 0), 5);
    assert.equal(s.players.length, 5);
    assert.ok(s.players.every((p) => p.role === null && !('awake' in p) && !('isLover' in p)));
    assert.equal(s.me.id, ids[0]);
    assert.deepEqual(s.me.actions, []);
    assert.ok(s.me.isHost);
  });

  test('un villageois ne voit ni le rôle d’un loup vivant ni les votes des loups', () => {
    const ctx = makeGame(6, { roles: [R.LOUP, R.LOUP, V, V, R.VOYANTE, V] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    const villager = buildSnapshot(ctx.game, ctx.ids[3]);
    assert.equal(villager.players[0].role, null);
    assert.equal(villager.players[1].role, null);
    assert.equal(villager.players[3].role, V);
    assert.deepEqual(villager.votes, {});
    assert.equal(villager.me.awake, false);
    assert.ok(villager.players.every((p) => !('awake' in p) || p.id === ctx.ids[3]), 'endormi : ne voit pas qui est éveillé');
    assert.deepEqual(villager.me.actions, []);
    assert.equal(villager.me.wolfVictim, null);

    const wolf = buildSnapshot(ctx.game, ctx.ids[1]);
    assert.equal(wolf.players[0].role, R.LOUP);
    assert.equal(wolf.players[0].awake, true);
    assert.equal(wolf.players[4].role, null);
    assert.equal(wolf.players[4].awake, undefined);
    assert.deepEqual(wolf.votes, { [ctx.ids[0]]: ctx.ids[2] });
    assert.deepEqual(wolf.me.actions, [A.LOUP_VOTE]);
    assert.deepEqual(wolf.me.targets[A.LOUP_VOTE].sort(), [ctx.ids[2], ctx.ids[3], ctx.ids[4], ctx.ids[5]].sort());
  });

  test('voyante : seuls les rôles inspectés ; sorcière : victime à son tour seulement', () => {
    const ctx = makeGame(6, { roles: [R.LOUP, R.SORCIERE, V, V, R.VOYANTE, V] });
    goTo(ctx, PHASES.NIGHT, S.VOYANTE);
    act(ctx, 4, { type: A.VOYANTE_INSPECT, target: ctx.ids[0] });
    const seer = buildSnapshot(ctx.game, ctx.ids[4]);
    assert.equal(seer.players[0].role, R.LOUP);
    assert.equal(seer.players[1].role, null);
    assert.deepEqual(seer.me.inspected, { [ctx.ids[0]]: R.LOUP });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    assert.equal(buildSnapshot(ctx.game, ctx.ids[1]).me.wolfVictim, null, 'pas avant son tour');
    goTo(ctx, PHASES.NIGHT, S.SORCIERE);
    const witch = buildSnapshot(ctx.game, ctx.ids[1]);
    assert.equal(witch.me.wolfVictim, ctx.ids[2]);
    assert.deepEqual(witch.me.potions, { heal: true, kill: true });
    assert.deepEqual(witch.me.actions, [A.SORCIERE_HEAL, A.SORCIERE_KILL, A.SORCIERE_DONE]);
    assert.equal(buildSnapshot(ctx.game, ctx.ids[2]).me.wolfVictim, null);
    assert.deepEqual(buildSnapshot(ctx.game, ctx.ids[2]).me.potions, { heal: false, kill: false });
  });

  test('amoureux : connus d’eux-mêmes (à partir de leur réveil), de Cupidon, et des morts', () => {
    const ctx = makeGame(8, { roles: [R.CUPIDON, R.LOUP, V, V, V, V, R.VOYANTE, V] });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    act(ctx, 0, { type: A.CUPIDON_LINK, targets: [ctx.ids[2], ctx.ids[3]] });
    assert.equal(buildSnapshot(ctx.game, ctx.ids[2]).me.lover, null, 'endormi pendant le tour de Cupidon');
    assert.equal(buildSnapshot(ctx.game, ctx.ids[0]).players[2].isLover, true);
    endPhase(ctx);
    assert.equal(ctx.game.step, S.LOVERS);
    const lover = buildSnapshot(ctx.game, ctx.ids[2]);
    assert.equal(lover.me.lover, ctx.ids[3]);
    assert.equal(lover.players[3].isLover, true);
    assert.equal(lover.players[3].awake, true);
    assert.equal(lover.players[3].role, null, "l'amoureux ne connaît pas le rôle de l'autre");
    const other = buildSnapshot(ctx.game, ctx.ids[4]);
    assert.ok(other.players.every((p) => !('isLover' in p)));
    assert.equal(other.me.lover, null);
  });

  test('petite fille qui épie : voit les loups éveillés ; les loups reçoivent sa présence', () => {
    const ctx = makeGame(6, { roles: [R.LOUP, R.PETITE_FILLE, V, V, R.VOYANTE, V] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    ctx.game.updatePresence(ctx.ids[1], { yaw: 0.2, pitch: 0, eyes: EYES.OPEN });
    ctx.game.updatePresence(ctx.ids[0], { yaw: 0, pitch: 0, eyes: EYES.OPEN });
    let pf = buildSnapshot(ctx.game, ctx.ids[1]);
    assert.equal(pf.players[0].awake, undefined);
    assert.ok(!presenceRecipients(ctx.game, ctx.ids[1]).includes(ctx.ids[0]));
    assert.ok(!presenceRecipients(ctx.game, ctx.ids[0]).includes(ctx.ids[1]));
    assert.equal(effectivePresence(ctx.game, ctx.P(1)).eyes, EYES.CLOSED);
    act(ctx, 1, { type: A.PEEK, active: true });
    pf = buildSnapshot(ctx.game, ctx.ids[1]);
    assert.equal(pf.players[0].awake, true);
    assert.equal(pf.players[0].role, null);
    assert.ok(pf.me.peeking);
    assert.ok(pf.me.peekLeft > 0);
    assert.deepEqual(presenceRecipients(ctx.game, ctx.ids[1]).sort(), [ctx.ids[0]]);
    assert.equal(effectivePresence(ctx.game, ctx.P(1)).eyes, EYES.PEEK);
    assert.ok(presenceRecipients(ctx.game, ctx.ids[0]).includes(ctx.ids[1]));
    assert.ok(!presenceRecipients(ctx.game, ctx.ids[0]).includes(ctx.ids[2]), 'un dormeur ne reçoit rien');
    const wolf = buildSnapshot(ctx.game, ctx.ids[0]);
    assert.equal(wolf.players[1].awake, undefined, "les loups ne la voient qu'en la regardant (présence)");
  });

  test('présence le jour : tout le monde ; morts : voient tout, ne sont vus que des morts', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.DEBATE);
    ctx.game.updatePresence(ctx.ids[1], { yaw: 0, pitch: 0, eyes: EYES.PEEK, gesture: 'point', target: ctx.ids[0] });
    assert.equal(presenceRecipients(ctx.game, ctx.ids[1]).length, 4);
    assert.equal(effectivePresence(ctx.game, ctx.P(1)).eyes, EYES.OPEN);
    ctx.P(2).alive = false;
    ctx.P(2).deathCause = DEATH_CAUSES.VOTE;
    ctx.game.updatePresence(ctx.ids[2], { yaw: 0, pitch: 0, eyes: EYES.OPEN });
    assert.deepEqual(presenceRecipients(ctx.game, ctx.ids[2]), []);
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    assert.deepEqual(presenceRecipients(ctx.game, ctx.ids[1]), [ctx.ids[2]], 'seul le mort voit un dormeur');
    assert.equal(effectivePresence(ctx.game, ctx.P(1)).eyes, EYES.CLOSED);
    assert.equal(effectivePresence(ctx.game, ctx.P(1)).gesture, null);
    const dead = buildSnapshot(ctx.game, ctx.ids[2]);
    assert.equal(dead.players[0].role, R.LOUP, 'les morts voient tout');
    assert.equal(dead.players[0].awake, true);
    assert.equal(dead.players[1].awake, false);
  });

  test('chat : canaux et droits', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    const g = ctx.game;
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    assert.match(chatError(g, ctx.P(1), CHANNELS.VILLAGE), /dort/);
    assert.equal(chatError(g, ctx.P(0), CHANNELS.LOUPS), null);
    assert.ok(chatError(g, ctx.P(1), CHANNELS.LOUPS));
    assert.ok(chatError(g, ctx.P(1), CHANNELS.MORTS));
    assert.ok(chatError(g, ctx.P(1), CHANNELS.SYSTEM));
    assert.deepEqual(chatRecipients(g, CHANNELS.LOUPS), [ctx.ids[0]]);
    goTo(ctx, PHASES.DEBATE);
    assert.equal(chatError(g, ctx.P(1), CHANNELS.VILLAGE), null);
    assert.ok(chatError(g, ctx.P(0), CHANNELS.LOUPS));
    ctx.P(3).alive = false;
    assert.ok(chatError(g, ctx.P(3), CHANNELS.VILLAGE));
    assert.equal(chatError(g, ctx.P(3), CHANNELS.MORTS), null);
    assert.deepEqual(chatRecipients(g, CHANNELS.MORTS), [ctx.ids[3]]);
  });

  test('fin de partie : tous les rôles révélés', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.VOTE);
    for (const i of [1, 2, 3]) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[0] });
    goTo(ctx, PHASES.GAME_OVER);
    const s = buildSnapshot(ctx.game, ctx.ids[1]);
    assert.ok(s.players.every((p) => p.role));
    assert.equal(s.result.winner, 'village');
  });
});

/** Invariants checked on every flush of complete simulated games, for every member. */
function checkNoLeak(game, items) {
  const wolves = new Set(game.players.filter((p) => p.role === R.LOUP).map((p) => p.id));
  for (const viewer of game.players) {
    const s = buildSnapshot(game, viewer.id);
    const obs = isObserver(game, viewer);
    if (obs) continue;
    const amWolf = viewer.role === R.LOUP;
    for (const pv of s.players) {
      const real = game.player(pv.id);
      if (pv.id === viewer.id) { assert.equal(pv.role, real.role); continue; }
      if (pv.role !== null) {
        const allowed = !real.alive || (amWolf && wolves.has(pv.id)) || (viewer.role === R.VOYANTE && pv.id in viewer.inspected);
        assert.ok(allowed, `${viewer.role} voit le rôle ${pv.role} d'un vivant`);
        assert.equal(pv.role, real.role);
      }
      if (pv.isLover) {
        const allowed = !real.alive || viewer.role === R.CUPIDON || (game.loversKnown && game.lovers.includes(viewer.id));
        assert.ok(allowed, 'amoureux divulgués');
      }
      if ('awake' in pv && game.phase === PHASES.NIGHT) {
        assert.ok(s.me.awake || s.me.peeking, 'un dormeur voit qui est éveillé');
      }
      if (pv.deathCause === DEATH_CAUSES.LOUPS) assert.ok(amWolf);
      if (pv.deathCause === DEATH_CAUSES.SORCIERE) assert.ok(viewer.role === R.SORCIERE);
    }
    if (game.phase === PHASES.NIGHT && Object.keys(s.votes).length) assert.ok(amWolf, 'votes des loups divulgués');
    if (s.me.wolfVictim) assert.equal(viewer.role, R.SORCIERE);
    if (viewer.role !== R.VOYANTE) assert.deepEqual(s.me.inspected, {});
    for (const a of s.me.actions) assert.ok(Array.isArray(s.me.targets[a]));
  }
  for (const it of items) {
    if (it.kind !== 'event') continue;
    const e = it.event;
    for (const id of it.to) {
      const m = game.member(id);
      if (isObserver(game, m)) continue;
      if (e.type === EVENTS.INSPECT_RESULT) assert.equal(m.role, R.VOYANTE);
      if (e.type === EVENTS.WOLF_VICTIM) assert.equal(m.role, R.SORCIERE);
      if (e.type === EVENTS.PEEK_SPOTTED) assert.ok(m.role === R.LOUP || e.playerId === id);
      if (e.type === EVENTS.VOTE_CAST && e.kind === 'loups') assert.equal(m.role, R.LOUP);
      if (e.type === EVENTS.LOVERS) assert.ok(m.role === R.CUPIDON || e.ids.includes(id));
      if (e.type === EVENTS.DEATH && e.cause === DEATH_CAUSES.LOUPS) assert.equal(m.role, R.LOUP);
      if (e.type === EVENTS.DEATH && e.cause === DEATH_CAUSES.SORCIERE) assert.equal(m.role, R.SORCIERE);
    }
  }
}

test('aucune fuite sur des parties complètes de bots (tous les rôles, toutes les phases)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const players = 8 + (seed % 9);
    const r = simulateGame({ seed, players, presence: true, onFlush: checkNoLeak });
    assert.ok(r.result);
  }
});
