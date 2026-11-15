/* Zip-It — archive worker
 * Everything archive-related runs here, off the main thread:
 * Deflate encoder, AES (WinZip AE-2) and ZipCrypto encryption, CRC-32,
 * ZIP / TAR / GZIP writers and readers. No third-party libraries —
 * decompression uses the browser's built-in DecompressionStream. */
'use strict';

const te = new TextEncoder();
const td = new TextDecoder();
const tdFatal = new TextDecoder('utf-8', { fatal: true });

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

// ---------- Byte helpers ----------
function concatBytes(list) {
  let len = 0;
  for (const a of list) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
function w16(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; }
function w32(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255; }
function r16(a, o) { return a[o] | (a[o + 1] << 8); }
function r32(a, o) { return (a[o] | (a[o + 1] << 8) | (a[o + 2] << 16) | (a[o + 3] << 24)) >>> 0; }
function r64(a, o) { return r32(a, o) + r32(a, o + 4) * 4294967296; }

// ---------- CRC-32 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(data, crc = 0) {
  let c = ~crc;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}

// =====================================================================
// Deflate encoder (RFC 1951): LZ77 with hash chains + Huffman coding.
// Level 0 = stored, 1–3 = greedy matching, 4–9 = lazy matching.
// =====================================================================
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LEN_CODE = new Uint8Array(259);
for (let c = 0; c < 29; c++) {
  const hi = Math.min(258, LEN_BASE[c] + (1 << LEN_EXTRA[c]) - 1);
  for (let l = LEN_BASE[c]; l <= hi; l++) LEN_CODE[l] = c;
}
const DIST_CODE = new Uint8Array(32769);
for (let c = 0; c < 30; c++) {
  const hi = Math.min(32768, DIST_BASE[c] + (1 << DIST_EXTRA[c]) - 1);
  for (let d = DIST_BASE[c]; d <= hi; d++) DIST_CODE[d] = c;
}

// Similar to zlib's configuration table.
const LEVELS = [
  null,
  { chain: 4, nice: 8, lazy: 0, insert: 4 },
  { chain: 8, nice: 16, lazy: 0, insert: 5 },
  { chain: 32, nice: 32, lazy: 0, insert: 6 },
  { chain: 16, nice: 16, lazy: 4, good: 4 },
  { chain: 32, nice: 32, lazy: 16, good: 8 },
  { chain: 128, nice: 128, lazy: 16, good: 8 },
  { chain: 256, nice: 128, lazy: 32, good: 8 },
  { chain: 1024, nice: 258, lazy: 128, good: 32 },
  { chain: 4096, nice: 258, lazy: 258, good: 32 }
];

function reverseBits(c, len) {
  let r = 0;
  for (let i = 0; i < len; i++) { r = (r << 1) | (c & 1); c >>>= 1; }
  return r;
}

// Length-limited Huffman code lengths. If the optimal tree is too deep,
// frequencies are flattened and the tree is rebuilt.
function buildLengths(freqs, maxBits) {
  const n = freqs.length;
  const lens = new Uint8Array(n);
  const f = Array.from(freqs);
  for (;;) {
    const syms = [];
    for (let i = 0; i < n; i++) if (f[i] > 0) syms.push(i);
    if (syms.length === 0) return lens;
    if (syms.length === 1) { lens[syms[0]] = 1; return lens; }
    syms.sort((a, b) => f[a] - f[b] || a - b);
    const m = syms.length;
    const W = new Float64Array(2 * m);
    const parent = new Int32Array(2 * m);
    for (let i = 0; i < m; i++) W[i] = f[syms[i]];
    let leaf = 0, node = m, end = m;
    const pick = () => (leaf < m && (node >= end || W[leaf] <= W[node])) ? leaf++ : node++;
    while (end < 2 * m - 1) {
      const a = pick(), b = pick();
      W[end] = W[a] + W[b];
      parent[a] = end; parent[b] = end;
      end++;
    }
    const depth = new Int32Array(2 * m);
    for (let k = 2 * m - 3; k >= 0; k--) depth[k] = depth[parent[k]] + 1;
    let maxD = 0;
    for (let i = 0; i < m; i++) if (depth[i] > maxD) maxD = depth[i];
    if (maxD <= maxBits) {
      for (let i = 0; i < m; i++) lens[syms[i]] = depth[i];
      return lens;
    }
    for (let i = 0; i < n; i++) if (f[i] > 0) f[i] = (f[i] >> 1) | 1;
  }
}

function buildCodes(lens) {
  const blCount = new Uint16Array(16);
  for (let i = 0; i < lens.length; i++) if (lens[i]) blCount[lens[i]]++;
  const next = new Uint16Array(16);
  let code = 0;
  for (let b = 1; b < 16; b++) { code = (code + blCount[b - 1]) << 1; next[b] = code; }
  const codes = new Uint16Array(lens.length);
  for (let i = 0; i < lens.length; i++) if (lens[i]) codes[i] = reverseBits(next[lens[i]]++, lens[i]);
  return codes;
}

const FIXED_L = new Uint8Array(288);
FIXED_L.fill(8, 0, 144); FIXED_L.fill(9, 144, 256); FIXED_L.fill(7, 256, 280); FIXED_L.fill(8, 280, 288);
const FIXED_D = new Uint8Array(30).fill(5);
const FIXED_LC = buildCodes(FIXED_L);
const FIXED_DC = buildCodes(FIXED_D);

class BitWriter {
  constructor(cap) { this.buf = new Uint8Array(cap); this.pos = 0; this.bb = 0; this.bc = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let c = this.buf.length * 2;
    while (c < this.pos + n) c *= 2;
    const b = new Uint8Array(c);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }
  bits(v, n) {
    this.bb |= v << this.bc;
    this.bc += n;
    while (this.bc >= 8) { this.buf[this.pos++] = this.bb & 255; this.bb >>>= 8; this.bc -= 8; }
  }
  align() { if (this.bc > 0) { this.buf[this.pos++] = this.bb & 255; this.bb = 0; this.bc = 0; } }
  finish() { this.align(); return this.buf.subarray(0, this.pos); }
}

// Run-length encode code lengths with symbols 16/17/18.
function rleLengths(all) {
  const out = [];
  const N = all.length;
  let i = 0;
  while (i < N) {
    const v = all[i];
    let run = 1;
    while (i + run < N && all[i + run] === v) run++;
    i += run;
    if (v === 0) {
      while (run >= 11) { const r = Math.min(run, 138); out.push(18, r - 11); run -= r; }
      if (run >= 3) { out.push(17, run - 3); run = 0; }
      while (run-- > 0) out.push(0, 0);
    } else {
      out.push(v, 0); run--;
      while (run >= 3) { const r = Math.min(run, 6); out.push(16, r - 3); run -= r; }
      while (run-- > 0) out.push(v, 0);
    }
  }
  return out;
}
const CL_EXTRA = { 16: 2, 17: 3, 18: 7 };

function storedBlocks(out, data, start, end, final) {
  if (start === end) { // empty stored block
    out.ensure(8); out.bits(final ? 1 : 0, 1); out.bits(0, 2); out.align();
    out.buf[out.pos++] = 0; out.buf[out.pos++] = 0; out.buf[out.pos++] = 255; out.buf[out.pos++] = 255;
    return;
  }
  for (let p = start; p < end; p += 65535) {
    const len = Math.min(65535, end - p);
    const last = final && p + len >= end;
    out.ensure(len + 8);
    out.bits(last ? 1 : 0, 1); out.bits(0, 2); out.align();
    out.buf[out.pos++] = len & 255; out.buf[out.pos++] = len >>> 8;
    out.buf[out.pos++] = ~len & 255; out.buf[out.pos++] = (~len >>> 8) & 255;
    out.buf.set(data.subarray(p, p + len), out.pos);
    out.pos += len;
  }
}

