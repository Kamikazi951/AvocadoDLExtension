# AvocadoDL for Chrome 1.3.1

Find video and audio on web pages, send files, video pages and HLS/DASH streams to Free Download Manager (FDM). Direct files also have an explicit Chrome fallback in the popup.

## Install or update

1. Extract `avocadodl-chrome-extension-v1.3.1.zip` to a permanent folder, or use this source folder.
2. Open `chrome://extensions`, enable Developer mode, then choose **Load unpacked** and select that folder.
3. If updating an extension already loaded from this folder, click its **Reload** button. Avoid loading duplicate copies.
4. Refresh existing website tabs after an update.
5. For page/stream downloads, install and enable the **official Free Download Manager Chrome extension**, start FDM, and install **AvocadoDL FDM Addon 1.1.0** inside FDM. AvocadoDL is a companion to the official integration.

Requires Chrome 119 or newer. Checked in Google Chrome 154.0.8037.98 on Windows.

## Download

- Hover a video or audio player and use the floating button. You can drag it, dismiss it, or change its size and position in settings.
- Open the toolbar popup to see detected files and streams. Play the video first if nothing appears.
- Use **Send this page to FDM** if a site exposes only a blob player or a direct file fails.
- Right-click a player, link or page and choose **Download with AvocadoDL**.
- Copy a supported social link to show the optional download prompt.

**Check FDM** means a marked request was issued from the web page. The repaired handoff has been verified through the official FDM 3.3.1 extension and its connected native host using an actual floating-button click. Native dialog acceptance is still up to you; this message does not claim the download has completed. If no dialog opens, check the official integration and FDM.

## Fixes in 1.3.1

- Fixes the 1.3.0 handoff regression: Chrome hides extension-worker requests from the other extension. Requests now originate in an isolated content-script world, which FDM can observe and which does not depend on the page's connect-src policy.
- All normal download buttons target FDM, including direct MP4s. **Save this file in Chrome instead** is an explicit fallback.
- FDM dispatch no longer waits up to five seconds for a website response.
- Repairs corrupt UTF-8 button text and the manifest title.
- On X/Twitter, observes the media JSON the page already fetches, selects the highest-bitrate MP4, and matches it to the player's poster. Cached selection avoids an extra tweet lookup. Fetch and XHR are supported; unmatched players retain the page-URL fallback.
- Does not copy API tokens, read browser cookies, hard-code X endpoint IDs, or send tweet URLs to a download service. X media observations stay in page memory. Reload X after upgrading so the observer sees its API responses.

## Earlier reliability improvements

- One download routing path for the floating button, popup, clipboard and context menu.
- Generic pages go to FDM rather than becoming saved HTML files. HLS/DASH manifests go to the parser; blob URLs fall back to the originating page.
- URL markers precede fragments, preserve signed query encoding and cannot accumulate duplicate markers. Social domain matching checks domain boundaries.
- Main-world clipboard observation uses Chrome's declarative injection. Page-specific script tag restrictions no longer prevent injection.
- Detects dynamic audio/video players, child `<source>` elements, open shadow roots, related blank frames and media URLs observed in resource timing.
- Per-tab detected-media state survives service-worker suspension and clears on navigation/closing the tab. It is bounded and stays in browser session storage.
- Dismissed players work again after their source or page changes. Pointer movement is processed once per animation frame without dropping the final event.
- Buttons stay inside the viewport; zero-percent idle opacity persists correctly. Popup/settings fonts work without a remote Google Fonts request.

## Limits

No downloader can support every website. DRM, private content, CAPTCHA, expiring URLs, geographic restrictions, hidden player internals, and sites unsupported by yt-dlp can still prevent downloads. Chrome blocks content scripts on internal pages and the Chrome Web Store. Resource timing cannot reveal every extensionless or protected stream. The page-to-FDM option remains available on ordinary HTTP(S) websites when automatic detection is incomplete.

Only download media you are entitled to save. Clipboard detection observes copy operations; it does not read clipboard history. Detected URLs can contain access tokens, so they are kept in session storage and are not logged by AvocadoDL.

## Verification

Build the distributable ZIP with `python build.py`.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run test:twitter
npm run test:request-context
```

Use Node.js 22 or newer and Python 3.10 or newer for development. GitHub Actions runs these checks and uploads the extension ZIP as a build artifact. Version notes are in [CHANGELOG.md](CHANGELOG.md).

The browser suite uses a disposable profile and local fixture server. It checks actual MV3 injection, strict CSP, direct media, navigation/dismissal, open shadow players, child sources, HLS detection, srcdoc frames, clipboard handling, a completed file download, and popup stream selection. It never uses a personal Chrome profile or browser cookies.

To test an installed Google Chrome build, set `AVOCADO_BROWSER` to its executable path before running the browser suite. The disposable profile uses the DevTools unpacked-extension loader. Native FDM dialog acceptance requires a separate manual check.

Sources: [Chrome content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts), and the locally installed official FDM integration 3.3.1 (`src/js/fdmscheme.js`).

Additional browser regressions:

```powershell
$env:AVOCADO_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:twitter
npm run test:request-context
```

`test:twitter` uses mocked X-shaped responses in an isolated browser; it does not access an account. The optional `test:fdm` test additionally needs `AVOCADO_FDM_EXTENSION` set to the installed official FDM extension directory. It copies the extension to temporary staging, instruments the native handoff boundary, and clicks the real AvocadoDL button. It can open a native FDM dialog for a tiny local test file. No installed extension files are changed.

The user-supplied [Twitter Click'n'Save](https://github.com/AlttiRi/twitter-click-and-save) script informed the direct-MP4 selection approach. AvocadoDL's observer and selector are independently implemented; that userscript is not bundled.
