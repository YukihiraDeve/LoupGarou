// Small deterministic helpers around an injectable rng() -> [0, 1).

/** Seeded PRNG (mulberry32), used by tests and simulations. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(rng() * list.length) % list.length];
}

export function shuffle(rng, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function between(rng, min, max) {
  return min + (max - min) * rng();
}

export function chance(rng, p) {
  return rng() < p;
}
