/* Zip-It — UI logic. All archive work happens in worker.js. */
'use strict';

const APP_VERSION = '0.2.0';
const $ = (id) => document.getElementById(id);

// ---------- Settings ----------
const DEFAULTS = { format: 'zip', level: 6, encryption: 'aes', junkSkip: true, subfolder: true };
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('zipit-settings') || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem('zipit-settings', JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
}
const settings = loadSettings();

// ---------- Helpers ----------
function formatSize(b) {
  if (b < 1024) return b + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < units.length - 1);
  return b.toFixed(b < 10 ? 2 : 1) + ' ' + units[i];
}
const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Clean up a relative path: forward slashes, no leading "/", no "." or ".." segments.
function normalizePath(p, isDir) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..');
  if (!parts.length) return '';
  return parts.join('/') + (isDir ? '/' : '');
}

// Files operating systems scatter into folders and that rarely belong in an archive.
const JUNK_RE = /(^|\/)(\.DS_Store|Thumbs\.db|ehthumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes|\._[^/]*)$/i;
const JUNK_DIR_RE = /(^|\/)(__MACOSX|\.Trash(es)?)\//i;
const isJunk = (p) => JUNK_RE.test(p) || JUNK_DIR_RE.test(p + '/');

const ICON_FILE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const ICON_DIR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// ---------- Theme ----------
const root = document.documentElement;
const themeItem = $('themeItem');
const themeMeta = document.querySelector('meta[name="theme-color"]');
function setTheme(t) {
  root.setAttribute('data-theme', t);
  try { localStorage.setItem('zipit-theme', t); } catch (e) { /* ignore */ }
  themeItem.setAttribute('aria-checked', String(t === 'dark'));
  themeMeta.setAttribute('content', t === 'dark' ? '#131313' : '#f4f4f2');
}
setTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
themeItem.addEventListener('click', () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

// ---------- Header: brand, menu, fullscreen ----------
const brand = $('brand');
brand.addEventListener('click', () => { window.location.href = '/'; });
brand.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/'; }
});

const menu = $('menu');
const menuBtn = $('menuBtn');
function setMenu(open) {
  menu.style.display = open ? 'block' : 'none';
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.style.display === 'none'); });
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) setMenu(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  setMenu(false);
  document.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open'));
});

const fullscreenBtn = $('fullscreenBtn');
if (!document.fullscreenEnabled) fullscreenBtn.hidden = true;
fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// ---------- Modals ----------
function openModal(id) { setMenu(false); $(id).classList.add('open'); }
document.querySelectorAll('.modal-bg').forEach((bg) => {
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.hasAttribute('data-close')) bg.classList.remove('open');
  });
});
$('aboutItem').addEventListener('click', () => openModal('aboutModal'));
$('settingsItem').addEventListener('click', () => {
  $('setFormat').value = settings.format;
  $('setLevel').value = settings.level;
  $('setLevelLabel').textContent = levelText(settings.level);
  $('setEnc').value = settings.encryption;
  $('setJunk').checked = settings.junkSkip;
  $('setSubfolder').checked = settings.subfolder;
  openModal('settingsModal');
});

// ---------- Install (PWA) ----------
let deferredInstall = null;
const installItem = $('installItem');
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
if (isStandalone()) installItem.hidden = true;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => { installItem.hidden = true; deferredInstall = null; toast('Zip-It installed'); });
installItem.addEventListener('click', async () => {
  setMenu(false);
  if (deferredInstall) {
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
    deferredInstall = null;
  } else {
    openModal('installModal');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// ---------- Worker bridge ----------
let worker = null;
let reqId = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker('worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { if (p.onProgress) p.onProgress(m); return; }
    pending.delete(m.id);
    if (m.type === 'done') p.resolve(m);
    else p.reject(Object.assign(new Error(m.message), { code: m.code }));
  };
  worker.onerror = (e) => {
    e.preventDefault();
    const msg = e.message || 'Unexpected error in the archive worker.';
    for (const p of pending.values()) p.reject(new Error(msg));
    pending.clear();
    worker = null;
    if (arc) arc.loaded = false;
  };
  return worker;
}
function callWorker(msg, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage(Object.assign({ id }, msg));
  });
}
function resetWorker() {
  if (worker) worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
  pending.clear();
  if (arc) arc.loaded = false;
}

// ---------- Mode switching ----------
const modeToggle = $('modeToggle');
let mode = 'pack';
function setMode(m) {
  mode = m;
  modeToggle.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  $('packView').hidden = m !== 'pack';
  $('unpackView').hidden = m !== 'unpack';
}
modeToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) setMode(b.dataset.mode);
});

// =====================================================================
// PACK
// =====================================================================
let packItems = []; // { id, path, file, dir, size, mtime }
let nextItemId = 1;
let packing = false;
let resultUrl = null;

const packInput = $('packInput');
const packDrop = $('packDrop');
const sourceToggle = $('sourceToggle');
const formatSelect = $('formatSelect');
const levelRange = $('levelRange');
const archiveName = $('archiveName');
const pwEnabled = $('pwEnabled');
const pwInput = $('pwInput');
const encSelect = $('encSelect');
const packBtn = $('packBtn');

// Source: single/multiple files vs. a whole folder
const sourceHints = {
  files: 'Pick one or more files. Folders can also be dragged and dropped.',
  folder: 'Pick a folder — its complete structure is kept inside the archive.'
};
const supportsFolderPick = 'webkitdirectory' in document.createElement('input');
if (!supportsFolderPick) sourceToggle.querySelector('[data-source="folder"]').hidden = true;
sourceToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  sourceToggle.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  const folder = b.dataset.source === 'folder';
  if (folder) packInput.setAttribute('webkitdirectory', ''); else packInput.removeAttribute('webkitdirectory');
  $('sourceHint').textContent = sourceHints[b.dataset.source];
  $('packDropTitle').textContent = folder ? 'Tap to choose a folder' : 'Tap to choose files';
});

packDrop.addEventListener('click', () => { if (!packing) packInput.click(); });
packDrop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); packInput.click(); }
});
packInput.addEventListener('change', () => {
  const list = Array.from(packInput.files).map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
  packInput.value = '';
  addPackEntries(list);
});

