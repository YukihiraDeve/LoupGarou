import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES as R, PHASES, NIGHT_STEPS as S, ACTIONS as A, TEAMS, EVENTS, DEATH_CAUSES, EYES, DEFAULT_TIMERS,
  MIN_PLAYERS, MAX_PLAYERS, AVATARS,
} from '../../shared/protocol.js';
import { defaultComposition } from '../../shared/roles.js';
import { applyConfig, defaultConfig, effectiveComposition, compositionError } from '../src/engine/config.js';
import { yawTo } from '../src/engine/geometry.js';
import { makeGame, endPhase, goTo, act, events } from './helpers.js';

const V = R.VILLAGEOIS;

describe('composition et configuration', () => {
  test('defaultComposition couvre 4 à 16 joueurs et reste jouable', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const comp = defaultComposition(n);
      assert.equal(Object.values(comp).reduce((a, b) => a + b, 0), n);
      assert.equal(compositionError(comp, n), null, `n=${n}`);
    }
  });

  test('composition personnalisée : les villageois complètent', () => {
    const res = applyConfig(defaultConfig(), { roles: { loup: 2, voyante: 1, sorciere: 1, villageois: 99 } });
    assert.ok(res.ok);
    const comp = effectiveComposition(res.config, 9);
    assert.equal(comp.villageois, 5);
    assert.equal(comp.loup, 2);
    assert.equal(compositionError(comp, 9), null);
  });

  test('validation des entrées de configuration', () => {
    const base = defaultConfig();
    assert.equal(applyConfig(base, { roles: { dragon: 1 } }).ok, false);
    assert.equal(applyConfig(base, { roles: { voyante: 2, loup: 1 } }).ok, false);
    assert.equal(applyConfig(base, { roles: { loup: 0 } }).ok, false);
    assert.equal(applyConfig(base, { roles: { loup: -1 } }).ok, false);
    assert.equal(applyConfig(base, { roles: { loup: 1.5 } }).ok, false);
    assert.equal(applyConfig(base, { captain: 'yes' }).ok, false);
    assert.equal(applyConfig(base, 'nope').ok, false);
    const t = applyConfig(base, { timers: { debate: 1, vote: 9999, unknown: 4 }, speed: 99 });
    assert.ok(t.ok);
    assert.equal(t.config.timers.debate, 3);
    assert.equal(t.config.timers.vote, 600);
    assert.equal(t.config.timers.unknown, undefined);
    assert.equal(t.config.speed, 4);
    assert.deepEqual(applyConfig(t.config, { roles: null }).config.roles, null);
  });

  test('trop de loups ou trop de cartes : impossible de lancer', () => {
    assert.match(compositionError({ ...defaultComposition(6), loup: 3, villageois: 1 }, 6), /Trop de Loups/);
    const { game } = makeGame(5, { start: false, config: { roles: { loup: 1, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1 } } });
    assert.match(game.startError(), /6 cartes pour 5 joueurs/);
    assert.equal(game.start(game.hostId).ok, false);
  });

  test("il faut 4 joueurs et seul l'hôte lance", () => {
    const { game, ids } = makeGame(3, { start: false });
    assert.equal(game.start(game.hostId).ok, false);
    assert.ok(game.join({ name: 'Zoé' }).ok);
    assert.equal(game.start(ids[1]).ok, false);
    assert.ok(game.start(game.hostId).ok);
    assert.equal(game.phase, PHASES.ROLE_REVEAL);
    const counts = {};
    for (const p of game.players) counts[p.role] = (counts[p.role] || 0) + 1;
    assert.deepEqual(counts, { loup: 1, voyante: 1, villageois: 2 });
  });
});

