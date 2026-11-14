# Changelog

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