// Recursively read dropped folders (keeps empty folders, too).
function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(all);
      else { all.push(...batch); next(); }
    }, () => resolve(all));
    next();
  });
}
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res) => entry.file(res, () => res(null)));
    if (file) out.push({ path: prefix + file.name, file });
  } else if (entry.isDirectory) {
    const dirPath = prefix + entry.name + '/';
    out.push({ path: dirPath, file: null });
    for (const child of await readAllEntries(entry.createReader())) await walkEntry(child, dirPath, out);
  }
}
async function collectDropped(dt) {
  const items = dt.items ? Array.from(dt.items).filter((i) => i.kind === 'file') : [];
  // webkitGetAsEntry must be called synchronously inside the drop event.
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.length && entries.every(Boolean)) {
    const out = [];
    for (const en of entries) await walkEntry(en, '', out);
    return out;
  }
  return Array.from(dt.files).map((f) => ({ path: f.name, file: f }));
}

function uniquePath(path, isDir, taken) {
  if (!taken.has(path)) return path;
  if (isDir) return null; // merge identical folders
  const m = path.match(/^(.*?)(\.[^./]*)?$/);
  let i = 2;
  while (taken.has(`${m[1]} (${i})${m[2] || ''}`)) i++;
  return `${m[1]} (${i})${m[2] || ''}`;
}

function addPackEntries(list) {
  if (!list.length) return;
  const taken = new Set(packItems.map((i) => i.path));
  for (const it of list) {
    const isDir = !it.file;
    let path = normalizePath(it.path, isDir);
    if (!path) continue;
    path = uniquePath(path, isDir, taken);
    if (!path) continue;
    taken.add(path);
    packItems.push({
      id: nextItemId++, path, file: it.file, dir: isDir,
      size: isDir ? 0 : it.file.size,
      mtime: isDir ? Date.now() : (it.file.lastModified || Date.now())
    });
  }
  hideResult();
  renderPackList();
  updatePackUI();
}

const LIST_LIMIT = 300;
function renderPackList() {
  const wrap = $('packListWrap');
  const list = $('packList');
  list.innerHTML = '';
  wrap.hidden = packItems.length === 0;
  if (!packItems.length) return;
  const files = packItems.filter((i) => !i.dir);
  const dirs = packItems.length - files.length;
  const total = files.reduce((s, i) => s + i.size, 0);
  $('packSummary').textContent = [plural(files.length, 'file'), dirs ? plural(dirs, 'folder') : '', formatSize(total)].filter(Boolean).join(' · ');
  const frag = document.createDocumentFragment();
  packItems.slice(0, LIST_LIMIT).forEach((it) => {
    const row = document.createElement('div');
    row.className = 'item' + (it.dir ? ' dir' : '');
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = it.dir ? ICON_DIR : ICON_FILE;
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    const bdi = document.createElement('bdi');
    bdi.textContent = it.path;
    name.appendChild(bdi);
    name.title = it.path;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = it.dir ? 'Folder' : formatSize(it.size);
    info.append(name, meta);
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.type = 'button';
    rm.innerHTML = '&times;';
    rm.title = it.dir ? 'Remove folder and its contents' : 'Remove';
    rm.setAttribute('aria-label', rm.title);
    rm.addEventListener('click', () => removePackItem(it));
    row.append(ico, info, rm);
    frag.appendChild(row);
  });
  if (packItems.length > LIST_LIMIT) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `…and ${(packItems.length - LIST_LIMIT).toLocaleString()} more`;
    frag.appendChild(more);
  }
  list.appendChild(frag);
}

function removePackItem(it) {
  if (packing) return;
  packItems = packItems.filter((x) => x !== it && !(it.dir && x.path.startsWith(it.path)));
  hideResult();
  renderPackList();
  updatePackUI();
}
$('clearPackBtn').addEventListener('click', () => {
  if (packing || !packItems.length) return;
  if (packItems.length > 3 && !confirm(`Remove all ${packItems.length} items from the list?`)) return;
  packItems = [];
  hideResult();
  renderPackList();
  updatePackUI();
});