describe('salon', () => {
  test('sièges répartis uniformément', () => {
    const { game } = makeGame(6, { start: false });
    assert.deepEqual(game.players.map((p) => p.seat), [0, 3, 5, 8, 11, 13]);
    const g16 = makeGame(16, { start: false }).game;
    assert.deepEqual(g16.players.map((p) => p.seat), [...Array(16).keys()]);
    assert.equal(g16.join({ name: 'Trop' }).ok, false);
  });

  test('avatars uniques tant que possible', () => {
    const { game, ids } = makeGame(10, { start: false });
    assert.equal(new Set(game.players.map((p) => p.avatar)).size, 10);
    assert.equal(game.setAvatar(ids[0], game.players[1].avatar).ok, false);
    assert.equal(game.setAvatar(ids[0], 'camper_99').ok, false);
    assert.ok(game.join({ name: 'Onzième', avatar: AVATARS[0] }).ok); // all taken: duplicates allowed
  });

  test("noms nettoyés et uniques, l'hôte passe au suivant", () => {
    const { game, ids } = makeGame(4, { start: false });
    const dup = game.join({ name: '  alice\u0007  ' }).member;
    assert.equal(dup.name, 'alice 2');
    assert.equal(game.hostId, ids[0]);
    game.removeMember(ids[0]);
    assert.equal(game.hostId, ids[1]);
    assert.equal(game.kick(ids[2], ids[3]).ok, false);
    assert.ok(game.kick(ids[1], ids[3]).ok);
    assert.equal(game.member(ids[3]), null);
  });

  test('spectateurs après le lancement, promus au redémarrage', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, V] });
    const s = ctx.game.join({ name: 'Spectre' });
    assert.ok(s.ok && s.spectator);
    assert.equal(ctx.game.players.length, 5);
    assert.equal(ctx.game.act(s.member.id, { type: A.DAY_VOTE, target: ctx.ids[0] }).ok, false);
    ctx.game.gameOver(ctx.game.checkVictory() || { winner: TEAMS.VILLAGE, winners: [] });
    assert.ok(ctx.game.restart(ctx.game.hostId).ok);
    assert.equal(ctx.game.phase, PHASES.LOBBY);
    assert.equal(ctx.game.players.length, 6);
    assert.ok(ctx.game.players.every((p) => p.role === null && p.alive));
  });
});

