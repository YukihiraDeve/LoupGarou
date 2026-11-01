import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { C2S, S2C, PHASES, ROLES, CHANNELS, ACTIONS } from '../../shared/protocol.js';
import { startServer } from '../src/index.js';

let srv;
let staticDir;
const sockets = [];

before(async () => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'lg-dist-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>LG</title>');
  mkdirSync(path.join(staticDir, 'assets', 'camp'), { recursive: true });
  writeFileSync(path.join(staticDir, 'assets', 'index-AbCd1234.js'), 'console.log(1)');
  writeFileSync(path.join(staticDir, 'assets', 'camp', 'camp.glb'), 'glTF');
  srv = await startServer({ port: 0, host: '127.0.0.1', speed: 0.03, staticDir, logLevel: 'warn' });
});

after(async () => {
  for (const s of sockets) s.close();
  await srv.close();
  rmSync(staticDir, { recursive: true, force: true });
});

function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Client wrapper keeping the latest state and every event. */
function client() {
  const socket = connect(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  const c = { socket, state: null, events: [], chats: [], presence: [], errors: [] };
  socket.on(S2C.STATE, (s) => { c.state = s; });
  socket.on(S2C.EVENT, (e) => c.events.push(e));
  socket.on(S2C.CHAT, (m) => c.chats.push(m));
  socket.on(S2C.PRESENCE, (p) => c.presence.push(p));
  socket.on(S2C.ERROR, (e) => c.errors.push(e));
  c.call = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));
  c.until = (pred, ms = 20_000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = c.state && pred(c.state); } catch { ok = false; }
      if (ok) { clearInterval(iv); resolve(c.state); } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error(`timeout (phase ${c.state?.phase}/${c.state?.step})`));
      }
    }, 20);
  });
  return c;
}

test('créer, rejoindre, bots, lancer, progresser, se reconnecter', async () => {
  const alice = client();
  const created = await alice.call(C2S.CREATE, { name: 'Alice', avatar: 'camper_02' });
  assert.ok(created.ok, created.error);
  assert.match(created.code, /^[A-Z]{4}$/);
  assert.ok(created.token && created.playerId);

  const bob = client();
  assert.equal((await bob.call(C2S.JOIN, { code: 'ZZZZ', name: 'Bob' })).ok, false);
  const joined = await bob.call(C2S.JOIN, { code: created.code.toLowerCase(), name: 'Bob', avatar: 'camper_02' });
  assert.ok(joined.ok, joined.error);
  assert.equal(joined.code, created.code);

  assert.equal((await bob.call(C2S.ADD_BOT)).ok, false, "seul l'hôte ajoute des bots");
  for (let i = 0; i < 6; i++) assert.ok((await alice.call(C2S.ADD_BOT)).ok);
  const lobby = await alice.until((s) => s.players.length === 8);
  assert.equal(new Set(lobby.players.map((p) => p.avatar)).size, 8, 'avatars uniques');
  assert.equal(new Set(lobby.players.map((p) => p.seat)).size, 8);
  assert.ok(lobby.players.filter((p) => p.isBot).length === 6);
  assert.ok(lobby.room.canStart);

  assert.equal((await alice.call(C2S.CONFIG, { roles: { loup: 9 } })).ok, false);
  assert.ok((await alice.call(C2S.CONFIG, { captain: true, timers: { debate: 60 } })).ok);
  await alice.until((s) => s.room.config.timers.debate === 60);

  // chat in the lobby
  assert.ok((await alice.call(C2S.CHAT, { text: 'Bonsoir !', channel: CHANNELS.VILLAGE })).ok);
  await bob.until(() => bob.chats.some((m) => m.text === 'Bonsoir !' && m.name === 'Alice'));
  assert.equal((await alice.call(C2S.CHAT, { text: 'Bonsoir !', channel: CHANNELS.VILLAGE })).ok, false, 'doublon refusé');

  assert.equal((await bob.call(C2S.START)).ok, false);
  const started = await alice.call(C2S.START);
  assert.ok(started.ok, started.error);
  const reveal = await bob.until((s) => s.phase === PHASES.ROLE_REVEAL);
  assert.ok(Object.values(ROLES).includes(reveal.me.role));
  const bobRole = reveal.me.role;
  if (bobRole !== ROLES.LOUP) {
    for (const p of reveal.players) if (p.id !== joined.playerId) assert.equal(p.role, null, 'aucun rôle divulgué');
  }

  // spectator joining mid-game
  const carol = client();
  const spect = await carol.call(C2S.JOIN, { code: created.code, name: 'Carole' });
  assert.ok(spect.ok && spect.spectator);
  await carol.until((s) => s.me.spectator && s.spectators.some((x) => x.id === spect.playerId));

  await bob.until((s) => s.phase === PHASES.NIGHT);
  await bob.until((s) => s.day >= 1, 30_000);

  // reconnection: same seat and role with the token, even during the game
  bob.socket.disconnect();
  await alice.until((s) => s.players.find((p) => p.id === joined.playerId)?.connected === false);
  const bob2 = client();
  const back = await bob2.call(C2S.JOIN, { code: created.code, token: joined.token, name: 'Bob' });
  assert.ok(back.ok, back.error);
  assert.equal(back.playerId, joined.playerId);
  const s2 = await bob2.until((s) => s.me.id === joined.playerId);
  assert.equal(s2.me.role, bobRole);
  assert.notEqual(s2.phase, PHASES.LOBBY);
  await alice.until((s) => s.players.find((p) => p.id === joined.playerId)?.connected === true);
  assert.ok(bob2.chats.length > 0, "historique du chat renvoyé à la reconnexion");

  // the game keeps going (bots act, humans time out) until the end
  const over = await alice.until((s) => s.phase === PHASES.GAME_OVER, 90_000);
  assert.ok(over.result && over.result.winner);
  assert.ok(over.players.every((p) => p.role));
  assert.ok(alice.events.some((e) => e.type === 'game_over'));
  assert.ok(alice.presence.length > 0, 'présence des bots relayée');

  // back to the lobby; the spectator gets a seat
  assert.ok((await alice.call(C2S.RESTART)).ok);
  const lobby2 = await alice.until((s) => s.phase === PHASES.LOBBY);
  assert.equal(lobby2.players.length, 9);
  assert.ok(lobby2.players.every((p) => p.role === null && p.alive));
});