// ----- Archive name -----
const EXT = { zip: '.zip', tar: '.tar', 'tar.gz': '.tar.gz', gz: '.gz' };
function defaultBaseName(d = new Date()) {
  return `zipped-it_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function sanitizeBase(s) {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/\.(zip|tar\.gz|tgz|tar|gz)$/i, '').replace(/^\.+/, '').trim();
}
function currentBaseName() {
  const typed = sanitizeBase(archiveName.value);
  if (typed) return typed;
  if (formatSelect.value === 'gz') {
    const f = packItems.find((i) => !i.dir);
    if (f) return f.path.split('/').pop();
  }
  return defaultBaseName();
}
function updateNamePlaceholder() {
  archiveName.placeholder = (formatSelect.value === 'gz' && packItems.some((i) => !i.dir))
    ? packItems.find((i) => !i.dir).path.split('/').pop()
    : defaultBaseName();
}
setInterval(updateNamePlaceholder, 1000);
$('resetNameBtn').addEventListener('click', () => { archiveName.value = ''; updateNamePlaceholder(); archiveName.focus(); });

// ----- Compression level -----
function levelText(l) {
  l = Number(l);
  const word = l === 0 ? 'Store (no compression)' : l <= 3 ? 'Fast' : l <= 6 ? 'Normal' : 'Maximum';
  return `${l} · ${word}`;
}
levelRange.addEventListener('input', () => { $('levelLabel').textContent = levelText(levelRange.value); });

// ----- Password strength -----
// A short built-in fallback list; the full list is lazy-loaded from /data/common-passwords.txt.
const COMMON = ['password', 'passwort', 'qwerty', 'qwertz', 'azerty', 'letmein', 'welcome', 'willkommen', 'admin', 'iloveyou',
  'monkey', 'dragon', 'football', 'fussball', 'baseball', 'hallo', 'hello', 'schatz', 'sunshine', 'princess', 'master',
  'login', 'secret', 'geheim', 'test', 'zipit', 'abc123', 'starwars', 'shadow', 'superman', 'batman', 'trustno1', 'michael',
  'summer', 'sommer', 'winter', 'freedom', 'whatever', 'computer', 'internet', 'service', 'default', 'changeme'];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'yxcvbnm', 'zxcvbnm', 'qwertzuiop'];

// Lazy-loaded set of the most common passwords (membership check for the strength meter).
let commonSet = null;         // Set of lowercased passwords, or null until loaded
let commonListMeta = '';      // version/date string from the file header
let commonListPromise = null;
function loadCommonList() {
  if (commonListPromise) return commonListPromise;
  commonListPromise = fetch('data/common-passwords.txt')
    .then((r) => (r.ok ? r.text() : Promise.reject()))
    .then((txt) => {
      const set = new Set();
      for (const raw of txt.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line[0] === '#') { const m = line.match(/version:\s*(.+)/i); if (m) commonListMeta = m[1].trim(); continue; }
        set.add(line.toLowerCase());
      }
      commonSet = set;
      updateAboutPwList();
      if (pwInput.value) updateStrength();
      return set;
    })
    .catch(() => { commonListPromise = null; }); // allow a later retry
  return commonListPromise;
}
// Strip trailing digits/symbols so "password123!" still matches "password".
function commonHit(lower) {
  if (!commonSet) return false;
  if (commonSet.has(lower)) return true;
  const core = lower.replace(/[^a-z]+$/i, '').replace(/^[^a-z]+/i, '');
  return core.length >= 3 && commonSet.has(core);
}
function updateAboutPwList() {
  const el = $('aboutPwList');
  if (!el) return;
  const n = commonSet ? commonSet.size.toLocaleString() : '—';
  el.textContent = `Password-strength list: ${n} entries${commonListMeta ? ' (' + commonListMeta + ')' : ''}.`;
}

function rateCharClassPool(pw) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += /[^\x00-\x7f]/.test(pw) ? 60 : 33;
  return Math.max(pool, 2);
}

// Rough entropy estimate in bits, penalising repeats, sequences and common words.
function ratePassword(pw) {
  const chars = Array.from(pw);
  const pool = rateCharClassPool(pw);
  const perChar = Math.log2(pool);
  const tips = [];
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    if (i > 0 && chars[i] === chars[i - 1]) { effective += 0.2; continue; }
    const d = i > 0 ? chars[i].codePointAt(0) - chars[i - 1].codePointAt(0) : 0;
    if (i > 0 && Math.abs(d) === 1) { effective += 0.4; continue; }
    effective += 1;
  }
  let bits = effective * perChar;
  const lower = pw.toLowerCase();
  let hitWord = false;
  // Exact (or near-exact) match against the common-password list: treat as trivially guessable.
  let listed = commonHit(lower);
  for (const w of COMMON) {
    if (lower.includes(w)) { bits -= Math.max(0, w.length * perChar - 12); hitWord = true; }
  }
  let hitSeq = false;
  for (const s of SEQUENCES) {
    for (let len = Math.min(8, s.length); len >= 4; len--) {
      let found = false;
      for (let i = 0; i + len <= s.length; i++) {
        const piece = s.slice(i, i + len);
        if (lower.includes(piece) || lower.includes([...piece].reverse().join(''))) { found = true; break; }
      }
      if (found) { bits -= (len - 1) * perChar * 0.6; hitSeq = true; break; }
    }
  }
  if (/(19|20)\d\d/.test(pw)) bits -= 5;
  if (/^[0-9]+$/.test(pw)) bits = Math.min(bits, chars.length * 3.3);
  if (listed) bits = Math.min(bits, 10); // it's on a public list — effectively instant
  bits = Math.max(0, bits);
  if (listed) tips.push('This password is on public lists of common passwords — attackers try these first.');
  else if (hitWord) tips.push('Avoid common words like "password".');
  if (hitSeq) tips.push('Avoid keyboard rows and sequences like "1234" or "qwer".');
  if (chars.length < 12) tips.push('Use at least 12 characters.');
  if (pool < 62 && chars.length < 20) tips.push('Mix upper and lower case, digits and symbols.');
  const level = listed ? 0 : bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, level, tips, listed };
}

function formatDuration(sec) {
  if (sec < 1) return 'instantly';
  const units = [['year', 31557600], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  if (sec > 31557600 * 1e6) return 'millions of years+';
  if (sec > 31557600 * 1000) return 'centuries';
  for (const [name, s] of units) {
    if (sec >= s) { const v = Math.round(sec / s); return `~${v.toLocaleString()} ${name}${v === 1 ? '' : 's'}`; }
  }
  return 'instantly';
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
function updateStrength() {
  const box = $('strength');
  const pw = pwInput.value;
  if (!pw) {
    box.dataset.level = '-1';
    $('strengthLabel').textContent = 'Enter a password';
    $('strengthDetail').textContent = '';
    $('strengthTips').textContent = '';
    return;
  }
  const r = ratePassword(pw);
  box.dataset.level = String(r.level);
  $('strengthLabel').textContent = STRENGTH_LABELS[r.level];
  // Guesses per second a single high-end GPU (e.g. an RTX 4090) manages offline against
  // the archive. AES here means PBKDF2-HMAC-SHA1 (1000 iterations); ZipCrypto is far weaker.
  const zc = encSelect.value === 'zipcrypto';
  const rate = zc ? 2e10 : 2e6;
  const seconds = Math.pow(2, r.bits) / 2 / rate;
  $('strengthDetail').textContent = `≈ ${Math.round(r.bits)} bits · ${formatDuration(seconds)} to crack`;
  const note = $('crackNote');
  note.hidden = false;
  note.textContent = zc
    ? 'Estimate for one high-end graphics card. ZipCrypto is weak by design — a serious attacker is far faster, whatever the password.'
    : 'Estimate for one high-end graphics card (AES-256). A large operation with many cards would be proportionally faster.';
  $('strengthTips').textContent = r.level < 3 ? r.tips.join(' ') : '';
}
pwInput.addEventListener('input', () => { resetHibp(); updateStrength(); updatePackUI(); });
pwInput.addEventListener('focus', loadCommonList, { once: true });

const ENC_HINTS = {
  aes: 'Strong encryption. Opens with 7-Zip, WinRAR, WinZip, Keka, PeaZip, most Android file managers and Zip-It — but not with the built-in Windows Explorer or macOS Archive Utility.',
  zipcrypto: 'Opens everywhere, including Windows Explorer and macOS. Warning: ZipCrypto is weak and can be broken with known attacks regardless of the password — use it only for low-risk files.'
};
encSelect.addEventListener('change', () => { $('encHint').textContent = ENC_HINTS[encSelect.value]; updateStrength(); });

const pwConfirm = $('pwConfirm');
const pwConfirmRow = $('pwConfirmRow');

pwEnabled.addEventListener('change', () => {
  $('pwFields').hidden = !pwEnabled.checked;
  if (pwEnabled.checked) { loadCommonList(); pwInput.focus(); }
  updateConfirmVisibility();
  updatePackUI();
});

function pwHidden() { return pwInput.type === 'password'; }
function confirmNeeded() { return pwEnabled.checked && pwHidden(); }
// A re-typed password (while hidden) guards against a typo locking you out of your own files.
function updateConfirmVisibility() {
  const need = confirmNeeded();
  pwConfirmRow.hidden = !need;
  if (!need) { $('pwMismatch').hidden = true; }
  updateMismatch();
}
function updateMismatch() {
  const bad = confirmNeeded() && pwConfirm.value.length > 0 && pwConfirm.value !== pwInput.value;
  $('pwMismatch').hidden = !bad;
  pwConfirm.classList.toggle('error', bad);
}
function pwReady() {
  if (!pwEnabled.checked) return true;
  if (!pwInput.value) return false;
  if (confirmNeeded() && pwConfirm.value !== pwInput.value) return false;
  return true;
}
pwConfirm.addEventListener('input', () => { updateMismatch(); updatePackUI(); });

function togglePwVisibility(input, btn) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.title = show ? 'Hide password' : 'Show password';
  btn.setAttribute('aria-label', btn.title);
  btn.classList.toggle('active', show);
}
$('pwShowBtn').addEventListener('click', () => {
  togglePwVisibility(pwInput, $('pwShowBtn'));
  updateConfirmVisibility(); // visible password needs no confirmation field
  updatePackUI();
});

// ----- Have I Been Pwned (optional, k-anonymity) -----
async function sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function resetHibp() { const r = $('hibpResult'); if (r) { r.textContent = ''; r.className = 'hibp-result'; } }
async function runHibp() {
  const pw = pwInput.value;
  if (!pw) return;
  const r = $('hibpResult');
  r.className = 'hibp-result pending';
  r.textContent = 'Checking…';
  try {
    const hash = await sha1Hex(pw);
    const resp = await fetch('https://api.pwnedpasswords.com/range/' + hash.slice(0, 5), { headers: { 'Add-Padding': 'true' } });
    if (!resp.ok) throw new Error();
    const suffix = hash.slice(5);
    let count = 0;
    for (const line of (await resp.text()).split('\n')) {
      const [suf, c] = line.trim().split(':');
      if (suf === suffix) { count = parseInt(c, 10) || 0; break; }
    }
    if (count > 0) { r.className = 'hibp-result bad'; r.textContent = `⚠ Appears in ${count.toLocaleString()} known breaches — pick another one.`; }
    else { r.className = 'hibp-result ok'; r.textContent = '✓ Not found in any known breach.'; }
  } catch (e) {
    r.className = 'hibp-result';
    r.textContent = 'Check failed — no connection?';
  }
}
$('hibpBtn').addEventListener('click', () => { if (pwInput.value) openModal('hibpModal'); });
$('hibpConfirm').addEventListener('click', () => { $('hibpModal').classList.remove('open'); runHibp(); });

function generatePassword(len = 20) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%&*+-=?@_'];
  const all = sets.join('');
  const pick = (s) => {
    const max = 256 - (256 % s.length);
    const b = new Uint8Array(1);
    do { crypto.getRandomValues(b); } while (b[0] >= max);
    return s[b[0] % s.length];
  };
  for (;;) {
    let pw = '';
    for (let i = 0; i < len; i++) pw += pick(all);
    if (sets.every((s) => [...pw].some((c) => s.includes(c)))) return pw;
  }
}
$('pwGenBtn').addEventListener('click', () => {
  pwInput.value = generatePassword();
  pwConfirm.value = pwInput.value;
  if (pwInput.type === 'password') togglePwVisibility(pwInput, $('pwShowBtn'));
  updateConfirmVisibility();
  resetHibp();
  updateStrength();
  updatePackUI();
  toast('Strong password generated — copy it before you zip!');
});
$('pwCopyBtn').addEventListener('click', async () => {
  if (!pwInput.value) return;
  try { await navigator.clipboard.writeText(pwInput.value); toast('Password copied'); }
  catch (e) { pwInput.select(); toast('Copy failed — please copy manually'); }
});

// ----- Format -----
formatSelect.addEventListener('change', updatePackUI);

function updatePackUI() {
  const fmt = formatSelect.value;
  $('archiveExt').textContent = EXT[fmt];
  levelRange.disabled = fmt === 'tar' || packing;
  $('levelField').style.opacity = fmt === 'tar' ? '.5' : '';
  const zip = fmt === 'zip';
  pwEnabled.disabled = !zip || packing;
  $('pwUnavailable').hidden = zip;
  const pwOn = zip && pwEnabled.checked;
  $('pwFields').hidden = !pwOn;
  $('hibpBox').hidden = !pwOn;
  $('hibpBtn').disabled = !pwInput.value;
  // Count system files we'd skip, and show it next to the toggle.
  const junkCount = packItems.filter((i) => !i.dir && isJunk(i.path)).length;
  $('junkRow').hidden = junkCount === 0;
  $('junkHint').textContent = junkCount ? `(${junkCount} found: .DS_Store, Thumbs.db, …)` : '';
  const fileCount = packItems.filter((i) => !i.dir).length;
  let warn = '';
  if (fmt === 'gz' && packItems.length && (fileCount !== 1 || packItems.length > 1)) {
    warn = 'GZ can only hold exactly one file (no folders). Choose TAR.GZ or ZIP for several files.';
  }
  $('formatHint').textContent = warn;
  $('formatHint').hidden = !warn;
  const needPw = pwOn && !pwInput.value;
  const mismatch = pwOn && !pwReady();
  packBtn.disabled = packing || !packItems.length || !!warn || !pwReady() || (fmt === 'gz' && fileCount !== 1);
  packBtn.textContent = needPw ? 'Enter a password first' : (mismatch ? 'Passwords must match' : 'Zip it!');
  updateNamePlaceholder();
}

// ----- Packing -----
function hideResult() {
  $('packResult').hidden = true;
  if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
}

function setPacking(on) {
  packing = on;
  $('packProgress').hidden = !on;
  packDrop.classList.toggle('disabled', on);
  [formatSelect, archiveName, pwInput, pwConfirm, encSelect].forEach((el) => { el.disabled = on; });
  updatePackUI();
}

packBtn.addEventListener('click', doPack);
async function doPack() {
  if (packing || !packItems.length) return;
  const fmt = formatSelect.value;
  const usePw = fmt === 'zip' && pwEnabled.checked;
  if (usePw && !pwReady()) { (pwInput.value ? pwConfirm : pwInput).focus(); return; }
  if (usePw && ratePassword(pwInput.value).level === 0 && !confirm('This password is very weak and easy to crack. Zip anyway?')) return;
  const skipJunk = $('junkSkip').checked;
  let source = fmt === 'gz' ? packItems.filter((i) => !i.dir) : packItems.slice();
  const skipped = skipJunk ? source.filter((i) => !i.dir && isJunk(i.path)).length : 0;
  if (skipJunk) source = source.filter((i) => !(i.dir ? false : isJunk(i.path)));
  const entries = source.map((i) => ({ path: i.path, file: i.file, mtime: i.mtime }));
  const fileName = currentBaseName() + EXT[fmt];
  const inputSize = source.reduce((s, i) => s + i.size, 0);
  const fileCount = source.filter((i) => !i.dir).length;
  hideResult();
  setPacking(true);
  $('packProgressBar').style.width = '0%';
  $('packProgressText').textContent = 'Preparing…';
  const started = performance.now();
  try {
    const res = await callWorker({
      cmd: 'pack',
      entries,
      opts: {
        format: fmt,
        level: Number(levelRange.value),
        password: usePw ? pwInput.value : '',
        encryption: encSelect.value
      }
    }, (p) => {
      const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
      $('packProgressBar').style.width = pct.toFixed(1) + '%';
      $('packProgressText').textContent = `${Math.floor(pct)}% · ${p.label || ''}`;
    });
    showResult(res.blob, fileName, inputSize, fileCount, fmt, usePw, performance.now() - started, skipped);
  } catch (err) {
    if (err.code !== 'CANCELLED') alert('Packing failed: ' + err.message);
  } finally {
    setPacking(false);
  }
}
$('cancelPackBtn').addEventListener('click', () => { if (packing) { resetWorker(); toast('Cancelled'); } });

function showResult(blob, fileName, inputSize, fileCount, fmt, encrypted, ms, skipped) {
  hideResult();
  resultUrl = URL.createObjectURL(blob);
  const dl = $('resultDownload');
  dl.href = resultUrl;
  dl.download = fileName;
  $('resultName').textContent = fileName;
  const parts = [plural(fileCount, 'file'), `${formatSize(inputSize)} → ${formatSize(blob.size)}`];
  if (inputSize > 0 && fmt !== 'tar') {
    const saved = Math.round((1 - blob.size / inputSize) * 100);
    parts.push(saved > 0 ? `${saved}% smaller` : 'no size gain');
  }
  if (encrypted) parts.push(encSelect.value === 'aes' ? 'AES-256 🔒' : 'ZipCrypto 🔒');
  parts.push(`${(ms / 1000).toFixed(1)} s`);
  if (skipped) parts.push(`${skipped} system ${skipped === 1 ? 'file' : 'files'} skipped`);
  $('resultMeta').textContent = parts.join(' · ');
  const share = $('resultShare');
  let file = null;
  try { file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' }); } catch (e) { file = null; }
  share.hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
  share.onclick = () => navigator.share({ files: [file], title: fileName }).catch(() => {});
  $('packResult').hidden = false;
  $('packResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// =====================================================================
// UNPACK
// =====================================================================
let arc = null; // { file, info, loaded }
const unpackInput = $('unpackInput');
const unpackDrop = $('unpackDrop');
const unpackPw = $('unpackPw');
const unpackStatus = $('unpackStatus');
let unpackBusy = false;

unpackDrop.addEventListener('click', () => unpackInput.click());
unpackDrop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unpackInput.click(); }
});
unpackInput.addEventListener('change', () => {
  const f = unpackInput.files[0];
  unpackInput.value = '';
  if (f) openArchive(f);
});
$('unpackPwShowBtn').addEventListener('click', () => togglePwVisibility(unpackPw, $('unpackPwShowBtn')));
unpackPw.addEventListener('input', () => unpackPw.classList.remove('error'));
$('closeArchiveBtn').addEventListener('click', closeArchive);
if (window.showDirectoryPicker) $('extractFolderBtn').hidden = false;

function setStatus(msg, isError) {
  unpackStatus.textContent = msg || '';
  unpackStatus.hidden = !msg;
  unpackStatus.classList.toggle('error', !!isError);
}

function closeArchive() {
  arc = null;
  selected.clear();
  stopRecoverWorker();
  $('recoverModal').classList.remove('open');
  $('encVerdict').hidden = true;
  $('archiveCard').hidden = true;
  $('selectHead').hidden = true;
  $('unpackList').innerHTML = '';
  unpackPw.value = '';
  setStatus('');
  if (worker) callWorker({ cmd: 'close' }).catch(() => {});
}

async function openArchive(file) {
  if (unpackBusy) return;
  closeArchive();
  setMode('unpack');
  setStatus(`Reading ${file.name}…`);
  try {
    const res = await callWorker({ cmd: 'open', file });
    arc = { file, info: res.info, loaded: true };
    renderArchive();
    setStatus('');
  } catch (err) {
    setStatus(err.code === 'CANCELLED' ? '' : err.message, true);
  }
}

async function ensureOpen() {
  if (arc.loaded) return;
  await callWorker({ cmd: 'open', file: arc.file });
  arc.loaded = true;
}

const selected = new Set(); // e.index of checked files
const subfolderToggle = $('subfolderToggle');
const canFolder = !!window.showDirectoryPicker;

function visibleEntries() {
  return arc ? arc.info.entries.filter((e) => !e.path.startsWith('__MACOSX/')) : [];
}
function stripArchiveExt(name) { return name.replace(/\.(zip|tar\.gz|tgz|tar|gz)$/i, '') || name; }

// The single top-level folder shared by every entry, or null if files sit loose at the top.
function commonTopFolder(entries) {
  let top = null;
  for (const e of entries) {
    const parts = normalizePath(e.path, false).split('/').filter(Boolean);
    if (!parts.length) continue;
    if (!e.dir && parts.length === 1) return null;
    if (top === null) top = parts[0]; else if (top !== parts[0]) return null;
  }
  return top;
}
// Prefix prepended on folder extraction: a subfolder named after the archive, unless the
// archive already has a single top-level folder (then we'd just double-nest it).
function destPrefix() {
  if (!subfolderToggle.checked) return '';
  if (commonTopFolder(visibleEntries())) return '';
  return normalizePath(stripArchiveExt(arc.file.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_'), true);
}
function updateSubfolderName() {
  const top = commonTopFolder(visibleEntries());
  if (!subfolderToggle.checked) { $('subfolderName').textContent = ''; return; }
  $('subfolderName').textContent = top ? `→ ${top}/ (already in the archive)` : `→ ${destPrefix().replace(/\/$/, '')}/`;
}
subfolderToggle.addEventListener('change', updateSubfolderName);

function updateSelectionHead() {
  const files = visibleEntries().filter((e) => !e.dir);
  const n = selected.size;
  $('selectSummary').textContent = `${n} of ${files.length} selected`;
  const sa = $('selectAll');
  sa.checked = n === files.length && n > 0;
  sa.indeterminate = n > 0 && n < files.length;
  $('extractSelectedBtn').disabled = n === 0 || unpackBusy;
}

function renderArchive() {
  const entries = visibleEntries();
  const files = entries.filter((e) => !e.dir);
  const total = files.reduce((s, e) => s + e.size, 0);
  const encrypted = files.some((e) => e.encrypted);
  $('arcName').textContent = arc.file.name;
  $('arcMeta').textContent = [arc.info.format, plural(files.length, 'file'), formatSize(arc.file.size) + ' → ' + formatSize(total)].join(' · ');
  $('unpackPwWrap').hidden = !encrypted;
  showEncVerdict(files);
  $('recoverLink').hidden = !(encrypted && arc.info.format === 'ZIP');
  $('downloadAllBtn').disabled = files.length === 0;
  $('extractFolderBtn').hidden = !canFolder;
  $('extractFolderBtn').disabled = files.length === 0;
  $('subfolderRow').hidden = !canFolder;
  $('archiveCard').hidden = false;
  $('selectHead').hidden = files.length === 0;
  updateSubfolderName();

  selected.clear();
  files.forEach((e) => selected.add(e.index));

  const list = $('unpackList');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  entries.slice(0, LIST_LIMIT).forEach((e) => {
    const row = document.createElement('div');
    row.className = 'item' + (e.dir ? ' dir' : '');
    if (!e.dir) {
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'pick';
      pick.checked = true;
      pick.title = 'Select for extraction';
      pick.addEventListener('change', () => {
        if (pick.checked) selected.add(e.index); else selected.delete(e.index);
        updateSelectionHead();
      });
      row.appendChild(pick);
      e._pick = pick;
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'pick';
      spacer.style.visibility = 'hidden';
      row.appendChild(spacer);
    }
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = e.dir ? ICON_DIR : ICON_FILE;
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    const bdi = document.createElement('bdi');
    bdi.textContent = e.path;
    name.appendChild(bdi);
    name.title = e.path;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = e.dir ? 'Folder' : formatSize(e.size) + (e.encrypted ? ' · ' + ICON_LOCK + (e.aes ? ' AES' : ' ZipCrypto') : '');
    info.append(name, meta);
    row.append(ico, info);
    if (!e.dir) {
      const btn = document.createElement('button');
      btn.className = 'save';
      btn.type = 'button';
      btn.textContent = 'Save';
      btn.addEventListener('click', () => saveEntry(e, btn));
      row.appendChild(btn);
    }
    frag.appendChild(row);
  });
  if (entries.length > LIST_LIMIT) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `…showing ${LIST_LIMIT.toLocaleString()} of ${entries.length.toLocaleString()} — all are still selected; use "Download all" or "Extract to folder".`;
    frag.appendChild(more);
  }
  list.appendChild(frag);
  updateSelectionHead();
  if (encrypted) unpackPw.focus();
}

// Verdict on the archive's encryption strength (the "is it good enough?" check).
function showEncVerdict(files) {
  const v = $('encVerdict');
  const enc = files.filter((e) => e.encrypted);
  if (!enc.length) { v.hidden = true; return; }
  v.hidden = false;
  const anyZc = enc.some((e) => !e.aes);
  if (anyZc) {
    v.className = 'verdict warn';
    v.innerHTML = '<strong>Weak encryption (ZipCrypto).</strong> It can be broken with known attacks no matter how good the password is — fine for casual use, not for anything sensitive. Re-pack with AES-256 for real protection.';
  } else {
    v.className = 'verdict good';
    v.innerHTML = '<strong>Strong encryption (AES-256).</strong> Only the correct password opens it; its strength then depends on the password itself.';
  }
}

// ---------- Password recovery (its own worker, so Cancel can hard-stop it) ----------
const RECOVER_RATE = { aes: 1200, zipcrypto: 150000 }; // rough guesses/sec for time estimates
const RECOVER_CAP = { aes: 8e6, zipcrypto: 2e9 };
const MASK_LEN = { '#': 10, '?': 26, '^': 26, '@': 52, '*': 62, '!': 11 };
let recoverWorker = null;
let recovering = false;
let recoverMode = 'dict';
let foundPassword = null;

function archiveIsAes() {
  const enc = (arc ? arc.info.entries : []).filter((e) => e.encrypted);
  return enc.length > 0 && enc.every((e) => e.aes);
}
function recoverRate() { return archiveIsAes() ? RECOVER_RATE.aes : RECOVER_RATE.zipcrypto; }
function recoverCap() { return archiveIsAes() ? RECOVER_CAP.aes : RECOVER_CAP.zipcrypto; }

function estimateTime(count) {
  const sec = count / recoverRate();
  return formatDuration(sec * 2); // average case ≈ half the space; show worst-ish for honesty
}
function maskCount(mask) {
  let total = 1;
  for (let i = 0; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === '\\') { i++; continue; }
    if (MASK_LEN[ch]) total *= MASK_LEN[ch];
  }
  return total;
}

$('recoverMode').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  recoverMode = b.dataset.rmode;
  $('recoverMode').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('recoverDict').hidden = recoverMode !== 'dict';
  $('recoverMaskPanel').hidden = recoverMode !== 'mask';
  resetRecoverUI();
});

function recDictCount() {
  const n = commonSet ? commonSet.size : 0;
  return $('recVariations').checked ? n * 40 : n; // rough: ~40 mutations per word
}
function updateRecDictInfo() {
  loadCommonList();
  const n = commonSet ? commonSet.size.toLocaleString() : '…';
  const approx = recDictCount();
  $('recDictInfo').textContent = commonSet
    ? `Tries ${n} common passwords${$('recVariations').checked ? ' with variations (~' + approx.toLocaleString() + ' attempts, ≈ ' + estimateTime(approx) + ')' : ''}.`
    : 'Loading password list…';
}
$('recVariations').addEventListener('change', updateRecDictInfo);

function updateRecMaskInfo() {
  const mask = $('recoverMask').value;
  const dyn = /[#?^@*!]/.test(mask.replace(/\\./g, ''));
  if (!mask || !dyn) { $('recMaskInfo').textContent = mask ? 'Add at least one placeholder (#, ?, …) for the unknown part.' : ''; return; }
  const c = maskCount(mask);
  const over = c > recoverCap();
  $('recMaskInfo').innerHTML = `${c.toLocaleString()} combinations · ≈ ${estimateTime(c)}` + (over ? ' — <span style="color:var(--danger)">too many, narrow the pattern</span>' : '');
}
$('recoverMask').addEventListener('input', updateRecMaskInfo);

function resetRecoverUI() {
  $('recoverProgress').hidden = true;
  $('recoverResult').hidden = true;
  $('recoverCancelBtn').hidden = true;
  $('recoverUseBtn').hidden = true;
  $('recoverStartBtn').hidden = false;
  $('recoverStartBtn').disabled = false;
  foundPassword = null;
}

$('recoverLink').addEventListener('click', () => {
  resetRecoverUI();
  recoverMode = 'dict';
  $('recoverMode').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.rmode === 'dict'));
  $('recoverDict').hidden = false;
  $('recoverMaskPanel').hidden = true;
  updateRecDictInfo();
  updateRecMaskInfo();
  openModal('recoverModal');
});

function stopRecoverWorker() {
  if (recoverWorker) { recoverWorker.terminate(); recoverWorker = null; }
  recovering = false;
}

$('recoverStartBtn').addEventListener('click', async () => {
  if (!arc || recovering) return;
  let spec;
  if (recoverMode === 'mask') {
    const mask = $('recoverMask').value;
    if (!mask || !/[#?^@*!]/.test(mask.replace(/\\./g, ''))) { $('recoverMask').focus(); return; }
    if (maskCount(mask) > recoverCap()) { updateRecMaskInfo(); return; }
    spec = { mode: 'mask', mask, cap: recoverCap() };
  } else {
    await loadCommonList();
    const words = commonSet ? Array.from(commonSet) : COMMON.slice();
    spec = { mode: 'dict', words, variations: $('recVariations').checked };
  }
  startRecover(spec);
});

function startRecover(spec) {
  stopRecoverWorker();
  recovering = true;
  foundPassword = null;
  $('recoverStartBtn').hidden = true;
  $('recoverCancelBtn').hidden = false;
  $('recoverUseBtn').hidden = true;
  $('recoverResult').hidden = true;
  $('recoverProgress').hidden = false;
  $('recoverBar').style.width = '0%';
  $('recoverStatus').textContent = 'Starting…';
  recoverWorker = new Worker('worker.js');
  recoverWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'recoverProgress') {
      const pct = m.total ? Math.min(100, (m.tried / m.total) * 100) : 0;
      $('recoverBar').style.width = (m.total ? pct : 100) + '%';
      $('recoverBar').style.opacity = m.total ? 1 : 0.5;
      $('recoverStatus').textContent = `${m.tried.toLocaleString()}${m.total ? ' / ' + m.total.toLocaleString() : ''} tried · ${m.rate.toLocaleString()}/s`;
    } else if (m.type === 'recoverHit') {
      finishRecover(m.password, m);
    } else if (m.type === 'recoverDone') {
      recovering = false;
      stopRecoverWorker();
      $('recoverProgress').hidden = true;
      $('recoverStartBtn').hidden = false;
      $('recoverCancelBtn').hidden = true;
      const res = $('recoverResult');
      res.hidden = false;
      res.className = 'verdict warn';
      res.innerHTML = `<strong>Not found.</strong> Tried ${m.tried.toLocaleString()} passwords. ${recoverMode === 'mask' ? 'Try a different pattern' : 'Try the “I remember part of it” mode'} if you recall more.`;
    } else if (m.type === 'recoverCancelled') {
      recovering = false;
      stopRecoverWorker();
      resetRecoverUI();
    } else if (m.type === 'error') {
      recovering = false;
      stopRecoverWorker();
      $('recoverProgress').hidden = true;
      $('recoverStartBtn').hidden = false;
      $('recoverCancelBtn').hidden = true;
      const res = $('recoverResult');
      res.hidden = false;
      res.className = 'verdict warn';
      res.innerHTML = `<strong>Couldn't run.</strong> ${m.message}`;
    }
  };
  recoverWorker.onerror = (e) => { e.preventDefault(); recovering = false; stopRecoverWorker(); };
  recoverWorker.postMessage({ id: 1, cmd: 'recover', file: arc.file, spec });
}

