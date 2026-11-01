// Idealised camp geometry: the 16 seats lie on a circle around the fire, in trigonometric
// (counter-clockwise seen from above) order. Yaw follows the three.js convention: rotation
// around +Y, so a positive yaw turns the head to the LEFT (counter-clockwise seen from above).
// 0 = looking at the fire (the seat's forward axis).
import { MAX_PLAYERS } from '../../../shared/protocol.js';

export const SEAT_COUNT = MAX_PLAYERS;
export const YAW_LIMIT = 1.6;
export const PITCH_MIN = -0.9;
export const PITCH_MAX = 0.7;

const TAU = Math.PI * 2;

export function wrapAngle(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

export function seatPosition(seat) {
  const a = (seat / SEAT_COUNT) * TAU;
  return [Math.cos(a), Math.sin(a)];
}

/** Head yaw (relative to the seat's forward axis) that makes `fromSeat` look at `toSeat`. */
export function yawTo(fromSeat, toSeat) {
  if (fromSeat === toSeat) return 0;
  const [ax, ay] = seatPosition(fromSeat);
  const [bx, by] = seatPosition(toSeat);
  const forward = Math.atan2(-ay, -ax);
  const dir = Math.atan2(by - ay, bx - ax);
  return wrapAngle(dir - forward);
}

export function angleDiff(a, b) {
  return wrapAngle(a - b);
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** True when a presence (yaw/pitch/eyes) from `fromSeat` is aimed at `toSeat`. */
export function isLookingAt(presence, fromSeat, toSeat, tolerance = 0.35) {
  if (!presence) return false;
  const want = yawTo(fromSeat, toSeat);
  return Math.abs(angleDiff(presence.yaw, want)) <= tolerance && presence.pitch > -0.6 && presence.pitch < 0.5;
}
