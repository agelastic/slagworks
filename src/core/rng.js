// Small seeded RNG (mulberry32). Deterministic for a given seed.
//
//   const rng = createRng(1234)
//   rng.next()        float in [0, 1)
//   rng.range(a, b)   float in [a, b)
//   rng.int(a, b)     integer in [a, b], both ends inclusive
//   rng.pick(arr)     random element
//   rng.chance(p)     true with probability p
//   rng.state         current 32-bit state; assign to restore

export class Rng {
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }
}

export function createRng(seed = 1) {
  return new Rng(seed);
}
