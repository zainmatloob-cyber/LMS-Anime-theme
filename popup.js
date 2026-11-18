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
  var colorTargets = Array.prototype.slice.call(document.querySelectorAll('.color-target'));
  var colorWheel = document.getElementById('colorWheel');
  var wheelCanvas = document.getElementById('wheelCanvas');
  var wheelHandle = document.getElementById('wheelHandle');
  var shadeInput = document.getElementById('shadeInput');
  var shadeField = document.getElementById('shadeField');
  var hexInput = document.getElementById('hexInput');
  var accentAuto = document.getElementById('accentAuto');
  var previewCells = Array.prototype.slice.call(document.querySelectorAll('#palettePreview span'));
  var status = document.getElementById('status');
  var shortcutHint = document.getElementById('shortcutHint');

  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  var state = Settings.normalise({});
  var uploadImage = '';
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

  /* ---------- colour wheel ----------------------------------------------
     An HSV disc: angle is the hue, distance from the centre the strength,
     and the Shade slider the brightness. It edits one of the two saved
     colours at a time (`target`). The page palette is generated from both,
     and palette() shifts lightness where needed to keep text readable. */

  var target = 'main';
  var hsv = { h: 0, s: 0, v: 1 };
  var dragging = false;
  var wheelDrawnFor = -1;

  function hexToHsv(hex) {
    var rgb = Settings.hexToRgb(hex).map(function (c) { return c / 255; });
    var max = Math.max.apply(null, rgb);
    var min = Math.min.apply(null, rgb);
    var d = max - min;
    var h = 0;
    if (d) {
      if (max === rgb[0]) h = ((rgb[1] - rgb[2]) / d + 6) % 6;
      else if (max === rgb[1]) h = (rgb[2] - rgb[0]) / d + 2;
      else h = (rgb[0] - rgb[1]) / d + 4;
    }
    return { h: h * 60, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb(h, s, v) {
    function f(n) {
      var k = (n + h / 60) % 6;
      return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    }
    return [f(5), f(3), f(1)];
  }

  function hsvToHex(c) {
    return Settings.rgbToHex(hsvToRgb(c.h, c.s, c.v));
  }

  /* The colour a target stands for right now. An automatic highlight shows
     as the colour it currently resolves to. */
  function colorOf(name) {
    if (name === 'main') return state.themeColor;
    return state.accentColor || Settings.autoAccent(state.themeColor);
  }

  var baseCanvas = null;
  var baseSize = 0;

  function renderBaseWheel(size) {
    if (baseCanvas && baseSize === size) return baseCanvas;
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = baseCanvas.height = size;
    baseSize = size;

    var ctx = baseCanvas.getContext('2d');
    var image = ctx.createImageData(size, size);
    var data = image.data;
    var r = size / 2;

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = x + 0.5 - r;
        var dy = y + 0.5 - r;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r + 1) continue;
        var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        var rgb = hsvToRgb(hue, Math.min(1, dist / r), 1);
        var i = (y * size + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = Math.max(0, Math.min(1, r - dist + 0.5)) * 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return baseCanvas;
  }

  // The base disc is rendered once; changes in brightness overlay black via GPU compositing.
  function drawWheel() {
    var v = Math.round(hsv.v * 100);
    var ratio = window.devicePixelRatio || 1;
    var size = Math.round((colorWheel.clientWidth || 136) * ratio);

    if (v === wheelDrawnFor && wheelCanvas.width === size) return;
    wheelDrawnFor = v;

    if (wheelCanvas.width !== size || wheelCanvas.height !== size) {
      wheelCanvas.width = wheelCanvas.height = size;
    }

    var base = renderBaseWheel(size);
    var ctx = wheelCanvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(base, 0, 0);

    if (hsv.v < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(0, 0, 0, ' + (1 - hsv.v) + ')';
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    }
  }

  function paintWheel() {
    drawWheel();

    var r = (colorWheel.clientWidth || 136) / 2;
    var angle = hsv.h * Math.PI / 180;
    wheelHandle.style.left = (r + Math.cos(angle) * hsv.s * r) + 'px';
    wheelHandle.style.top = (r + Math.sin(angle) * hsv.s * r) + 'px';

    var hex = hsvToHex(hsv);
    wheelHandle.style.background = hex;
    colorWheel.setAttribute('aria-valuetext', hex.toUpperCase());

    shadeInput.value = Math.round(hsv.v * 100);
    var minHex = hsvToHex({ h: hsv.h, s: hsv.s, v: 0.15 });
    var maxHex = hsvToHex({ h: hsv.h, s: hsv.s, v: 1 });
    shadeInput.style.setProperty('--shade-track',
      'linear-gradient(90deg, ' + minHex + ', ' + maxHex + ')');

    if (document.activeElement !== hexInput) {
      hexInput.value = hex;
      hexInput.classList.remove('is-invalid');
    }
  }

  /* Follow the saved colour, unless it already matches what the wheel
     shows. Greys and black have no hue (and black no strength) of their
     own, so those keep the handle where it was instead of jumping to red. */
  function syncWheel() {
    var hex = colorOf(target);
    if (dragging || hsvToHex(hsv) === hex) return;
    var next = hexToHsv(hex);
    if (next.s === 0 || next.v === 0) next.h = hsv.h;
    if (next.v === 0) next.s = hsv.s;
    hsv = next;
  }

  /* chrome.storage.sync allows 120 writes a minute, so a drag writes at
     most every 700ms, plus once more when it ends. */
  var pendingWrite = null;
  var writeTimer = null;
  var lastWrite = 0;

  function writeColor(patch, now) {
    pendingWrite = patch;
    clearTimeout(writeTimer);
    var wait = now ? 0 : Math.max(0, 700 - (Date.now() - lastWrite));
    writeTimer = setTimeout(function () {
      lastWrite = Date.now();
      var p = pendingWrite;
      pendingWrite = null;
      if (p) chrome.storage.sync.set(p, checkActiveTab);
    }, wait);
  }

  function flushColor() {
    if (pendingWrite) writeColor(pendingWrite, true);
  }

  // The popup shows the colour at once; the write to storage may trail it.
  function setColor(hex, now) {
    if (target === 'main') state.themeColor = hex;
    else state.accentColor = hex;
    paint();
    writeColor(target === 'main' ? { themeColor: hex } : { accentColor: hex }, now);
  }

  function pickAt(event) {
    var box = colorWheel.getBoundingClientRect();
    var r = box.width / 2;
    var dx = event.clientX - box.left - r;
    var dy = event.clientY - box.top - r;
    hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    hsv.s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / r);
    liftShade();
    setColor(hsvToHex(hsv), false);
  }

  /* On a black wheel nothing would visibly change, so lift it until a pick
     shows. */
  function liftShade() {
    if (hsv.v < 0.15) hsv.v = 0.15;
  }

  function chooseTarget(name) {
    flushColor();
    target = name;
    hsv = hexToHsv(colorOf(target));
    paint();
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

    // The popup wears the active mode's main colour and highlight.
    var activePalette = Settings.palette(state.themeColor, state.accentColor, dark);
    var root = document.documentElement.style;
    root.setProperty('--popup-primary', activePalette['--lms-primary']);
    root.setProperty('--popup-accent', activePalette['--manga-pop']);
    root.setProperty('--popup-primary-rgb', activePalette['--lms-primary-rgb']);
    root.setProperty('--popup-pop', activePalette['--manga-pop']);

    // Colour picker.
    syncWheel();
    paintWheel();

    colorTargets.forEach(function (button) {
      var name = button.dataset.target;
      var on = name === target;
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      button.querySelector('.color-dot').style.background = colorOf(name);
      button.querySelector('.color-target-value').textContent =
        name === 'accent' && !state.accentColor ? 'Auto' : colorOf(name);
    });

    accentAuto.hidden = target !== 'accent';
    accentAuto.setAttribute('aria-pressed', state.accentColor ? 'false' : 'true');

    // Strip: sidebar, buttons, links, highlight, page - in the mode shown.
    var shown = activePalette;
    ['--lms-sidebar-bg', '--lms-primary', '--lms-link', '--manga-pop', '--lms-bg'].forEach(function (key, i) {
      previewCells[i].style.background = shown[key];
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

  renderWallpaperTiles();
  showNote(DEFAULT_NOTE, false);
  showShortcut();

  chrome.storage.sync.get(Settings.READ_KEYS, function (result) {
    state = Settings.normalise(result);
    hsv = hexToHsv(colorOf(target));

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

  /* ---------- colour events ---------- */

  colorTargets.forEach(function (button) {
    button.addEventListener('click', function () { chooseTarget(button.dataset.target); });
    button.addEventListener('keydown', function (event) {
      gridKeys(event, colorTargets, 2, function (el) { chooseTarget(el.dataset.target); });
    });
  });

  colorWheel.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    colorWheel.focus();
    colorWheel.setPointerCapture(event.pointerId);
    dragging = true;
    pickAt(event);
  });

  colorWheel.addEventListener('pointermove', function (event) {
    if (dragging) pickAt(event);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    flushColor();
  }
  colorWheel.addEventListener('pointerup', endDrag);
  colorWheel.addEventListener('pointercancel', endDrag);

  // Left/right turn the hue, up/down change the strength; Shift for bigger steps.
  colorWheel.addEventListener('keydown', function (event) {
    var step = event.shiftKey ? 15 : 5;
    switch (event.key) {
      case 'ArrowLeft':  hsv.h = (hsv.h - step + 360) % 360; break;
      case 'ArrowRight': hsv.h = (hsv.h + step) % 360; break;
      case 'ArrowUp':    hsv.s = Math.min(1, hsv.s + step / 100); break;
      case 'ArrowDown':  hsv.s = Math.max(0, hsv.s - step / 100); break;
      default: return;
    }
    event.preventDefault();
    liftShade();
    setColor(hsvToHex(hsv), false);
  });
  colorWheel.addEventListener('keyup', function (event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) !== -1) {
      flushColor();
    }
  });

  shadeInput.addEventListener('input', function () {
    hsv.v = Number(shadeInput.value) / 100;
    setColor(hsvToHex(hsv), false);
  });
  shadeInput.addEventListener('change', flushColor);

  function readHex(commit) {
    var hex = Settings.cleanHex(hexInput.value);
    hexInput.classList.toggle('is-invalid', !hex && commit);
    if (!hex) return;
    var next = hexToHsv(hex);
    if (next.s === 0) next.h = hsv.h;
    hsv = next;
    setColor(hex, commit);
  }

  // Six digits apply as they are typed; #abc shorthand on Enter or leaving.
  hexInput.addEventListener('input', function () {
    if (/^#?[0-9a-f]{6}$/i.test(hexInput.value.trim())) readHex(false);
  });
  hexInput.addEventListener('change', function () { readHex(true); });
  hexInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') readHex(true);
  });
  hexInput.addEventListener('blur', paintWheel);

  accentAuto.addEventListener('click', function () {
    flushColor();
    // Turning Auto off pins the colour it was showing, to fine-tune from there.
    save({ accentColor: state.accentColor ? '' : Settings.autoAccent(state.themeColor) });
  });

  document.getElementById('colorReset').addEventListener('click', function () {
    clearTimeout(writeTimer);
    pendingWrite = null;
    save({ themeColor: Settings.DEFAULT_COLOR, accentColor: '' });
  });

  // A drag or slider still waiting on its last write when the popup closes.
  window.addEventListener('pagehide', flushColor);

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
      // While the wheel or slider still has a write queued, the colour on
      // screen is newer than anything storage is echoing back.
      var busy = dragging || pendingWrite !== null;
      Settings.SYNC_KEYS.forEach(function (key) {
        if (busy && (key === 'themeColor' || key === 'accentColor')) return;
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