describe('déroulé de la nuit', () => {
  test('ordre des étapes de la première nuit puis de la suivante', () => {
    const ctx = makeGame(8, { roles: [R.LOUP, R.LOUP, R.VOYANTE, R.SORCIERE, R.CUPIDON, R.CHASSEUR, V, V], config: { captain: false } });
    const seen = [];
    const { game } = ctx;
    while (game.phase !== PHASES.DAWN) { endPhase(ctx); seen.push(game.phase === PHASES.NIGHT ? game.step : game.phase); }
    assert.deepEqual(seen, [S.FALL, S.CUPIDON, S.LOVERS, S.VOYANTE, S.LOUPS, S.SORCIERE, PHASES.DAWN]);
    assert.equal(game.day, 1);
    goTo(ctx, PHASES.NIGHT, S.FALL);
    const seen2 = [];
    while (game.phase !== PHASES.DAWN) { endPhase(ctx); seen2.push(game.phase === PHASES.NIGHT ? game.step : game.phase); }
    assert.deepEqual(seen2, [S.VOYANTE, S.LOUPS, S.SORCIERE, PHASES.DAWN]);
  });

  test('Cupidon lie deux amoureux (au hasard à expiration)', () => {
    const ctx = makeGame(8, { roles: [R.CUPIDON, R.LOUP, V, V, V, V, V, R.VOYANTE] });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    assert.equal(act(ctx, 1, { type: A.CUPIDON_LINK, targets: [ctx.ids[2], ctx.ids[3]] }).ok, false);
    assert.equal(act(ctx, 0, { type: A.CUPIDON_LINK, targets: [ctx.ids[2], ctx.ids[2]] }).ok, false);
    assert.ok(act(ctx, 0, { type: A.CUPIDON_LINK, targets: [ctx.ids[0], ctx.ids[3]] }).ok);
    assert.deepEqual(ctx.game.lovers, [ctx.ids[0], ctx.ids[3]]);
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt, 'fin anticipée');

    const ctx2 = makeGame(8, { roles: [R.CUPIDON, R.LOUP, V, V, V, V, V, R.VOYANTE] });
    goTo(ctx2, PHASES.NIGHT, S.CUPIDON);
    endPhase(ctx2);
    assert.equal(ctx2.game.step, S.LOVERS);
    assert.equal(ctx2.game.lovers.length, 2);
    assert.notEqual(ctx2.game.lovers[0], ctx2.game.lovers[1]);
  });

  test('Voyante : une inspection par nuit, résultat privé', () => {
    const ctx = makeGame(5, { roles: [R.VOYANTE, R.LOUP, V, V, V] });
    goTo(ctx, PHASES.NIGHT, S.VOYANTE);
    assert.equal(act(ctx, 0, { type: A.VOYANTE_INSPECT, target: ctx.ids[0] }).ok, false);
    assert.ok(act(ctx, 0, { type: A.VOYANTE_INSPECT, target: ctx.ids[1] }).ok);
    assert.equal(act(ctx, 0, { type: A.VOYANTE_INSPECT, target: ctx.ids[2] }).ok, false);
    const ev = events(ctx.game, EVENTS.INSPECT_RESULT);
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].to, [ctx.ids[0]]);
    assert.equal(ev[0].event.role, R.LOUP);
    assert.deepEqual(ctx.P(0).inspected, { [ctx.ids[1]]: R.LOUP });
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt);
  });

  test('Loups : unanimité = fin anticipée, sinon majorité à expiration', () => {
    const ctx = makeGame(9, { roles: [R.LOUP, R.LOUP, R.LOUP, V, V, V, V, V, R.VOYANTE] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    assert.equal(act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[1] }).ok, false, 'pas de loup contre loup');
    assert.equal(act(ctx, 3, { type: A.LOUP_VOTE, target: ctx.ids[4] }).ok, false, 'villageois exclu');
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[3] });
    act(ctx, 1, { type: A.LOUP_VOTE, target: ctx.ids[3] });
    assert.equal(ctx.game.phaseEndsAt, ctx.game.fullEndsAt);
    act(ctx, 2, { type: A.LOUP_VOTE, target: ctx.ids[3] });
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt, 'unanimité');
    act(ctx, 2, { type: A.LOUP_VOTE, target: ctx.ids[4] });
    assert.equal(ctx.game.phaseEndsAt, ctx.game.fullEndsAt, "l'unanimité rompue annule la fin anticipée");
    endPhase(ctx);
    assert.equal(ctx.game.night.victim, ctx.ids[3], 'majorité 2 contre 1');
    goTo(ctx, PHASES.DAWN);
    assert.equal(ctx.P(3).alive, false);
    assert.equal(ctx.P(3).deathCause, DEATH_CAUSES.LOUPS);
  });

  test('Loups : égalité tirée au sort parmi les ex-aequo, aucun vote = aucune victime', () => {
    const victims = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      const ctx = makeGame(8, { seed, roles: [R.LOUP, R.LOUP, V, V, V, V, V, R.VOYANTE] });
      goTo(ctx, PHASES.NIGHT, S.LOUPS);
      act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
      act(ctx, 1, { type: A.LOUP_VOTE, target: ctx.ids[3] });
      endPhase(ctx);
      victims.add(ctx.game.night.victim);
    }
    assert.deepEqual([...victims].sort(), ['p3', 'p4']);
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, V] });
    goTo(ctx, PHASES.DAWN);
    assert.ok(ctx.game.players.every((p) => p.alive));
  });

  test('joueurs déconnectés ignorés dans le quorum', () => {
    const ctx = makeGame(8, { roles: [R.LOUP, R.LOUP, V, V, V, V, V, R.VOYANTE] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    assert.equal(ctx.game.phaseEndsAt, ctx.game.fullEndsAt);
    ctx.game.setConnected(ctx.ids[1], false);
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt);
  });
});

