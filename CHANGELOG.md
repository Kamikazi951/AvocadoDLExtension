# Changelog

## 1.3.1 — pending release

### Fixed
- Restore FDM handoff by issuing requests from the originating web page. Chrome hides requests from another extension's worker from the official FDM integration.
- Send normal download actions, including MP4 files, to FDM without waiting for a website response. Keep Chrome file saving available as an explicit fallback.
- Repair garbled floating-button text and report that FDM was requested without claiming a completed download.

### Added
- Select the highest-bitrate X/Twitter MP4 from media responses already loaded by the page, matching the video poster to avoid unrelated media.
- Regression checks for cross-extension request visibility, restrictive page CSP, Twitter fetch/XHR responses, and an optional native FDM handoff probe.

## 1.3.0 — included in 1.3.1

### Added
- Toolbar download controls and a list of detected files and HLS/DASH streams.
- Detection for dynamic video/audio players, open shadow roots, related blank frames and resource-timing media URLs.
- Per-tab media state that survives service-worker suspension and clears on navigation.

### Fixed
- Preserve signed URLs, place the FDM marker before fragments, and fall back from blob players to their original page.
- Restore dismissed controls when the player or page changes; keep the button inside the viewport and preserve zero-percent idle opacity.
- Remove dependence on remote fonts and script-tag injection.

### Verification
- Unit tests, isolated browser fixtures and distributable ZIP packaging are included in GitHub Actions.
- Google Chrome 154 and official FDM extension 3.3.1 were used for local handoff verification. Native download completion and live signed-in X playback were not automated.
