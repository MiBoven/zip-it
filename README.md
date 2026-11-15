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
- **Skip system files** (default on): `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX/`, AppleDouble `._*` files etc. are left out of the archive. The toggle appears only when such files are present and shows how many were found.
- **Password protection** (ZIP only):
  - **Secure — AES-256** (WinZip AE-2, default) — strong; opens with 7-Zip, WinRAR, WinZip, Keka, PeaZip, most Android file managers and Zip-It, but *not* with the built-in **Windows Explorer** or macOS Archive Utility
  - **Compatible — ZipCrypto** (legacy) — opens everywhere, including Windows Explorer, but is cryptographically weak
  - Live **password strength meter** (5 levels) with an entropy estimate, the estimated offline crack time (assuming one high-end graphics card), and tips. It checks the password against a list of the most common passwords (see [Password list](#password-list))
  - **Repeat-password field** shown while the password is hidden (the eye is off), so a typo can't silently lock you out; it disappears when you reveal the password
  - Optional **Have I Been Pwned** check: a button looks the password up in public breach data using k-anonymity — only the first 5 characters of the password's SHA-1 hash are sent, never the password itself. It's the one and only network request the app ever makes, and only on an explicit tap after a confirmation
  - Show / hide, **generate a strong 20-character password**, and copy to clipboard
  - A warning before zipping with a "Very weak" password
- **Verify after packing** (optional, off by default): re-opens the finished archive and reads every entry back to catch a bad write before you delete the originals
- Progress bar with the current file, and a **Cancel** button
- Result card with the final size, compression ratio, time and number of skipped system files — **Download**, plus **Share** on devices that support sharing files (e.g. Android)

### Unpack
- Open or drag & drop an archive: **ZIP** (stored / Deflate, AES-128/192/256, ZipCrypto, ZIP64, UTF-8 and legacy CP437 file names), **TAR**, **TAR.GZ / TGZ**, **GZ**, **XZ / TAR.XZ** and **LZMA** (`.lzma`). XZ/LZMA can be unpacked but not created (a good LZMA compressor is impractical in-browser)
- Lists all entries with size and encryption type (`__MACOSX/` metadata folders are hidden)
- **Encryption verdict**: a banner states whether the archive uses strong AES-256 or weak ZipCrypto — the "is it good enough?" check at a glance
- Password field for encrypted archives — wrong passwords are detected and reported
- **Password recovery** (ZIP, encrypted): if you've forgotten the password, Zip-It can try to find it on your device. Two modes:
  - **Common passwords** — runs through the common-password list, optionally with variations (capitalisation, appended digits/years, simple leet)
  - **I remember part of it** — a pattern where you type the parts you remember and mark the unknown ones: `#` a digit, `?` a lowercase letter, `^` uppercase, `@` any letter, `*` letter or digit, `!` a symbol (`\\#` for a literal `#`). Example: `Sommer####` tries Sommer0000 … Sommer9999. The number of combinations and a rough time estimate are shown before you start; overly large patterns are refused
  - Runs in its own worker with a progress bar, **Pause/Resume** and a **Cancel**. On success it shows the password and can fill it into the extract field. This only helps for weak or partly-remembered passwords — a strong unknown AES password is not realistically recoverable (roughly 1,000–2,000 guesses/second for AES on a typical device)
  - **Resume later**: progress is saved in the browser, keyed to the archive (name + size). Close the tab or the archive and, when you re-open the same archive, Zip-It offers to resume where it left off (the file itself can't be stored, so you re-select it). "Start over" discards the saved progress
  - The dictionary keeps each list entry's original casing, so an unusual-case common password (e.g. `LuckyLuke`) is tried verbatim, on top of the lower/Capitalised/UPPER variants the recovery generates itself
- **Checkbox per file** with a select-all control — **Extract selected** pulls out only the ticked files (all selected by default)
- **Convert / re-save**: re-pack an opened archive into another format (ZIP, TAR.GZ, TAR, GZ) and/or with a different password — add one, change it, or remove it. The original file is untouched; an encrypted source needs its password entered first
- **Save** single files, **Download all** (separate downloads), or **Extract to folder…** (keeps the folder structure; Chrome / Edge on desktop)
- **Into a subfolder** (default on, folder extraction only): the files land in a subfolder named after the archive — `MeineBilder.zip` → a `MeineBilder/` folder. If the archive already contains a single top-level folder, that one is used instead of nesting it again
- On desktop Chrome / Edge, the installed app can be set as handler for `.zip`, `.tar`, `.gz` and `.tgz` files

### General
- Installable as an app (PWA) on Android, iOS and desktop — **Install app** in the menu; works **offline** once loaded
- **Android share sheet**: once installed, Zip-It appears in the system "Share" menu. Share files to it to pack them (it opens in Pack with the files loaded); share a single archive to open it straight in Unpack
- On desktop Chrome / Edge, the installed app can also be opened by double-clicking `.zip`, `.tar`, `.gz` or `.tgz` files
- Password-visibility buttons stay highlighted while the password is shown and use a struck-through eye while it's hidden
- Password fields are masked plain-text inputs (via `-webkit-text-security`), not real `password` inputs — so the browser never offers to save them and never autofills them
- **Help & info** panel in the menu: a collapsible guide covering getting started, packing, unpacking/converting, passwords &amp; encryption, password recovery (incl. how progress is stored and cleared), compression &amp; formats, and privacy
- Each setting has a short explanation, and **Settings → Clear saved recovery progress** wipes any paused recovery data
- **Copy password** can auto-clear the clipboard after 45 s (Settings), but only if the clipboard still holds that password — so it never wipes something you copied since
- Dark mode by default, light mode via the menu
- Fullscreen toggle (where supported)
- Settings for the default format, compression level and encryption method (stored only in this browser)
- Mobile-first layout
- 100% client-side: no backend, no analytics, no cookies, **no third-party libraries**

## How it works

All archive work runs in a Web Worker (`worker.js`), so the page stays responsive while packing.

- **Deflate** is a self-written encoder (LZ77 with hash chains, greedy matching for levels 1–3 and lazy matching for 4–9, dynamic/fixed Huffman blocks with stored-block fallback). Its output is on par with zlib at the same level.
- **Decompression** uses the browser's built-in `DecompressionStream` (`deflate-raw` and `gzip`). **XZ/LZMA** decompression is a self-written LZMA/LZMA2/XZ decoder (range coder + the full LZMA model), validated byte-for-byte against the `xz` reference tool.
- **AES-256** follows the WinZip AE-2 specification: the key is derived with PBKDF2-HMAC-SHA1 (1,000 iterations, random 16-byte salt) via the Web Crypto API, data is encrypted with AES in CTR mode (self-written AES core, since WinZip uses a little-endian counter Web Crypto can't produce), and authenticated with HMAC-SHA1.
- **ZipCrypto** is the traditional PKWARE stream cipher.
- **Password recovery** reuses the same primitives: candidates are generated (dictionary mutations or a mask odometer) and checked against the smallest encrypted entry — the 2-byte verifier (AES) or 1-byte header check (ZipCrypto) as a fast prefilter, then a full HMAC (AES) or decompress-and-CRC (ZipCrypto) confirmation. It runs in a dedicated worker so Cancel can stop it instantly.
- ZIP files are written with UTF-8 file names and extended timestamps; TAR files use POSIX ustar with PAX headers for long paths.
- The finished archive is offered as a download via `URL.createObjectURL`.

## Files

- `index.html` — markup
- `style.css` — all styling
- `app.js` — UI logic
- `worker.js` — compression, encryption, archive writers and readers
- `data/common-passwords.txt` — list for the password-strength check (see below)
- `sw.js` — service worker (offline support, stale-while-revalidate)
- `manifest.json` — PWA manifest
- `netlify.toml` — headers
- `favicon.ico` — at the repo root for crawler compatibility
- `icons/` — `android-chrome-192x192.png`, `android-chrome-512x512.png`, `apple-touch-icon.png`, `favicon-16x16.png`, `favicon-32x32.png`

## Browser support

Works in current versions of Chrome, Edge, Firefox and Safari (16.4+ — `DecompressionStream` is needed for unpacking). "Extract to folder…" requires the File System Access API (desktop Chrome / Edge); other browsers use "Download all".

### Limits of this version
- Archives and single files up to 4 GB (everything is processed in memory, so the practical limit depends on the device)
- Not supported yet: 7z, RAR and BZIP2; creating XZ/LZMA; XZ files that use BCJ/delta filters; ZIP entries compressed with methods other than Store/Deflate

## Password list

The strength meter checks whether a password is a known common one, and password recovery uses the same list as its dictionary. The file `data/common-passwords.txt` holds it.

**Format** — plain text, one password per line. Lines starting with `#` are comments; a `# version:` line is shown in the About dialog. The order is kept as-is, so if the list is sorted by frequency (most common first), recovery tries the likeliest passwords first. The file is loaded **lazily** (only once you start entering a password), so it never slows the initial load.

Shipped is a **German top-100000 list (~89,900 entries after de-duplication)**, frequency-ordered. To replace or extend it, just overwrite `data/common-passwords.txt` with another list in the same one-per-line format and commit — no code change needed. (A JSON array like `["pw1","pw2",…]` first has to be converted to one-per-line.)

The list stays in the repo and is served locally; nothing about it is ever sent anywhere.

## Privacy

Zip-It makes **no third-party requests by itself**, sets no cookies and uploads nothing. The single exception is the optional "Have I Been Pwned" check, which runs only when you explicitly tap the button and confirm: it sends the first 5 characters of your password's SHA-1 hash (never the password) to `api.pwnedpasswords.com`. Only the theme and default settings are stored in `localStorage`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