function finishRecover(pw, m) {
  recovering = false;
  stopRecoverWorker();
  foundPassword = pw;
  $('recoverProgress').hidden = true;
  $('recoverCancelBtn').hidden = true;
  $('recoverStartBtn').hidden = false;
  $('recoverUseBtn').hidden = false;
  const res = $('recoverResult');
  res.hidden = false;
  res.className = 'verdict good';
  const rating = ratePassword(pw);
  res.innerHTML = `<strong>Found it!</strong> The password is <code>${pw.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code><br>` +
    `<span class="hint" style="margin-top:6px;display:block">Found after ${m.tried.toLocaleString()} tries. This password rates “${STRENGTH_LABELS[rating.level]}” — ${rating.level < 2 ? 'weak enough that recovery like this works; pick a stronger one next time.' : 'if you re-pack, it holds up reasonably well.'}</span>`;
}

$('recoverCancelBtn').addEventListener('click', () => {
  if (recoverWorker && recovering) { recoverWorker.postMessage({ id: 2, cmd: 'cancelRecover' }); recovering = false; stopRecoverWorker(); resetRecoverUI(); }
});
$('recoverUseBtn').addEventListener('click', () => {
  if (foundPassword != null) { unpackPw.value = foundPassword; unpackPw.classList.remove('error'); }
  $('recoverModal').classList.remove('open');
  toast('Password filled in — now extract your files');
});
$('recoverModal').addEventListener('click', (e) => {
  if ((e.target === $('recoverModal') || e.target.hasAttribute('data-close'))) stopRecoverWorker();
});