describe('Sorcière', () => {
  const roles = [R.LOUP, R.SORCIERE, V, V, V, V];

  test('voit la victime et la sauve, potion unique', () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    goTo(ctx, PHASES.NIGHT, S.SORCIERE);
    const ev = events(ctx.game, EVENTS.WOLF_VICTIM);
    assert.deepEqual(ev.map((e) => [e.to, e.event.target]), [[[ctx.ids[1]], ctx.ids[2]]]);
    assert.ok(act(ctx, 1, { type: A.SORCIERE_HEAL }).ok);
    assert.equal(act(ctx, 1, { type: A.SORCIERE_HEAL }).ok, false);
    assert.ok(act(ctx, 1, { type: A.SORCIERE_DONE }).ok);
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt);
    goTo(ctx, PHASES.DAWN);
    assert.ok(ctx.P(2).alive);
    assert.equal(events(ctx.game, EVENTS.NO_DEATH).length, 1);
    assert.equal(ctx.game.potions.heal, false);
    assert.equal(ctx.game.potions.kill, true);
  });

  test('peut tout faire la même nuit et se sauver elle-même (règle classique)', () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[1] });
    goTo(ctx, PHASES.NIGHT, S.SORCIERE);
    assert.ok(act(ctx, 1, { type: A.SORCIERE_HEAL }).ok);
    assert.equal(act(ctx, 1, { type: A.SORCIERE_KILL, target: ctx.ids[1] }).ok, false, 'pas de suicide');
    assert.ok(act(ctx, 1, { type: A.SORCIERE_KILL, target: ctx.ids[0] }).ok);
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt, 'plus rien à faire : fin anticipée');
    goTo(ctx, PHASES.GAME_OVER);
    assert.ok(ctx.P(1).alive);
    assert.equal(ctx.P(0).deathCause, DEATH_CAUSES.SORCIERE);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
  });

  test("la cause d'une mort nocturne reste secrète pour le village", () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.SORCIERE);
    act(ctx, 1, { type: A.SORCIERE_KILL, target: ctx.ids[3] });
    goTo(ctx, PHASES.DAWN);
    const deaths = events(ctx.game, EVENTS.DEATH);
    const real = deaths.find((d) => d.event.cause === DEATH_CAUSES.SORCIERE);
    const masked = deaths.find((d) => d.event.cause === DEATH_CAUSES.NIGHT);
    assert.ok(real.to.includes(ctx.ids[1]) && real.to.includes(ctx.ids[3]));
    assert.ok(!real.to.includes(ctx.ids[2]));
    assert.ok(masked.to.includes(ctx.ids[2]) && masked.to.includes(ctx.ids[0]));
  });
});

