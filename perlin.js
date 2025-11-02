// Simple seedable pseudo-random and 2D Perlin noise
export function createRNG(seed) {
  let s = xorshift32(seed);
  return () => (s = xorshift32(s)) / 0xffffffff;
}
function xorshift32(x) {
  if (x === 0) x = 0xdeadbeef;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0;
}

export function createPerlin(seed = 1337) {
  const rand = createRNG(seed);
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  function noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x); const v = fade(y);

    const A = p[X] + Y, B = p[X + 1] + Y;
    const n00 = grad(p[A], x, y);
    const n10 = grad(p[B], x - 1, y);
    const n01 = grad(p[A + 1], x, y - 1);
    const n11 = grad(p[B + 1], x - 1, y - 1);

    const nx0 = lerp(n00, n10, u);
    const nx1 = lerp(n01, n11, u);
    const nxy = lerp(nx0, nx1, v);
    return (nxy + 1) * 0.5; // [0,1]
  }

  return { noise2D };
}