test('validation des entrées et actions hors tour', async () => {
  const a = client();
  const res = await a.call(C2S.CREATE, { name: 'x'.repeat(200), avatar: 42 });
  assert.ok(res.ok);
  const s = await a.until((st) => st.players.length === 1);
  assert.equal(s.players[0].name.length, 20);
  assert.equal((await a.call(C2S.ACTION, { type: ACTIONS.DAY_VOTE, target: 'nobody' })).ok, false);
  assert.equal((await a.call(C2S.ACTION, null)).ok, false);
  assert.equal((await a.call(C2S.KICK, { playerId: res.playerId })).ok, false);
  assert.equal((await a.call(C2S.CHAT, { text: '   ', channel: CHANNELS.VILLAGE })).ok, false);
  assert.equal((await a.call(C2S.CHAT, { text: 'hey', channel: CHANNELS.LOUPS })).ok, false);
  a.socket.emit(C2S.PRESENCE, { yaw: 'NaN', pitch: 99, eyes: 'wide', gesture: 'dance' });
  a.socket.emit(C2S.CONFIG, { speed: 'vite' });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(a.errors.length >= 1);
  assert.ok(a.socket.connected, 'le serveur survit aux entrées invalides');

  const b = client();
  assert.equal((await b.call(C2S.ACTION, { type: ACTIONS.SKIP })).ok, false, 'hors salon');

  // kick + leave
  assert.ok((await a.call(C2S.ADD_BOT)).ok);
  const withBot = await a.until((st) => st.players.length === 2);
  const botId = withBot.players.find((p) => p.isBot).id;
  assert.ok((await a.call(C2S.KICK, { playerId: botId })).ok);
  await a.until((st) => st.players.length === 1);
  assert.ok((await a.call(C2S.LEAVE)).ok);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!srv.manager.rooms.has(res.code), 'salon sans humain supprimé');
});

test('fichiers statiques : types MIME, cache, repli SPA, pas de traversée', async () => {
  const get = (p, headers) => fetch(srv.url + p, { headers });
  let r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  r = await get('/salon/ABCD');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>LG/);
  r = await get('/assets/index-AbCd1234.js');
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(r.headers.get('cache-control'), /immutable/);
  const etag = r.headers.get('etag');
  r = await get('/assets/index-AbCd1234.js', { 'if-none-match': etag });
  assert.equal(r.status, 304);
  r = await get('/assets/camp/camp.glb');
  assert.equal(r.headers.get('content-type'), 'model/gltf-binary');
  assert.doesNotMatch(r.headers.get('cache-control'), /immutable/);
  assert.equal((await get('/missing.png')).status, 404);
  for (const raw of ['/../../../etc/passwd', '/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd.txt']) {
    const res = await rawGet(raw);
    assert.ok(!res.body.includes('root:'), `traversée possible : ${raw}`);
    assert.ok(res.status === 404 || res.body.includes('<title>LG'), `${raw} -> ${res.status}`);
  }
  r = await get('/healthz');
  assert.equal((await r.json()).ok, true);
});