describe('Chasseur et amoureux', () => {
  test('le Chasseur tué la nuit tire au lever du jour', () => {
    const ctx = makeGame(7, { roles: [R.LOUP, R.CHASSEUR, V, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[1] });
    goTo(ctx, PHASES.DAWN);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.HUNTER);
    assert.deepEqual(ctx.game.allowedActions(ctx.P(1)), [A.HUNTER_SHOOT]);
    assert.equal(act(ctx, 1, { type: A.HUNTER_SHOOT, target: ctx.ids[1] }).ok, false);
    assert.ok(act(ctx, 1, { type: A.HUNTER_SHOOT, target: ctx.ids[0] }).ok);
    assert.equal(ctx.P(0).deathCause, DEATH_CAUSES.CHASSEUR);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.GAME_OVER);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
  });

  test("le Chasseur qui ne tire pas à temps n'emporte personne", () => {
    const ctx = makeGame(7, { roles: [R.LOUP, R.CHASSEUR, V, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.DEBATE);
    goTo(ctx, PHASES.VOTE);
    for (const i of [0, 2, 3, 4]) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[1] });
    goTo(ctx, PHASES.HUNTER);
    endPhase(ctx);
    assert.equal(ctx.game.living().length, 6);
    assert.equal(ctx.game.phase, PHASES.NIGHT);
  });

  test('cascade : amoureux mort de chagrin, Chasseur amoureux qui tire, puis chagrin à nouveau', () => {
    // seats: 0 loup, 1 chasseur (lover of 2), 2 villageois, 3 cupidon, 4 voyante (lover of 5), 5 villageois...
    const ctx = makeGame(9, { roles: [R.LOUP, R.CHASSEUR, V, R.CUPIDON, R.VOYANTE, V, V, R.LOUP, V], config: { captain: false } });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    act(ctx, 3, { type: A.CUPIDON_LINK, targets: [ctx.ids[1], ctx.ids[2]] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    act(ctx, 7, { type: A.LOUP_VOTE, target: ctx.ids[2] });
    goTo(ctx, PHASES.DAWN);
    assert.equal(ctx.P(2).deathCause, DEATH_CAUSES.LOUPS);
    assert.equal(ctx.P(1).deathCause, DEATH_CAUSES.CHAGRIN);
    assert.deepEqual(ctx.game.lastDeaths, [ctx.ids[2], ctx.ids[1]]);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.HUNTER);
    assert.ok(act(ctx, 1, { type: A.HUNTER_SHOOT, target: ctx.ids[7] }).ok);
    assert.equal(ctx.P(7).alive, false);
    assert.deepEqual(ctx.game.lastDeaths, [ctx.ids[2], ctx.ids[1], ctx.ids[7]]);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.DEBATE);
  });

  test("le tir du Chasseur sur un amoureux emporte l'autre", () => {
    const ctx = makeGame(9, { roles: [R.LOUP, R.CHASSEUR, V, R.CUPIDON, R.VOYANTE, V, V, R.LOUP, V], config: { captain: false } });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    act(ctx, 3, { type: A.CUPIDON_LINK, targets: [ctx.ids[5], ctx.ids[6]] });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[1] });
    act(ctx, 7, { type: A.LOUP_VOTE, target: ctx.ids[1] });
    goTo(ctx, PHASES.HUNTER);
    act(ctx, 1, { type: A.HUNTER_SHOOT, target: ctx.ids[5] });
    assert.equal(ctx.P(5).deathCause, DEATH_CAUSES.CHASSEUR);
    assert.equal(ctx.P(6).deathCause, DEATH_CAUSES.CHAGRIN);
  });

  test('couple mixte : victoire des amoureux quand ils sont les deux derniers', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, R.CUPIDON, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    act(ctx, 1, { type: A.CUPIDON_LINK, targets: [ctx.ids[0], ctx.ids[2]] });
    assert.ok(ctx.game.loversMixed());
    assert.equal(ctx.game.teamOf(ctx.P(0)), TEAMS.AMOUREUX);
    for (const i of [1, 3, 4]) { ctx.P(i).alive = false; ctx.P(i).deathCause = DEATH_CAUSES.VOTE; }
    assert.deepEqual(ctx.game.checkVictory(), { winner: TEAMS.AMOUREUX, winners: [ctx.ids[0], ctx.ids[2]] });
  });
});