$('selectAll').addEventListener('change', () => {
  const on = $('selectAll').checked;
  selected.clear();
  visibleEntries().forEach((e) => { if (!e.dir) { if (on) selected.add(e.index); if (e._pick) e._pick.checked = on; } });
  updateSelectionHead();
});
$('extractSelectedBtn').addEventListener('click', () => {
  const picked = visibleEntries().filter((e) => !e.dir && selected.has(e.index));
  if (!picked.length) return;
  if (canFolder) extractToFolder(picked);
  else extractToDownloads(picked);
});

async function extractBlob(e) {
  await ensureOpen();
  const res = await callWorker({ cmd: 'extract', index: e.index, password: unpackPw.value });
  return new Blob([res.data]);
}

function handleExtractError(err) {
  if (err.code === 'NEED_PASSWORD' || err.code === 'WRONG_PASSWORD') {
    unpackPw.classList.add('error');
    unpackPw.focus();
  }
  setStatus(err.message, true);
}

async function saveEntry(e, btn) {
  if (unpackBusy) return;
  unpackBusy = true;
  btn.disabled = true;
  setStatus(`Extracting ${e.path}…`);
  try {
    const blob = await extractBlob(e);
    downloadBlob(blob, e.path.split('/').pop() || 'file');
    setStatus('');
  } catch (err) {
    handleExtractError(err);
  } finally {
    btn.disabled = false;
    unpackBusy = false;
  }
}

