// Shared network contract between server/ and client/ (plain ESM, no dependency).
// Rule: names may be ADDED, never renamed or removed. Every addition is noted in
// docs/ARCHITECTURE.md (section "Journal du contrat").

export const PROTOCOL_VERSION = 1;

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16; // = number of seat_XX markers in camp.glb

export const ROLES = Object.freeze({
  VILLAGEOIS: 'villageois',
  LOUP: 'loup',
  VOYANTE: 'voyante',
  SORCIERE: 'sorciere',
  CHASSEUR: 'chasseur',
  CUPIDON: 'cupidon',
  PETITE_FILLE: 'petite_fille',
});

export const TEAMS = Object.freeze({
  VILLAGE: 'village',
  LOUPS: 'loups',
  AMOUREUX: 'amoureux', // lovers from opposite camps win together
});

export const PHASES = Object.freeze({
  LOBBY: 'lobby',
  ROLE_REVEAL: 'role_reveal',             // day 0, golden hour: each player discovers their card
  NIGHT: 'night',                         // sub-step in state.step (NIGHT_STEPS)
  DAWN: 'dawn',                           // sunrise: night victims announced and revealed
  HUNTER: 'hunter',                       // the dead chasseur fires his last shot
  CAPTAIN_SUCCESSION: 'captain_succession', // dead captain names a successor
  ELECTION: 'election',                   // day 1 only: captain election
  DEBATE: 'debate',                       // free discussion, the sun goes down
  VOTE: 'vote',                           // village vote; closes when the sun touches the horizon
  EXECUTION: 'execution',                 // vote result, reveal, death animation
  GAME_OVER: 'game_over',
});

export const NIGHT_STEPS = Object.freeze({
  FALL: 'fall',         // "Le village s'endort" (everyone closes their eyes)
  CUPIDON: 'cupidon',   // night 1 only
  LOVERS: 'lovers',     // night 1 only: the lovers open their eyes and see each other
  VOYANTE: 'voyante',
  LOUPS: 'loups',       // the petite_fille may peek during this step
  SORCIERE: 'sorciere',
});

// Client -> server socket.io events. Calls that need an answer use socket.io acks:
// socket.emit(C2S.JOIN, payload, (res) => res.ok ? ... : res.error)
export const C2S = Object.freeze({
  CREATE: 'room:create',     // { name, avatar }                    -> ack { ok, code, playerId, token }
  JOIN: 'room:join',         // { code, name, avatar, token? }      -> ack { ok, code, playerId, token }
  LEAVE: 'room:leave',       // {}
  AVATAR: 'lobby:avatar',    // { avatar }
  CONFIG: 'lobby:config',    // host: { roles?: {role: count}, timers?: {key: seconds}, captain?: bool, speed?: number }
  ADD_BOT: 'lobby:addBot',   // host: {}
  KICK: 'lobby:kick',        // host: { playerId }
  START: 'game:start',       // host: {}                            -> ack { ok, error? }
  RESTART: 'game:restart',   // host, from game_over: back to lobby with the same players
  ACTION: 'game:action',     // { type: ACTIONS.*, target?, targets? } -> ack { ok, error? }
  CHAT: 'chat:send',         // { text, channel: CHANNELS.* }
  PRESENCE: 'presence',      // PresenceUpdate, at most 10 Hz
});

// Server -> client socket.io events.
export const S2C = Object.freeze({
  STATE: 'state',            // StateSnapshot, personalised for the receiver, sent on every change
  EVENT: 'event',            // GameEvent, one-shot (animations, sounds, narrator)
  CHAT: 'chat',              // { id, from, name, text, channel, ts }
  PRESENCE: 'presence',      // PresenceUpdate + { id }, relayed only to players allowed to see the sender
  ERROR: 'error',            // { message }
});

