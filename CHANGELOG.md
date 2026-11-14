# Changelog

### 0.4.0 — 2026-11-14 — Android share sheet & toggle polish
- **Web Share Target**: once installed, Zip-It shows up in Android's "Share" menu. Shared files open in Pack ready to zip; a single shared archive opens straight in Unpack. The service worker receives the files and hands them to the app
- **Password-visibility buttons now show their state**: highlighted (accent colour) while the password is revealed, and a struck-through "eye-off" icon while it's hidden — on both the pack and unpack password fields
- General rule for stateful icon buttons: an active toggle is now visibly highlighted

### 0.3.0 — 2026-11-14 — Password recovery & encryption check
- **Password recovery** for encrypted ZIPs — if you forgot the password, Zip-It tries to find it on your device:
  - "Common passwords" mode runs the common-password list, optionally with variations (capitalisation, digits, years, leet)
  - "I remember part of it" mode takes a pattern (`#` digit, `?` lowercase, `^` uppercase, `@` letter, `*` letter/digit, `!` symbol; `\#` for a literal `#`) and brute-forces only the unknown positions — e.g. `Sommer####`
  - Shows the combination count and a time estimate up front, refuses overly large patterns, runs in a dedicated worker with a progress bar and a working Cancel, and can fill a found password straight into the extract field
  - Works against AES-256 and ZipCrypto; only realistic for weak or partly-remembered passwords
- **Encryption verdict banner** when opening an archive — states plainly whether it's strong (AES-256) or weak (ZipCrypto), so you can judge whether the protection is good enough
- A recovered password is also rated for strength in the result

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
