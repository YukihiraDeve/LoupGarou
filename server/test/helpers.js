// Shared helpers for engine tests (this file has no test of its own).
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { mulberry32 } from '../src/engine/rng.js';
import { ROLES } from '../../shared/protocol.js';

export const NAMES = ['Alice', 'Bruno', 'Chloé', 'David', 'Emma', 'Félix', 'Gaëlle', 'Hugo', 'Inès', 'Jules',
  'Karim', 'Léa', 'Malo', 'Nina', 'Oscar', 'Paula'];

/** New game with n human players (connected), roles forced in seat order when given. */
export function makeGame(n, { roles, config, seed = 42, start = true } = {}) {
  const clock = { t: 1_000_000 };
  let seq = 0;
  const game = new Game({ now: () => clock.t, rng: mulberry32(seed), idGen: () => `p${++seq}` });
  for (let i = 0; i < n; i++) assert.ok(game.join({ name: NAMES[i] }).ok);
  if (config) assert.deepEqual(game.setConfig(game.hostId, config), { ok: true });
  if (start) {
    const r = game.start(game.hostId);
    assert.ok(r.ok, r.error);
    if (roles) {
      assert.equal(roles.length, n);
      game.players.forEach((p, i) => { p.role = roles[i]; });
      const witch = roles.includes(ROLES.SORCIERE);
      game.potions = { heal: witch, kill: witch };
    }
  }
  game.drain();
  const ids = game.players.map((p) => p.id);
  return { game, clock, ids, P: (i) => game.players[i] };
}

/** Jump to the end of the current phase/step and process it. */
export function endPhase(ctx) {
  const { game, clock } = ctx;
  assert.notEqual(game.phaseEndsAt, null, `phase ${game.phase} has no end`);
  clock.t = Math.max(clock.t, game.phaseEndsAt);
  game.tick();
}

/** Advance until the given phase (and step) is reached. */
export function goTo(ctx, phase, step = null, guard = 60) {
  const { game } = ctx;
  while (!(game.phase === phase && (step === null || game.step === step))) {
    if (guard-- <= 0) throw new Error(`never reached ${phase}/${step} (now ${game.phase}/${game.step})`);
    endPhase(ctx);
  }
}

export function act(ctx, i, action) {
  const res = ctx.game.act(ctx.ids[i], action);
  return res;
}

export function events(game, type) {
  return game.drain().items.filter((it) => it.kind === 'event' && (!type || it.event.type === type));
}