export const ACTIONS = Object.freeze({
  CUPIDON_LINK: 'cupidon_link',         // { targets: [idA, idB] }
  VOYANTE_INSPECT: 'voyante_inspect',   // { target }
  LOUP_VOTE: 'loup_vote',               // { target }  (wolves must agree; majority at timeout)
  SORCIERE_HEAL: 'sorciere_heal',       // {}          (life potion on the wolves' victim)
  SORCIERE_KILL: 'sorciere_kill',       // { target }  (death potion)
  SORCIERE_DONE: 'sorciere_done',       // {}          (ends her step early)
  PEEK: 'peek',                         // { active: bool } petite_fille during NIGHT_STEPS.LOUPS
  HUNTER_SHOOT: 'hunter_shoot',         // { target }
  ELECTION_VOTE: 'election_vote',       // { target }
  DAY_VOTE: 'day_vote',                 // { target: id | null }  (null = withdraw)
  CAPTAIN_DESIGNATE: 'captain_designate', // { target }
  CAPTAIN_TIEBREAK: 'captain_tiebreak',   // { target }
  SKIP: 'skip',                         // {} "Passer" : ends the debate early once a majority of the living asks
});

export const CHANNELS = Object.freeze({
  VILLAGE: 'village', // everyone, daytime only (the living)
  LOUPS: 'loups',     // wolves, during NIGHT_STEPS.LOUPS
  MORTS: 'morts',     // dead players and spectators
  SYSTEM: 'system',   // narrator lines from the server
});

export const DEATH_CAUSES = Object.freeze({
  LOUPS: 'loups',
  SORCIERE: 'sorciere',
  VOTE: 'vote',
  CHASSEUR: 'chasseur',
  CHAGRIN: 'chagrin', // a lover dies of grief
  NIGHT: 'nuit',       // v2: public cause of a night death (wolves or poison are not disclosed to the village)
});

// Server -> client one-shot events: { type: EVENTS.*, ...payload }
export const EVENTS = Object.freeze({
  PHASE: 'phase',                     // { phase, step, day }
  DEATH: 'death',                     // { playerId, cause, role }
  NO_DEATH: 'no_death',               // {} peaceful night
  INSPECT_RESULT: 'inspect_result',   // { target, role } (voyante only)
  LOVERS: 'lovers',                   // { ids: [a, b] } (lovers and cupidon only)
  WOLF_VICTIM: 'wolf_victim',         // { target | null } (sorciere only, at her step)
  VOTE_CAST: 'vote_cast',             // { voterId, target } (public day/election votes; wolves-only at night)
  CAPTAIN: 'captain',                 // { playerId }
  NO_LYNCH: 'no_lynch',               // {} tie without captain decision
  PEEK_SPOTTED: 'peek_spotted',       // { playerId } (wolves + the spotted petite fille herself)
  GAME_OVER: 'game_over',             // { winner: TEAMS.*, winners: [ids], roles: { id: role } }
});

// Eyes state of an avatar, carried by presence.
export const EYES = Object.freeze({ OPEN: 'open', CLOSED: 'closed', PEEK: 'peek' });

// Gestures an avatar can play, carried by presence.
export const GESTURES = Object.freeze({
  NONE: null,
  TALK: 'talk',
  POINT: 'point',   // points at presence.target
  RAISE: 'raise',   // raised hand
  NOD: 'nod',
  SHAKE: 'shake',
});

// Avatars available in the lobby (files client/public/assets/characters/<id>.glb).
export const AVATARS = Object.freeze([
  'camper_01', 'camper_02', 'camper_03', 'camper_04', 'camper_05',
  'camper_06', 'camper_07', 'camper_08', 'camper_09', 'camper_10',
]);

// Default timers in seconds (host can override, `speed` multiplies them all).
export const DEFAULT_TIMERS = Object.freeze({
  role_reveal: 12,
  night_fall: 5,
  cupidon: 25,
  lovers: 8,
  voyante: 20,
  loups: 40,
  sorciere: 25,
  dawn: 8,
  hunter: 20,
  captain_succession: 20,
  election: 60,
  debate: 150,
  vote: 45,
  execution: 8,
  captain_tiebreak: 20, // v2: execution phase, the captain breaks a tie between the most voted players
});

