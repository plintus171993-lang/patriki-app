// Карта гостя: QR-код с меняющимся кодом и демо-реализация программы лояльности.

// --- SHA-256 (нужен для кода в QR; crypto.subtle есть не везде, например на http) ---
function sha256hex(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64), r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i-15], 7) ^ r(w[i-15], 18) ^ (w[i-15] >>> 3), s1 = r(w[i-2], 17) ^ r(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h = h.map((v, i) => (v + [a, b, c, d, e, f, g, hh][i]) >>> 0);
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
// тот же алгоритм, что public.loyalty_otp в базе
export const otp = (secret, win = Math.floor(Date.now() / 30000)) =>
  String(parseInt(sha256hex(`${secret}:${win}`).slice(0, 8), 16) % 1000000).padStart(6, '0');
export const qrPayload = (card, secret) => `PK1:${card}:${otp(secret)}`;

// QR-картинка (библиотека qrcode-generator кладётся в vendor/ при сборке)
export function qrSvg(text, size = 220) {
  if (typeof window.qrcode !== 'function') return `<div class="qr-fallback">${text.split(':')[1] || text}</div>`;
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, cell = size / (n + m * 2);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${(x + m) * cell} ${(y + m) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR-код карты гостя"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0E0E0D" shape-rendering="crispEdges"/></svg>`;
}

// уровень по сумме покупок
export function tierFor(tiers, spent) {
  const t = [...(tiers || [])].sort((a, b) => a.from - b.from);
  let cur = { name: 'Гость', from: 0, pct: 0 }, nxt = null;
  for (const x of t) { if (spent >= x.from) cur = x; else if (!nxt) nxt = x; }
  return { ...cur, next_name: nxt?.name || null, next_from: nxt?.from ?? null };
}

export const DEFAULT_SETTINGS = {
  enabled: true, verified_only: true, app_enabled: true, venue_enabled: true,
  tiers: [{ name: 'Гость', from: 0, pct: 5 }, { name: 'Завсегдатай', from: 5000, pct: 10 }, { name: 'Свой человек', from: 15000, pct: 15 }],
  period_days: 0, app_min_order: 0, accrue_delivery: false, max_redeem_pct: 30, burn_after_days: 0, welcome_bonus: 0, birthday_bonus: 0, rules_text: '',
  fixed_levels: [], accrue_if_redeem: true, accrue_delay_days: 0,
};