describe('Capitaine et vote du village', () => {
  function toVote(captainIdx, roles = [R.LOUP, V, V, V, V, R.VOYANTE]) {
    const ctx = makeGame(roles.length, { roles });
    goTo(ctx, PHASES.ELECTION);
    for (let i = 0; i < roles.length; i++) assert.ok(act(ctx, i, { type: A.ELECTION_VOTE, target: ctx.ids[captainIdx] }).ok);
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt, 'tous ont voté');
    endPhase(ctx);
    assert.equal(ctx.game.captainId, ctx.ids[captainIdx]);
    assert.equal(ctx.game.phase, PHASES.DEBATE);
    goTo(ctx, PHASES.VOTE);
    return ctx;
  }

  test('élection le jour 1, voix double du Capitaine', () => {
    const ctx = toVote(1);
    act(ctx, 1, { type: A.DAY_VOTE, target: ctx.ids[0] }); // captain: 2
    act(ctx, 2, { type: A.DAY_VOTE, target: ctx.ids[3] });
    act(ctx, 4, { type: A.DAY_VOTE, target: ctx.ids[3] });
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.EXECUTION);
    assert.equal(ctx.game.execStage, 'tiebreak', '2 contre 2 : égalité');
    assert.deepEqual([...ctx.game.tie].sort(), [ctx.ids[0], ctx.ids[3]].sort());
    assert.equal(act(ctx, 2, { type: A.CAPTAIN_TIEBREAK, target: ctx.ids[0] }).ok, false);
    assert.equal(act(ctx, 1, { type: A.CAPTAIN_TIEBREAK, target: ctx.ids[2] }).ok, false);
    assert.ok(act(ctx, 1, { type: A.CAPTAIN_TIEBREAK, target: ctx.ids[0] }).ok);
    assert.equal(ctx.P(0).deathCause, DEATH_CAUSES.VOTE);
    endPhase(ctx);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
  });

  test('la voix double fait pencher le vote', () => {
    const ctx = toVote(1);
    act(ctx, 1, { type: A.DAY_VOTE, target: ctx.ids[2] });
    act(ctx, 3, { type: A.DAY_VOTE, target: ctx.ids[4] });
    endPhase(ctx);
    assert.equal(ctx.game.execStage, 'result');
    assert.equal(ctx.P(2).alive, false);
  });

  test("égalité sans décision du Capitaine : pas d'exécution", () => {
    const ctx = toVote(1);
    act(ctx, 2, { type: A.DAY_VOTE, target: ctx.ids[3] });
    act(ctx, 3, { type: A.DAY_VOTE, target: ctx.ids[2] });
    endPhase(ctx);
    assert.equal(ctx.game.execStage, 'tiebreak');
    events(ctx.game);
    endPhase(ctx);
    assert.equal(events(ctx.game, EVENTS.NO_LYNCH).length, 1);
    assert.equal(ctx.game.living().length, 6);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.NIGHT);
  });

  test("égalité sans Capitaine (option désactivée) : pas d'exécution, pas d'élection", () => {
    const ctx = makeGame(6, { roles: [R.LOUP, V, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.DAWN);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.DEBATE);
    goTo(ctx, PHASES.VOTE);
    act(ctx, 2, { type: A.DAY_VOTE, target: ctx.ids[3] });
    act(ctx, 3, { type: A.DAY_VOTE, target: ctx.ids[2] });
    endPhase(ctx);
    assert.equal(ctx.game.execStage, 'result');
    assert.equal(ctx.game.living().length, 6);
  });

  test('vote retiré, changement de vote, fin anticipée quand tous ont voté', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.VOTE);
    assert.equal(act(ctx, 0, { type: A.DAY_VOTE, target: ctx.ids[0] }).ok, false, 'pas contre soi');
    for (let i = 0; i < 5; i++) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[(i + 1) % 5] });
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt);
    act(ctx, 0, { type: A.DAY_VOTE, target: null });
    assert.equal(ctx.game.phaseEndsAt, ctx.game.fullEndsAt);
  });

  test('succession : le Capitaine mort désigne (ou hasard à expiration)', () => {
    const ctx = toVote(2);
    for (const i of [0, 1, 3, 4]) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[2] });
    goTo(ctx, PHASES.CAPTAIN_SUCCESSION);
    assert.deepEqual(ctx.game.allowedActions(ctx.P(2)), [A.CAPTAIN_DESIGNATE]);
    assert.ok(act(ctx, 2, { type: A.CAPTAIN_DESIGNATE, target: ctx.ids[4] }).ok);
    assert.equal(ctx.game.captainId, ctx.ids[4]);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.NIGHT);

    const ctx2 = toVote(2);
    for (const i of [0, 1, 3, 4]) act(ctx2, i, { type: A.DAY_VOTE, target: ctx2.ids[2] });
    goTo(ctx2, PHASES.CAPTAIN_SUCCESSION);
    endPhase(ctx2);
    assert.ok(ctx2.game.player(ctx2.game.captainId).alive);
  });

  test('débat : « Passer » à la majorité des vivants', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.DEBATE);
    act(ctx, 0, { type: A.SKIP });
    act(ctx, 1, { type: A.SKIP });
    assert.equal(ctx.game.phaseEndsAt, ctx.game.fullEndsAt);
    assert.equal(act(ctx, 1, { type: A.SKIP }).ok, false);
    act(ctx, 2, { type: A.SKIP });
    assert.ok(ctx.game.phaseEndsAt < ctx.game.fullEndsAt);
    endPhase(ctx);
    assert.equal(ctx.game.phase, PHASES.VOTE);
  });
});

