# Bahria LMS Redesign — Chrome Extension

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![Version](https://img.shields.io/badge/version-3.3-success)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Chrome extension that gives Bahria University's LMS and CMS a modern UI overhaul — anime-style layout, glass panels over your own wallpaper, dark mode, and 13 full-palette themes.

**Supports:**
- `lms.bahria.edu.pk` — Student/faculty portal (AdminLTE 2 + Bootstrap 3)
- `cms.bahria.edu.pk` — Course management system (Aspire framework + Bootstrap 3)

---

## Installation

> This extension is unpacked (not on the Chrome Web Store), so you load it manually.

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select this repository folder (the one containing `manifest.json`).
6. The extension icon will appear in your toolbar.

---

## Usage

Click the extension icon in the toolbar to open the settings popup. The popup takes on
whichever theme is active, so it doubles as a preview.

### Dark Mode
Toggle the **Dark Mode** switch to flip between light and dark. The setting is remembered
across sessions and applies to both sites.

### Anime Style
On by default. Every theme is drawn as a manga page: inked panel outlines with hard
shadows, screentone headers, a bold display face, and each page title set on a slab with
focus lines. Turn **Anime Style** off in the popup to get the plain redesign back; the
switch applies to every theme.

### Wallpaper and Glass
Upload your own wallpaper from the popup: **SVG, JPEG or PNG, up to 4 MB**. The three
buttons are **Upload image**, **Built-in** (the Overgrown City artwork that ships with the
extension) and **None** (plain screentone). While a wallpaper is showing, panels, the nav
bar and the sidebar turn to frosted glass (medium strength) so the art reads through them.

An uploaded image is far too big for `chrome.storage.sync`, which caps one item at 8 KB,
so it is kept in `chrome.storage.local`. That means the *choice* syncs across devices but
the image does not; on a device that hasn't got it, the built-in wallpaper is shown until
you upload again.

On upload the popup measures the image's average brightness on a canvas and stores the
result. A dark image under light glass, or a bright one under dark glass, drags the glass
toward the wrong end and muted text drops below 4.5:1, so those pairings get a heavier
wash in the page colour. Readability was measured this way across every theme, mode and
wallpaper (182 combinations, all above 5.4:1).

Uploaded SVGs are used as a CSS `background-image`, so any script inside one never runs.

`images/wallpapers/` still holds all seven original SVGs. To make a different one the
built-in, change `BUILT_IN` in `js/theme-core.js` and `popup.js` to match its filename.

Panels that contain a modal or the LMS chat popup stay solid, because `backdrop-filter`
would trap those fixed-position elements inside the panel.

### Themes
Thirteen themes, each a complete palette in the style of Verdant: a deep nav and page-title
colour, a main colour for panel headers and buttons, a bright highlight for the active
sidebar item and accent stripes, and tinted page and text colours. Every theme has its own
light and dark version. Click a tile to apply it; arrow keys move through the grid.

| Theme | Look |
|---|---|
| Midnight (default) | Navy ink, sky-blue highlights |
| Ember | Deep red with orange sparks |
| Pine | True green with sunlight yellow |
| Blossom | Raspberry and petal pink |
| Graphite | Pure ink and paper |
| Amethyst | Violet with orchid highlights |
| Lagoon | Deep teal and seafoam |
| Sunstone | Burnt amber and gold |
| Tide | Harbour blue and spray |
| Lichen | Weathered olive and pale moss |
| Garnet | Dark garnet and coral pink |
| Twilight | Indigo evening, lavender glow |
| Verdant | Moss and emerald over stone |

Every theme was checked in code: text, muted text and links against solid surfaces, fills
against the text on them, and then again against the rendered glass over every wallpaper
in both modes (182 combinations, all above 5.4:1).

**Upgrading from 3.1:** the 12 colour themes were rebuilt and renamed (Blue is now
Midnight, Crimson is Ember, and so on). Their internal ids are unchanged, so your saved
choice carries over. Shounen and Noir from 3.0 still map to Verdant.

---

## File Structure

```
├── css/
│   ├── theme.css         # Shared: bundled font, design tokens, all 13 themes
│   ├── anime.css         # Shared: manga layer and glass (panels, nav, wallpaper)
│   ├── mystyle.css       # LMS-specific layout
│   ├── cms-style.css     # CMS-specific layout
│   └── popup.css         # Popup styles
├── fonts/
│   ├── inter-latin.woff2       # Bundled Inter (latin)
│   ├── inter-latin-ext.woff2   # Bundled Inter (latin-ext)
│   ├── dela-gothic-one-latin.woff2      # Manga display face (latin)
│   ├── dela-gothic-one-latin-ext.woff2  # Manga display face (latin-ext)
│   └── OFL-DelaGothicOne.txt            # Its licence (SIL OFL 1.1)
├── images/
│   └── wallpapers/       # 7 original SVG wallpapers
├── icons/
│   └── logo.png          # Extension icon
├── js/
│   ├── theme-core.js     # Shared: state, messaging, flash prevention, helpers
│   ├── content.js        # LMS DOM tweaks (avatar, themed selects)
│   └── cms-content.js    # CMS DOM tweaks (dropdown contrast, submenus)
├── manifest.json
├── popup.html
└── popup.js              # Popup logic (storage read/write, messaging)
```

---

## How It Works

- **Manifest V3** with two `content_scripts` entries — one matched to LMS, one to CMS.
  Both load `theme.css` and `theme-core.js` first, then their site-specific files.
- All theming runs on CSS custom properties (`--lms-primary`, `--lms-bg`, …) defined once
  in `theme.css`. There is no per-color JavaScript.
- Theme, dark mode, anime style and the wallpaper choice live in `chrome.storage.sync`, so
  they follow you across devices; an uploaded image stays in `chrome.storage.local`.
- The wallpaper is a `position: fixed` layer (`body::before`), not
  `background-attachment: fixed`, so it is composited once instead of repainting on scroll.
  The URL is an extension path or a `data:` URL, so `theme-core.js` sets it as
  `--manga-wallpaper` rather than writing it into the stylesheet.
- The popup sends `chrome.tabs.sendMessage` to the active tab on every change; the content
  script toggles classes (`lms-dark`, `lms-theme-*`) on `<html>` instantly.

### No flash on load

`chrome.storage` is asynchronous, so at `document_start` the page would paint at least one
unstyled frame — a white flash on every load for dark-mode users. `theme-core.js` keeps a
mirror of the last known settings in the page's own `localStorage` and reads it
*synchronously* before the first paint. `chrome.storage` remains the source of truth and
corrects the mirror as soon as it resolves.

A `lms-preload` class suppresses every transition until the real settings land, so the
styles that settle during boot appear instantly instead of animating into place.

### Performance

Transitions are scoped to interactive elements rather than applied with `* { transition }`.
A universal rule makes the browser track an animation for every node on the page; on the
LMS course tables that alone made scrolling and theme switches feel sluggish. Measured on
the dashboard, a theme switch costs **~1.8× less** style and layout time than the universal
rule it replaced.

The `MutationObserver`s that keep the avatar and CMS dropdown patched are coalesced to one
run per animation frame and suspend themselves while writing, so they cannot retrigger
on their own changes.

### Fonts

Inter is bundled as two `woff2` subsets and declared with `@font-face` in `theme.css`.
The manga themes add Dela Gothic One (SIL Open Font License 1.1, from the Fontsource
package), used only for headings. `anime.css` references it with the
`chrome-extension://__MSG_@@extension_id__/` prefix, which Chrome fills in at load time.

The previous `@import` from Google Fonts was a render-blocking network request on every
page load and was subject to the site's content-security policy.

### Accessibility

- Every text/background pair is checked against WCAG AA (4.5:1) across all 24
  theme × mode combinations — buttons, labels, alerts, tables, tabs, pagination and links.
  `--lms-on-primary` follows the fill's lightness, and `--lms-link` is a separate token for
  the few themes whose primary is a fill color too dark or too pale to read as text.
- Keyboard support: the themed semester/course dropdowns respond to arrows, Home/End,
  Enter, Escape and Tab, and expose `role="listbox"` with `aria-expanded`/`aria-selected`.
- A visible focus ring is applied on `:focus-visible` only, so mouse users keep the
  original look.
- `prefers-reduced-motion: reduce` disables animations and smooth scrolling.

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save dark mode preference and selected theme |

No network access, no tab history, no cookies.

---

## Notes

- Content scripts run at `document_start` so styles apply before the page renders.
- LMS uses Font Awesome 4 (`FontAwesome`). CMS uses Font Awesome 5 (`Font Awesome 5 Free`,
  weight 900). The stylesheets handle each separately to preserve icons.
- If a theme or dark mode change doesn't apply, reload the page once after first install.

---

## License

[MIT](LICENSE) © Abdur-Rafay-AR

> Not affiliated with or endorsed by Bahria University. This extension only restyles pages
> you are already logged into; it sends no data anywhere.
