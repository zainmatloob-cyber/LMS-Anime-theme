/* ============================================================
   Shared settings schema.
   Loaded by the content scripts (before theme-core.js), the popup,
   and the settings page, so every one
   of them agrees on the keys, the defaults, the built-in
   wallpapers and the colour palette. Exposes globalThis.LmsSettings.

   Sync settings (chrome.storage.sync):
     darkMode      boolean
     darkAuto      boolean, follow the operating system instead of darkMode
     themeColor    '#rrggbb', the main colour picked on the wheel
     accentColor   '#rrggbb' highlight, or '' to derive it from themeColor
     animeMode     boolean, default true - manga layer on every theme
     wallpaper     'default' | 'custom' | 'none'
     wallpaperId   which built-in wallpaper 'default' means
     wallpaperFit  'cover' | 'contain'
     wallpaperPos  'center' | 'top' | 'bottom' | 'left' | 'right'

   Local only (chrome.storage.local, too big for sync):
     wallpaperImage  data: URL of the uploaded image
     wallpaperTone   'light' | 'dark', its measured brightness
   ============================================================ */
(function (root) {
  'use strict';

  /* Colours are picked on a wheel. palette() below builds every token from
     two of them, the same pair each of the old themes was designed around:
       themeColor   main colour: buttons, links, and the sidebar/header hue
       accentColor  highlight: active sidebar item, stripes, badges */
  var DEFAULT_COLOR = '#1d4ed8';
  var DEFAULT_ACCENT = '#38bdf8';

  /* The 3.8 colour themes, kept only to turn a saved lmsTheme (or an old
     backup file) into the matching pair of colours. */
  var LEGACY_THEMES = {
    blue:    ['#1d4ed8', '#38bdf8'],
    crimson: ['#c2321c', '#fb923c'],
    forest:  ['#166534', '#facc15'],
    pink:    ['#be185d', '#f9a8d4'],
    mono:    ['#27272a', '#e4e4e7'],
    purple:  ['#6d28d9', '#f0abfc'],
    teal:    ['#0f766e', '#5eead4'],
    amber:   ['#a14a07', '#fbbf24'],
    ocean:   ['#0369a1', '#7dd3fc'],
    sage:    ['#4f5f33', '#d9e0a3'],
    rose:    ['#9f1239', '#fda4af'],
    dusk:    ['#4f46e5', '#c4b5fd'],
    verdant: ['#0f7a52', '#a3e635'],
    shounen: ['#0f7a52', '#a3e635'],
    noir:    ['#0f7a52', '#a3e635']
  };

  /* The artwork in images/wallpapers/. The tone is the overall brightness
     of each piece, which anime.css uses to pick the readability wash. */
  var WALLPAPERS = [
    { id: 'overgrown-city', name: 'Overgrown City', tone: 'light' },
    { id: 'dawn-tide',      name: 'Dawn Tide',      tone: 'light' },
    { id: 'focus-burst',    name: 'Focus Burst',    tone: 'light' },
    { id: 'ink-ridge',      name: 'Ink Ridge',      tone: 'light' },
    { id: 'petal-wind',     name: 'Petal Wind',     tone: 'light' },
    { id: 'night-line',     name: 'Night Line',     tone: 'dark' },
    { id: 'starwatch',      name: 'Starwatch',      tone: 'dark' }
  ];

  var MODES = ['default', 'custom', 'none'];
  var FITS = ['cover', 'contain'];
  var POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

  var DEFAULTS = {
    darkMode: false,
    darkAuto: false,
    themeColor: DEFAULT_COLOR,
    accentColor: '',
    animeMode: true,
    wallpaper: 'default',
    wallpaperId: WALLPAPERS[0].id,
    wallpaperFit: 'cover',
    wallpaperPos: 'center'
  };

  var SYNC_KEYS = Object.keys(DEFAULTS);
  var LOCAL_KEYS = ['wallpaperImage', 'wallpaperTone'];

  // Read alongside SYNC_KEYS so an old saved theme can be converted, and
  // removed with them on reset so it can't come back.
  var LEGACY_KEYS = ['lmsTheme'];
  var READ_KEYS = SYNC_KEYS.concat(LEGACY_KEYS);

  function wallpaperById(id) {
    for (var i = 0; i < WALLPAPERS.length; i++) {
      if (WALLPAPERS[i].id === id) return WALLPAPERS[i];
    }
    return null;
  }

  function oneOf(list, value, fallback) {
    return list.indexOf(value) === -1 ? fallback : value;
  }

  /* Missing keys mean "never set", which is different from false, so fill
     them from DEFAULTS rather than coercing. */
  function normalise(raw) {
    raw = raw || {};
    var color = cleanHex(raw.themeColor);
    var accent = raw.accentColor === '' ? '' : cleanHex(raw.accentColor);

    // Never picked a colour: carry over the 3.8 theme, if there was one.
    if (!color) {
      var legacy = LEGACY_THEMES[raw.lmsTheme];
      color = legacy ? legacy[0] : DEFAULT_COLOR;
      if (accent === null) accent = legacy ? legacy[1] : '';
    }
    if (accent === null) accent = '';

    return {
      darkMode: !!raw.darkMode,
      darkAuto: !!raw.darkAuto,
      themeColor: color,
      accentColor: accent,
      animeMode: raw.animeMode === undefined ? DEFAULTS.animeMode : !!raw.animeMode,
      wallpaper: oneOf(MODES, raw.wallpaper, DEFAULTS.wallpaper),
      wallpaperId: wallpaperById(raw.wallpaperId) ? raw.wallpaperId : DEFAULTS.wallpaperId,
      wallpaperFit: oneOf(FITS, raw.wallpaperFit, DEFAULTS.wallpaperFit),
      wallpaperPos: oneOf(POSITIONS, raw.wallpaperPos, DEFAULTS.wallpaperPos)
    };
  }

  function wallpaperPath(id) {
    return 'images/wallpapers/' + (wallpaperById(id) ? id : DEFAULTS.wallpaperId) + '.svg';
  }

  /* ---------- colour -----------------------------------------------------
     palette() turns the two picked colours into every token the stylesheets
     read, following the pattern the hand-made themes used: a deep nav and
     header in the main hue, a tinted page and tinted text, the main colour
     on buttons and links, and the highlight on the active item and stripes.

     Lightness is pushed until each WCAG contrast target the old themes were
     checked against is met, so any colour off the wheel stays readable:
       light: white on primary 5.5:1, links 8:1, muted text 7.2:1 on white,
              black on the highlight 9:1
       dark:  primary 7.5:1 on the nav, links 9.5:1 and muted text 7.2:1 on
              panels, the highlight 9:1 on the nav */

  function cleanHex(value) {
    if (typeof value !== 'string') return null;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!m) return null;
    var h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var c = clamp(Math.round(v), 0, 255).toString(16);
      return c.length === 1 ? '0' + c : c;
    }).join('');
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(p[0] + m) * 255, (p[1] + m) * 255, (p[2] + m) * 255];
  }

  function hsl(h, s, l) {
    return rgbToHex(hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)));
  }

  function lightnessOf(hex) {
    return rgbToHsl(hexToRgb(hex)).l;
  }

  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  /* Step lightness from `l` by `step` until the colour reaches `ratio`
     against `against`, or runs out of range. */
  function reach(h, s, l, against, ratio, step) {
    var againstLum = typeof against === 'number' ? against : luminance(against);
    var hex = hsl(h, s, l);
    while (step < 0 ? l > 0 : l < 1) {
      var lum = luminance(hex);
      var c = (Math.max(lum, againstLum) + 0.05) / (Math.min(lum, againstLum) + 0.05);
      if (c >= ratio) break;
      l = clamp(l + step, 0, 1);
      hex = hsl(h, s, l);
    }
    return hex;
  }

  function rgbList(hex) {
    return hexToRgb(hex).join(', ');
  }

  /* The highlight an empty accentColor stands for: a brighter colour a little
     round the wheel, like sky blue beside navy or amber beside red. Greys
     keep a grey highlight, as the old Graphite theme did. */
  function autoAccent(color) {
    var p = rgbToHsl(hexToRgb(cleanHex(color) || DEFAULT_COLOR));
    var s = p.s < 0.12 ? p.s : Math.max(p.s, 0.75);
    return hsl(p.h + 25, s, 0.62);
  }

  function palette(color, accent, dark) {
    color = cleanHex(color) || DEFAULT_COLOR;
    accent = cleanHex(accent) || autoAccent(color);

    var p = rgbToHsl(hexToRgb(color));
    var a = rgbToHsl(hexToRgb(accent));
    var H = p.h, S = p.s;

    /* Depth: the main colour's brightness (the popup's Shade slider) mapped
       to 0..1. Lightness alone can't carry it, because the contrast fix-ups
       would flatten most of the range back to the same colour; instead it
       places the result inside the range that is already readable. */
    var t = clamp((Math.max.apply(null, hexToRgb(color)) / 255 - 0.15) / 0.85, 0, 1);

    if (dark) {
      var dS = clamp(S * 0.6, 0.06, 0.6);
      var mutedS = clamp(S * 0.18, 0.04, 0.2);
      // Lower shade, deeper night: nav 3.5% to 7% lightness, the rest above it.
      var navY = 0.035 + 0.035 * t;
      var nav = hsl(H, dS, navY);
      var surface = hsl(H, dS * 0.75, navY + 0.075);
      var deepest = lightnessOf(reach(H, S, 0.3, nav, 5.5, 0.01));
      var brightest = lightnessOf(reach(H, S, deepest, nav, 8.5, 0.01));
      var primaryDk = reach(H, S, deepest + (brightest - deepest) * t, nav, 5.5, 0.01);
      var linkDk = reach(H, S, lightnessOf(primaryDk) + 0.04, surface, 8.5, 0.01);
      var hiDk = reach(a.h, a.s, Math.max(a.l, 0.5 + 0.15 * t), nav, 8.5, 0.01);

      return {
        '--lms-primary': primaryDk,
        '--lms-primary-d': linkDk,
        '--lms-accent': hiDk,
        '--lms-primary-rgb': rgbList(primaryDk),
        '--lms-on-primary': nav,
        '--lms-on-primary-muted': 'rgba(' + rgbList(nav) + ', .8)',
        '--lms-link': linkDk,
        '--lms-bg': hsl(H, dS * 0.9, navY + 0.025),
        '--lms-surface': surface,
        '--lms-sidebar-bg': nav,
        '--lms-sidebar-hover': hsl(H, dS * 0.8, navY + 0.065),
        '--lms-sidebar-active': hiDk,
        '--lms-text': hsl(H, clamp(S * 0.4, 0.05, 0.45), 0.93),
        '--lms-text-muted': reach(H, mutedS, 0.66, surface, 7.2, 0.01),
        '--lms-border': hsl(H, dS * 0.55, navY + 0.165),
        '--lms-header-bg': nav,
        '--lms-header-text': '#ffffff',

        '--manga-ink': hsl(H, mutedS, 0.42),
        '--manga-shadow': '#000000',
        '--manga-pop': hiDk,
        '--manga-on-pop': nav,
        '--manga-stripe': hiDk,
        '--manga-slab': nav
      };
    }

    var navS = clamp(S * 0.8, 0.06, 0.7);
    // Lower shade, deeper nav and header: 7% to 15% lightness.
    var navY = 0.07 + 0.08 * t;
    var navLt = hsl(H, navS, navY);
    var ink = hsl(H, clamp(S * 0.5, 0.05, 0.45), 0.11);
    // Buttons run from 12% lightness up to the lightest shade that still
    // carries white text at 5.5:1.
    var lightest = lightnessOf(reach(H, S, 0.97, '#ffffff', 5.5, -0.01));
    var primaryLt = reach(H, S, 0.12 + (lightest - 0.12) * t, '#ffffff', 5.5, -0.01);
    var linkLt = reach(H, S, lightnessOf(primaryLt), '#ffffff', 8, -0.01);
    var hiLt = reach(a.h, a.s, a.l, '#000000', 9, 0.01);

    return {
      '--lms-primary': primaryLt,
      '--lms-primary-d': linkLt,
      '--lms-accent': hiLt,
      '--lms-primary-rgb': rgbList(primaryLt),
      '--lms-on-primary': '#ffffff',
      '--lms-on-primary-muted': 'rgba(255,255,255,.92)',
      '--lms-link': linkLt,
      '--lms-bg': hsl(H, clamp(S * 0.4, 0.06, 0.38), 0.92),
      '--lms-surface': '#ffffff',
      '--lms-sidebar-bg': navLt,
      '--lms-sidebar-hover': hsl(H, navS, navY + 0.08),
      '--lms-sidebar-active': hiLt,
      '--lms-text': ink,
      '--lms-text-muted': reach(H, clamp(S * 0.2, 0.04, 0.2), 0.42, '#ffffff', 7.2, -0.01),
      '--lms-border': hsl(H, clamp(S * 0.35, 0.06, 0.32), 0.84),
      '--lms-header-bg': navLt,
      '--lms-header-text': '#ffffff',

      '--manga-ink': ink,
      '--manga-shadow': navLt,
      '--manga-pop': hiLt,
      '--manga-on-pop': '#000000',
      '--manga-stripe': hiLt,
      '--manga-slab': navLt
    };
  }

  root.LmsSettings = {
    DEFAULT_COLOR: DEFAULT_COLOR,
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    WALLPAPERS: WALLPAPERS,
    FITS: FITS,
    POSITIONS: POSITIONS,
    DEFAULTS: DEFAULTS,
    SYNC_KEYS: SYNC_KEYS,
    LOCAL_KEYS: LOCAL_KEYS,
    LEGACY_KEYS: LEGACY_KEYS,
    READ_KEYS: READ_KEYS,
    normalise: normalise,
    wallpaperById: wallpaperById,
    wallpaperPath: wallpaperPath,
    palette: palette,
    autoAccent: autoAccent,
    cleanHex: cleanHex,
    contrast: contrast,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
