# Changelog

### 0.2.0 — 2026-11-14 — Extraction, selection & password tools
- **Encryption picker reworded** to "Secure — AES-256" / "Compatible — ZipCrypto (opens on Windows/Mac)"; the choice is remembered as the default. Clears up the Windows `0x80004005` error, which happens because Windows Explorer can't open AES-256 — use ZipCrypto for Explorer compatibility
- **Unpack: subfolder option** (default on) — files extract into a subfolder named after the archive; if the archive already has a single top-level folder, that one is used instead of double-nesting
- **Unpack: partial extraction** — a checkbox per file plus a select-all control; "Extract selected" pulls out only the ticked files (all selected by default)
- **Pack: skip system files** (default on) — `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX/`, `._*` etc. are left out; the toggle shows how many were found
- **Repeat-password field** shown while the password is hidden, to catch typos before they lock you out
- **Password-strength check against a common-password list** (lazy-loaded from `data/common-passwords.txt`; ships with a ~550-entry starter list, replaceable with a full top-10000 list)
- **Crack-time estimate now states its assumption** (one high-end graphics card) and notes larger attackers are faster
- **Optional Have I Been Pwned check** via k-anonymity (only a 5-char hash prefix is sent, after a confirmation) — the only network request the app can make
- Settings gained defaults for "skip system files" and "unpack into a subfolder"

### 0.1.0 — 2026-11-14 — Initial release
- Pack files and folders (picker or drag & drop, empty folders kept) into ZIP, TAR.GZ, TAR or GZ
- Compression level slider 0–9 (Store / Fast / Normal / Maximum, default 6) with a self-written Deflate encoder; already-compressed files are stored automatically
- Archive name field with default `zipped-it_[date]-[time]`
- ZIP password protection with AES-256 (WinZip AE-2, default) or ZipCrypto, live password strength meter with crack-time estimate, password generator, show/hide and copy
- Progress bar with cancel, result card with size, ratio, download and share
- Unpack ZIP (Store/Deflate, AES, ZipCrypto, ZIP64), TAR, TAR.GZ / TGZ and GZ; save single files, download all, or extract to a folder
- PWA: installable, offline support, file handler for archives on desktop
- Dark mode by default, dropdown menu with theme toggle, Install app, Settings and About; fullscreen toggle
- No third-party libraries
