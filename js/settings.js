/* ============================================================
   Shared settings schema.
   Loaded by the content scripts (before theme-core.js), the popup,
   and the settings page, so every one
   of them agrees on the keys, the defaults and the built-in
   wallpapers. Exposes globalThis.LmsSettings.

   Sync settings (chrome.storage.sync):
     darkMode      boolean
     darkAuto      boolean, follow the operating system instead of darkMode
     lmsTheme      colour theme id
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

  var DEFAULT_THEME = 'blue';

  // Themes removed in 3.1. Anyone who had one lands on Verdant instead of
  // silently falling back to the default blue.
  var RETIRED_THEMES = { shounen: 'verdant', noir: 'verdant' };

  /* The colour themes. Each id needs a matching block in css/theme.css;
     from/to/rgb are only used to draw swatches and tint extension pages.
     Ids are kept from older versions, so saved choices carry over even
     though the names changed. */
  var THEMES = [
    { id: 'blue',    name: 'Midnight',  from: '#1d4ed8', to: '#38bdf8', rgb: '29, 78, 216' },
    { id: 'crimson', name: 'Ember',     from: '#b91c1c', to: '#fb923c', rgb: '185, 28, 28' },
    { id: 'forest',  name: 'Pine',      from: '#166534', to: '#facc15', rgb: '22, 101, 52' },
    { id: 'pink',    name: 'Blossom',   from: '#be185d', to: '#f9a8d4', rgb: '190, 24, 93' },
    { id: 'mono',    name: 'Graphite',  from: '#27272a', to: '#e4e4e7', rgb: '39, 39, 42' },
    { id: 'purple',  name: 'Amethyst',  from: '#6d28d9', to: '#f0abfc', rgb: '109, 40, 217' },
    { id: 'teal',    name: 'Lagoon',    from: '#0f766e', to: '#5eead4', rgb: '15, 118, 110' },
    { id: 'amber',   name: 'Sunstone',  from: '#a14a07', to: '#fbbf24', rgb: '161, 74, 7' },
    { id: 'ocean',   name: 'Tide',      from: '#0369a1', to: '#7dd3fc', rgb: '3, 105, 161' },
    { id: 'sage',    name: 'Lichen',    from: '#4f5f33', to: '#d9e0a3', rgb: '79, 95, 51' },
    { id: 'rose',    name: 'Garnet',    from: '#9f1239', to: '#fda4af', rgb: '159, 18, 57' },
    { id: 'dusk',    name: 'Twilight',  from: '#4f46e5', to: '#c4b5fd', rgb: '79, 70, 229' },
    { id: 'verdant', name: 'Verdant',   from: '#0f7a52', to: '#a3e635', rgb: '15, 122, 82' }
  ];

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
    lmsTheme: DEFAULT_THEME,
    animeMode: true,
    wallpaper: 'default',
    wallpaperId: WALLPAPERS[0].id,
    wallpaperFit: 'cover',
    wallpaperPos: 'center'
  };

  var SYNC_KEYS = Object.keys(DEFAULTS);
  var LOCAL_KEYS = ['wallpaperImage', 'wallpaperTone'];

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
    var theme = typeof raw.lmsTheme === 'string' && raw.lmsTheme ? raw.lmsTheme : DEFAULTS.lmsTheme;

    return {
      darkMode: !!raw.darkMode,
      darkAuto: !!raw.darkAuto,
      lmsTheme: RETIRED_THEMES[theme] || theme,
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

  root.LmsSettings = {
    DEFAULT_THEME: DEFAULT_THEME,
    RETIRED_THEMES: RETIRED_THEMES,
    THEMES: THEMES,
    WALLPAPERS: WALLPAPERS,
    FITS: FITS,
    POSITIONS: POSITIONS,
    DEFAULTS: DEFAULTS,
    SYNC_KEYS: SYNC_KEYS,
    LOCAL_KEYS: LOCAL_KEYS,
    normalise: normalise,
    wallpaperById: wallpaperById,
    wallpaperPath: wallpaperPath
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
