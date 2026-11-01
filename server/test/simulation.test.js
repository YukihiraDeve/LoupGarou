import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES as R, TEAMS, PHASES, EVENTS } from '../../shared/protocol.js';
import { simulateGame } from '../src/sim.js';

const CONFIGS = [
  undefined,
  { captain: false },
  { speed: 2 },
  { roles: { loup: 2, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1 } },
  { roles: { loup: 1, cupidon: 1, chasseur: 1 } },
  { roles: { loup: 3, sorciere: 1, cupidon: 1 }, captain: false },
];

function validate(r, label) {
  const { game, result } = r;
  assert.equal(game.phase, PHASES.GAME_OVER, `${label}: pas terminée`);
  assert.ok(result, `${label}: pas de résultat`);
  assert.ok(Object.values(TEAMS).includes(result.winner), `${label}: vainqueur ${result.winner}`);
  const ids = new Set(game.players.map((p) => p.id));
  assert.ok(result.winners.every((id) => ids.has(id)), `${label}: gagnant inconnu`);
  const alive = game.living();
  const wolvesAlive = alive.filter((p) => p.role === R.LOUP).length;
  if (result.winner === TEAMS.VILLAGE) assert.equal(wolvesAlive, 0, `${label}: loups vivants`);
  if (result.winner === TEAMS.LOUPS) {
    assert.ok(alive.length > 0 && wolvesAlive === alive.length, `${label}: non-loups vivants`);
    assert.ok(result.winners.length > 0);
  }
  if (result.winner === TEAMS.AMOUREUX) {
    assert.equal(alive.length, 2);
    assert.deepEqual(alive.map((p) => p.id).sort(), [...game.lovers].sort());
    assert.ok(game.loversMixed());
  }
  assert.ok(game.day <= 20, `${label}: ${game.day} jours`);
  const over = r.log.filter((it) => it.kind === 'event' && it.event.type === EVENTS.GAME_OVER);
  assert.equal(over.length, 1);
}

test('des centaines de parties complètes de bots se terminent avec un vainqueur valide', () => {
  const wins = { village: 0, loups: 0, amoureux: 0 };
  let games = 0;
  for (let seed = 1; seed <= 360; seed++) {
    const players = 4 + (seed % 13);
    const config = CONFIGS[seed % CONFIGS.length];
    let r;
    try {
      r = simulateGame({ seed, players, config, presence: seed % 4 === 0 });
    } catch (err) {
      // a custom composition may not fit very small tables: that is a lobby error, not a game
      if (/cartes pour|Trop de Loups/.test(err.message)) continue;
      throw err;
    }
    validate(r, `seed ${seed} (${players} joueurs)`);
    wins[r.result.winner]++;
    games++;
  }
  assert.ok(games >= 300, `${games} parties jouées`);
  assert.ok(wins.village > 0 && wins.loups > 0, JSON.stringify(wins));
});

test('les bots jouent tous les rôles (actions observées)', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = simulateGame({
      seed, players: 12, presence: true,
      config: { roles: { loup: 3, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1 } },
    });
    for (const it of r.log) if (it.kind === 'event') seen.add(it.event.type);
  }
  for (const t of [EVENTS.LOVERS, EVENTS.INSPECT_RESULT, EVENTS.WOLF_VICTIM, EVENTS.VOTE_CAST, EVENTS.CAPTAIN,
    EVENTS.DEATH, EVENTS.GAME_OVER, EVENTS.PEEK_SPOTTED]) {
    assert.ok(seen.has(t), `événement ${t} jamais vu`);
  }
});

test('simulation déterministe à graine égale', () => {
  const a = simulateGame({ seed: 77, players: 10 });
  const b = simulateGame({ seed: 77, players: 10 });
  assert.deepEqual(a.result, b.result);
  assert.equal(a.days, b.days);
});
