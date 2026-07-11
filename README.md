# AvocadoDL Chrome Extension 🥑

A premium, smart video download helper for Google Chrome (Manifest V3). AvocadoDL detects video elements on any webpage and intercepts social media links (TikTok, Twitter/X, Instagram, Reddit, Facebook, YouTube) to route them instantly to **Free Download Manager (FDM)**.

> [!IMPORTANT]
> This extension works with the [AvocadoDL FDM Addon](https://github.com/Kamikazi951/avocadodl) which runs inside Free Download Manager to parse and download video streams at maximum speed.

---

## ✨ What's New in v1.1

*   **Redesigned download banner** — Glass-morphism design with #7cb342 gradient, 16px backdrop blur, and smooth animations.
*   **Draggable anywhere** — Press and hold anywhere on the banner to drag; no separate handle needed. 4px threshold prevents accidental drags.
*   **"Attached" corner design** — Sits flush outside the top-right of the video with square bottom corners (8px 8px 0 0). When dragged, all corners become rounded.
*   **Smart dismissal** — Clicking close hides the banner for that specific video; it reappears on the next video or page.
*   **Per-video position** — Drag position is in-memory only and resets on each new page/video.
*   **Popup settings panel** — Clicking the extension icon now shows quick settings toggles (mode, size, position) instead of the hero screen.
*   **Size-preset positioning** — Small, Medium, and Large each have precise top-offsets to stay flush with the video edge (both full and mini modes).

---

## 🚀 Key Features

*   🥑 **Smart Social Media Crawler**: Bypasses transparent overlay grids on Instagram, Twitter/X, TikTok, and Facebook to extract the exact post/reel link.
*   🖱️ **Draggable Floating Button**: Press-and-hold anywhere on the banner to reposition. Per-video offset — resets on navigation.
*   🎨 **Attached Corner Design**: Sits flush outside the top-right of any video. Square bottom corners when docked; fully rounded when dragged.
*   📋 **Clipboard Interceptor Pill**: Shows a glassmorphic bottom-center download prompt when you copy a supported social media link.
*   🧹 **Smart Dismissal**: Close a banner once — it stays hidden for that video until you navigate to a different page.
*   ⚙️ **Popup Quick Settings**: Click the extension icon for instant access to mode (Full/Mini), size (S/M/L), position, and clipboard toggles.
*   🎛️ **Full Settings Dashboard**: Configure everything in detail via the dedicated settings page.

---

## 📥 How to Download & Install

1.  **Download or clone** this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** (top-right).
4.  Click **Load unpacked** and select the `AvocadoDL Chrome Extension` folder.
5.  Pin the 🥑 icon for quick access.

---

## 🖱️ How to Use

### 1. Floating Download Button
Hover over any video player — a green banner appears at the top-right, **outside** the video. Click **Download** to send to FDM. Press and hold anywhere on the banner to drag it to a new position.

### 2. Clipboard Sniffer Pill
Copy a link on TikTok, Twitter/X, Instagram, Reddit, or Facebook — a glass pill appears at the bottom of the screen. Click **Download** to send to FDM, or **Dismiss** to hide.

### 3. Popup Quick Settings
Click the 🥑 toolbar icon to toggle settings on the fly: enable/disable the floating button, switch between Full banner and Mini icon mode, adjust size and position, and toggle clipboard detection.

---

## ⚙️ Settings

Access the full settings dashboard via the gear icon in the popup or right-click the extension icon → Options.

*   **Floating download button**: Enable/disable the hover banner.
*   **Button display mode**: Full banner or compact Mini icon.
*   **Button size**: Small, Medium, or Large.
*   **Button position**: Top-Right, Top-Left, Bottom-Right, Bottom-Left.
*   **Clipboard detection**: Toggle the copy-link prompt.
*   **Reset position**: Return the dragged button to its default top-right corner.

---

## 📂 Folder Structure

```
├── manifest.json         # Manifest V3 configuration
├── background.js         # Service worker
├── content.js            # Content script (DOM scanner, banner UI, drag, clipboard)
├── injected.js           # Page-context clipboard interceptor
├── popup.html / .css / .js   # Quick settings popup
├── settings.html / .css / .js # Full settings dashboard
├── assets/               # Screenshots
└── icons/                # Extension icons
```

---

## 📄 License

MIT License. Open-source and free to share.
