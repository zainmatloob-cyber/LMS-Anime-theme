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
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

  /* A 4K photo is ~2.6 MB once base64 inflates it, which crowds the 5 MB
     storage.local quota on older Chrome. Nothing on screen needs more than
     this width, so bitmaps are redrawn smaller before being stored. SVG is
     left alone: it is vector and already small. */
  var MAX_IMAGE_WIDTH = 2560;
  var JPEG_QUALITY = 0.85;

  /* Glass sliders. `glass` is a transparency step away from the theme's own
     strength, so light and dark keep their different bases (see
     js/theme-core.js). Measured across themes, modes and wallpapers, muted
     text holds 4.5:1 up to 40% and fails from 50%, so the slider warns above
     the last value that was verified rather than blocking it. */
  var GLASS = { max: 60, warnAt: 42, fallback: 22 };
  var BLUR = { max: 40, fallback: 14 };
  var ALLOWED_TYPES = ['image/svg+xml', 'image/jpeg', 'image/png'];

  var body = document.body;
  var darkToggle = document.getElementById('darkToggle');
  var animeToggle = document.getElementById('animeToggle');
  var wallpaperPreview = document.getElementById('wallpaperPreview');
  var wallpaperState = document.getElementById('wallpaperState');
  var wallpaperInput = document.getElementById('wallpaperInput');
  var wallpaperNote = document.getElementById('wallpaperNote');
  var glassAlpha = document.getElementById('glassAlpha');
  var glassAlphaValue = document.getElementById('glassAlphaValue');
  var glassBlur = document.getElementById('glassBlur');
  var glassBlurValue = document.getElementById('glassBlurValue');
  var glassWarning = document.getElementById('glassWarning');
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

  /* Dragging a slider fires a stream of input events. The page is updated on
     every one so the change is visible live, but storage is written on a
     trailing timer: chrome.storage.sync allows only ~120 writes a minute. */
  var glassWriteTimer = null;

  function onGlassInput() {
    var alpha = Number(glassAlpha.value);
    var blur = Number(glassBlur.value);

    glassAlphaValue.textContent = alpha + '%';
    glassBlurValue.textContent = blur + 'px';
    glassWarning.hidden = alpha < GLASS.warnAt;

    sendToTab({ type: 'setGlass', glass: alpha, glassBlur: blur });

    clearTimeout(glassWriteTimer);
    glassWriteTimer = setTimeout(function () {
      chrome.storage.sync.set({ glass: alpha, glassBlur: blur });
    }, 250);
  }

  function setGlass(alpha, blur) {
    glassAlpha.value = clampNumber(alpha, GLASS.max, GLASS.fallback);
    glassBlur.value = clampNumber(blur, BLUR.max, BLUR.fallback);
    glassAlphaValue.textContent = glassAlpha.value + '%';
    glassBlurValue.textContent = glassBlur.value + 'px';
    glassWarning.hidden = Number(glassAlpha.value) < GLASS.warnAt;
  }

  function clampNumber(value, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(0, Math.round(n)));
  }

  function showNote(text, isError) {
    wallpaperNote.textContent = text;
    wallpaperNote.classList.toggle('is-error', !!isError);
  }

  /* One pass over the image: shrink it if it is wider than the screen needs,
     and measure its average brightness, which decides how heavy a wash the
     page needs over it for text to stay readable. A data: URL never taints
     the canvas, so the pixels stay readable. */
  function prepareImage(dataUrl, isVector, done) {
    var img = new Image();

    img.onerror = function () {
      done({ image: dataUrl, tone: 'light', resized: false });
    };

    img.onload = function () {
      try {
        var width = img.naturalWidth || MAX_IMAGE_WIDTH;
        var height = img.naturalHeight || Math.round(MAX_IMAGE_WIDTH * 9 / 16);
        var scale = Math.min(1, MAX_IMAGE_WIDTH / width);

        // Brightness first, off a tiny draw: cheap and resolution-proof.
        var probe = document.createElement('canvas');
        probe.width = 32;
        probe.height = 32;
        var pctx = probe.getContext('2d');
        pctx.drawImage(img, 0, 0, 32, 32);
        var px = pctx.getImageData(0, 0, 32, 32).data;
        var sum = 0;
        for (var i = 0; i < px.length; i += 4) {
          sum += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        }
        var tone = sum / (px.length / 4) < 0.5 ? 'dark' : 'light';

        if (isVector || scale === 1) {
          done({ image: dataUrl, tone: tone, resized: false });
          return;
        }

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        done({ image: canvas.toDataURL('image/jpeg', JPEG_QUALITY), tone: tone, resized: true });
      } catch (e) {
        done({ image: dataUrl, tone: 'light', resized: false });
      }
    };

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

    showNote('Reading ' + file.name + '...', false);

    var reader = new FileReader();
    reader.onerror = function () { showNote('That image could not be read.', true); };
    reader.onload = function () {
      var isVector = file.type === 'image/svg+xml' || /\.svg$/.test(name);

      prepareImage(String(reader.result), isVector, function (result) {
        chrome.storage.local.set(
          { wallpaperImage: result.image, wallpaperTone: result.tone },
          function () {
            if (chrome.runtime.lastError) {
              showNote('There was not enough room to store that image. Try a smaller one.', true);
              return;
            }
            uploadPreview = result.image;
            selectWallpaper('custom', true);
            // Stored size is what matters, not the size on disk.
            var kb = Math.max(1, Math.round(result.image.length / 1024));
            showNote(file.name + ' - ' + kb + ' KB stored' +
              (result.resized ? ', resized to ' + MAX_IMAGE_WIDTH + 'px wide' : ''), false);
          }
        );
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

  chrome.storage.sync.get(['darkMode', 'lmsTheme', 'animeMode', 'wallpaper', 'glass', 'glassBlur'], function (result) {
    result = result || {};
    setDark(!!result.darkMode, false);
    // animeMode is on unless the user has turned it off.
    setAnime(result.animeMode === undefined ? DEFAULTS.animeMode : !!result.animeMode, false);
    selectTheme(result.lmsTheme || DEFAULT_THEME, false);
    selectWallpaper(result.wallpaper || DEFAULTS.wallpaper, false);
    setGlass(result.glass, result.glassBlur);
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
    showNote('SVG, JPEG or PNG. Click Upload, or drag an image here.', false);
  });

  document.getElementById('wallpaperNone').addEventListener('click', function () {
    selectWallpaper('none', true);
  });

  /* Opening the OS file dialog can close the popup on some systems, which
     kills the upload before the change event fires. Drag-and-drop and paste
     both avoid the dialog entirely, so either always works. */
  var dropZone = document.querySelector('.wallpaper-panel');

  ['dragenter', 'dragover'].forEach(function (type) {
    dropZone.addEventListener(type, function (event) {
      event.preventDefault();
      dropZone.classList.add('is-dropping');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(function (type) {
    dropZone.addEventListener(type, function () {
      dropZone.classList.remove('is-dropping');
    });
  });

  dropZone.addEventListener('drop', function (event) {
    event.preventDefault();
    var dropped = event.dataTransfer && event.dataTransfer.files;
    if (dropped && dropped.length) handleFile(dropped[0]);
  });

  document.addEventListener('paste', function (event) {
    var items = event.clipboardData && event.clipboardData.files;
    if (items && items.length) handleFile(items[0]);
  });

  glassAlpha.addEventListener('input', onGlassInput);
  glassBlur.addEventListener('input', onGlassInput);

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
    if (changes.glass || changes.glassBlur) {
      setGlass(
        changes.glass ? changes.glass.newValue : glassAlpha.value,
        changes.glassBlur ? changes.glassBlur.newValue : glassBlur.value
      );
    }
  });
})();
