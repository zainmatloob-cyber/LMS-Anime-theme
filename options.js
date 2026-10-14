/* ============================================================
   Settings page (opens in a tab).
   Holds the things a popup cannot do reliably: picking a file on
   Linux, saving a backup file, and reading one back.
   ============================================================ */
(function () {
  'use strict';

  var Settings = window.LmsSettings;
  var Upload = window.LmsWallpaperUpload;

  var BACKUP_APP = 'bahria-lms-redesign';
  var MAX_BACKUP_BYTES = 40 * 1024 * 1024;

  var body = document.body;
  var dropzone = document.getElementById('dropzone');
  var uploadPreview = document.getElementById('uploadPreview');
  var uploadInput = document.getElementById('uploadInput');
  var uploadRemove = document.getElementById('uploadRemove');
  var uploadNote = document.getElementById('uploadNote');
  var exportImage = document.getElementById('exportImage');
  var importInput = document.getElementById('importInput');
  var backupNote = document.getElementById('backupNote');
  var shortcutText = document.getElementById('shortcutText');

  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  var state = Settings.normalise({});
  var uploadImage = '';

  uploadInput.accept = Upload.ACCEPT;
  document.getElementById('uploadFormats').textContent = Upload.SUMMARY + '. Large photos are shrunk to 2560px wide.';

  /* ---------- painting ---------------------------------------------------- */

  function paint() {
    var theme = Settings.THEMES.filter(function (t) { return t.id === state.lmsTheme; })[0] || Settings.THEMES[0];
    var root = document.documentElement.style;
    root.setProperty('--accent', theme.from);
    root.setProperty('--accent-2', theme.to);
    root.setProperty('--accent-rgb', theme.rgb);

    body.classList.toggle('dark', state.darkAuto ? systemDark.matches : state.darkMode);

    uploadPreview.style.backgroundImage = uploadImage ? 'url("' + uploadImage + '")' : '';
    uploadPreview.style.backgroundSize = state.wallpaperFit;
    uploadPreview.style.backgroundPosition = state.wallpaperPos;
    uploadPreview.classList.toggle('is-empty', !uploadImage);
    uploadRemove.disabled = !uploadImage;
  }

  function note(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }

  function load() {
    chrome.storage.sync.get(Settings.SYNC_KEYS, function (sync) {
      state = Settings.normalise(sync);
      chrome.storage.local.get(['wallpaperImage'], function (local) {
        uploadImage = local && typeof local.wallpaperImage === 'string' ? local.wallpaperImage : '';
        paint();
        requestAnimationFrame(function () { body.classList.remove('is-loading'); });
      });
    });
  }

  /* ---------- wallpaper upload ------------------------------------------- */

  function handleFile(file) {
    Upload.handleFile(file, {
      status: function (text, isError) { note(uploadNote, text, isError); },
      done: function (image) {
        uploadImage = image;
        paint();
      }
    });
  }

  uploadInput.addEventListener('change', function () {
    handleFile(uploadInput.files && uploadInput.files[0]);
    uploadInput.value = '';
  });

  uploadRemove.addEventListener('click', function () {
    Upload.remove(function () {
      uploadImage = '';
      paint();
      note(uploadNote, 'Your image was deleted. The built-in wallpaper is showing instead.', false);
    });
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.add('is-dropping');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      if (type === 'dragleave' && dropzone.contains(event.relatedTarget)) return;
      dropzone.classList.remove('is-dropping');
    });
  });

  dropzone.addEventListener('drop', function (event) {
    event.preventDefault();
    var files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) handleFile(files[0]);
  });

  document.addEventListener('paste', function (event) {
    var files = event.clipboardData && event.clipboardData.files;
    if (files && files.length) handleFile(files[0]);
  });

  /* ---------- backup ------------------------------------------------------ */

  document.getElementById('exportBtn').addEventListener('click', function () {
    chrome.storage.sync.get(Settings.SYNC_KEYS, function (sync) {
      chrome.storage.local.get(Settings.LOCAL_KEYS, function (local) {
        var backup = {
          app: BACKUP_APP,
          version: chrome.runtime.getManifest().version,
          exported: new Date().toISOString(),
          settings: Settings.normalise(sync),
          wallpaper: exportImage.checked && local && local.wallpaperImage
            ? { image: local.wallpaperImage, tone: local.wallpaperTone === 'dark' ? 'dark' : 'light' }
            : null
        };

        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'lms-redesign-backup-' + backup.exported.slice(0, 10) + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

        note(backupNote, 'Backup saved' + (backup.wallpaper ? ' with your image.' : '.'), false);
      });
    });
  });

  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;

    if (file.size > MAX_BACKUP_BYTES) {
      note(backupNote, 'That file is too big to be a backup from this extension.', true);
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () { note(backupNote, 'That file could not be read.', true); };
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        note(backupNote, 'That is not a backup file (it isn\'t valid JSON).', true);
        return;
      }

      if (!data || data.app !== BACKUP_APP || typeof data.settings !== 'object') {
        note(backupNote, 'That JSON file is not a backup from this extension.', true);
        return;
      }

      // normalise() drops anything unknown and repairs bad values, so a
      // hand-edited or older backup can't put the extension in a bad state.
      var settings = Settings.normalise(data.settings);
      var image = data.wallpaper && typeof data.wallpaper.image === 'string' &&
        /^data:image\/[a-z0-9.+-]+[;,]/i.test(data.wallpaper.image) ? data.wallpaper.image : '';

      function applySettings() {
        chrome.storage.sync.set(settings, function () {
          if (chrome.runtime.lastError) {
            note(backupNote, 'The settings could not be saved: ' + chrome.runtime.lastError.message, true);
            return;
          }
          note(backupNote, 'Settings restored' + (image ? ' with the image' : '') + '.', false);
          load();
        });
      }

      if (!image) {
        applySettings();
        return;
      }

      chrome.storage.local.set({
        wallpaperImage: image,
        wallpaperTone: data.wallpaper.tone === 'dark' ? 'dark' : 'light'
      }, function () {
        if (chrome.runtime.lastError) {
          // Keep the rest of the backup even if the image doesn't fit.
          image = '';
          if (settings.wallpaper === 'custom') settings.wallpaper = 'default';
        }
        applySettings();
      });
    };
    reader.readAsText(file);
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    if (!window.confirm('Reset theme, colour mode and wallpaper settings to their defaults? Your uploaded image is kept.')) return;

    chrome.storage.sync.remove(Settings.SYNC_KEYS, function () {
      note(backupNote, 'Settings reset to defaults.', false);
      load();
    });
  });

  /* ---------- shortcut ---------------------------------------------------- */

  function showShortcut() {
    // Undefined until the browser reloads a manifest that declares "commands".
    if (!chrome.commands || !chrome.commands.getAll) {
      shortcutText.textContent = 'Reload the extension at edge://extensions to enable the dark-mode shortcut.';
      return;
    }
    chrome.commands.getAll(function (commands) {
      var command = (commands || []).filter(function (c) { return c.name === 'toggle-dark-mode'; })[0];
      shortcutText.textContent = command && command.shortcut
        ? 'Press ' + command.shortcut + ' on any page to switch between light and dark.'
        : 'No shortcut is set for switching dark mode. The default (Alt+Shift+D) may clash with another extension.';
    });
  }

  // Extension pages may open the browser's own shortcuts page; plain links
  // to edge:// or chrome:// URLs are blocked.
  document.getElementById('shortcutBtn').addEventListener('click', function () {
    var scheme = /\bEdg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
    chrome.tabs.create({ url: scheme + '://extensions/shortcuts' });
  });

  /* ---------- boot -------------------------------------------------------- */

  load();
  showShortcut();
  window.addEventListener('focus', showShortcut);

  systemDark.addEventListener('change', paint);

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync') {
      Settings.SYNC_KEYS.forEach(function (key) {
        if (changes[key]) state[key] = changes[key].newValue;
      });
      state = Settings.normalise(state);
      paint();
    }
    if (area === 'local' && changes.wallpaperImage) {
      uploadImage = changes.wallpaperImage.newValue || '';
      paint();
    }
  });
})();