function archiveFiles() {
  return visibleEntries().filter((e) => !e.dir);
}

// Separate loose downloads (no folders possible via the browser).
async function extractToDownloads(files) {
  if (!arc || unpackBusy || !files.length) return;
  if (files.length > 10 && !confirm(`This starts ${files.length} separate downloads (folders are not kept). Your browser may ask for permission.${canFolder ? '\n\nTip: "Extract to folder…" keeps the folder structure.' : ''}\n\nContinue?`)) return;
  unpackBusy = true;
  updateSelectionHead();
  let done = 0;
  try {
    for (const e of files) {
      setStatus(`Extracting ${done + 1} of ${files.length} · ${e.path}`);
      const blob = await extractBlob(e);
      downloadBlob(blob, e.path.split('/').pop() || 'file');
      done++;
      await sleep(250);
    }
    setStatus(`Done — ${plural(done, 'file')} downloaded.`);
  } catch (err) {
    handleExtractError(err);
  } finally {
    unpackBusy = false;
    updateSelectionHead();
  }
}

// Folder extraction via the File System Access API — keeps the structure and
// drops everything into a subfolder (named after the archive) when enabled.
async function extractToFolder(files) {
  if (!arc || unpackBusy || !files.length) return;
  let dirHandle;
  try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (e) { return; } // user cancelled
  const prefix = destPrefix();
  unpackBusy = true;
  updateSelectionHead();
  let done = 0;
  const dirCache = new Map();
  async function getDir(parts) {
    let handle = dirHandle;
    let key = '';
    for (const p of parts) {
      key += p + '/';
      if (!dirCache.has(key)) dirCache.set(key, await handle.getDirectoryHandle(p, { create: true }));
      handle = dirCache.get(key);
    }
    return handle;
  }
  try {
    for (const e of files) {
      const parts = normalizePath(prefix + e.path, false).split('/').filter(Boolean);
      if (!parts.length) continue;
      setStatus(`Extracting ${done + 1} of ${files.length} · ${e.path}`);
      const blob = await extractBlob(e);
      const dir = await getDir(parts.slice(0, -1));
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      done++;
    }
    const where = prefix ? `${dirHandle.name}/${prefix.replace(/\/$/, '')}` : dirHandle.name;
    setStatus(`Done — ${plural(done, 'file')} extracted to "${where}".`);
  } catch (err) {
    handleExtractError(err);
  } finally {
    unpackBusy = false;
    updateSelectionHead();
  }
}

