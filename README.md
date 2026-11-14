# Zip-It

**The Zipper for your Files** — a privacy-friendly web app that packs and unpacks ZIP, TAR and GZ archives, with optional password protection — entirely in your browser. No file is ever uploaded to a server.

**Live at:** [zipit.michels.world](https://zipit.michels.world)

## Features

### Pack
- Select files or a whole folder, or drag & drop files **and folders** (folder structure — including empty folders — is kept)
- **Files / Folder** toggle above the picker (the folder picker is hidden in browsers that don't support it)
- Output formats:
  | Format | Notes |
  |---|---|
  | **ZIP** (default) | Deflate compression, optional password protection |
  | **TAR.GZ** | TAR archive compressed with GZIP |
  | **TAR** | Uncompressed TAR (POSIX ustar, PAX headers for long paths) |
  | **GZ** | A single compressed file |
- **Compression level** slider from 0 to 9: `0` = Store (no compression), `1–3` = Fast, `4–6` = Normal (default `6`), `7–9` = Maximum
- Already-compressed files (photos, videos, archives…) are detected via a quick sample test and stored without wasting time on recompression; any file that wouldn't get smaller is stored as-is
- **Archive name** field — default: `zipped-it_[date]-[time]`, e.g. `zipped-it_20261114-023505.zip` (taken at the moment you press "Zip it!"). For GZ, the default is the original file name (`notes.txt` → `notes.txt.gz`). The extension is added automatically; the reset button returns to the default name
- **Password protection** (ZIP only):
  - **AES-256** (WinZip AE-2, default) — strong; opens with 7-Zip, WinRAR, WinZip, Keka, PeaZip, most Android file managers and Zip-It, but *not* with the built-in Windows Explorer or macOS Archive Utility
  - **ZipCrypto** (legacy) — opens everywhere, but is cryptographically weak
  - Live **password strength meter** (5 levels from "Very weak" to "Very strong") with an entropy estimate, the estimated offline crack time for the chosen encryption, and tips for improvement
  - Show / hide, **generate a strong 20-character password**, and copy to clipboard
  - A warning before zipping with a "Very weak" password
- Progress bar with the current file, and a **Cancel** button
- Result card with the final size, compression ratio and time — **Download**, plus **Share** on devices that support sharing files (e.g. Android)

### Unpack
- Open or drag & drop an archive: **ZIP** (stored / Deflate, AES-128/192/256, ZipCrypto, ZIP64, UTF-8 and legacy CP437 file names), **TAR**, **TAR.GZ / TGZ**, **GZ**
- Lists all entries with size and encryption type (`__MACOSX/` metadata folders are hidden)
- Password field for encrypted archives — wrong passwords are detected and reported
- **Save** single files, **Download all** (separate downloads), or **Extract to folder…** (keeps the folder structure; Chrome / Edge on desktop)
- On desktop Chrome / Edge, the installed app can be set as handler for `.zip`, `.tar`, `.gz` and `.tgz` files

### General
- Installable as an app (PWA) on Android, iOS and desktop — **Install app** in the menu; works **offline** once loaded
- Dark mode by default, light mode via the menu
- Fullscreen toggle (where supported)
- Settings for the default format, compression level and encryption method (stored only in this browser)
- Mobile-first layout
- 100% client-side: no backend, no analytics, no cookies, **no third-party libraries**

## How it works

All archive work runs in a Web Worker (`worker.js`), so the page stays responsive while packing.

- **Deflate** is a self-written encoder (LZ77 with hash chains, greedy matching for levels 1–3 and lazy matching for 4–9, dynamic/fixed Huffman blocks with stored-block fallback). Its output is on par with zlib at the same level.
- **Decompression** uses the browser's built-in `DecompressionStream` (`deflate-raw` and `gzip`).
- **AES-256** follows the WinZip AE-2 specification: the key is derived with PBKDF2-HMAC-SHA1 (1,000 iterations, random 16-byte salt) via the Web Crypto API, data is encrypted with AES in CTR mode (self-written AES core, since WinZip uses a little-endian counter Web Crypto can't produce), and authenticated with HMAC-SHA1.
- **ZipCrypto** is the traditional PKWARE stream cipher.
- ZIP files are written with UTF-8 file names and extended timestamps; TAR files use POSIX ustar with PAX headers for long paths.
- The finished archive is offered as a download via `URL.createObjectURL`.

## Files

- `index.html` — markup
- `style.css` — all styling
- `app.js` — UI logic
- `worker.js` — compression, encryption, archive writers and readers
- `sw.js` — service worker (offline support, stale-while-revalidate)
- `manifest.json` — PWA manifest
- `netlify.toml` — headers
- `favicon.ico` — at the repo root for crawler compatibility
- `icons/` — `android-chrome-192x192.png`, `android-chrome-512x512.png`, `apple-touch-icon.png`, `favicon-16x16.png`, `favicon-32x32.png`

## Browser support

Works in current versions of Chrome, Edge, Firefox and Safari (16.4+ — `DecompressionStream` is needed for unpacking). "Extract to folder…" requires the File System Access API (desktop Chrome / Edge); other browsers use "Download all".

### Limits of this version
- Archives and single files up to 4 GB (everything is processed in memory, so the practical limit depends on the device)
- Not supported yet: packing/unpacking 7z, RAR, BZIP2 and XZ; ZIP entries compressed with methods other than Store/Deflate

## Privacy

Zip-It makes no third-party requests, sets no cookies and uploads nothing. Only the theme and default settings are stored in `localStorage`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
