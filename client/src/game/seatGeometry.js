// Default seat layout (same as the procedural camp and the contract: 16 seats on a 3.5 m circle,
// trigonometric order, seat_00 facing the presentation camera). Used by the demo bots to aim
// their gaze; the client itself always uses the real seat markers.
import { MAX_PLAYERS } from '@shared/protocol.js';

const R = 3.5;
export function seatPos(i) {
  const phi = Math.PI + (i * Math.PI * 2) / MAX_PLAYERS;
  return { x: Math.sin(phi) * R, z: Math.cos(phi) * R, phi };
}

/**
 * Presence angles from seat a towards seat b (or the fire when b is null).
 * yaw: radians around +Y relative to the seat forward (towards the fire), positive = to the left.
 * pitch: radians, positive = up.
 */
export function gazeAngles(a, b) {
  const pa = seatPos(a);
  const fx = -pa.x / R;
  const fz = -pa.z / R; // forward (towards the fire)
  const lx = fz;
  const lz = -fx; // local +X (the avatar's left) in world
  let dx;
  let dz;
  let dy;
  if (b == null) {
    dx = -pa.x;
    dz = -pa.z;
    dy = 0.6 - 1.1;
  } else {
    const pb = seatPos(b);
    dx = pb.x - pa.x;
    dz = pb.z - pa.z;
    dy = 0;
  }
  const yaw = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { yaw, pitch };
}
