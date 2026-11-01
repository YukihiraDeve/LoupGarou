import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S2C, PHASES, NIGHT_STEPS, ROLES as R, ACTIONS as A, EYES, CHANNELS } from '../../shared/protocol.js';
import { Room } from '../src/net/room.js';

const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeSocket() {
  return { data: {}, out: [], emit(ev, p) { this.out.push([ev, p]); } };
}

function setup() {
  const room = new Room('TEST');
  const g = room.game;
  const socks = [];
  const roles = [R.LOUP, R.PETITE_FILLE, R.VILLAGEOIS, R.VILLAGEOIS, R.VOYANTE, R.LOUP, R.VILLAGEOIS, R.VILLAGEOIS];
  for (let i = 0; i < roles.length; i++) {
    const m = g.join({ name: `J${i}` }).member;
    const s = fakeSocket();
    socks.push(s);
    room.attach(m.id, s);
  }
  assert.ok(g.start(g.hostId).ok);
  g.players.forEach((p, i) => { p.role = roles[i]; });
  const goTo = (phase, step = null) => {
    for (let k = 0; k < 40 && !(g.phase === phase && (step === null || g.step === step)); k++) g.onPhaseEnd();
    room.flush();
  };
  const presenceTo = (i) => socks[i].out.filter(([ev]) => ev === S2C.PRESENCE).map(([, p]) => p);
  const clear = () => socks.forEach((s) => { s.out.length = 0; });
  return { room, g, socks, goTo, presenceTo, clear, id: (i) => g.players[i].id };
}

test('relais de présence filtré, limité à 10 Hz, petite fille ↔ loups', async () => {
  const t = setup();
  try {
    t.goTo(PHASES.NIGHT, NIGHT_STEPS.LOUPS);
    t.clear();
    t.room.presenceIn(t.id(0), { yaw: 0.3, pitch: 0, eyes: EYES.OPEN, gesture: null });
    await tick();
    assert.equal(t.presenceTo(5).length, 1, "l'autre loup voit le loup");
    assert.equal(t.presenceTo(5)[0].id, t.id(0));
    for (const i of [1, 2, 3, 4, 6, 7]) assert.equal(t.presenceTo(i).length, 0, `joueur ${i} endormi ne reçoit rien`);

    // 10 Hz cap: a burst gives one immediate relay + one trailing relay
    t.clear();
    await wait(120);
    for (let k = 0; k < 6; k++) t.room.presenceIn(t.id(0), { yaw: 0.1 * k, pitch: 0, eyes: EYES.OPEN });
    assert.equal(t.presenceTo(5).length, 1);
    await wait(150);
    assert.equal(t.presenceTo(5).length, 2);
    assert.ok(Math.abs(t.presenceTo(5)[1].yaw - 0.5) < 1e-9, 'la dernière valeur est relayée');

    // a sleeping villager trying to open the eyes is relayed closed (to the dead only: none here)
    t.room.presenceIn(t.id(2), { yaw: 0, pitch: 0, eyes: EYES.OPEN });
    await wait(20);
    assert.ok(t.socks.every((s, i) => i === 2 || !s.out.some(([ev, p]) => ev === S2C.PRESENCE && p.id === t.id(2))));

    // petite fille peeks: wolves get her half-open eyes, she gets the wolves
    t.clear();
    assert.ok(t.room.applyAction(t.id(1), { type: A.PEEK, active: true }).ok);
    await tick();
    const seen = t.presenceTo(0).filter((p) => p.id === t.id(1));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].eyes, EYES.PEEK);
    assert.ok(t.presenceTo(1).some((p) => p.id === t.id(0) && p.eyes === EYES.OPEN));
    assert.equal(t.presenceTo(2).length, 0);
    t.clear();
    assert.ok(t.room.applyAction(t.id(1), { type: A.PEEK, active: false }).ok);
    await tick();
    const after = t.presenceTo(5).filter((p) => p.id === t.id(1));
    assert.equal(after.length, 1);
    assert.equal(after[0].eyes, EYES.CLOSED);
  } finally {
    t.room.dispose();
  }
});

test('chat : droits, anti-spam, destinataires', async () => {
  const t = setup();
  try {
    t.goTo(PHASES.NIGHT, NIGHT_STEPS.LOUPS);
    t.clear();
    assert.equal(t.room.chat(t.id(2), { text: 'coucou', channel: CHANNELS.VILLAGE }).ok, false);
    assert.ok(t.room.chat(t.id(0), { text: 'On mange J2 ?', channel: CHANNELS.LOUPS }).ok);
    const got = t.socks.map((s) => s.out.filter(([ev]) => ev === S2C.CHAT).length);
    assert.deepEqual(got, [1, 0, 0, 0, 0, 1, 0, 0]);
    t.goTo(PHASES.DEBATE);
    let refused = 0;
    for (let k = 0; k < 8; k++) if (!t.room.chat(t.id(3), { text: `message ${k}`, channel: CHANNELS.VILLAGE }).ok) refused++;
    assert.ok(refused >= 2, 'rafale limitée');
    assert.equal(t.room.chat(t.id(4), { text: 'x'.repeat(500), channel: CHANNELS.VILLAGE }).ok, true);
    const long = t.socks[2].out.filter(([ev]) => ev === S2C.CHAT).map(([, m]) => m).find((m) => m.from === t.id(4));
    assert.equal(long.text.length, 200);
  } finally {
    t.room.dispose();
  }
});