describe('conditions de victoire', () => {
  test('village : plus aucun loup', () => {
    const ctx = makeGame(5, { roles: [R.LOUP, V, V, V, R.VOYANTE], config: { captain: false } });
    goTo(ctx, PHASES.VOTE);
    for (const i of [1, 2, 3]) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[0] });
    goTo(ctx, PHASES.GAME_OVER);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
    assert.deepEqual(ctx.game.result.winners.sort(), ctx.ids.slice(1).sort());
    const over = events(ctx.game, EVENTS.GAME_OVER);
    assert.equal(over.length, 1);
    assert.equal(Object.keys(over[0].event.roles).length, 5);
  });

  test('loups : plus aucun non-loup', () => {
    const ctx = makeGame(4, { roles: [R.LOUP, V, V, R.VOYANTE], config: { captain: false } });
    for (const i of [1, 2]) { ctx.P(i).alive = false; ctx.P(i).deathCause = DEATH_CAUSES.VOTE; }
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[3] });
    goTo(ctx, PHASES.GAME_OVER);
    assert.equal(ctx.game.result.winner, TEAMS.LOUPS);
    assert.deepEqual(ctx.game.result.winners, [ctx.ids[0]]);
  });

  test('tout le monde meurt : le village l’emporte à titre posthume', () => {
    const ctx = makeGame(4, { roles: [R.LOUP, R.SORCIERE, V, V] });
    for (const i of [2, 3]) { ctx.P(i).alive = false; ctx.P(i).deathCause = DEATH_CAUSES.VOTE; }
    assert.equal(ctx.game.checkVictory(), null);
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    act(ctx, 0, { type: A.LOUP_VOTE, target: ctx.ids[1] });
    goTo(ctx, PHASES.NIGHT, S.SORCIERE);
    act(ctx, 1, { type: A.SORCIERE_KILL, target: ctx.ids[0] });
    goTo(ctx, PHASES.GAME_OVER);
    assert.equal(ctx.game.living().length, 0);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
  });

  test("couple mixte exclu des victoires d'équipe", () => {
    const ctx = makeGame(6, { roles: [R.LOUP, R.CUPIDON, V, V, R.VOYANTE, V], config: { captain: false } });
    goTo(ctx, PHASES.NIGHT, S.CUPIDON);
    act(ctx, 1, { type: A.CUPIDON_LINK, targets: [ctx.ids[0], ctx.ids[2]] });
    goTo(ctx, PHASES.VOTE);
    for (const i of [1, 3, 4, 5]) act(ctx, i, { type: A.DAY_VOTE, target: ctx.ids[0] });
    goTo(ctx, PHASES.GAME_OVER);
    assert.equal(ctx.P(2).deathCause, DEATH_CAUSES.CHAGRIN);
    assert.equal(ctx.game.result.winner, TEAMS.VILLAGE);
    assert.ok(!ctx.game.result.winners.includes(ctx.ids[2]));
  });
});

