/* ============================================================
   Shared theme runtime for the LMS and CMS content scripts.
   Loaded first by both manifest entries; exposes window.LmsTheme
   inside the isolated content-script world.

   Settings (chrome.storage.sync):
     darkMode   boolean
     lmsTheme   colour theme id
     animeMode  boolean, default true - manga layer on every theme
     wallpaper  'default' | 'custom' | 'none', default 'default'

   An uploaded wallpaper is far too big for chrome.storage.sync (8 KB per
   item), so the image itself lives in chrome.storage.local under
   wallpaperImage, with wallpaperTone recording whether it is light or dark.
   Local storage is per-device, so the choice syncs but the image does not.
   ============================================================ */
(function () {
  'use strict';

  var ROOT = document.documentElement;
  var MIRROR_KEY = 'lmsRedesign:theme';
  var DEFAULT_THEME = 'blue';
  var STORAGE_KEYS = ['darkMode', 'lmsTheme', 'animeMode', 'wallpaper'];

  // Themes removed in 3.1. Anyone who had one lands on Verdant instead of
  // silently falling back to the default blue.
  var RETIRED_THEMES = { shounen: 'verdant', noir: 'verdant' };

  // The wallpaper shipped with the extension, used until one is uploaded.
  var BUILT_IN = 'overgrown-city';
  var BUILT_IN_TONE = 'light';

  var LOCAL_KEYS = ['wallpaperImage', 'wallpaperTone'];

  // Set from chrome.storage.local, which resolves separately from sync.
  var upload = { image: '', tone: 'light' };
  var DEFAULTS = {
    darkMode: false,
    lmsTheme: DEFAULT_THEME,
    animeMode: true,
    wallpaper: 'default'
  };

  var MODES = ['default', 'custom', 'none'];

  var state = {
    darkMode: DEFAULTS.darkMode,
    lmsTheme: DEFAULTS.lmsTheme,
    animeMode: DEFAULTS.animeMode,
    wallpaper: DEFAULTS.wallpaper
  };

  // Callbacks the per-site scripts register to re-run their DOM tweaks
  // whenever the theme or dark mode changes.
  var listeners = [];

  /* Missing keys mean "never set", which is different from false, so fill
     them from DEFAULTS rather than coercing. */
  function normalise(raw) {
    raw = raw || {};
    var theme = raw.lmsTheme || DEFAULTS.lmsTheme;
    return {
      darkMode: !!raw.darkMode,
      lmsTheme: RETIRED_THEMES[theme] || theme,
      animeMode: raw.animeMode === undefined ? DEFAULTS.animeMode : !!raw.animeMode,
      wallpaper: MODES.indexOf(raw.wallpaper) === -1 ? DEFAULTS.wallpaper : raw.wallpaper
    };
  }

  /* ---------- synchronous mirror ----------------------------------------
     chrome.storage.sync is async, so at document_start the <html> element is
     unstyled for at least one frame. For a dark-mode user that frame is a
     white flash on every single page load.

     Content scripts share the page's localStorage, so we keep a mirror of the
     last known settings there and read it synchronously before the first
     paint. chrome.storage stays the source of truth and corrects the mirror
     as soon as it resolves. */

  function readMirror() {
    try {
      var raw = window.localStorage.getItem(MIRROR_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Mirrors written by v2.1 used `theme` instead of `lmsTheme`.
      if (parsed.theme && !parsed.lmsTheme) parsed.lmsTheme = parsed.theme;
      return normalise(parsed);
    } catch (e) {
      // Private mode, disabled storage, or malformed JSON - fall back to async.
      return null;
    }
  }

  function writeMirror() {
    try {
      window.localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
    } catch (e) {
      /* nothing we can do, and nothing breaks without it */
    }
  }

  /* ---------- applying state -------------------------------------------- */

  function isMangaActive() {
    return state.animeMode;
  }

  function applyTheme(theme) {
    // Snapshot first: classList is live, removing while iterating skips entries.
    Array.prototype.slice
      .call(ROOT.classList)
      .filter(function (cls) { return cls.indexOf('lms-theme-') === 0; })
      .forEach(function (cls) { ROOT.classList.remove(cls); });

    if (theme !== DEFAULT_THEME) {
      ROOT.classList.add('lms-theme-' + theme);
    }
  }

  /* The built-in URL depends on the extension id and an uploaded one is a
     data: URL, so the image is set as a custom property here rather than
     written into the stylesheet. The tone tells anime.css whether the art is
     light or dark, which decides how heavy the readability wash has to be. */
  function applyWallpaper(manga) {
    var mode = state.wallpaper;
    var url = '';
    var tone = BUILT_IN_TONE;

    if (mode === 'custom' && upload.image) {
      url = 'url("' + upload.image + '")';
      tone = upload.tone === 'dark' ? 'dark' : 'light';
    } else if (mode !== 'none') {
      // 'default', or 'custom' with no image on this device yet.
      url = 'url("' + chrome.runtime.getURL('images/wallpapers/' + BUILT_IN + '.svg') + '")';
    }

    var show = manga && !!url;
    ROOT.classList.toggle('lms-wallpaper', show);

    if (show) {
      ROOT.style.setProperty('--manga-wallpaper', url);
      ROOT.setAttribute('data-lms-wallpaper-tone', tone);
    } else {
      ROOT.style.removeProperty('--manga-wallpaper');
      ROOT.removeAttribute('data-lms-wallpaper-tone');
    }
  }

  /* Re-read the uploaded image. Called at boot and whenever the popup says
     the upload changed, so the message itself never carries the image. */
  function loadUpload(done) {
    chrome.storage.local.get(LOCAL_KEYS, function (result) {
      if (!chrome.runtime.lastError && result) {
        upload.image = typeof result.wallpaperImage === 'string' ? result.wallpaperImage : '';
        upload.tone = result.wallpaperTone === 'dark' ? 'dark' : 'light';
      }
      if (done) done();
    });
  }

  function render() {
    var manga = isMangaActive();
    ROOT.classList.toggle('lms-dark', state.darkMode);
    applyTheme(state.lmsTheme);
    ROOT.classList.toggle('lms-manga', manga);
    applyWallpaper(manga);
  }

  function update(patch) {
    Object.keys(patch).forEach(function (key) {
      if (patch[key] !== undefined) state[key] = patch[key];
    });
    render();
    writeMirror();
    notify();
  }

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.error('[LMS Redesign] theme listener failed:', e);
      }
    });
  }

  /* ---------- preload guard ---------------------------------------------
     css/theme.css disables every transition while `lms-preload` is set, so
     the styles that settle during boot land instantly instead of animating
     into place. We clear it one frame after the real settings arrive. */

  var preloadCleared = false;

  function clearPreload() {
    if (preloadCleared) return;
    preloadCleared = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ROOT.classList.remove('lms-preload');
      });
    });
  }

  ROOT.classList.add('lms-preload');

  // Never leave the page frozen if storage misbehaves or never answers.
  setTimeout(clearPreload, 1500);

  /* ---------- boot ------------------------------------------------------- */

  var mirrored = readMirror();
  if (mirrored) {
    state = mirrored;
    render();
  }

  // The image is only needed once a custom wallpaper is actually selected,
  // but loading it alongside the settings keeps the first paint in one step.
  loadUpload(function () {
    if (state.wallpaper === 'custom') render();
  });

  chrome.storage.sync.get(STORAGE_KEYS, function (result) {
    if (chrome.runtime.lastError) {
      if (!mirrored) render();
      clearPreload();
      return;
    }
    update(normalise(result));
    clearPreload();
  });

  /* ---------- popup messages --------------------------------------------- */

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'toggleDark') update({ darkMode: !!msg.enabled });
    if (msg.type === 'setTheme') update({ lmsTheme: normalise({ lmsTheme: msg.theme }).lmsTheme });
    if (msg.type === 'setAnime') update({ animeMode: !!msg.enabled });
    if (msg.type === 'setWallpaper') {
      // The popup has already written the image to storage.local.
      loadUpload(function () { update({ wallpaper: msg.wallpaper }); });
    }
  });

  function currentTheme() {
    return state.lmsTheme;
  }

  /* ---------- helpers for the per-site scripts --------------------------- */

  /* Coalesces bursts of calls into one per animation frame. The LMS/CMS pages
     mutate constantly (AdminLTE widgets, ASP.NET partial postbacks); running
     DOM fix-ups per mutation is what made theme changes stutter. */
  function rafDebounce(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn();
      });
    };
  }

  /* A MutationObserver whose callback writes to the DOM will re-trigger
     itself. This wrapper suspends observation for the duration of the write. */
  function selfHealingObserver(target, options, work) {
    var observer;
    var run = rafDebounce(function () {
      observer.disconnect();
      try {
        work();
      } finally {
        observer.observe(target, options);
      }
    });

    observer = new MutationObserver(run);
    observer.observe(target, options);
    return observer;
  }

  window.LmsTheme = {
    DEFAULT_THEME: DEFAULT_THEME,
    onChange: function (fn) { listeners.push(fn); },
    isDark: function () { return state.darkMode; },
    isManga: isMangaActive,
    currentTheme: currentTheme,
    rafDebounce: rafDebounce,
    selfHealingObserver: selfHealingObserver
  };
})();
