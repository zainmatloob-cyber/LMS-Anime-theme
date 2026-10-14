/* ============================================================
   Shared theme runtime for the LMS and CMS content scripts.
   Loaded after js/settings.js by both manifest entries; exposes
   window.LmsTheme inside the isolated content-script world.

   The settings themselves (keys, defaults, built-in wallpapers) are
   described in js/settings.js.

   Glass strength and blur are not settings: they come from --glass-alpha
   and --glass-blur in css/theme.css.

   An uploaded wallpaper is far too big for chrome.storage.sync (8 KB per
   item), so the image itself lives in chrome.storage.local under
   wallpaperImage, with wallpaperTone recording whether it is light or dark.
   Local storage is per-device, so the choice syncs but the image does not.
   ============================================================ */
(function () {
  'use strict';

  var Settings = window.LmsSettings;
  var ROOT = document.documentElement;
  var MIRROR_KEY = 'lmsRedesign:theme';
  var GPU_KEY = 'lmsRedesign:gpu';
  var DEFAULT_THEME = Settings.DEFAULT_THEME;

  // Set from chrome.storage.local, which resolves separately from sync.
  var upload = { image: '', tone: 'light' };

  var state = Settings.normalise({});

  // The OS colour scheme, for darkAuto. Edge on Linux reads it from the
  // desktop's GTK/portal setting.
  var systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // Callbacks the per-site scripts register to re-run their DOM tweaks
  // whenever the theme or dark mode changes.
  var listeners = [];

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
      return Settings.normalise(parsed);
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

  /* ---------- software rendering ----------------------------------------
     backdrop-filter is cheap on a GPU and very expensive without one. Edge
     on Linux sometimes runs without GPU acceleration (blocklisted drivers,
     Wayland quirks, VMs), and there every scroll re-blurs every glass panel.

     The glass only goes solid when WebGL positively names a software
     renderer. A missing WebGL context proves nothing (it can be disabled
     while compositing still runs on the GPU), so that keeps the glass.

     The answer is cached for the browser session only. Edge drops to
     software rendering for a while after a GPU process crash; a permanent
     per-site cache froze that state, so one site could stay solid while
     the other kept its glass. */

  function detectSoftwareRendering() {
    // Results cached permanently by 3.8.0 could be stale; drop them.
    try { window.localStorage.removeItem(GPU_KEY); } catch (e) { /* ignore */ }

    try {
      var cached = window.sessionStorage.getItem(GPU_KEY);
      if (cached === '1' || cached === '0') return cached === '1';
    } catch (e) { /* re-probe */ }

    var software = false;
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

      if (gl) {
        var info = gl.getExtension('WEBGL_debug_renderer_info');
        var renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
        software = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(renderer);

        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (e) {
      software = false;
    }

    try {
      window.sessionStorage.setItem(GPU_KEY, software ? '1' : '0');
    } catch (e) { /* fine, probe again next time */ }

    return software;
  }

  ROOT.classList.toggle('lms-no-gpu', detectSoftwareRendering());

  /* ---------- applying state -------------------------------------------- */

  function isDark() {
    return state.darkAuto ? !!(systemDark && systemDark.matches) : state.darkMode;
  }

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
    var tone = 'light';

    if (mode === 'custom' && upload.image) {
      url = 'url("' + upload.image + '")';
      tone = upload.tone === 'dark' ? 'dark' : 'light';
    } else if (mode !== 'none') {
      // 'default', or 'custom' with no image on this device yet.
      var art = Settings.wallpaperById(state.wallpaperId) || Settings.WALLPAPERS[0];
      url = 'url("' + chrome.runtime.getURL(Settings.wallpaperPath(art.id)) + '")';
      tone = art.tone;
    }

    var show = manga && !!url;
    ROOT.classList.toggle('lms-wallpaper', show);

    if (show) {
      ROOT.style.setProperty('--manga-wallpaper', url);
      ROOT.style.setProperty('--manga-wallpaper-size', state.wallpaperFit);
      ROOT.style.setProperty('--manga-wallpaper-pos', state.wallpaperPos);
      ROOT.setAttribute('data-lms-wallpaper-tone', tone);
    } else {
      ROOT.style.removeProperty('--manga-wallpaper');
      ROOT.style.removeProperty('--manga-wallpaper-size');
      ROOT.style.removeProperty('--manga-wallpaper-pos');
      ROOT.removeAttribute('data-lms-wallpaper-tone');
    }
  }

  /* Re-read the uploaded image. Called at boot and whenever storage says
     the upload changed. */
  function loadUpload(done) {
    chrome.storage.local.get(Settings.LOCAL_KEYS, function (result) {
      if (!chrome.runtime.lastError && result) {
        upload.image = typeof result.wallpaperImage === 'string' ? result.wallpaperImage : '';
        upload.tone = result.wallpaperTone === 'dark' ? 'dark' : 'light';
      }
      if (done) done();
    });
  }

  function render() {
    var manga = isMangaActive();
    ROOT.classList.toggle('lms-dark', isDark());
    applyTheme(state.lmsTheme);
    ROOT.classList.toggle('lms-manga', manga);
    applyWallpaper(manga);
  }

  function update(patch) {
    var merged = {};
    Object.keys(state).forEach(function (key) { merged[key] = state[key]; });
    Object.keys(patch).forEach(function (key) {
      if (patch[key] !== undefined) merged[key] = patch[key];
    });
    state = Settings.normalise(merged);
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

  chrome.storage.sync.get(Settings.SYNC_KEYS, function (result) {
    if (chrome.runtime.lastError) {
      if (!mirrored) render();
      clearPreload();
      return;
    }
    update(Settings.normalise(result));
    clearPreload();
  });

  if (systemDark) {
    systemDark.addEventListener('change', function () {
      if (state.darkAuto) {
        render();
        notify();
      }
    });
  }

  /* ---------- live updates ----------------------------------------------
     The popup, the settings page and the keyboard shortcut all just write
     to storage. Listening here means every open LMS/CMS tab follows along,
     not only the one the popup was opened over. */

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync') {
      var patch = {};
      var touched = false;
      Settings.SYNC_KEYS.forEach(function (key) {
        if (changes[key]) {
          // A removed key goes back to its default.
          patch[key] = changes[key].newValue === undefined
            ? Settings.DEFAULTS[key]
            : changes[key].newValue;
          touched = true;
        }
      });
      if (touched) update(patch);
    }

    if (area === 'local' && (changes.wallpaperImage || changes.wallpaperTone)) {
      loadUpload(function () { update({}); });
    }
  });

  /* ---------- messages ---------------------------------------------------- */

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || !msg.type) return;

    // The popup asks so it can tell the user whether this tab is themed.
    if (msg.type === 'ping') reply({ ok: true });

    // Alt+Shift+D. The background worker can't see the OS colour scheme,
    // so the tab works out what "the other mode" is from what it shows.
    if (msg.type === 'toggleDarkShortcut') {
      chrome.storage.sync.set({ darkMode: !isDark(), darkAuto: false });
      reply({ ok: true });
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
    isDark: isDark,
    isManga: isMangaActive,
    currentTheme: currentTheme,
    rafDebounce: rafDebounce,
    selfHealingObserver: selfHealingObserver
  };
})();