describe('Petite Fille', () => {
  const roles = [R.LOUP, R.PETITE_FILLE, V, V, V, R.VOYANTE];
  const budget = 8 * 1000;

  test("n'épie que pendant le tour des loups, jauge limitée", () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.VOYANTE);
    assert.equal(act(ctx, 1, { type: A.PEEK, active: true }).ok, false);
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    assert.ok(act(ctx, 1, { type: A.PEEK, active: true }).ok);
    ctx.clock.t += 2000;
    assert.ok(act(ctx, 1, { type: A.PEEK, active: false }).ok);
    assert.equal(ctx.game.peekLeftMs(), budget - 2000);
    assert.ok(act(ctx, 1, { type: A.PEEK, active: true }).ok);
    assert.equal(ctx.game.nextDeadline(), ctx.clock.t + Math.min(budget - 2000, 3000));
    ctx.clock.t += 7000;
    ctx.game.tick();
    assert.equal(ctx.game.night.peek.peeking, false, 'jauge épuisée');
    assert.equal(ctx.game.peekLeftMs(), 0);
    assert.equal(act(ctx, 1, { type: A.PEEK, active: true }).ok, false);
  });

  test('surprise par un loup qui la regarde plus de 3 s', () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    const wolf = ctx.P(0);
    const pf = ctx.P(1);
    ctx.game.updatePresence(wolf.id, { yaw: yawTo(wolf.seat, pf.seat), pitch: 0, eyes: EYES.OPEN, gesture: null });
    act(ctx, 1, { type: A.PEEK, active: true });
    ctx.clock.t += 2000;
    ctx.game.tick();
    assert.equal(ctx.game.night.peek.spotted, false);
    events(ctx.game);
    ctx.clock.t += 1100;
    ctx.game.tick();
    const ev = events(ctx.game, EVENTS.PEEK_SPOTTED);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event.playerId, pf.id);
    assert.ok(ev[0].to.includes(wolf.id) && ev[0].to.includes(pf.id) && !ev[0].to.includes(ctx.ids[2]));
  });

  test("pas surprise si le loup regarde ailleurs ou si elle s'arrête à temps", () => {
    const ctx = makeGame(6, { roles });
    goTo(ctx, PHASES.NIGHT, S.LOUPS);
    const wolf = ctx.P(0);
    const pf = ctx.P(1);
    ctx.game.updatePresence(wolf.id, { yaw: yawTo(wolf.seat, pf.seat) + 1, pitch: 0, eyes: EYES.OPEN });
    act(ctx, 1, { type: A.PEEK, active: true });
    ctx.clock.t += 3500;
    ctx.game.tick();
    assert.equal(ctx.game.night.peek.spotted, false);
    // turns towards her while she keeps peeking -> caught at once
    ctx.game.updatePresence(wolf.id, { yaw: 0, pitch: 0, eyes: EYES.OPEN, target: pf.id });
    assert.equal(ctx.game.night.peek.spotted, true);

    const ctx2 = makeGame(6, { roles });
    goTo(ctx2, PHASES.NIGHT, S.LOUPS);
    ctx2.game.updatePresence(ctx2.ids[0], { yaw: 0, pitch: 0, eyes: EYES.OPEN, target: ctx2.ids[1] });
    for (let k = 0; k < 3; k++) {
      act(ctx2, 1, { type: A.PEEK, active: true });
      ctx2.clock.t += 2500;
      ctx2.game.tick();
      act(ctx2, 1, { type: A.PEEK, active: false });
    }
    assert.equal(ctx2.game.night.peek.spotted, false, 'jamais plus de 3 s d’affilée');
  });
});

test('géométrie : regard vers un siège (lacet positif = vers la gauche)', () => {
  assert.ok(Math.abs(yawTo(0, 8)) < 1e-9, 'siège opposé : droit devant');
  assert.ok(yawTo(0, 1) < 0 && yawTo(0, 15) > 0);
  assert.ok(Math.abs(yawTo(0, 4) + Math.PI / 4) < 1e-9);
});

test('minuteurs : vitesse et multiplicateur global', () => {
  const ctx = makeGame(4, { start: false, config: { speed: 0.5 } });
  ctx.game.speedFactor = 0.2;
  assert.ok(ctx.game.start(ctx.game.hostId).ok);
  assert.equal(ctx.game.phaseEndsAt - ctx.game.phaseStartedAt, DEFAULT_TIMERS.role_reveal * 1000 * 0.1);
});
