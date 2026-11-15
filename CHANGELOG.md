# Changelog

### 0.7.1 — 2026-11-15 — Help panel, setting explanations & safer clipboard
- Added a **Help & info** panel to the menu (collapsible sections) covering getting started, packing, unpacking/converting, passwords &amp; encryption, password recovery, compression &amp; formats, and privacy — replaces the earlier “Formats &amp; compression” dialog and folds it in
- Every **Settings** item now has a short explanation (what system files are, what AES-256 vs ZipCrypto means, what verify does, …)
- **Settings → Clear saved recovery progress** removes any paused password-recovery data (it's stored in the browser, keyed to the archive, with no passwords or file contents)
- **Copy password** now clears the clipboard again after 45 s (toggle in Settings), but only if the clipboard still holds that password, so it never wipes something you copied in the meantime

### 0.7.0 — 2026-11-14 — Unpack XZ / LZMA & a formats guide
- **Unpack XZ, TAR.XZ and LZMA** (`.xz`, `.txz`, `.tar.xz`, `.lzma`). Zip-It now includes a self-written LZMA/LZMA2/XZ decoder (no third-party libraries), validated byte-for-byte against the `xz` reference tool. Creating XZ/LZMA is intentionally not offered — a good LZMA compressor is impractical to run in the browser
- GZ and TAR.GZ (gzip) were already supported for both packing and unpacking
- Added a **“Formats & compression” guide** to the menu: what Zip-It can pack/unpack, why already-compressed files (photos, videos, PDFs) barely shrink, lossless vs lossy, which format to pick, and what the compression slider does

### 0.6.0 — 2026-11-14 — Pause & resume password recovery
- Password recovery can now be **paused and resumed** mid-run
- Recovery progress is **saved in the browser**, keyed to the archive (name + size): close the archive or the tab, re-open the same archive, and Zip-It offers to **resume where it left off** — or "Start over" to discard it. Mask attacks seek directly to the saved position; dictionary attacks fast-forward to it
- Progress and resume are cleared automatically once the password is found or the search is exhausted

### 0.5.1 — 2026-11-14 — Repeat-password field polish
- The repeat-password field no longer appears and disappears (which made the page jump). It now stays in place and simply greys out when the password is revealed, and it's the same width as the password field above it

### 0.5.0 — 2026-11-14 — Convert, verify & masked password fields
- **Convert / re-save** an opened archive: change the format (ZIP, TAR.GZ, TAR, GZ) and/or the password — add, change or remove it. The original is left untouched; an encrypted source needs its current password entered first
- **Verify after packing** (optional, off by default): re-reads the finished archive to confirm every entry is intact before you delete the originals
- **Password fields no longer trigger the browser's save-password / autofill prompts**: they're masked plain-text inputs (`-webkit-text-security`) instead of real `password` inputs, so the browser doesn't treat them as login credentials. Masking and the show/hide toggle work exactly as before
- **Recovery dictionary keeps original casing**, so unusual-case common passwords (e.g. `LuckyLuke`) are tried verbatim in addition to the generated capitalisation variants
- ZIP entry timestamps are now read and preserved when converting

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