// v2: limits shared by the server (validation) and the client (UI). Seconds are multiplied by `speed`
// like the timers (PEEK_SECONDS, PEEK_SPOT_SECONDS).
export const LIMITS = Object.freeze({
  NAME_MAX: 20,           // player name length
  CHAT_MAX: 200,          // chat message length
  PRESENCE_HZ: 10,        // max presence updates relayed per player and per second
  PEEK_SECONDS: 8,        // petite_fille peek budget per night
  PEEK_SPOT_SECONDS: 3,   // continuous peek before the wolves can catch her
  CODE_LENGTH: 4,         // room code length
  CODE_ALPHABET: 'ACDEFGHJKMNPRTUVWXY', // no ambiguous letters (B/8, I/L/1, O/0, Q, S/5, Z/2)
  MAX_SPECTATORS: 16,
  SPEED_MIN: 0.25,
  SPEED_MAX: 4,
  TIMER_MIN: 3,           // seconds, host-configurable timers are clamped to [TIMER_MIN, TIMER_MAX]
  TIMER_MAX: 600,
});

/**
 * @typedef {Object} PresenceUpdate
 * @property {number} yaw     radians, head yaw relative to the seat's forward (0 = towards the fire), clamp [-1.6, 1.6]
 * @property {number} pitch   radians, clamp [-0.9, 0.7]
 * @property {'open'|'closed'|'peek'} eyes
 * @property {string|null} gesture  GESTURES.*
 * @property {string|null} [target] player id the gesture/gaze is aimed at
 */

/**
 * @typedef {Object} PlayerView      one entry of StateSnapshot.players
 * @property {string} id
 * @property {string} name
 * @property {string} avatar          AVATARS.*
 * @property {number} seat            0..15, index of the seat_XX marker
 * @property {boolean} alive
 * @property {boolean} connected
 * @property {boolean} isBot
 * @property {boolean} isHost
 * @property {boolean} isCaptain
 * @property {string|null} role       only when known to the receiver (self, dead, fellow wolves, game over)
 * @property {boolean} [isLover]      only when known to the receiver
 * @property {boolean} [awake]        only when the receiver is allowed to see it (night)
 * @property {string|null} deathCause v2: DEATH_CAUSES.* as known to the receiver (night deaths: 'nuit' for the village), null if alive
 */

/**
 * @typedef {Object} SpectatorView   v2: one entry of StateSnapshot.spectators (joined after the start, no seat)
 * @property {string} id
 * @property {string} name
 * @property {boolean} connected
 * @property {boolean} isHost
 */

/**
 * @typedef {Object} StateSnapshot   personalised: never contains information the receiver must not know
 * @property {number} v               PROTOCOL_VERSION
 * @property {{code:string, hostId:string, config:Object}} room
 * @property {number} serverNow       ms epoch, lets the client correct its clock
 * @property {string} phase           PHASES.*
 * @property {string|null} step       NIGHT_STEPS.* during the night
 * @property {number} day             0 = role reveal, 1 = first day...
 * @property {number} phaseStartedAt  ms epoch
 * @property {number|null} phaseEndsAt ms epoch, null when untimed (lobby, game over)
 * @property {PlayerView[]} players
 * @property {Object} me              { id, role, alive, lover: id|null, potions: {heal, kill}, awake, canAct,
 *                                      actions: [ACTIONS.*] allowed right now, inspected: {id: role},
 *                                      wolfVictim: id|null (sorciere at her step), peekLeft: seconds }
 * @property {Object<string,string|null>} votes  voterId -> target, only the votes the receiver may see
 * @property {string[]} lastDeaths    ids that died at the last dawn / execution
 * @property {{winner:string, winners:string[]}|null} result
 *
 * v2 additions:
 * @property {SpectatorView[]} spectators   observers who joined during the game (no seat, see everything)
 * @property {string[]|null} tie            execution phase: tied players while the captain must break the tie
 * @property {{count:number, needed:number}|null} skip  debate: SKIP requests among the living / majority needed
 * room additions: room.canStart (bool), room.startError (string|null, French), room.config.rolesAuto (bool: roles
 *   follow defaultComposition(n)); room.config.roles is the effective composition, villageois always fills up to n.
 * me additions: spectator (bool), isHost (bool), team (TEAMS.*: own objective, 'amoureux' for a mixed couple),
 *   peeking (bool), skipped (bool), targets: { [ACTIONS.*]: ids[] } valid targets for each allowed action.
 * GameEvent additions: VOTE_CAST carries kind ('election' | 'day' | 'loups') and weight (2 for the captain's day vote).
 */
