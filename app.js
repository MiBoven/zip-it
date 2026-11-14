/* Zip-It — UI logic. All archive work happens in worker.js. */
'use strict';

const APP_VERSION = '0.1.0';
const $ = (id) => document.getElementById(id);

// ---------- Settings ----------
const DEFAULTS = { format: 'zip', level: 6, encryption: 'aes' };
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
const COMMON = ['password', 'passwort', 'qwerty', 'qwertz', 'azerty', 'letmein', 'welcome', 'willkommen', 'admin', 'iloveyou',
  'monkey', 'dragon', 'football', 'fussball', 'baseball', 'hallo', 'hello', 'schatz', 'sunshine', 'princess', 'master',
  'login', 'secret', 'geheim', 'test', 'zipit', 'abc123', 'starwars', 'shadow', 'superman', 'batman', 'trustno1', 'michael',
  'summer', 'sommer', 'winter', 'freedom', 'whatever', 'computer', 'internet', 'service', 'default', 'changeme'];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'yxcvbnm', 'zxcvbnm', 'qwertzuiop'];

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
  bits = Math.max(0, bits);
  if (hitWord) tips.push('Avoid common words like "password".');
  if (hitSeq) tips.push('Avoid keyboard rows and sequences like "1234" or "qwer".');
  if (chars.length < 12) tips.push('Use at least 12 characters.');
  if (pool < 62 && chars.length < 20) tips.push('Mix upper and lower case, digits and symbols.');
  const level = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, level, tips };
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
  // Guesses per second for a high-end GPU attacking the archive offline.
  const rate = encSelect.value === 'zipcrypto' ? 2e10 : 1e7;
  const seconds = Math.pow(2, r.bits) / 2 / rate;
  $('strengthDetail').textContent = `≈ ${Math.round(r.bits)} bits · crack time ${formatDuration(seconds)}`;
  $('strengthTips').textContent = r.level < 3 ? r.tips.join(' ') : '';
}
pwInput.addEventListener('input', () => { updateStrength(); updatePackUI(); });

const ENC_HINTS = {
  aes: 'Strong encryption. Opens with 7-Zip, WinRAR, WinZip, Keka, PeaZip, most Android file managers and Zip-It — but not with the built-in Windows Explorer or macOS Archive Utility.',
  zipcrypto: 'Opens everywhere, including Windows Explorer and macOS. Warning: ZipCrypto is weak and can be broken with known attacks regardless of the password — use it only for low-risk files.'
};
encSelect.addEventListener('change', () => { $('encHint').textContent = ENC_HINTS[encSelect.value]; updateStrength(); });

pwEnabled.addEventListener('change', () => {
  $('pwFields').hidden = !pwEnabled.checked;
  if (pwEnabled.checked) pwInput.focus();
  updatePackUI();
});

function togglePwVisibility(input, btn) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.title = show ? 'Hide password' : 'Show password';
  btn.setAttribute('aria-label', btn.title);
  btn.classList.toggle('active', show);
}
$('pwShowBtn').addEventListener('click', () => togglePwVisibility(pwInput, $('pwShowBtn')));

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
  if (pwInput.type === 'password') togglePwVisibility(pwInput, $('pwShowBtn'));
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
  $('pwFields').hidden = !(zip && pwEnabled.checked);
  const fileCount = packItems.filter((i) => !i.dir).length;
  let warn = '';
  if (fmt === 'gz' && packItems.length && (fileCount !== 1 || packItems.length > 1)) {
    warn = 'GZ can only hold exactly one file (no folders). Choose TAR.GZ or ZIP for several files.';
  }
  $('formatHint').textContent = warn;
  $('formatHint').hidden = !warn;
  const needPw = zip && pwEnabled.checked && !pwInput.value;
  packBtn.disabled = packing || !packItems.length || !!warn || needPw || (fmt === 'gz' && fileCount !== 1);
  packBtn.textContent = needPw ? 'Enter a password first' : 'Zip it!';
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
  [formatSelect, archiveName, pwInput, encSelect].forEach((el) => { el.disabled = on; });
  updatePackUI();
}

