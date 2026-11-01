// Personalised StateSnapshot: never contains anything the receiver is not allowed to know.
import { PROTOCOL_VERSION, PHASES, NIGHT_STEPS, ROLES } from '../../../shared/protocol.js';
import { publicConfig } from './config.js';
import * as V from './visibility.js';

function playerView(game, viewer, p) {
  const view = {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    seat: p.seat,
    alive: p.alive,
    connected: p.connected,
    isBot: p.isBot,
    isHost: game.hostId === p.id,
    isCaptain: game.captainId === p.id,
    role: V.knowsRole(game, viewer, p) ? p.role : null,
    deathCause: V.deathCauseFor(game, viewer, p),
  };
  if (V.knowsLover(game, viewer, p)) view.isLover = true;
  const awake = V.awakeFor(game, viewer, p);
  if (awake !== undefined) view.awake = awake;
  return view;
}

function visibleVotes(game, viewer) {
  const out = {};
  if (game.phase === PHASES.ELECTION) {
    for (const [k, v] of game.electionVotes) out[k] = v;
  } else if (game.phase === PHASES.VOTE || game.phase === PHASES.EXECUTION) {
    for (const [k, v] of game.dayVotes) out[k] = v;
  } else if (game.phase === PHASES.NIGHT && game.step === NIGHT_STEPS.LOUPS && game.night) {
    const allowed = V.isObserver(game, viewer) || (viewer && !viewer.spectator && viewer.alive && viewer.role === ROLES.LOUP);
    if (allowed) for (const [k, v] of game.night.wolfVotes) out[k] = v;
  }
  return out;
}

function meView(game, viewer) {
  if (!viewer) {
    return {
      id: null, role: null, alive: false, lover: null, potions: { heal: false, kill: false }, awake: true,
      canAct: false, actions: [], inspected: {}, wolfVictim: null, peekLeft: 0,
      spectator: true, isHost: false, team: null, peeking: false, skipped: false, targets: {},
    };
  }
  const running = V.inGame(game);
  const actions = game.allowedActions(viewer);
  const targets = {};
  for (const a of actions) targets[a] = game.targetsFor(viewer, a);
  const isWitch = !viewer.spectator && viewer.role === ROLES.SORCIERE;
  const witchStep = game.phase === PHASES.NIGHT && game.step === NIGHT_STEPS.SORCIERE && viewer.alive;
  const isPf = !viewer.spectator && viewer.role === ROLES.PETITE_FILLE && game.night?.peek?.id === viewer.id;
  const lover = V.loverOf(game, viewer.id);
  return {
    id: viewer.id,
    role: viewer.spectator ? null : viewer.role,
    alive: !viewer.spectator && viewer.alive,
    lover: lover && V.knowsLover(game, viewer, viewer) ? lover : null,
    potions: isWitch ? { heal: game.potions.heal, kill: game.potions.kill } : { heal: false, kill: false },
    awake: V.isAwakeAllowed(game, viewer),
    canAct: actions.length > 0,
    actions,
    inspected: viewer.role === ROLES.VOYANTE && running ? { ...viewer.inspected } : {},
    wolfVictim: isWitch && witchStep ? game.night.victim : null,
    peekLeft: isPf && running ? Math.round(game.peekLeftMs() / 100) / 10 : 0,
    // v2 additions
    spectator: !!viewer.spectator,
    isHost: game.hostId === viewer.id,
    team: viewer.spectator || game.phase === PHASES.LOBBY ? null : game.teamOf(viewer),
    peeking: V.isPeeking(game, viewer),
    skipped: game.phase === PHASES.DEBATE && game.skips.has(viewer.id),
    targets,
  };
}

/** StateSnapshot for `viewerId` (see shared/protocol.js). */
export function buildSnapshot(game, viewerId) {
  const viewer = game.member(viewerId);
  const n = game.players.length;
  const startError = game.phase === PHASES.LOBBY ? game.startError() : null;
  let skip = null;
  if (game.phase === PHASES.DEBATE) {
    const q = game.quorum();
    skip = { count: q.filter((p) => game.skips.has(p.id)).length, needed: Math.floor(q.length / 2) + 1 };
  }
  return {
    v: PROTOCOL_VERSION,
    room: {
      code: game.code,
      hostId: game.hostId,
      config: publicConfig(game.config, n),
      canStart: game.phase === PHASES.LOBBY && !startError,
      startError,
    },
    serverNow: game.now(),
    phase: game.phase,
    step: game.step,
    day: game.day,
    phaseStartedAt: game.phaseStartedAt,
    phaseEndsAt: game.phaseEndsAt,
    players: game.players.map((p) => playerView(game, viewer, p)),
    spectators: game.spectators.map((s) => ({ id: s.id, name: s.name, connected: s.connected, isHost: game.hostId === s.id })),
    me: meView(game, viewer),
    votes: visibleVotes(game, viewer),
    lastDeaths: [...game.lastDeaths],
    result: game.result ? { winner: game.result.winner, winners: [...game.result.winners] } : null,
    tie: game.tie ? [...game.tie] : null,
    skip,
  };
}
