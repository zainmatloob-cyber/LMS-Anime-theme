/* ============================================================
   Popup logic
   Reads and writes chrome.storage.sync, and pushes live updates to the
   active tab so changes land without a page reload.
   ============================================================ */
(function () {
  'use strict';

  /* The single source of truth for the theme list. The grid, the popup's own
     accent colour and the swatch gradients all come from here, so adding a
     theme means adding one row plus the matching block in css/theme.css. */
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

  // Themes removed in 3.1, mapped to their replacement. Ids are kept for the
  // rest, so saved choices carry over even though the names changed.
  var RETIRED_THEMES = { shounen: 'verdant', noir: 'verdant' };

  var DEFAULT_THEME = 'blue';

  var DEFAULTS = { animeMode: true, wallpaper: 'default' };

  // Ships with the extension; matches BUILT_IN in js/theme-core.js.
  var BUILT_IN = 'overgrown-city';

  /* Uploaded wallpapers go in chrome.storage.local: sync caps a single item
     at 8 KB. The cap here keeps one image well inside the local quota. */
  var MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  var ALLOWED_TYPES = ['image/svg+xml', 'image/jpeg', 'image/png'];

  var body = document.body;
  var darkToggle = document.getElementById('darkToggle');
  var animeToggle = document.getElementById('animeToggle');
  var wallpaperPreview = document.getElementById('wallpaperPreview');
  var wallpaperState = document.getElementById('wallpaperState');
  var wallpaperInput = document.getElementById('wallpaperInput');
  var wallpaperNote = document.getElementById('wallpaperNote');
  var wallpaperSection = document.getElementById('wallpaperSection');
  var wallpaperHint = document.getElementById('wallpaperHint');
  var themeGrid = document.getElementById('themeGrid');
  var status = document.getElementById('status');

  var swatches = [];
  var wallpaperMode = DEFAULTS.wallpaper;
  var uploadPreview = '';
  var activeTheme = DEFAULT_THEME;
  var animeMode = DEFAULTS.animeMode;

  /* ---------- rendering -------------------------------------------------- */

  function renderSwatches() {
    var fragment = document.createDocumentFragment();

    THEMES.forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-swatch';
      button.dataset.theme = theme.id;
      button.title = theme.name;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');

      var circle = document.createElement('span');
      circle.className = 'swatch-circle is-manga';
      circle.style.background = 'linear-gradient(135deg, ' + theme.from + ' 0%, ' + theme.to + ' 100%)';

      var label = document.createElement('span');
      label.className = 'swatch-name';
      label.textContent = theme.name;

      button.append(circle, label);
      button.addEventListener('click', function () { selectTheme(theme.id, true); });
      button.addEventListener('keydown', onGridKeydown);

      fragment.appendChild(button);
    });

    themeGrid.appendChild(fragment);
    swatches = Array.prototype.slice.call(themeGrid.children);
  }

  /* Arrow keys walk the 4-column grid, matching how a radio group is expected
     to behave. Only the selected swatch stays in the tab order. */
  function onGridKeydown(event) {
    var columns = 4;
    var index = swatches.indexOf(event.currentTarget);
    var next;

    switch (event.key) {
      case 'ArrowRight': next = index + 1; break;
      case 'ArrowLeft':  next = index - 1; break;
      case 'ArrowDown':  next = index + columns; break;
      case 'ArrowUp':    next = index - columns; break;
      case 'Home':       next = 0; break;
      case 'End':        next = swatches.length - 1; break;
      default: return;
    }

    // Down from a column the short last row doesn't reach lands on its end.
    if (event.key === 'ArrowDown' && next >= swatches.length && index < swatches.length - 1) {
      next = swatches.length - 1;
    }
    if (next < 0 || next >= swatches.length) return;

    event.preventDefault();
    swatches[next].focus();
    selectTheme(swatches[next].dataset.theme, true);
  }

  /* ---------- state ------------------------------------------------------ */

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  function paintPopup(themeId) {
    var theme = themeById(themeId);
    var root = document.documentElement.style;

    root.setProperty('--popup-primary', theme.from);
    root.setProperty('--popup-accent', theme.to);
    root.setProperty('--popup-primary-rgb', theme.rgb);
    root.setProperty('--popup-pop', theme.to);
    refreshMangaState();
  }

  /* Mirrors theme-core.js: the manga layer follows the anime style switch.
     The popup header and the wallpaper
     section follow it so the popup previews exactly what the page shows. */
  function refreshMangaState() {
    var manga = animeMode;
    body.classList.toggle('manga', manga);
    wallpaperSection.classList.toggle('is-inactive', !manga);
    wallpaperHint.hidden = manga;
  }

  function selectTheme(themeId, persist) {
    themeId = RETIRED_THEMES[themeId] || themeId;
    activeTheme = themeId;

    swatches.forEach(function (swatch) {
      var isActive = swatch.dataset.theme === themeId;
      swatch.setAttribute('aria-checked', isActive ? 'true' : 'false');
      swatch.tabIndex = isActive ? 0 : -1;
    });

    paintPopup(themeId);

    if (persist) {
      chrome.storage.sync.set({ lmsTheme: themeId });
      sendToTab({ type: 'setTheme', theme: themeId });
    }
  }

  function setAnime(enabled, persist) {
    animeMode = enabled;
    animeToggle.checked = enabled;
    refreshMangaState();

    if (persist) {
      chrome.storage.sync.set({ animeMode: enabled });
      sendToTab({ type: 'setAnime', enabled: enabled });
    }
  }

  /* mode is 'default' (the wallpaper that ships with the extension),
     'custom' (the uploaded image) or 'none'. Only the mode is persisted
     here; the image itself is written by storeUpload below. */
  function selectWallpaper(mode, persist) {
    var next = ['default', 'custom', 'none'].indexOf(mode) === -1 ? DEFAULTS.wallpaper : mode;
    if (next === 'custom' && !uploadPreview) next = DEFAULTS.wallpaper;

    wallpaperMode = next;
    paintWallpaper();

    if (persist) {
      chrome.storage.sync.set({ wallpaper: next });
      sendToTab({ type: 'setWallpaper', wallpaper: next });
    }
  }

  function paintWallpaper() {
    var image = wallpaperMode === 'custom' ? uploadPreview
      : wallpaperMode === 'default' ? 'images/wallpapers/' + BUILT_IN + '.svg' : '';

    wallpaperPreview.style.backgroundImage = image ? 'url("' + image + '")' : '';
    wallpaperPreview.classList.toggle('is-empty', !image);
    wallpaperState.textContent = wallpaperMode === 'custom' ? 'Your wallpaper'
      : wallpaperMode === 'default' ? 'Built-in wallpaper' : 'No wallpaper';

    [['wallpaperDefault', 'default'], ['wallpaperNone', 'none']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      el.classList.toggle('is-active', wallpaperMode === pair[1]);
      el.setAttribute('aria-pressed', wallpaperMode === pair[1] ? 'true' : 'false');
    });
  }

  function showNote(text, isError) {
    wallpaperNote.textContent = text;
    wallpaperNote.classList.toggle('is-error', !!isError);
  }

  /* Average brightness decides how heavy a wash the page needs over the
     image for text to stay readable, so it is measured once here rather
     than guessed. A 32px draw is plenty for an average and costs nothing.
     A data: URL never taints the canvas, so the pixels stay readable. */
  function measureTone(dataUrl, done) {
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        var px = ctx.getImageData(0, 0, 32, 32).data;
        var sum = 0;
        for (var i = 0; i < px.length; i += 4) {
          // Rough luminance is accurate enough to pick a wash.
          sum += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        }
        done(sum / (px.length / 4) < 0.5 ? 'dark' : 'light');
      } catch (e) {
        done('light');
      }
    };
    img.onerror = function () { done('light'); };
    img.src = dataUrl;
  }

  function handleFile(file) {
    if (!file) return;

    var name = (file.name || '').toLowerCase();
    var typeOk = ALLOWED_TYPES.indexOf(file.type) !== -1 ||
      /\.(svg|jpe?g|png)$/.test(name);
    if (!typeOk) {
      showNote('That file type is not supported. Use SVG, JPEG or PNG.', true);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showNote('That image is ' + Math.round(file.size / 1048576) + ' MB. The limit is 4 MB.', true);
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () { showNote('That image could not be read.', true); };
    reader.onload = function () {
      var dataUrl = String(reader.result);
      measureTone(dataUrl, function (tone) {
        chrome.storage.local.set({ wallpaperImage: dataUrl, wallpaperTone: tone }, function () {
          if (chrome.runtime.lastError) {
            showNote('There was not enough room to store that image.', true);
            return;
          }
          uploadPreview = dataUrl;
          selectWallpaper('custom', true);
          showNote(file.name + ' - ' + Math.max(1, Math.round(file.size / 1024)) + ' KB', false);
        });
      });
    };
    reader.readAsDataURL(file);
  }

  function setDark(enabled, persist) {
    darkToggle.checked = enabled;
    body.classList.toggle('dark', enabled);

    if (persist) {
      chrome.storage.sync.set({ darkMode: enabled });
      sendToTab({ type: 'toggleDark', enabled: enabled });
    }
  }

  /* ---------- messaging -------------------------------------------------- */

  /* The popup opens on any tab, including ones with no content script. Reading
     lastError inside the callback is what stops Chrome logging an unchecked
     runtime error every time someone opens this on a random page. */
  function sendToTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) return;

      chrome.tabs.sendMessage(tab.id, message, function () {
        if (chrome.runtime.lastError) {
          showStatus('Saved. Open the LMS or CMS to see it applied.');
        } else {
          hideStatus();
        }
      });
    });
  }

  var statusTimer = null;

  function showStatus(text) {
    status.textContent = text;
    status.hidden = false;

    clearTimeout(statusTimer);
    statusTimer = setTimeout(hideStatus, 4000);
  }

  function hideStatus() {
    clearTimeout(statusTimer);
    status.hidden = true;
  }

  /* ---------- boot ------------------------------------------------------- */

  renderSwatches();

  chrome.storage.sync.get(['darkMode', 'lmsTheme', 'animeMode', 'wallpaper'], function (result) {
    result = result || {};
    setDark(!!result.darkMode, false);
    // animeMode is on unless the user has turned it off.
    setAnime(result.animeMode === undefined ? DEFAULTS.animeMode : !!result.animeMode, false);
    selectTheme(result.lmsTheme || DEFAULT_THEME, false);
    selectWallpaper(result.wallpaper || DEFAULTS.wallpaper, false);
    chrome.storage.local.get(['wallpaperImage'], function (local) {
      if (!chrome.runtime.lastError && local && local.wallpaperImage) {
        uploadPreview = local.wallpaperImage;
        paintWallpaper();
      } else if (wallpaperMode === 'custom') {
        // The image was cleared on this device (local storage is per-device).
        selectWallpaper('default', true);
      }
    });

    // Drop the transition freeze once the saved state is on screen.
    requestAnimationFrame(function () {
      body.classList.remove('is-loading');
    });
  });

  darkToggle.addEventListener('change', function () {
    setDark(darkToggle.checked, true);
  });

  animeToggle.addEventListener('change', function () {
    setAnime(animeToggle.checked, true);
  });

  document.getElementById('wallpaperUpload').addEventListener('click', function () {
    wallpaperInput.click();
  });

  wallpaperInput.addEventListener('change', function () {
    handleFile(wallpaperInput.files && wallpaperInput.files[0]);
    // Reset so picking the same file twice still fires a change event.
    wallpaperInput.value = '';
  });

  document.getElementById('wallpaperDefault').addEventListener('click', function () {
    selectWallpaper('default', true);
    showNote('SVG, JPEG or PNG, up to 4 MB. Stored on this device.', false);
  });

  document.getElementById('wallpaperNone').addEventListener('click', function () {
    selectWallpaper('none', true);
  });

  // Keeps two open popups (or a second window) in step with each other.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;
    if (changes.darkMode) setDark(!!changes.darkMode.newValue, false);
    if (changes.lmsTheme) selectTheme(changes.lmsTheme.newValue || DEFAULT_THEME, false);
    if (changes.animeMode) {
      var v = changes.animeMode.newValue;
      setAnime(v === undefined ? DEFAULTS.animeMode : !!v, false);
    }
    if (changes.wallpaper) selectWallpaper(changes.wallpaper.newValue || DEFAULTS.wallpaper, false);
  });
})();