$('downloadAllBtn').addEventListener('click', () => extractToDownloads(archiveFiles()));
$('extractFolderBtn').addEventListener('click', () => extractToFolder(archiveFiles()));

// =====================================================================
// Global drag & drop (routes to the active mode)
// =====================================================================
let dragDepth = 0;
const activeDrop = () => (mode === 'pack' ? packDrop : unpackDrop);
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  dragDepth++;
  activeDrop().classList.add('drag');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) activeDrop().classList.remove('drag');
});
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  packDrop.classList.remove('drag');
  unpackDrop.classList.remove('drag');
  if (!e.dataTransfer) return;
  if (mode === 'unpack') {
    const f = e.dataTransfer.files[0];
    if (f) openArchive(f);
    return;
  }
  if (packing) return;
  const list = await collectDropped(e.dataTransfer);
  addPackEntries(list);
});

// Opened via the installed app's file handler (desktop Chrome / Edge).
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const f = await params.files[0].getFile();
    openArchive(f);
  });
}

// Warn before leaving with unsaved work.
window.addEventListener('beforeunload', (e) => {
  if (packing || packItems.length) { e.preventDefault(); e.returnValue = ''; }
});

// =====================================================================
// Settings modal
// =====================================================================
function applyDefaults() {
  formatSelect.value = settings.format;
  levelRange.value = settings.level;
  $('levelLabel').textContent = levelText(settings.level);
  encSelect.value = settings.encryption;
  $('encHint').textContent = ENC_HINTS[encSelect.value];
  $('junkSkip').checked = settings.junkSkip;
  subfolderToggle.checked = settings.subfolder;
  updatePackUI();
  updateStrength();
}
$('setFormat').addEventListener('change', (e) => { settings.format = e.target.value; saveSettings(); applyDefaults(); });
$('setLevel').addEventListener('input', (e) => {
  settings.level = Number(e.target.value);
  $('setLevelLabel').textContent = levelText(settings.level);
  saveSettings();
  applyDefaults();
});
$('setEnc').addEventListener('change', (e) => { settings.encryption = e.target.value; saveSettings(); applyDefaults(); });
$('setJunk').addEventListener('change', (e) => { settings.junkSkip = e.target.checked; saveSettings(); applyDefaults(); });
$('setSubfolder').addEventListener('change', (e) => { settings.subfolder = e.target.checked; saveSettings(); updateSubfolderName(); });
// Remember the pack-side toggles when the user flips them directly.
$('junkSkip').addEventListener('change', (e) => { settings.junkSkip = e.target.checked; saveSettings(); });
subfolderToggle.addEventListener('change', () => { settings.subfolder = subfolderToggle.checked; saveSettings(); });
encSelect.addEventListener('change', () => { settings.encryption = encSelect.value; saveSettings(); });

// ---------- Init ----------
applyDefaults();
updateAboutPwList();
renderPackList();
