/* ============================================================
   Popup logic
   Writes settings to chrome.storage.sync. The content scripts listen
   for storage changes, so every open LMS/CMS tab updates live; the
   popup only pings the active tab to say whether it is themed.
   ============================================================ */
(function () {
  'use strict';

  var Settings = window.LmsSettings;
  var Upload = window.LmsWallpaperUpload;

  // The theme list (swatch colours included) lives in js/settings.js.
  var THEMES = Settings.THEMES;

  var DEFAULT_NOTE = Upload.SUMMARY + '. Drag an image here, or paste one.';

  var body = document.body;
  var schemeButtons = Array.prototype.slice.call(document.querySelectorAll('#schemeControl [data-scheme]'));
  var schemeDesc = document.getElementById('schemeDesc');
  var animeToggle = document.getElementById('animeToggle');
  var wallpaperGrid = document.getElementById('wallpaperGrid');
  var wallpaperInput = document.getElementById('wallpaperInput');
  var wallpaperFit = document.getElementById('wallpaperFit');
  var wallpaperPos = document.getElementById('wallpaperPos');
  var wallpaperNote = document.getElementById('wallpaperNote');
  var wallpaperSection = document.getElementById('wallpaperSection');
  var wallpaperHint = document.getElementById('wallpaperHint');
  var themeGrid = document.getElementById('themeGrid');
  var status = document.getElementById('status');
  var shortcutHint = document.getElementById('shortcutHint');

  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  var state = Settings.normalise({});
  var uploadImage = '';
  var swatches = [];
  var wallTiles = [];

  /* On Linux the native file dialog steals focus from the popup, which
     closes it and throws the chosen file away before it can be read. There
     the Upload button opens the settings page in a tab instead. */
  var pickerClosesPopup = false;
  chrome.runtime.getPlatformInfo(function (info) {
    pickerClosesPopup = !!info && (info.os === 'linux' || info.os === 'openbsd');
  });

  wallpaperInput.accept = Upload.ACCEPT;

  /* ---------- building ---------------------------------------------------- */

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
      button.addEventListener('click', function () { save({ lmsTheme: theme.id }); });
      button.addEventListener('keydown', function (event) {
        gridKeys(event, swatches, 4, function (el) { save({ lmsTheme: el.dataset.theme }); });
      });

      fragment.appendChild(button);
    });

    themeGrid.appendChild(fragment);
    swatches = Array.prototype.slice.call(themeGrid.children);
  }

  /* Tiles: None, each built-in wallpaper, then the upload slot. Each tile
     carries the settings it stands for in data attributes. */
  function renderWallpaperTiles() {
    var fragment = document.createDocumentFragment();

    function tile(key, label, image) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'wall-tile';
      button.dataset.key = key;
      button.title = label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-label', label);
      if (image) button.style.backgroundImage = 'url("' + image + '")';

      var tick = document.createElement('span');
      tick.className = 'wall-tick';
      tick.setAttribute('aria-hidden', 'true');
      button.appendChild(tick);

      button.addEventListener('click', function () { chooseTile(key); });
      button.addEventListener('keydown', function (event) {
        gridKeys(event, wallTiles, 3, function (el) { chooseTile(el.dataset.key); });
      });
      fragment.appendChild(button);
      return button;
    }

    tile('none', 'No wallpaper').classList.add('wall-tile--none');

    Settings.WALLPAPERS.forEach(function (art) {
      tile('art:' + art.id, art.name, Settings.wallpaperPath(art.id));
    });

    var custom = tile('custom', 'Your image');
    custom.classList.add('wall-tile--custom');

    var remove = document.createElement('span');
    remove.className = 'wall-remove';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', 'Delete your image');
    remove.title = 'Delete your image';
    remove.textContent = '×';
    function deleteUpload() {
      Upload.remove(function () {
        uploadImage = '';
        showNote('Your image was deleted.', false);
        paint();
      });
    }

    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteUpload();
    });
    custom.appendChild(remove);

    // Keyboard equivalent of the hover-only delete button.
    custom.addEventListener('keydown', function (event) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && uploadImage) {
        event.preventDefault();
        deleteUpload();
      }
    });

    wallpaperGrid.appendChild(fragment);
    wallTiles = Array.prototype.slice.call(wallpaperGrid.children);
  }

  /* Arrow keys walk a grid, matching how a radio group is expected to
     behave. Only the selected item stays in the tab order. */
  function gridKeys(event, items, columns, pick) {
    var index = items.indexOf(event.currentTarget);
    var next;

    switch (event.key) {
      case 'ArrowRight': next = index + 1; break;
      case 'ArrowLeft':  next = index - 1; break;
      case 'ArrowDown':  next = index + columns; break;
      case 'ArrowUp':    next = index - columns; break;
      case 'Home':       next = 0; break;
      case 'End':        next = items.length - 1; break;
      default: return;
    }

    // Down from a column the short last row doesn't reach lands on its end.
    if (event.key === 'ArrowDown' && next >= items.length && index < items.length - 1) {
      next = items.length - 1;
    }
    if (next < 0 || next >= items.length) return;

    event.preventDefault();
    items[next].focus();
    pick(items[next]);
  }

  /* ---------- actions ----------------------------------------------------- */

  function save(patch) {
    Object.keys(patch).forEach(function (key) { state[key] = patch[key]; });
    state = Settings.normalise(state);
    paint();
    chrome.storage.sync.set(patch, checkActiveTab);
  }

  function chooseTile(key) {
    if (key === 'none') {
      save({ wallpaper: 'none' });
    } else if (key === 'custom') {
      if (uploadImage) save({ wallpaper: 'custom' });
      else openPicker();
    } else {
      save({ wallpaper: 'default', wallpaperId: key.slice(4) });
    }
  }

  function openPicker() {
    if (pickerClosesPopup) {
      openSettingsPage('wallpaper');
      return;
    }
    wallpaperInput.click();
  }

  function openSettingsPage(section) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html' + (section ? '#' + section : '')) });
    window.close();
  }

  function handleFile(file) {
    Upload.handleFile(file, {
      status: showNote,
      done: function (image) {
        uploadImage = image;
        state.wallpaper = 'custom';
        paint();
        checkActiveTab();
      }
    });
  }

  /* ---------- painting ---------------------------------------------------- */

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  function schemeOf(s) {
    return s.darkAuto ? 'auto' : s.darkMode ? 'dark' : 'light';
  }

  function paint() {
    // Colour mode. The popup previews what the page shows, so with Auto it
    // follows the OS too.
    var scheme = schemeOf(state);
    var dark = state.darkAuto ? systemDark.matches : state.darkMode;
    body.classList.toggle('dark', dark);
    schemeButtons.forEach(function (button) {
      var on = button.dataset.scheme === scheme;
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
    });
    schemeDesc.textContent = scheme === 'auto'
      ? 'Following your system (' + (dark ? 'dark' : 'light') + ')'
      : 'Auto follows your system';

    // Theme accent.
    var theme = themeById(state.lmsTheme);
    var root = document.documentElement.style;
    root.setProperty('--popup-primary', theme.from);
    root.setProperty('--popup-accent', theme.to);
    root.setProperty('--popup-primary-rgb', theme.rgb);
    root.setProperty('--popup-pop', theme.to);

    swatches.forEach(function (swatch) {
      var on = swatch.dataset.theme === state.lmsTheme;
      swatch.setAttribute('aria-checked', on ? 'true' : 'false');
      swatch.tabIndex = on ? 0 : -1;
    });

    // Anime style. The wallpaper choice stays editable while it is off.
    animeToggle.checked = state.animeMode;
    body.classList.toggle('manga', state.animeMode);
    wallpaperSection.classList.toggle('is-inactive', !state.animeMode);
    wallpaperHint.hidden = state.animeMode;

    // Wallpaper. 'custom' with no image on this device shows the built-in,
    // exactly as theme-core.js does.
    var mode = state.wallpaper === 'custom' && !uploadImage ? 'default' : state.wallpaper;
    var current = mode === 'none' ? 'none' : mode === 'custom' ? 'custom' : 'art:' + state.wallpaperId;

    wallTiles.forEach(function (tile) {
      var on = tile.dataset.key === current;
      tile.setAttribute('aria-checked', on ? 'true' : 'false');
      tile.tabIndex = on ? 0 : -1;
      tile.style.backgroundSize = state.wallpaperFit;
      tile.style.backgroundPosition = state.wallpaperPos;
    });

    var custom = wallpaperGrid.querySelector('.wall-tile--custom');
    if (custom) {
      custom.style.backgroundImage = uploadImage ? 'url("' + uploadImage + '")' : '';
      custom.classList.toggle('is-empty', !uploadImage);
      custom.title = uploadImage ? 'Your image (Delete key removes it)' : 'Upload your own image';
    }

    wallpaperFit.value = state.wallpaperFit;
    wallpaperPos.value = state.wallpaperPos;
    wallpaperFit.disabled = wallpaperPos.disabled = mode === 'none';
  }

  function showNote(text, isError) {
    wallpaperNote.textContent = text;
    wallpaperNote.classList.toggle('is-error', !!isError);
  }

  /* ---------- active tab ---------------------------------------------------
     The popup opens on any tab, including ones with no content script.
     Reading lastError inside the callback is what stops the browser logging
     an unchecked runtime error every time. */

  function checkActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) return;

      chrome.tabs.sendMessage(tab.id, { type: 'ping' }, function () {
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

  /* chrome.commands only exists once the browser has loaded a manifest that
     declares "commands"; until the extension is reloaded after an update it
     is undefined, and a throw here would stop the popup booting. */
  function showShortcut() {
    if (!chrome.commands || !chrome.commands.getAll) return;
    chrome.commands.getAll(function (commands) {
      var command = (commands || []).filter(function (c) { return c.name === 'toggle-dark-mode'; })[0];
      shortcutHint.textContent = command && command.shortcut
        ? command.shortcut + ' flips dark mode'
        : '';
    });
  }

  /* ---------- boot ------------------------------------------------------- */

  renderSwatches();
  renderWallpaperTiles();
  showNote(DEFAULT_NOTE, false);
  showShortcut();

  chrome.storage.sync.get(Settings.SYNC_KEYS, function (result) {
    state = Settings.normalise(result);

    chrome.storage.local.get(['wallpaperImage'], function (local) {
      uploadImage = !chrome.runtime.lastError && local && typeof local.wallpaperImage === 'string'
        ? local.wallpaperImage : '';
      paint();

      // Drop the transition freeze once the saved state is on screen.
      requestAnimationFrame(function () {
        body.classList.remove('is-loading');
      });
    });
  });

  /* ---------- events ------------------------------------------------------ */

  schemeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var scheme = button.dataset.scheme;
      if (scheme === 'auto') save({ darkAuto: true });
      else save({ darkAuto: false, darkMode: scheme === 'dark' });
    });
    button.addEventListener('keydown', function (event) {
      gridKeys(event, schemeButtons, 3, function (el) { el.click(); });
    });
  });

  systemDark.addEventListener('change', function () {
    if (state.darkAuto) paint();
  });

  animeToggle.addEventListener('change', function () {
    save({ animeMode: animeToggle.checked });
  });

  wallpaperFit.addEventListener('change', function () {
    save({ wallpaperFit: wallpaperFit.value });
  });

  wallpaperPos.addEventListener('change', function () {
    save({ wallpaperPos: wallpaperPos.value });
  });

  document.getElementById('wallpaperUpload').addEventListener('click', openPicker);

  document.getElementById('openSettings').addEventListener('click', function () {
    openSettingsPage('');
  });

  wallpaperInput.addEventListener('change', function () {
    handleFile(wallpaperInput.files && wallpaperInput.files[0]);
    // Reset so picking the same file twice still fires a change event.
    wallpaperInput.value = '';
  });

  /* Drag-and-drop and paste skip the file dialog entirely, so both work
     everywhere, Linux included. */
  ['dragenter', 'dragover'].forEach(function (type) {
    wallpaperSection.addEventListener(type, function (event) {
      event.preventDefault();
      wallpaperSection.classList.add('is-dropping');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(function (type) {
    wallpaperSection.addEventListener(type, function (event) {
      if (type === 'dragleave' && wallpaperSection.contains(event.relatedTarget)) return;
      wallpaperSection.classList.remove('is-dropping');
    });
  });

  wallpaperSection.addEventListener('drop', function (event) {
    event.preventDefault();
    var dropped = event.dataTransfer && event.dataTransfer.files;
    if (dropped && dropped.length) handleFile(dropped[0]);
  });

  document.addEventListener('paste', function (event) {
    var items = event.clipboardData && event.clipboardData.files;
    if (items && items.length) handleFile(items[0]);
  });

  /* The keyboard shortcut and the settings page write storage while the
     popup may be open; keep it honest. */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync') {
      var patch = {};
      Settings.SYNC_KEYS.forEach(function (key) {
        if (changes[key]) patch[key] = changes[key].newValue;
      });
      Object.keys(patch).forEach(function (key) { state[key] = patch[key]; });
      state = Settings.normalise(state);
      paint();
    }
    if (area === 'local' && changes.wallpaperImage) {
      uploadImage = changes.wallpaperImage.newValue || '';
      paint();
    }
  });
})();
