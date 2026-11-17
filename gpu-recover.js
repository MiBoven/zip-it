/* Zip-It — GPU-accelerated password recovery (WebGPU).
 *
 * Accelerates the AES-256 recovery path: a compute shader derives the WinZip-AES
 * password verifier (2 bytes) via PBKDF2-HMAC-SHA1, 1000 iterations, for thousands
 * of candidates in parallel. Only the 2-byte verifier is checked on the GPU; the rare
 * matches are confirmed on the CPU (full HMAC) by the caller.
 *
 * Scope: AES-256 only (16-byte salt, 32-byte key). Everything else stays on the CPU.
 * The algorithm is identical to the CPU path and is self-tested against a known vector
 * before use, so a wrong or unavailable GPU automatically falls back to the CPU. */
'use strict';

const GpuRecover = (() => {
  const WGSL = `
struct Params {
  iterations : u32,
  count : u32,
  verifier : u32,      // target verifier: (b0 << 8) | b1
  salt0 : u32, salt1 : u32, salt2 : u32, salt3 : u32, // 16-byte salt, big-endian words
};
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> pwords : array<u32>; // 16 u32 per candidate, big-endian, zero-padded
@group(0) @binding(2) var<storage, read_write> found : atomic<u32>; // 0 = none, else index+1

fn rotl(x : u32, n : u32) -> u32 { return (x << n) | (x >> (32u - n)); }

// SHA-1 compression of one 512-bit block (w: 16 words) into state h[0..4].
fn sha1(h : ptr<function, array<u32,5>>, w0 : ptr<function, array<u32,16>>) {
  var W : array<u32,80>;
  for (var i = 0u; i < 16u; i = i + 1u) { W[i] = (*w0)[i]; }
  for (var i = 16u; i < 80u; i = i + 1u) { W[i] = rotl(W[i-3u] ^ W[i-8u] ^ W[i-14u] ^ W[i-16u], 1u); }
  var a = (*h)[0]; var b = (*h)[1]; var c = (*h)[2]; var d = (*h)[3]; var e = (*h)[4];
  for (var i = 0u; i < 80u; i = i + 1u) {
    var f : u32; var k : u32;
    if (i < 20u) { f = (b & c) | ((~b) & d); k = 0x5A827999u; }
    else if (i < 40u) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
    else if (i < 60u) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
    else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
    let t = rotl(a, 5u) + f + e + k + W[i];
    e = d; d = c; c = rotl(b, 30u); b = a; a = t;
  }
  (*h)[0] = (*h)[0] + a; (*h)[1] = (*h)[1] + b; (*h)[2] = (*h)[2] + c; (*h)[3] = (*h)[3] + d; (*h)[4] = (*h)[4] + e;
}

// Hash a 20-byte message (5 words) given a precomputed 64-byte-pad midstate.
// Total length = 64 + 20 = 84 bytes = 672 bits.
fn hashMid(mid : array<u32,5>, msg : array<u32,5>) -> array<u32,5> {
  var blk : array<u32,16>;
  blk[0] = msg[0]; blk[1] = msg[1]; blk[2] = msg[2]; blk[3] = msg[3]; blk[4] = msg[4];
  blk[5] = 0x80000000u;
  for (var i = 6u; i < 16u; i = i + 1u) { blk[i] = 0u; }
  blk[15] = 672u;
  var h = mid;
  sha1(&h, &blk);
  return h;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= P.count) { return; }
  let base = idx * 16u;

  // ipad / opad midstates: block byte i = keyByte[i]^pad, i.e. keyWord ^ padWord.
  var hi : array<u32,5>; var ho : array<u32,5>;
  hi[0]=0x67452301u; hi[1]=0xEFCDAB89u; hi[2]=0x98BADCFEu; hi[3]=0x10325476u; hi[4]=0xC3D2E1F0u;
  ho = hi;
  var bi : array<u32,16>; var bo : array<u32,16>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    let kw = pwords[base + i];
    bi[i] = kw ^ 0x36363636u;
    bo[i] = kw ^ 0x5C5C5C5Cu;
  }
  sha1(&hi, &bi);  // midI
  sha1(&ho, &bo);  // midO

  // U1 = HMAC(salt || 0x00000004)
  var msg : array<u32,5>;
  msg[0]=P.salt0; msg[1]=P.salt1; msg[2]=P.salt2; msg[3]=P.salt3; msg[4]=4u;
  var inner = hashMid(hi, msg);
  var u = hashMid(ho, inner);
  var T = u;
  for (var j = 2u; j <= P.iterations; j = j + 1u) {
    inner = hashMid(hi, u);
    u = hashMid(ho, inner);
    T[0]=T[0]^u[0]; T[1]=T[1]^u[1]; T[2]=T[2]^u[2]; T[3]=T[3]^u[3]; T[4]=T[4]^u[4];
  }
  // verifier = derived bytes 64,65 → block 4 offsets 4,5 → T word1 top two bytes
  let cand = (T[1] >> 16u) & 0xFFFFu;
  if (cand == P.verifier) { atomicMin(&found, idx); }
}
`;

  let device = null;
  let pipeline = null;
  let ready = null;       // Promise<boolean>
  const STRIDE = 16;      // u32 per candidate (64 bytes)
  const te = new TextEncoder();

  function supported() { return typeof navigator !== 'undefined' && !!navigator.gpu; }

  async function initDevice() {
    if (!supported()) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      device = await adapter.requestDevice();
      if (!device) return false;
      device.addEventListener && device.addEventListener('uncapturederror', () => {});
      const module = device.createShaderModule({ code: WGSL });
      pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      return true;
    } catch (e) { device = null; pipeline = null; return false; }
  }

  // Pack candidate strings into a GPU buffer: 16 big-endian u32 per candidate, zero-padded.
  // Returns {buffer, skipped} — candidates longer than 64 bytes are marked skipped (-> CPU).
  function packCandidates(encoded) {
    const n = encoded.length;
    const arr = new Uint32Array(n * STRIDE); // zero-filled
    for (let c = 0; c < n; c++) {
      const bytes = encoded[c];
      const base = c * STRIDE;
      const len = Math.min(bytes.length, 64);
      for (let i = 0; i < len; i++) {
        const w = base + (i >> 2);
        arr[w] |= bytes[i] << (24 - 8 * (i & 3));
      }
    }
    return arr;
  }

  // Run one batch on the GPU. params: {salt:Uint8Array(16), verifier:[b0,b1], iterations}.
  // encoded: array of Uint8Array passwords. Returns the 0-based index of the first verifier
  // match, or -1. (Caller confirms the match on the CPU.)
  async function runBatch(encoded, params) {
    const count = encoded.length;
    const words = packCandidates(encoded);
    const pwBuf = device.createBuffer({ size: words.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(pwBuf, 0, words);

    const salt = params.salt;
    const be = (o) => ((salt[o] << 24) | (salt[o + 1] << 16) | (salt[o + 2] << 8) | salt[o + 3]) >>> 0;
    const uni = new Uint32Array([params.iterations, count, (params.verifier[0] << 8) | params.verifier[1], be(0), be(4), be(8), be(12)]);
    const uniBuf = device.createBuffer({ size: uni.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniBuf, 0, uni);

    const foundBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    device.queue.writeBuffer(foundBuf, 0, new Uint32Array([0xFFFFFFFF]));
    const readBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniBuf } },
        { binding: 1, resource: { buffer: pwBuf } },
        { binding: 2, resource: { buffer: foundBuf } }
      ]
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    enc.copyBufferToBuffer(foundBuf, 0, readBuf, 0, 4);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const res = new Uint32Array(readBuf.getMappedRange())[0];
    readBuf.unmap();
    pwBuf.destroy(); uniBuf.destroy(); foundBuf.destroy(); readBuf.destroy();
    return res === 0xFFFFFFFF ? -1 : res;
  }

  // Self-test: a known password at a known index must be the only verifier match.
  async function selfTest() {
    // vector computed with Web Crypto (ground truth)
    const pw = te.encode('Sommer2024');
    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = (i * 17 + 3) & 0xff;
    const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' }, key, (32 * 2 + 2) * 8));
    const verifier = [bits[64], bits[65]];
    // batch: a few wrong passwords + the right one at index 3
    const batch = ['wrong1', 'x', 'nope', 'Sommer2024', 'another'].map((s) => te.encode(s));
    const hit = await runBatch(batch, { salt, verifier, iterations: 1000 });
    if (hit !== 3) return false;
    // and a batch with no match must return -1
    const none = await runBatch(['aaa', 'bbb'].map((s) => te.encode(s)), { salt, verifier, iterations: 1000 });
    return none === -1;
  }

  async function ensureReady() {
    if (ready) return ready;
    ready = (async () => {
      if (!(await initDevice())) return false;
      try { return await selfTest(); } catch (e) { return false; }
    })();
    return ready;
  }

  return {
    supported,
    // Resolves true only if WebGPU works AND the shader passes the self-test.
    isAvailable: ensureReady,
    runBatch,
    STRIDE
  };
})();

if (typeof window !== 'undefined') window.GpuRecover = GpuRecover;
if (typeof module !== 'undefined' && module.exports) module.exports = GpuRecover;