function deflateRaw(data, level, onProgress) {
  const n = data.length;
  const out = new BitWriter(Math.max(1024, n + (n >> 3) + 1024));
  if (level <= 0) { storedBlocks(out, data, 0, n, true); return out.finish(); }
  if (n === 0) { out.bits(1, 1); out.bits(1, 2); out.bits(0, 7); return out.finish(); }

  const cfg = LEVELS[Math.min(9, level)];
  const nice = cfg.nice;
  const HMASK = (1 << 15) - 1, WSIZE = 32768, WMASK = WSIZE - 1;
  const head = new Int32Array(HMASK + 1).fill(-1);
  const prev = new Int32Array(WSIZE);
  const SYM_LIMIT = 16384;
  const syms = new Uint16Array(SYM_LIMIT);
  const dists = new Uint16Array(SYM_LIMIT);
  let symCount = 0, blockStart = 0, emitted = 0, matchDist = 0;

  function insertOnly(i) {
    if (i + 2 >= n) return;
    const h = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & HMASK;
    prev[i & WMASK] = head[h];
    head[h] = i;
  }

  // Inserts position i and returns the longest match longer than bestLen (or 0).
  function insertAndFind(i, chainLimit, bestLen) {
    if (i + 2 >= n) return 0;
    const h = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & HMASK;
    let cur = head[h];
    prev[i & WMASK] = cur;
    head[h] = i;
    const maxLen = Math.min(258, n - i);
    if (maxLen < 3 || bestLen >= maxLen) return 0;
    const limit = i - WSIZE;
    let best = bestLen < 2 ? 2 : bestLen;
    let bestDist = 0;
    let chain = chainLimit;
    while (cur >= 0 && cur >= limit && chain-- > 0) {
      if (data[cur + best] === data[i + best] && data[cur] === data[i] && data[cur + 1] === data[i + 1]) {
        let l = 2;
        while (l < maxLen && data[cur + l] === data[i + l]) l++;
        if (l > best) {
          best = l; bestDist = i - cur;
          if (l >= nice || l >= maxLen) break;
        }
      }
      const nx = prev[cur & WMASK];
      if (nx >= cur) break;
      cur = nx;
    }
    matchDist = bestDist;
    if (bestDist === 0) return 0;
    if (best === 3 && bestDist > 4096) return 0; // not worth it
    return best;
  }

  function writeBlock(final) {
    const start = blockStart, end = emitted;
    const lf = new Uint32Array(286), df = new Uint32Array(30);
    for (let k = 0; k < symCount; k++) {
      const s = syms[k];
      if (dists[k] === 0) lf[s]++;
      else { lf[257 + LEN_CODE[s - 256]]++; df[DIST_CODE[dists[k]]]++; }
    }
    lf[256] = 1;
    const ll = buildLengths(lf, 15);
    const dl = buildLengths(df, 15);
    let anyDist = false;
    for (let i = 0; i < 30; i++) if (dl[i]) { anyDist = true; break; }
    if (!anyDist) dl[0] = 1;

    const dataBits = (L, D) => {
      let b = 0;
      for (let c = 0; c < 286; c++) if (lf[c]) b += lf[c] * (L[c] + (c >= 257 ? LEN_EXTRA[c - 257] : 0));
      for (let c = 0; c < 30; c++) if (df[c]) b += df[c] * (D[c] + DIST_EXTRA[c]);
      return b;
    };

    let hlit = 286; while (hlit > 257 && ll[hlit - 1] === 0) hlit--;
    let hdist = 30; while (hdist > 1 && dl[hdist - 1] === 0) hdist--;
    const all = new Uint8Array(hlit + hdist);
    all.set(ll.subarray(0, hlit), 0);
    all.set(dl.subarray(0, hdist), hlit);
    const rle = rleLengths(all);
    const clf = new Uint32Array(19);
    for (let k = 0; k < rle.length; k += 2) clf[rle[k]]++;
    const clLens = buildLengths(clf, 7);
    let hclen = 19; while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
    let dynBits = 17 + 3 * hclen;
    for (let k = 0; k < rle.length; k += 2) dynBits += clLens[rle[k]] + (CL_EXTRA[rle[k]] || 0);
    dynBits += dataBits(ll, dl);
    const fixedBits = 3 + dataBits(FIXED_L, FIXED_D);
    const rawLen = end - start;
    const storedBits = Math.ceil(rawLen / 65535) * 42 + rawLen * 8;

    if (storedBits <= dynBits && storedBits <= fixedBits) {
      storedBlocks(out, data, start, end, final);
      return;
    }
    const useFixed = fixedBits <= dynBits;
    out.ensure(((useFixed ? fixedBits : dynBits) >> 3) + 64);
    out.bits(final ? 1 : 0, 1);
    let LL, LC, DL, DC;
    if (useFixed) {
      out.bits(1, 2);
      LL = FIXED_L; LC = FIXED_LC; DL = FIXED_D; DC = FIXED_DC;
    } else {
      out.bits(2, 2);
      out.bits(hlit - 257, 5); out.bits(hdist - 1, 5); out.bits(hclen - 4, 4);
      for (let k = 0; k < hclen; k++) out.bits(clLens[CL_ORDER[k]], 3);
      const clCodes = buildCodes(clLens);
      for (let k = 0; k < rle.length; k += 2) {
        const s = rle[k];
        out.bits(clCodes[s], clLens[s]);
        if (s >= 16) out.bits(rle[k + 1], CL_EXTRA[s]);
      }
      LL = ll; LC = buildCodes(ll); DL = dl; DC = buildCodes(dl);
    }
    for (let k = 0; k < symCount; k++) {
      const s = syms[k], d = dists[k];
      if (d === 0) { out.bits(LC[s], LL[s]); continue; }
      const len = s - 256;
      const lc = LEN_CODE[len];
      out.bits(LC[257 + lc], LL[257 + lc]);
      if (LEN_EXTRA[lc]) out.bits(len - LEN_BASE[lc], LEN_EXTRA[lc]);
      const dc = DIST_CODE[d];
      out.bits(DC[dc], DL[dc]);
      if (DIST_EXTRA[dc]) out.bits(d - DIST_BASE[dc], DIST_EXTRA[dc]);
    }
    out.bits(LC[256], LL[256]);
  }

  function flush(final) {
    if (symCount === 0) {
      if (final) { out.ensure(4); out.bits(1, 1); out.bits(1, 2); out.bits(0, 7); }
      return;
    }
    writeBlock(final);
    blockStart = emitted;
    symCount = 0;
    if (onProgress) onProgress(emitted);
  }
  function emitLit(b) {
    syms[symCount] = b; dists[symCount++] = 0; emitted++;
    if (symCount === SYM_LIMIT) flush(false);
  }
  function emitMatch(len, dist) {
    syms[symCount] = 256 + len; dists[symCount++] = dist; emitted += len;
    if (symCount === SYM_LIMIT) flush(false);
  }

  if (cfg.lazy === 0) {
    let i = 0;
    while (i < n) {
      const len = insertAndFind(i, cfg.chain, 2);
      if (len >= 3) {
        emitMatch(len, matchDist);
        if (len <= cfg.insert) for (let j = i + 1; j < i + len; j++) insertOnly(j);
        i += len;
      } else {
        emitLit(data[i]);
        i++;
      }
    }
  } else {
    let i = 0, prevLen = 0, prevDist = 0, avail = false;
    while (i < n) {
      let curLen = 0, curDist = 0;
      if (prevLen < cfg.lazy) {
        curLen = insertAndFind(i, prevLen >= cfg.good ? cfg.chain >> 2 : cfg.chain, prevLen);
        curDist = matchDist;
      } else {
        insertOnly(i);
      }
      if (avail && prevLen >= 3 && curLen <= prevLen) {
        emitMatch(prevLen, prevDist);
        const end = i - 1 + prevLen;
        for (let j = i + 1; j < end; j++) insertOnly(j);
        i = end;
        avail = false;
        prevLen = 0;
      } else {
        if (avail) emitLit(data[i - 1]);
        avail = true;
        prevLen = curLen;
        prevDist = curDist;
        i++;
      }
    }
    if (avail) emitLit(data[n - 1]);
  }
  flush(true);
  return out.finish();
}

