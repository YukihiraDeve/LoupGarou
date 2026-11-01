// Headless simulation: full games of bots on a simulated clock (no network, no real timers).
// Used by the tests; also runnable: `npm run sim -- 500` prints a summary.
import { fileURLToPath } from 'node:url';
import { PHASES, TEAMS, CHANNELS } from '../../shared/protocol.js';
import { Game } from './engine/game.js';
import { BotController } from './bots/controller.js';
import { mulberry32 } from './engine/rng.js';
import { chatError, chatRecipients } from './engine/visibility.js';

/** Deterministic scheduler on a simulated clock. */
export class FakeScheduler {
  constructor(start = 1_700_000_000_000) {
    this.t = start;
    this.seq = 0;
    this.tasks = new Map(); // id -> { at, fn, seq }
  }
  now() { return this.t; }
  setTimeout(fn, ms) {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.t + Math.max(0, ms || 0), fn, seq: id });
    return id;
  }
  clearTimeout(id) { this.tasks.delete(id); }
  nextAt() {
    let best = null;
    for (const t of this.tasks.values()) if (best === null || t.at < best) best = t.at;
    return best;
  }
  /** Run every task due at the current time (in scheduling order). */
  runDue() {
    let ran = 0;
    for (;;) {
      let due = null;
      for (const [id, t] of this.tasks) {
        if (t.at <= this.t && (!due || t.at < due[1].at || (t.at === due[1].at && t.seq < due[1].seq))) due = [id, t];
      }
      if (!due) return ran;
      this.tasks.delete(due[0]);
      due[1].fn();
      ran++;
    }
  }
}

/**
 * Play one complete game of bots. Returns { result, days, steps, game, log }.
 * opts: { seed, players (4..16), config (lobby config), presence (simulate gaze, default true), onFlush(game, items) }
 */
export function simulateGame(opts = {}) {
  const seed = opts.seed ?? 1;
  const rng = mulberry32(seed);
  const sched = new FakeScheduler();
  let idSeq = 0;
  const game = new Game({ code: 'SIMU', now: () => sched.now(), rng, idGen: () => `b${++idSeq}` });
  const n = opts.players ?? 8;
  for (let i = 0; i < n; i++) {
    const res = game.join({ name: `Bot${i + 1}`, isBot: true });
    if (!res.ok) throw new Error(res.error);
  }
  game.hostId = game.players[0].id;
  if (opts.config) {
    const res = game.setConfig(game.hostId, opts.config);
    if (!res.ok) throw new Error(res.error);
  }
  const log = [];
  const bots = new BotController(game, {
    scheduler: sched,
    rng,
    presence: opts.presence ?? true,
    chat: opts.chat ?? true,
    act: (id, action) => game.act(id, action),
    sendPresence: (id, p) => game.updatePresence(id, p),
    say: (id, text, channel) => {
      const m = game.member(id);
      if (chatError(game, m, channel)) return;
      const msg = { id: game.nextChatId(), from: id, name: m.name, text, channel, ts: sched.now() };
      log.push({ kind: 'chat', msg, to: chatRecipients(game, channel) });
      bots.onChat(msg);
    },
  });
  bots.onError = (err) => { throw err; };
  const start = game.start(game.hostId);
  if (!start.ok) throw new Error(start.error);

  const flush = () => {
    const { items } = game.drain();
    for (const it of items) {
      log.push(it);
      if (it.kind === 'event') for (const id of it.to) bots.onEvent(id, it.event);
      if (it.kind === 'chat' && it.msg.channel !== CHANNELS.SYSTEM) bots.onChat(it.msg);
    }
    opts.onFlush?.(game, items);
    bots.sync();
  };

  let steps = 0;
  const maxSteps = opts.maxSteps ?? 200_000;
  flush();
  while (game.phase !== PHASES.GAME_OVER && steps++ < maxSteps) {
    const candidates = [game.nextDeadline(), sched.nextAt()].filter((x) => x != null);
    if (!candidates.length) throw new Error(`simulation stalled in ${game.phase}/${game.step}`);
    sched.t = Math.max(sched.t, Math.min(...candidates));
    sched.runDue();
    game.tick();
    flush();
  }
  bots.dispose();
  return { result: game.result, days: game.day, steps, game, log };
}

// CLI ---------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = Number(process.argv[2]) || 200;
  const wins = { [TEAMS.VILLAGE]: 0, [TEAMS.LOUPS]: 0, [TEAMS.AMOUREUX]: 0 };
  let days = 0;
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const r = simulateGame({ seed: i + 1, players: 4 + (i % 13), presence: false });
    wins[r.result.winner]++;
    days += r.days;
  }
  console.log(`${count} parties en ${Date.now() - t0} ms — victoires :`, wins, `— jours moyens : ${(days / count).toFixed(1)}`);
}