packBtn.addEventListener('click', doPack);
async function doPack() {
  if (packing || !packItems.length) return;
  const fmt = formatSelect.value;
  const usePw = fmt === 'zip' && pwEnabled.checked;
  if (usePw && !pwInput.value) { pwInput.focus(); return; }
  if (usePw && ratePassword(pwInput.value).level === 0 && !confirm('This password is very weak and easy to crack. Zip anyway?')) return;
  const entries = (fmt === 'gz' ? packItems.filter((i) => !i.dir) : packItems)
    .map((i) => ({ path: i.path, file: i.file, mtime: i.mtime }));
  const fileName = currentBaseName() + EXT[fmt];
  const inputSize = packItems.reduce((s, i) => s + i.size, 0);
  const fileCount = packItems.filter((i) => !i.dir).length;
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
    showResult(res.blob, fileName, inputSize, fileCount, fmt, usePw, performance.now() - started);
  } catch (err) {
    if (err.code !== 'CANCELLED') alert('Packing failed: ' + err.message);
  } finally {
    setPacking(false);
  }
}
$('cancelPackBtn').addEventListener('click', () => { if (packing) { resetWorker(); toast('Cancelled'); } });

function showResult(blob, fileName, inputSize, fileCount, fmt, encrypted, ms) {
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
  $('archiveCard').hidden = true;
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

function renderArchive() {
  const entries = arc.info.entries.filter((e) => !e.path.startsWith('__MACOSX/'));
  const files = entries.filter((e) => !e.dir);
  const total = files.reduce((s, e) => s + e.size, 0);
  const encrypted = files.some((e) => e.encrypted);
  $('arcName').textContent = arc.file.name;
  $('arcMeta').textContent = [arc.info.format, plural(files.length, 'file'), formatSize(arc.file.size) + ' → ' + formatSize(total)].join(' · ');
  $('unpackPwWrap').hidden = !encrypted;
  $('downloadAllBtn').disabled = files.length === 0;
  $('extractFolderBtn').disabled = files.length === 0;
  $('archiveCard').hidden = false;

  const list = $('unpackList');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  entries.slice(0, LIST_LIMIT).forEach((e) => {
    const row = document.createElement('div');
    row.className = 'item' + (e.dir ? ' dir' : '');
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
    more.textContent = `…and ${(entries.length - LIST_LIMIT).toLocaleString()} more (use "Download all" or "Extract to folder")`;
    frag.appendChild(more);
  }
  list.appendChild(frag);
  if (encrypted) unpackPw.focus();
}

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
  return arc ? arc.info.entries.filter((e) => !e.dir && !e.path.startsWith('__MACOSX/')) : [];
}

$('downloadAllBtn').addEventListener('click', async () => {
  if (!arc || unpackBusy) return;
  const files = archiveFiles();
  if (files.length > 10 && !confirm(`This starts ${files.length} separate downloads (folders are not kept). Your browser may ask for permission.${window.showDirectoryPicker ? '\n\nTip: "Extract to folder…" keeps the folder structure.' : ''}\n\nContinue?`)) return;
  unpackBusy = true;
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
  }
});

$('extractFolderBtn').addEventListener('click', async () => {
  if (!arc || unpackBusy) return;
  let dirHandle;
  try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (e) { return; } // user cancelled
  const entries = arc.info.entries.filter((e) => !e.path.startsWith('__MACOSX/'));
  const files = entries.filter((e) => !e.dir);
  unpackBusy = true;
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
    for (const e of entries) {
      const parts = normalizePath(e.path, false).split('/').filter(Boolean);
      if (!parts.length) continue;
      if (e.dir) { await getDir(parts); continue; }
      setStatus(`Extracting ${done + 1} of ${files.length} · ${e.path}`);
      const blob = await extractBlob(e);
      const dir = await getDir(parts.slice(0, -1));
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      done++;
    }
    setStatus(`Done — ${plural(done, 'file')} extracted to "${dirHandle.name}".`);
  } catch (err) {
    handleExtractError(err);
  } finally {
    unpackBusy = false;
  }
});

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

// ---------- Init ----------
applyDefaults();
renderPackList();