// Built-in decompression (deflate-raw / gzip) via DecompressionStream.
async function decompress(u8, format) {
  if (typeof DecompressionStream === 'undefined') {
    throw fail('This browser cannot decompress data (DecompressionStream is missing). Please update your browser.');
  }
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// =====================================================================
// AES (encryption direction only — CTR mode needs nothing else)
// =====================================================================
const AES_SBOX = new Uint8Array(256);
const AES_T0 = new Uint32Array(256), AES_T1 = new Uint32Array(256), AES_T2 = new Uint32Array(256), AES_T3 = new Uint32Array(256);
(() => {
  const xt = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  let p = 1;
  for (let i = 0; i < 255; i++) { exp[i] = p; log[p] = i; p ^= xt(p); }
  const rotl8 = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff;
  for (let a = 0; a < 256; a++) {
    const inv = a === 0 ? 0 : exp[(255 - log[a]) % 255];
    const s = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
    AES_SBOX[a] = s;
  }
  for (let a = 0; a < 256; a++) {
    const s = AES_SBOX[a], s2 = xt(s), s3 = s2 ^ s;
    const t = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    AES_T0[a] = t;
    AES_T1[a] = ((t >>> 8) | (t << 24)) >>> 0;
    AES_T2[a] = ((t >>> 16) | (t << 16)) >>> 0;
    AES_T3[a] = ((t >>> 24) | (t << 8)) >>> 0;
  }
})();

function aesExpandKey(key) {
  const nk = key.length / 4, nr = nk + 6, total = 4 * (nr + 1);
  const w = new Uint32Array(total);
  for (let i = 0; i < nk; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  const S = AES_SBOX;
  const sub = (t) => ((S[t >>> 24] << 24) | (S[(t >>> 16) & 255] << 16) | (S[(t >>> 8) & 255] << 8) | S[t & 255]) >>> 0;
  let rcon = 1;
  for (let i = nk; i < total; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = sub(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24);
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) {
      t = sub(t);
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return { w, nr };
}

function aesEncryptBlock(k, s0, s1, s2, s3, out) {
  const w = k.w, nr = k.nr;
  s0 ^= w[0]; s1 ^= w[1]; s2 ^= w[2]; s3 ^= w[3];
  let r = 4;
  for (let round = 1; round < nr; round++) {
    const t0 = AES_T0[s0 >>> 24] ^ AES_T1[(s1 >>> 16) & 255] ^ AES_T2[(s2 >>> 8) & 255] ^ AES_T3[s3 & 255] ^ w[r];
    const t1 = AES_T0[s1 >>> 24] ^ AES_T1[(s2 >>> 16) & 255] ^ AES_T2[(s3 >>> 8) & 255] ^ AES_T3[s0 & 255] ^ w[r + 1];
    const t2 = AES_T0[s2 >>> 24] ^ AES_T1[(s3 >>> 16) & 255] ^ AES_T2[(s0 >>> 8) & 255] ^ AES_T3[s1 & 255] ^ w[r + 2];
    const t3 = AES_T0[s3 >>> 24] ^ AES_T1[(s0 >>> 16) & 255] ^ AES_T2[(s1 >>> 8) & 255] ^ AES_T3[s2 & 255] ^ w[r + 3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3; r += 4;
  }
  const S = AES_SBOX;
  const o0 = ((S[s0 >>> 24] << 24) | (S[(s1 >>> 16) & 255] << 16) | (S[(s2 >>> 8) & 255] << 8) | S[s3 & 255]) ^ w[r];
  const o1 = ((S[s1 >>> 24] << 24) | (S[(s2 >>> 16) & 255] << 16) | (S[(s3 >>> 8) & 255] << 8) | S[s0 & 255]) ^ w[r + 1];
  const o2 = ((S[s2 >>> 24] << 24) | (S[(s3 >>> 16) & 255] << 16) | (S[(s0 >>> 8) & 255] << 8) | S[s1 & 255]) ^ w[r + 2];
  const o3 = ((S[s3 >>> 24] << 24) | (S[(s0 >>> 16) & 255] << 16) | (S[(s1 >>> 8) & 255] << 8) | S[s2 & 255]) ^ w[r + 3];
  out[0] = o0 >>> 24; out[1] = o0 >>> 16; out[2] = o0 >>> 8; out[3] = o0;
  out[4] = o1 >>> 24; out[5] = o1 >>> 16; out[6] = o1 >>> 8; out[7] = o1;
  out[8] = o2 >>> 24; out[9] = o2 >>> 16; out[10] = o2 >>> 8; out[11] = o2;
  out[12] = o3 >>> 24; out[13] = o3 >>> 16; out[14] = o3 >>> 8; out[15] = o3;
}

const bswap = (x) => (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;

// WinZip AES uses CTR mode with a 128-bit little-endian counter starting at 1.
function aesCtr(key, data) {
  const k = aesExpandKey(key);
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  let lo = 1, hi = 0;
  for (let off = 0; off < data.length; off += 16) {
    aesEncryptBlock(k, bswap(lo), bswap(hi), 0, 0, ks);
    const end = Math.min(16, data.length - off);
    for (let j = 0; j < end; j++) out[off + j] = data[off + j] ^ ks[j];
    lo = (lo + 1) >>> 0;
    if (lo === 0) hi++;
  }
  return out;
}

const AES_KEYLEN = { 1: 16, 2: 24, 3: 32 };

async function aesDeriveKeys(pw, salt, keyLen) {
  const base = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' }, base, (keyLen * 2 + 2) * 8));
  return {
    encKey: bits.slice(0, keyLen),
    authKey: bits.slice(keyLen, keyLen * 2),
    verifier: bits.slice(keyLen * 2, keyLen * 2 + 2)
  };
}
async function hmacSha1x10(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)).slice(0, 10);
}
async function aesEncrypt(data, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { encKey, authKey, verifier } = await aesDeriveKeys(pw, salt, 32);
  const cipher = aesCtr(encKey, data);
  const mac = await hmacSha1x10(authKey, cipher);
  return [salt, verifier, cipher, mac];
}
async function aesDecrypt(data, pw, strength) {
  const keyLen = AES_KEYLEN[strength];
  if (!keyLen) throw fail('Unknown AES key strength in archive.');
  const saltLen = keyLen / 2;
  if (data.length < saltLen + 12) throw fail('Encrypted data is truncated.');
  const salt = data.subarray(0, saltLen);
  const pv = data.subarray(saltLen, saltLen + 2);
  const cipher = data.subarray(saltLen + 2, data.length - 10);
  const mac = data.subarray(data.length - 10);
  const keys = await aesDeriveKeys(pw, salt, keyLen);
  if (keys.verifier[0] !== pv[0] || keys.verifier[1] !== pv[1]) throw fail('Wrong password.', 'WRONG_PASSWORD');
  const check = await hmacSha1x10(keys.authKey, cipher);
  for (let i = 0; i < 10; i++) if (check[i] !== mac[i]) throw fail('Wrong password or damaged data (authentication failed).', 'WRONG_PASSWORD');
  return aesCtr(keys.encKey, cipher);
}

// =====================================================================
// ZipCrypto (traditional PKWARE encryption) — weak, but opens everywhere
// =====================================================================
function zcInit(pw) {
  const k = new Uint32Array([0x12345678, 0x23456789, 0x34567890]);
  for (let i = 0; i < pw.length; i++) zcUpdate(k, pw[i]);
  return k;
}
function zcUpdate(k, b) {
  k[0] = CRC_TABLE[(k[0] ^ b) & 0xff] ^ (k[0] >>> 8);
  k[1] = (Math.imul(k[1] + (k[0] & 0xff), 134775813) + 1) >>> 0;
  k[2] = CRC_TABLE[(k[2] ^ (k[1] >>> 24)) & 0xff] ^ (k[2] >>> 8);
}
function zcByte(k) {
  const t = (k[2] | 2) & 0xffff;
  return ((t * (t ^ 1)) >>> 8) & 0xff;
}
function zipCryptoEncrypt(data, pw, crc) {
  const k = zcInit(pw);
  const out = new Uint8Array(12 + data.length);
  const header = crypto.getRandomValues(new Uint8Array(12));
  header[11] = crc >>> 24;
  for (let i = 0; i < 12; i++) { const p = header[i]; out[i] = p ^ zcByte(k); zcUpdate(k, p); }
  for (let i = 0; i < data.length; i++) { const p = data[i]; out[12 + i] = p ^ zcByte(k); zcUpdate(k, p); }
  return out;
}
function zipCryptoDecrypt(data, pw, checkByte) {
  if (data.length < 12) throw fail('Encrypted data is truncated.');
  const k = zcInit(pw);
  let last = 0;
  for (let i = 0; i < 12; i++) { const p = data[i] ^ zcByte(k); zcUpdate(k, p); last = p; }
  if (last !== checkByte) throw fail('Wrong password.', 'WRONG_PASSWORD');
  const out = new Uint8Array(data.length - 12);
  for (let i = 12; i < data.length; i++) { const p = data[i] ^ zcByte(k); zcUpdate(k, p); out[i - 12] = p; }
  return out;
}

// =====================================================================
// ZIP writer
// =====================================================================
function dosDateTime(ms) {
  const d = new Date(ms || Date.now());
  const y = d.getFullYear();
  if (y < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.min(y, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}
function utExtra(ms) { // 0x5455 extended timestamp: precise mtime
  const e = new Uint8Array(9);
  w16(e, 0, 0x5455); w16(e, 2, 5); e[4] = 1;
  w32(e, 5, Math.max(0, Math.floor((ms || Date.now()) / 1000)));
  return e;
}
function aesExtra(method) { // 0x9901 WinZip AES, AE-2, 256-bit
  const e = new Uint8Array(11);
  w16(e, 0, 0x9901); w16(e, 2, 7); w16(e, 4, 2); e[6] = 0x41; e[7] = 0x45; e[8] = 3; w16(e, 9, method);
  return e;
}

// Skip expensive compression for data that is already compressed (photos, videos, archives…).
function worthCompressing(data, level) {
  if (data.length < 262144) return true;
  const sample = data.subarray(0, 65536);
  const c = deflateRaw(sample, Math.min(level, 3));
  return c.length < sample.length * 0.97;
}

const MAX32 = 0xFFFFFFFF;

async function packZip(entries, opts, prog) {
  const pw = opts.password ? te.encode(opts.password) : null;
  const useAes = !!pw && opts.encryption !== 'zipcrypto';
  const level = opts.level;
  if (entries.length > 0xFFFF) throw fail('Too many entries for a ZIP file (max. 65,535 in this version).');
  const parts = [], central = [];
  let offset = 0;

  for (const e of entries) {
    const name = te.encode(e.path);
    const isDir = !e.file;
    let method = 0, crc = 0, usize = 0, csize = 0, flags = 0x0800, version = 20;
    let payload = [];
    const extras = [utExtra(e.mtime)];
    if (!isDir) {
      prog.label(e.path);
      const data = new Uint8Array(await e.file.arrayBuffer());
      usize = data.length;
      if (usize >= MAX32) throw fail(`"${e.path}" is larger than 4 GB — not supported yet.`);
      crc = crc32(data);
      let comp = data;
      if (level > 0 && usize > 0 && worthCompressing(data, level)) {
        const d = deflateRaw(data, level, (p) => prog.partial(p));
        if (d.length < usize) {
          comp = d; method = 8;
          if (level >= 8) flags |= 2; else if (level <= 2) flags |= 4;
        }
      }
      if (pw) {
        flags |= 1;
        if (useAes) {
          payload = await aesEncrypt(comp, pw);
          extras.push(aesExtra(method));
          method = 99; crc = 0; version = 51;
        } else {
          payload = [zipCryptoEncrypt(comp, pw, crc)];
        }
      } else {
        payload = [comp];
      }
      for (const p of payload) csize += p.length;
      prog.done(usize);
    }
    const extra = concatBytes(extras);
    const dt = dosDateTime(e.mtime);
    const lh = new Uint8Array(30 + name.length + extra.length);
    w32(lh, 0, 0x04034b50); w16(lh, 4, version); w16(lh, 6, flags); w16(lh, 8, method);
    w16(lh, 10, dt.time); w16(lh, 12, dt.date); w32(lh, 14, crc); w32(lh, 18, csize); w32(lh, 22, usize);
    w16(lh, 26, name.length); w16(lh, 28, extra.length);
    lh.set(name, 30); lh.set(extra, 30 + name.length);
    if (offset + lh.length + csize >= MAX32) throw fail('The archive would be larger than 4 GB — not supported yet.');
    central.push({ name, extra, version, flags, method, dt, crc, csize, usize, offset, isDir });
    parts.push(lh, ...payload);
    offset += lh.length + csize;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const ch = new Uint8Array(46 + c.name.length + c.extra.length);
    w32(ch, 0, 0x02014b50); w16(ch, 4, (3 << 8) | 63); w16(ch, 6, c.version); w16(ch, 8, c.flags);
    w16(ch, 10, c.method); w16(ch, 12, c.dt.time); w16(ch, 14, c.dt.date); w32(ch, 16, c.crc);
    w32(ch, 20, c.csize); w32(ch, 24, c.usize); w16(ch, 28, c.name.length); w16(ch, 30, c.extra.length);
    w32(ch, 38, c.isDir ? ((0o40755 << 16) | 0x10) : (0o100644 << 16));
    w32(ch, 42, c.offset);
    ch.set(c.name, 46); ch.set(c.extra, 46 + c.name.length);
    parts.push(ch);
    cdSize += ch.length;
  }
  const eocd = new Uint8Array(22);
  w32(eocd, 0, 0x06054b50); w16(eocd, 8, central.length); w16(eocd, 10, central.length);
  w32(eocd, 12, cdSize); w32(eocd, 16, cdStart);
  parts.push(eocd);
  return new Blob(parts, { type: 'application/zip' });
}

// =====================================================================
// TAR writer (POSIX ustar, PAX headers for long names)
// =====================================================================
function octal(a, off, len, value) {
  const s = Math.floor(value).toString(8).padStart(len - 1, '0');
  for (let i = 0; i < len - 1; i++) a[off + i] = s.charCodeAt(i);
  a[off + len - 1] = 0;
}
function tarHeaderBlock(nameBytes, prefixBytes, size, mtimeMs, type) {
  const h = new Uint8Array(512);
  h.set(nameBytes.subarray(0, 100), 0);
  octal(h, 100, 8, type === '5' ? 0o755 : 0o644);
  octal(h, 108, 8, 0); octal(h, 116, 8, 0);
  octal(h, 124, 12, size);
  octal(h, 136, 12, Math.max(0, (mtimeMs || Date.now()) / 1000));
  h.fill(32, 148, 156);
  h[156] = type.charCodeAt(0);
  h.set(te.encode('ustar\u000000'), 257);
  if (prefixBytes) h.set(prefixBytes.subarray(0, 155), 345);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  const cs = sum.toString(8).padStart(6, '0');
  for (let i = 0; i < 6; i++) h[148 + i] = cs.charCodeAt(i);
  h[154] = 0; h[155] = 32;
  return h;
}
function padTo512(len) { return (512 - (len % 512)) % 512; }

function tarHeaders(path, size, mtime, type) {
  const full = te.encode(path);
  if (full.length <= 100) return [tarHeaderBlock(full, null, size, mtime, type)];
  // Try the ustar prefix/name split at a "/".
  for (let i = full.length - 101; i < full.length; i++) {
    if (i > 0 && i <= 155 && full[i] === 0x2f && full.length - i - 1 <= 100 && full.length - i - 1 > 0) {
      return [tarHeaderBlock(full.subarray(i + 1), full.subarray(0, i), size, mtime, type)];
    }
  }
  // PAX extended header with the full path.
  const body = ' path=' + path + '\n';
  const bodyLen = te.encode(body).length;
  let len = bodyLen + 1;
  while (String(len).length + bodyLen !== len) len = String(len).length + bodyLen;
  const recBytes = te.encode(len + body);
  const paxName = te.encode('PaxHeader/' + path.split('/').filter(Boolean).pop()).subarray(0, 100);
  return [
    tarHeaderBlock(paxName, null, recBytes.length, mtime, 'x'),
    recBytes, new Uint8Array(padTo512(recBytes.length)),
    tarHeaderBlock(full.subarray(full.length - 100), null, size, mtime, type)
  ];
}

async function buildTar(entries, prog) {
  const parts = [];
  for (const e of entries) {
    if (!e.file) {
      parts.push(...tarHeaders(e.path.endsWith('/') ? e.path : e.path + '/', 0, e.mtime, '5'));
      continue;
    }
    prog.label(e.path);
    const data = new Uint8Array(await e.file.arrayBuffer());
    parts.push(...tarHeaders(e.path, data.length, e.mtime, '0'), data, new Uint8Array(padTo512(data.length)));
    prog.done(data.length);
  }
  parts.push(new Uint8Array(1024));
  return parts;
}

// =====================================================================
// GZIP writer
// =====================================================================
function gzip(data, level, name, mtimeMs, onProgress) {
  const nameBytes = name ? te.encode(name) : null;
  const h = new Uint8Array(10);
  h[0] = 0x1f; h[1] = 0x8b; h[2] = 8; h[3] = nameBytes ? 0x08 : 0;
  w32(h, 4, Math.max(0, Math.floor((mtimeMs || 0) / 1000)));
  h[8] = level >= 9 ? 2 : level <= 1 ? 4 : 0;
  h[9] = 255;
  const body = deflateRaw(data, level, onProgress);
  const t = new Uint8Array(8);
  w32(t, 0, crc32(data)); w32(t, 4, data.length >>> 0);
  const parts = [h];
  if (nameBytes) parts.push(nameBytes, new Uint8Array(1));
  parts.push(body, t);
  return parts;
}

// =====================================================================
// Packing entry point
// =====================================================================
function makeProgress(post, total) {
  let base = 0, last = 0, label = '';
  const send = (cur, force) => {
    const now = Date.now();
    if (!force && now - last < 80) return;
    last = now;
    post({ type: 'progress', done: Math.min(total, base + cur), total, label });
  };
  return {
    label(l) { label = l; send(0, true); },
    partial(n) { send(n, false); },
    done(n) { base += n; send(0, true); },
    reset(t, l) { total = t; base = 0; label = l; send(0, true); }
  };
}

async function pack(entries, opts, post) {
  const total = entries.reduce((s, e) => s + (e.file ? e.file.size : 0), 0) || 1;
  const prog = makeProgress(post, total);
  if (opts.format === 'zip') return packZip(entries, opts, prog);
  if (opts.format === 'tar') return new Blob(await buildTar(entries, prog), { type: 'application/x-tar' });
  if (opts.format === 'tar.gz') {
    const tar = concatBytes(await buildTar(entries, prog));
    prog.reset(tar.length, 'Compressing archive…');
    return new Blob(gzip(tar, opts.level, null, Date.now(), (p) => prog.partial(p)), { type: 'application/gzip' });
  }
  if (opts.format === 'gz') {
    const files = entries.filter((e) => e.file);
    if (files.length !== 1) throw fail('GZ can only hold exactly one file. Use TAR.GZ for several files.');
    const f = files[0];
    prog.label(f.path);
    const data = new Uint8Array(await f.file.arrayBuffer());
    return new Blob(gzip(data, opts.level, f.path.split('/').pop(), f.mtime, (p) => prog.partial(p)), { type: 'application/gzip' });
  }
  throw fail('Unknown format: ' + opts.format);
}

// =====================================================================
// Readers
// =====================================================================
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeName(bytes, utf8Flag) {
  if (utf8Flag) return td.decode(bytes);
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 127) { ascii = false; break; }
  if (ascii) return td.decode(bytes);
  try { return tdFatal.decode(bytes); } catch (e) { /* not UTF-8 — fall back to CP437 */ }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i] < 128 ? String.fromCharCode(bytes[i]) : CP437[bytes[i] - 128];
  return s;
}

function blobReader(blob) {
  return async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer());
}
function memReader(u8) {
  return async (o, l) => u8.subarray(o, o + l);
}

function dosToMs(date, time) {
  if (!date) return Date.now();
  const y = ((date >> 9) & 0x7f) + 1980, mo = ((date >> 5) & 0x0f) || 1, d = (date & 0x1f) || 1;
  const h = (time >> 11) & 0x1f, mi = (time >> 5) & 0x3f, s = (time & 0x1f) * 2;
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

async function openZip(read, total) {
  const tailLen = Math.min(total, 65557);
  const tailStart = total - tailLen;
  const tail = await read(tailStart, tailLen);
  let p = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { p = i; break; }
  }
  if (p < 0) throw fail('This is not a valid ZIP file (end of central directory not found).');
  let count = r16(tail, p + 10), cdSize = r32(tail, p + 12), cdOff = r32(tail, p + 16);
  if (count === 0xFFFF || cdSize === MAX32 || cdOff === MAX32) {
    if (p >= 20 && r32(tail, p - 20) === 0x07064b50) {
      const recOff = r64(tail, p - 20 + 8);
      const rec = await read(recOff, 56);
      if (r32(rec, 0) === 0x06064b50) { count = r64(rec, 32); cdSize = r64(rec, 40); cdOff = r64(rec, 48); }
    }
  }
  // Data prepended before the archive (e.g. self-extractors) shifts all offsets.
  const eocdPos = tailStart + p;
  let shift = 0;
  const probe = await read(cdOff, 4);
  if (probe.length < 4 || r32(probe, 0) !== 0x02014b50) shift = eocdPos - cdSize - cdOff;
  const cd = await read(cdOff + shift, cdSize);
  const entries = [];
  let q = 0;
  for (let n = 0; n < count && q + 46 <= cd.length; n++) {
    if (r32(cd, q) !== 0x02014b50) break;
    const flags = r16(cd, q + 8), method = r16(cd, q + 10), time = r16(cd, q + 12), date = r16(cd, q + 14);
    let crc = r32(cd, q + 16), csize = r32(cd, q + 20), usize = r32(cd, q + 24);
    const nameLen = r16(cd, q + 28), extraLen = r16(cd, q + 30), commentLen = r16(cd, q + 32);
    const extAttr = r32(cd, q + 38);
    let localOff = r32(cd, q + 42);
    const nameBytes = cd.subarray(q + 46, q + 46 + nameLen);
    let path = decodeName(nameBytes, flags & 0x800);
    const extra = cd.subarray(q + 46 + nameLen, q + 46 + nameLen + extraLen);
    let aes = null;
    for (let x = 0; x + 4 <= extra.length;) {
      const id = r16(extra, x), sz = r16(extra, x + 2), d = x + 4;
      if (id === 0x0001) {
        let z = d;
        if (usize === MAX32) { usize = r64(extra, z); z += 8; }
        if (csize === MAX32) { csize = r64(extra, z); z += 8; }
        if (localOff === MAX32) { localOff = r64(extra, z); z += 8; }
      } else if (id === 0x9901 && sz >= 7) {
        aes = { version: r16(extra, d), strength: extra[d + 4], method: r16(extra, d + 5) };
      } else if (id === 0x7075 && sz > 5 && extra[d] === 1 && r32(extra, d + 1) === crc32(nameBytes)) {
        path = td.decode(extra.subarray(d + 5, d + sz));
      }
      x = d + sz;
    }
    const dir = path.endsWith('/') || ((extAttr & 0x10) !== 0 && usize === 0);
    entries.push({
      path, dir, size: usize, csize, crc, method, flags, time, mtime: dosToMs(date, time),
      encrypted: (flags & 1) !== 0, aes, localOff: localOff + shift
    });
    q += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractZipEntry(arc, e, password) {
  const lh = await arc.read(e.localOff, 30);
  if (r32(lh, 0) !== 0x04034b50) throw fail('Damaged archive (local header not found).');
  const dataOff = e.localOff + 30 + r16(lh, 26) + r16(lh, 28);
  let data = await arc.read(dataOff, e.csize);
  let method = e.method;
  if (e.encrypted) {
    if (!password) throw fail('This file is password-protected. Please enter the password.', 'NEED_PASSWORD');
    const pw = te.encode(password);
    if (e.aes) {
      data = await aesDecrypt(data, pw, e.aes.strength);
      method = e.aes.method;
    } else {
      if (e.flags & 0x40) throw fail('Strong (PKWARE) encryption is not supported.');
      const check = (e.flags & 8) ? (e.time >>> 8) & 0xff : e.crc >>> 24;
      data = zipCryptoDecrypt(data, pw, check);
    }
  }
  if (method === 8) {
    try { data = await decompress(data, 'deflate-raw'); }
    catch (err) { throw e.encrypted ? fail('Wrong password or damaged data.', 'WRONG_PASSWORD') : fail('Damaged data — could not decompress.'); }
  } else if (method !== 0) {
    const names = { 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd' };
    throw fail(`Compression method ${names[method] || method} is not supported yet.`);
  }
  const checkCrc = !e.aes || e.aes.version === 1;
  if (checkCrc && crc32(data) !== e.crc) {
    throw e.encrypted ? fail('Wrong password or damaged data (checksum mismatch).', 'WRONG_PASSWORD') : fail('Checksum mismatch — the file is damaged.');
  }
  return data;
}

function cstr(a, off, len) {
  let end = off;
  while (end < off + len && a[end] !== 0) end++;
  return td.decode(a.subarray(off, end));
}
function parseTarNum(a, off, len) {
  if (a[off] & 0x80) { // base-256
    let v = a[off] & 0x7f;
    for (let i = 1; i < len; i++) v = v * 256 + a[off + i];
    return v;
  }
  const s = cstr(a, off, len).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}
async function openTar(read, total) {
  const entries = [];
  let off = 0, paxPath = null, longName = null;
  while (off + 512 <= total) {
    const h = await read(off, 512);
    let empty = true;
    for (let i = 0; i < 512; i++) if (h[i]) { empty = false; break; }
    if (empty) break;
    const size = parseTarNum(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const dataOff = off + 512;
    const next = dataOff + size + padTo512(size);
    if (type === 'x' || type === 'g' || type === 'L') {
      const body = await read(dataOff, size);
      if (type === 'L') longName = cstr(body, 0, body.length);
      if (type === 'x') {
        const txt = td.decode(body);
        const m = txt.match(/(?:^|\n)\d+ path=([^\n]*)\n/);
        if (m) paxPath = m[1];
      }
    } else {
      const ustar = cstr(h, 257, 6).startsWith('ustar');
      const name = cstr(h, 0, 100);
      const prefix = ustar ? cstr(h, 345, 155) : '';
      const path = paxPath || longName || (prefix ? prefix + '/' + name : name);
      paxPath = null; longName = null;
      const mtime = parseTarNum(h, 136, 12) * 1000;
      if (type === '5') entries.push({ path: path.endsWith('/') ? path : path + '/', dir: true, size: 0, mtime });
      else if (type === '0' || type === '7' || h[156] === 0) entries.push({ path, dir: path.endsWith('/'), size, offset: dataOff, mtime });
    }
    off = next;
  }
  return entries;
}

// =====================================================================
// XZ / LZMA2 / LZMA decoder (decompress only) — no third-party libraries
// =====================================================================
// Growable output buffer
class Out {
  constructor(){ this.buf=new Uint8Array(1<<16); this.len=0; }
  ensure(n){ if(this.len+n<=this.buf.length) return; let c=this.buf.length; while(c<this.len+n) c*=2; const b=new Uint8Array(c); b.set(this.buf.subarray(0,this.len)); this.buf=b; }
  push(b){ this.ensure(1); this.buf[this.len++]=b; }
  copyMatch(dist, length){
    this.ensure(length);
    let s=this.len-dist;
    if(s<0) throw fail('LZMA: bad match distance');
    for(let i=0;i<length;i++){ this.buf[this.len]=this.buf[s]; this.len++; s++; }
  }
  bytes(){ return this.buf.subarray(0,this.len); }
}

const kNumBitModelTotalBits=11, kBitModelTotal=1<<11, kNumMoveBits=5;
const kNumPosBitsMax=4;
const kNumStates=12;
const kNumLenToPosStates=4;
const kNumAlignBits=4;
const kEndPosModelIndex=14, kNumFullDistances=1<<(kEndPosModelIndex>>1);
const kMatchMinLen=2;

class Lzma {
  constructor(out){ this.o=out; }
  setLcLpPb(lc,lp,pb){ this.lc=lc; this.lp=lp; this.pb=pb; }
  create(){
    this.litProbs=new Uint16Array(0x300<<(this.lc+this.lp));
    this.posSlot=new Uint16Array(kNumLenToPosStates*64);
    this.spec=new Uint16Array(kNumFullDistances-kEndPosModelIndex);
    this.align=new Uint16Array(1<<kNumAlignBits);
    this.isMatch=new Uint16Array(kNumStates<<kNumPosBitsMax);
    this.isRep=new Uint16Array(kNumStates);
    this.isRepG0=new Uint16Array(kNumStates);
    this.isRepG1=new Uint16Array(kNumStates);
    this.isRepG2=new Uint16Array(kNumStates);
    this.isRep0Long=new Uint16Array(kNumStates<<kNumPosBitsMax);
    this.lenChoice=new Uint16Array(2); this.lenLow=new Uint16Array((1<<kNumPosBitsMax)*8); this.lenMid=new Uint16Array((1<<kNumPosBitsMax)*8); this.lenHigh=new Uint16Array(256);
    this.repChoice=new Uint16Array(2); this.repLow=new Uint16Array((1<<kNumPosBitsMax)*8); this.repMid=new Uint16Array((1<<kNumPosBitsMax)*8); this.repHigh=new Uint16Array(256);
  }
  resetProbs(){
    const fill=(a)=>a.fill(kBitModelTotal>>1);
    fill(this.litProbs);fill(this.posSlot);fill(this.spec);fill(this.align);
    fill(this.isMatch);fill(this.isRep);fill(this.isRepG0);fill(this.isRepG1);fill(this.isRepG2);fill(this.isRep0Long);
    fill(this.lenChoice);fill(this.lenLow);fill(this.lenMid);fill(this.lenHigh);
    fill(this.repChoice);fill(this.repLow);fill(this.repMid);fill(this.repHigh);
  }
  resetState(){ this.state=0; this.rep0=0;this.rep1=0;this.rep2=0;this.rep3=0; this.resetProbs(); }

  // Range decoder bound to input buffer
  rcInit(inBuf, inPos){
    this.in=inBuf; this.inPos=inPos;
    if(this.in[this.inPos]!==0) throw fail('LZMA: range coder init byte != 0');
    this.inPos++;
    this.code=0; this.range=0xFFFFFFFF>>>0;
    for(let i=0;i<4;i++) this.code=((this.code<<8)|this.in[this.inPos++])>>>0;
  }
  norm(){ if(this.range>>>0 < (1<<24)){ this.range=(this.range<<8)>>>0; this.code=((this.code<<8)|(this.in[this.inPos++]|0))>>>0; } }
  decodeBit(probs,i){
    const p=probs[i];
    const bound=((this.range>>>11)*p)>>>0;
    let sym;
    if((this.code>>>0) < (bound>>>0)){
      this.range=bound>>>0;
      probs[i]=p+((kBitModelTotal-p)>>>kNumMoveBits);
      sym=0;
    } else {
      this.range=(this.range-bound)>>>0;
      this.code=(this.code-bound)>>>0;
      probs[i]=p-(p>>>kNumMoveBits);
      sym=1;
    }
    this.norm();
    return sym;
  }
  decodeDirect(n){
    let res=0;
    do {
      this.range=this.range>>>1;
      this.code=(this.code-this.range)>>>0;
      const t=(0-(this.code>>>31))>>>0;
      this.code=(this.code+(this.range&t))>>>0;
      this.norm();
      res=((res<<1)+t+1)>>>0;
    } while(--n);
    return res>>>0;
  }
  bitTree(probs,off,numBits){ let m=1; for(let i=0;i<numBits;i++) m=(m<<1)+this.decodeBit(probs,off+m); return m-(1<<numBits); }
  bitTreeRev(probs,off,numBits){ let m=1,sym=0; for(let i=0;i<numBits;i++){ const b=this.decodeBit(probs,off+m); m=(m<<1)+b; sym|=b<<i; } return sym; }

  decodeLen(choice,low,mid,high,posState){
    if(this.decodeBit(choice,0)===0) return this.bitTree(low,posState<<3,3);
    if(this.decodeBit(choice,1)===0) return 8+this.bitTree(mid,posState<<3,3);
    return 16+this.bitTree(high,0,8);
  }

  // decode exactly `limit` output bytes (relative to current out length)
  decodeChunk(limit){
    const o=this.o;
    const pbMask=(1<<this.pb)-1, lpMask=(1<<this.lp)-1, lc=this.lc;
    const end=o.len+limit;
    while(o.len<end){
      const posState=o.len&pbMask;
      if(this.decodeBit(this.isMatch,(this.state<<kNumPosBitsMax)+posState)===0){
        // literal
        const prevByte= o.len>0 ? o.buf[o.len-1] : 0;
        const litState=((o.len&lpMask)<<lc)+(prevByte>>>(8-lc));
        const probs=this.litProbs; const base=0x300*litState;
        let symbol=1;
        if(this.state>=7){
          let matchByte=o.buf[o.len-this.rep0-1];
          do {
            const matchBit=(matchByte>>7)&1; matchByte=(matchByte<<1)&0xff;
            const bit=this.decodeBit(probs, base+((1+matchBit)<<8)+symbol);
            symbol=(symbol<<1)|bit;
            if(matchBit!==bit){
              while(symbol<0x100) symbol=(symbol<<1)|this.decodeBit(probs,base+symbol);
              break;
            }
          } while(symbol<0x100);
        } else {
          while(symbol<0x100) symbol=(symbol<<1)|this.decodeBit(probs,base+symbol);
        }
        o.push(symbol&0xff);
        this.state = this.state<4?0 : this.state<10? this.state-3 : this.state-6;
        continue;
      }
      // match
      let len;
      if(this.decodeBit(this.isRep,this.state)!==0){
        // rep match
        if(this.decodeBit(this.isRepG0,this.state)===0){
          if(this.decodeBit(this.isRep0Long,(this.state<<kNumPosBitsMax)+posState)===0){
            this.state=this.state<7?9:11;
            o.copyMatch(this.rep0+1,1);
            continue;
          }
        } else {
          let dist;
          if(this.decodeBit(this.isRepG1,this.state)===0){ dist=this.rep1; }
          else {
            if(this.decodeBit(this.isRepG2,this.state)===0){ dist=this.rep2; }
            else { dist=this.rep3; this.rep3=this.rep2; }
            this.rep2=this.rep1;
          }
          this.rep1=this.rep0; this.rep0=dist;
        }
        len=this.decodeLen(this.repChoice,this.repLow,this.repMid,this.repHigh,posState)+kMatchMinLen;
        this.state=this.state<7?8:11;
      } else {
        // new match
        this.rep3=this.rep2; this.rep2=this.rep1; this.rep1=this.rep0;
        len=this.decodeLen(this.lenChoice,this.lenLow,this.lenMid,this.lenHigh,posState);
        this.state=this.state<7?7:10;
        const lenState=len<kNumLenToPosStates?len:kNumLenToPosStates-1;
        const posSlot=this.bitTree(this.posSlot,lenState<<6,6);
        if(posSlot<4){ this.rep0=posSlot; }
        else {
          const numDirect=(posSlot>>1)-1;
          let dist=(2|(posSlot&1))<<numDirect;
          if(posSlot<kEndPosModelIndex){
            dist+=this.bitTreeRev(this.spec, dist-posSlot-1, numDirect);
          } else {
            dist=(dist + (this.decodeDirect(numDirect-kNumAlignBits)<<kNumAlignBits))>>>0;
            dist=(dist + this.bitTreeRev(this.align,0,kNumAlignBits))>>>0;
          }
          this.rep0=dist>>>0;
        }
        len+=kMatchMinLen;
        if(this.rep0===0xFFFFFFFF){ // end marker
          len-=kMatchMinLen; // undo
          break;
        }
      }
      o.copyMatch(this.rep0+1,len);
    }
  }
}

// varint (xz multibyte int)
function readVarint(buf,pos){ let v=0,i=0; for(;;){ const b=buf[pos.p++]; v+= (b&0x7f)*Math.pow(2,7*i); if(!(b&0x80)) break; i++; } return v; }


function xzDecompress(u8){
  if(!(u8[0]===0xFD&&u8[1]===0x37&&u8[2]===0x7A&&u8[3]===0x58&&u8[4]===0x5A&&u8[5]===0x00)) throw fail('Not an XZ file.');
  const checkType=u8[7]&0x0f;
  const checkSize=[0,4,4,4,8,8,8,16,16,16,32,32,32,64,64,64][checkType];
  const out=new Out();
  let pos=12; // after stream header
  while(pos<u8.length){
    const bhsByte=u8[pos];
    if(bhsByte===0) break; // index indicator
    const blockHeaderSize=(bhsByte+1)*4;
    const bhEnd=pos+blockHeaderSize;
    let p={p:pos+1};
    const flags=u8[p.p++];
    const numFilters=(flags&0x03)+1;
    if(flags&0x40) readVarint(u8,p); // compressed size present
    if(flags&0x80) readVarint(u8,p); // uncompressed size present
    let lzma2=false;
    for(let f=0;f<numFilters;f++){
      const id=readVarint(u8,p);
      const propSize=readVarint(u8,p);
      if(id===0x21){ lzma2=true; p.p+=propSize; }
      else if(id===0x03 || (id>=0x04&&id<=0x0b)){ throw fail('XZ uses a filter (BCJ/delta) that is not supported yet.'); }
      else { p.p+=propSize; throw fail('XZ filter 0x'+id.toString(16)+' not supported.'); }
    }
    if(!lzma2) throw fail('XZ block without LZMA2 is not supported.');
    // data starts at bhEnd (block header incl its CRC32 is blockHeaderSize)
    let dpos=bhEnd;
    const startLen=out.len;
    dpos=lzma2DecodeUntilEnd(u8,dpos,out);
    // align to 4
    while((dpos&3)!==0) dpos++;
    dpos+=checkSize; // skip check
    pos=dpos;
  }
  return out.bytes();
}
// LZMA2 variant that stops at its 0x00 terminator and returns new position
function lzma2DecodeUntilEnd(input, inPos, out){
  const lz=new Lzma(out); let propsSet=false;
  for(;;){
    const ctrl=input[inPos++];
    if(ctrl===0) break;
    if(ctrl<0x80){
      if(ctrl>2) throw fail('LZMA2: bad control '+ctrl);
      const size=((input[inPos]<<8)|input[inPos+1])+1; inPos+=2;
      out.ensure(size); out.buf.set(input.subarray(inPos,inPos+size),out.len); out.len+=size; inPos+=size;
    } else {
      const unpackSize=((ctrl&0x1f)<<16)+((input[inPos]<<8)|input[inPos+1])+1; inPos+=2;
      const packSize=((input[inPos]<<8)|input[inPos+1])+1; inPos+=2;
      const reset=(ctrl>>5)&3;
      if(reset>=2){ const d0=input[inPos++]; let d=d0; const lc=d%9; d=(d/9)|0; const lp=d%5; const pb=(d/5)|0; lz.setLcLpPb(lc,lp,pb); lz.create(); propsSet=true; }
      if(!propsSet) throw fail('LZMA2: props not set');
      if(reset>=1) lz.resetState();
      lz.rcInit(input,inPos);
      lz.decodeChunk(unpackSize);
      inPos+=packSize;
    }
  }
  return inPos;
}

// .lzma (alone) format
function lzmaAloneDecompress(u8){
  const d=u8[0]; let dd=d; const lc=dd%9; dd=(dd/9)|0; const lp=dd%5; const pb=(dd/5)|0;
  // bytes 1-4 dict size, 5-12 uncompressed size (LE, may be 0xFFFFFFFFFFFFFFFF = unknown)
  let size=0; for(let i=0;i<8;i++) size+=u8[5+i]*Math.pow(2,8*i);
  const unknown = (size>=0xFFFFFFFFFFFFFFFF) || u8.slice(5,13).every(b=>b===0xff);
  const out=new Out();
  const lz=new Lzma(out); lz.setLcLpPb(lc,lp,pb); lz.create(); lz.resetState();
  lz.rcInit(u8,13);
  if(unknown){
    // decode until end marker
    lz.decodeChunk(Infinity);
  } else {
    lz.decodeChunk(size);
  }
  return out.bytes();
}

function detectFormat(head, name) {
  const n = (name || '').toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  if (head.length >= 262 && cstr(head, 257, 5) === 'ustar') return 'tar';
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return '7z';
  if (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) return 'rar';
  if (head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68) return 'bzip2';
  if (head[0] === 0xfd && head[1] === 0x37 && head[2] === 0x7a && head[3] === 0x58) return 'xz';
  if (n.endsWith('.tar')) return 'tar';
  if (n.endsWith('.zip')) return 'zip';
  if (n.endsWith('.xz') || n.endsWith('.txz')) return 'xz';
  if (n.endsWith('.lzma') || n.endsWith('.tlz')) return 'lzma';
  return null;
}

function gzipOriginalName(head) {
  if (!(head[3] & 0x08)) return null;
  let p = 10;
  if (head[3] & 0x04) p += 2 + r16(head, 10);
  let end = p;
  while (end < head.length && head[end] !== 0) end++;
  return end > p ? decodeName(head.subarray(p, end), false) : null;
}

async function openArchive(file) {
  const read = blobReader(file);
  const head = await read(0, 1024);
  const fmt = detectFormat(head, file.name);
  if (!fmt) throw fail('Unknown archive format. Supported: ZIP, TAR, TAR.GZ / TGZ, GZ, XZ / TAR.XZ, LZMA.');
  if (['7z', 'rar', 'bzip2'].includes(fmt)) throw fail(`${fmt.toUpperCase()} archives are not supported yet. Supported: ZIP, TAR, TAR.GZ / TGZ, GZ, XZ / TAR.XZ, LZMA.`);
  if (fmt === 'zip') return { format: 'ZIP', kind: 'zip', read, entries: await openZip(read, file.size) };
  if (fmt === 'tar') return { format: 'TAR', kind: 'tar', read, entries: await openTar(read, file.size) };
  if (fmt === 'xz' || fmt === 'lzma') {
    const raw = new Uint8Array(await file.arrayBuffer());
    let data;
    try { data = fmt === 'xz' ? xzDecompress(raw) : lzmaAloneDecompress(raw); }
    catch (e) { throw fail(e.message || `Damaged ${fmt.toUpperCase()} file — could not decompress.`); }
    const memRead = memReader(data);
    const label = fmt === 'xz' ? 'XZ' : 'LZMA';
    if (data.length >= 512 && cstr(data, 257, 5) === 'ustar') {
      return { format: 'TAR.' + label, kind: 'tar', read: memRead, mem: true, entries: await openTar(memRead, data.length) };
    }
    let name = (file.name || 'file').replace(/\.(txz|xz|lzma|tlz)$/i, '') || 'file';
    if (/\.(txz|tlz)$/i.test(file.name || '') && !name.includes('.')) name += '.tar';
    return { format: label, kind: 'single', read: memRead, mem: true, entries: [{ path: name, dir: false, size: data.length, offset: 0 }] };
  }
  // gzip: decompress fully, then check whether it contains a TAR.
  const data = await decompress(new Uint8Array(await file.arrayBuffer()), 'gzip').catch(() => {
    throw fail('Damaged GZ file — could not decompress.');
  });
  const memRead = memReader(data);
  if (data.length >= 512 && cstr(data, 257, 5) === 'ustar') {
    return { format: 'TAR.GZ', kind: 'tar', read: memRead, mem: true, entries: await openTar(memRead, data.length) };
  }
  let name = gzipOriginalName(head);
  if (!name) name = (file.name || 'file').replace(/\.t?gz$/i, '') || 'file';
  if (/\.tgz$/i.test(file.name || '') && !name.includes('.')) name += '.tar';
  return { format: 'GZ', kind: 'single', read: memRead, mem: true, entries: [{ path: name, dir: false, size: data.length, offset: 0 }] };
}

async function extractEntry(arc, index, password) {
  if (!arc) throw fail('No archive is open.');
  const e = arc.entries[index];
  if (!e || e.dir) throw fail('Entry not found.');
  if (arc.kind === 'zip') return extractZipEntry(arc, e, password);
  const data = await arc.read(e.offset, e.size);
  return arc.mem ? data.slice() : data;
}

// =====================================================================
// Password recovery (dictionary + mask attack)
// =====================================================================
// A fast verifier bound to one small encrypted entry. Returns async (pwBytes) => boolean.
async function makeVerifier(arc, e) {
  const lh = await arc.read(e.localOff, 30);
  if (r32(lh, 0) !== 0x04034b50) throw fail('Damaged archive (local header not found).');
  const dataOff = e.localOff + 30 + r16(lh, 26) + r16(lh, 28);
  const data = await arc.read(dataOff, e.csize);
  if (e.aes) {
    const keyLen = AES_KEYLEN[e.aes.strength];
    if (!keyLen) throw fail('Unknown AES key strength in archive.');
    const saltLen = keyLen / 2;
    const salt = data.subarray(0, saltLen);
    const pv = data.subarray(saltLen, saltLen + 2);
    const cipher = data.subarray(saltLen + 2, data.length - 10);
    const mac = data.subarray(data.length - 10);
    return async (pw) => {
      const keys = await aesDeriveKeys(pw, salt, keyLen);       // 2-byte verifier prefilter
      if (keys.verifier[0] !== pv[0] || keys.verifier[1] !== pv[1]) return false;
      const check = await hmacSha1x10(keys.authKey, cipher);    // strong confirm
      for (let i = 0; i < 10; i++) if (check[i] !== mac[i]) return false;
      return true;
    };
  }
  // ZipCrypto: 1-byte header check, then full decrypt + decompress + CRC confirm.
  if (e.flags & 0x40) throw fail('Strong (PKWARE) encryption is not supported.');
  const check = (e.flags & 8) ? (e.time >>> 8) & 0xff : e.crc >>> 24;
  const header = data.subarray(0, 12);
  const body = data.subarray(12);
  const method = e.method;
  return async (pw) => {
    const k = zcInit(pw);
    let last = 0;
    for (let i = 0; i < 12; i++) { const p = header[i] ^ zcByte(k); zcUpdate(k, p); last = p; }
    if (last !== check) return false;
    const out = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) { const p = body[i] ^ zcByte(k); zcUpdate(k, p); out[i] = p; }
    let plain = out;
    if (method === 8) { try { plain = await decompress(out, 'deflate-raw'); } catch (err) { return false; } }
    else if (method !== 0) return false;
    return crc32(plain) === e.crc;
  };
}

const MUT_SUFFIX = ['', '1', '2', '3', '12', '123', '1234', '!', '?', '.', '01', '00', '007', '99', '69',
  '2020', '2021', '2022', '2023', '2024', '2025', '2026', '!!', '123!', '#1'];
function* mutate(word) {
  const seen = new Set();
  const caps = [word, word.charAt(0).toUpperCase() + word.slice(1), word.toUpperCase()];
  for (const base of caps) for (const suf of MUT_SUFFIX) { const f = base + suf; if (!seen.has(f)) { seen.add(f); yield f; } }
  const leet = word.replace(/a/g, '@').replace(/o/g, '0').replace(/i/g, '1').replace(/e/g, '3').replace(/s/g, '$');
  if (leet !== word && !seen.has(leet)) yield leet;
}
function countDict(words, variations) {
  if (!variations) return words.length;
  let n = 0;
  for (const w of words) for (const _ of mutate(w)) n++;
  return n;
}
function* dictCandidates(words, variations) {
  for (const w of words) {
    if (!w) continue;
    if (variations) { for (const f of mutate(w)) yield f; }
    else yield w;
  }
}

const MASK_SETS = {
  '#': '0123456789',
  '?': 'abcdefghijklmnopqrstuvwxyz',
  '^': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '@': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '*': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  '!': '!@#$%&*?-_.'
};
// "\" escapes the next character so a literal #, ?, etc. can appear in the known part.
function maskPlan(mask) {
  const tmpl = [];
  let total = 1;
  for (let i = 0; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === '\\' && i + 1 < mask.length) { tmpl.push({ lit: mask[++i] }); continue; }
    if (MASK_SETS[ch]) { tmpl.push({ set: MASK_SETS[ch] }); total *= MASK_SETS[ch].length; }
    else tmpl.push({ lit: ch });
  }
  return { tmpl, total };
}
function* maskCandidates(tmpl, startAt) {
  const dyn = [];
  for (let i = 0; i < tmpl.length; i++) if (tmpl[i].set) dyn.push(i);
  const counters = dyn.map(() => 0);
  if (startAt > 0) { // seek directly to the resume position (mixed-radix, last slot least significant)
    let rem = startAt;
    for (let k = dyn.length - 1; k >= 0; k--) {
      const base = tmpl[dyn[k]].set.length;
      counters[k] = rem % base; rem = Math.floor(rem / base);
    }
    if (rem > 0) return; // past the end
  }
  for (;;) {
    let s = '', d = 0;
    for (const t of tmpl) { if (t.set) { s += t.set[counters[d]]; d++; } else s += t.lit; }
    yield s;
    let k = counters.length - 1;
    while (k >= 0) { counters[k]++; if (counters[k] < tmpl[dyn[k]].set.length) break; counters[k] = 0; k--; }
    if (k < 0) break;
  }
}

let cancelRecover = false;
let pausedRecover = false;
let resumeWaiter = null;
function wakeRecover() { if (resumeWaiter) { const r = resumeWaiter; resumeWaiter = null; r(); } }

async function recover(file, spec, post) {
  cancelRecover = false; pausedRecover = false; resumeWaiter = null;
  const arc = await openArchive(file);
  if (arc.kind !== 'zip') throw fail('Password recovery works only for ZIP archives.');
  const enc = arc.entries.filter((e) => !e.dir && e.encrypted);
  if (!enc.length) throw fail('This archive is not password-protected.');
  if (enc.some((e) => e.flags & 0x40)) throw fail('Strong (PKWARE) encryption is not supported.');
  enc.sort((a, b) => (a.csize || 0) - (b.csize || 0));
  const verify = await makeVerifier(arc, enc[0]);

  const skip = Math.max(0, spec.skip || 0);
  let gen, total;
  if (spec.mode === 'mask') {
    const { tmpl, total: tot } = maskPlan(spec.mask);
    if (tot <= 1 && !tmpl.some((t) => t.set)) throw fail('The pattern has no unknown positions to try.');
    if (tot > spec.cap) throw fail(`That pattern means ${tot.toLocaleString()} combinations — too many. Narrow it down.`);
    gen = maskCandidates(tmpl, skip); total = tot; // mask seeks directly to the resume point
  } else {
    total = countDict(spec.words, spec.variations);
    gen = dictCandidates(spec.words, spec.variations);
  }

  let tried = skip;                                  // resume counter
  let skipRemaining = spec.mode === 'mask' ? 0 : skip; // dict fast-forwards by iterating
  let verified = 0;
  const start = Date.now();
  let lastPost = 0;
  for (const pw of gen) {
    if (skipRemaining > 0) { skipRemaining--; continue; }
    if (cancelRecover) { post({ type: 'recoverCancelled', tried }); return; }
    if (pausedRecover) {
      post({ type: 'recoverPaused', tried, total });
      await new Promise((r) => { resumeWaiter = r; });
      if (cancelRecover) { post({ type: 'recoverCancelled', tried }); return; }
      lastPost = 0;
    }
    tried++; verified++;
    if (await verify(te.encode(pw))) { post({ type: 'recoverHit', password: pw, tried, ms: Date.now() - start }); return; }
    if (verified % 128 === 0) {
      const now = Date.now();
      if (now - lastPost >= 100) {
        lastPost = now;
        post({ type: 'recoverProgress', tried, total, rate: Math.round(verified / ((now - start) / 1000 || 1)) });
      }
      await new Promise((r) => setTimeout(r)); // yield so pause/cancel messages can arrive
    }
  }
  post({ type: 'recoverDone', tried, ms: Date.now() - start });
}

// =====================================================================
// Convert / re-save: unpack everything in memory, then re-pack with new options
// =====================================================================
async function convert(file, opts, srcPassword, post) {
  const arc = await openArchive(file);
  const all = arc.entries.filter((e) => !e.path.startsWith('__MACOSX/'));
  const files = all.filter((e) => !e.dir);
  if (opts.format === 'gz' && files.length !== 1) {
    throw fail(`GZ holds exactly one file, but this archive has ${files.length}. Choose TAR.GZ or ZIP.`);
  }
  const total = files.reduce((s, e) => s + (e.size || 0), 0) || 1;
  let readDone = 0;
  const entries = [];
  for (let i = 0; i < arc.entries.length; i++) {
    const e = arc.entries[i];
    if (e.path.startsWith('__MACOSX/')) continue;
    if (e.dir) { entries.push({ path: e.path, file: null, mtime: e.mtime || Date.now() }); continue; }
    post({ type: 'progress', done: readDone, total, label: 'Reading ' + e.path });
    const data = await extractEntry(arc, i, srcPassword);
    entries.push({ path: e.path, file: new Blob([data]), mtime: e.mtime || Date.now() });
    readDone += e.size || data.length;
  }
  const blob = await pack(entries, opts, post);
  post({ type: 'done', blob });
}

// Verify a freshly made archive by extracting every entry (CRC/HMAC are checked inside).
async function verifyArchive(file, password, post) {
  const arc = await openArchive(file);
  const files = arc.entries.filter((e) => !e.dir && !e.path.startsWith('__MACOSX/'));
  const total = files.reduce((s, e) => s + (e.size || 0), 0) || 1;
  let done = 0, n = 0;
  for (let i = 0; i < arc.entries.length; i++) {
    const e = arc.entries[i];
    if (e.dir || e.path.startsWith('__MACOSX/')) continue;
    post({ type: 'progress', done, total, label: 'Verifying ' + e.path });
    await extractEntry(arc, i, password);
    done += e.size || 0; n++;
  }
  post({ type: 'done', verified: n });
}

// =====================================================================
// Message handling
// =====================================================================
let current = null;

if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.onmessage = async (ev) => {
    const m = ev.data;
    const post = (o, t) => self.postMessage(Object.assign({ id: m.id }, o), t || []);
    try {
      if (m.cmd === 'pack') {
        const blob = await pack(m.entries, m.opts, post);
        post({ type: 'done', blob });
      } else if (m.cmd === 'open') {
        current = null;
        current = await openArchive(m.file);
        post({
          type: 'done',
          info: {
            format: current.format,
            entries: current.entries.map((e, i) => ({ index: i, path: e.path, dir: e.dir, size: e.size, encrypted: !!e.encrypted, aes: !!e.aes }))
          }
        });
      } else if (m.cmd === 'extract') {
        const data = await extractEntry(current, m.index, m.password);
        const buf = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) ? data.buffer : data.slice().buffer;
        post({ type: 'done', data: buf }, [buf]);
      } else if (m.cmd === 'close') {
        current = null;
        post({ type: 'done' });
      } else if (m.cmd === 'convert') {
        await convert(m.file, m.opts, m.password, post);
      } else if (m.cmd === 'verify') {
        await verifyArchive(m.file, m.password, post);
      } else if (m.cmd === 'recover') {
        await recover(m.file, m.spec, post);
      } else if (m.cmd === 'cancelRecover') {
        cancelRecover = true; wakeRecover();
      } else if (m.cmd === 'pauseRecover') {
        pausedRecover = true;
      } else if (m.cmd === 'resumeRecover') {
        pausedRecover = false; wakeRecover();
      } else if (m.cmd === 'maskCount') {
        const { total } = maskPlan(m.mask || '');
        post({ type: 'maskCount', total });
      }
    } catch (err) {
      post({ type: 'error', message: (err && err.message) || String(err), code: err && err.code });
    }
  };
}
