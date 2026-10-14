/* ============================================================
   Wallpaper uploads, shared by the popup and the settings page.
   Exposes window.LmsWallpaperUpload.

   Accepts SVG, JPEG, PNG, WebP, AVIF, GIF, BMP and ICO. Everything a
   browser can decode is shown as-is when it is already small; the rest
   is redrawn to WebP, which keeps transparency (JPEG would not) and is
   about a third smaller than the PNG it often replaces.
   ============================================================ */
(function () {
  'use strict';

  /* What a user may pick. The upper bound is generous because large photos
     are shrunk before they are stored; this only rejects files that would
     take too long to decode in the popup. */
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  /* chrome.storage.local holds 10 MB in current Edge and Chrome (5 MB in
     older builds). A data: URL is a third bigger than its file, so anything
     kept as-is must stay under this. */
  var KEEP_AS_IS_BYTES = 3 * 1024 * 1024;

  // Nothing on screen needs more than this width.
  var MAX_IMAGE_WIDTH = 2560;
  var WEBP_QUALITY = 0.86;

  var FORMATS = [
    { label: 'SVG',  ext: ['svg'],                         mime: ['image/svg+xml'],                vector: true },
    { label: 'JPEG', ext: ['jpg', 'jpeg', 'jfif', 'pjpeg'], mime: ['image/jpeg', 'image/pjpeg'] },
    { label: 'PNG',  ext: ['png', 'apng'],                 mime: ['image/png', 'image/apng'] },
    { label: 'WebP', ext: ['webp'],                        mime: ['image/webp'] },
    { label: 'AVIF', ext: ['avif'],                        mime: ['image/avif'] },
    { label: 'GIF',  ext: ['gif'],                         mime: ['image/gif'],                    animated: true },
    // Uncompressed or icon formats: always worth re-encoding.
    { label: 'BMP',  ext: ['bmp', 'dib'],                  mime: ['image/bmp', 'image/x-ms-bmp'],  reencode: true },
    { label: 'ICO',  ext: ['ico', 'cur'],                  mime: ['image/x-icon', 'image/vnd.microsoft.icon'], reencode: true }
  ];

  // Formats people try that browsers cannot decode, with a useful answer.
  var UNSUPPORTED = [
    { ext: ['heic', 'heif'], mime: ['image/heic', 'image/heif'],
      message: 'HEIC photos (from iPhones) can\'t be read by the browser. Export it as JPEG first, or set the iPhone camera to "Most Compatible".' },
    { ext: ['tif', 'tiff'], mime: ['image/tiff'],
      message: 'TIFF images can\'t be read by the browser. Save it as PNG or JPEG first.' },
    { ext: ['psd', 'xcf', 'kra'], mime: [],
      message: 'That is an editor file. Export it as PNG or JPEG first.' },
    { ext: ['raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2'], mime: [],
      message: 'Camera RAW files can\'t be read by the browser. Export it as JPEG first.' }
  ];

  var ACCEPT = FORMATS.reduce(function (list, f) {
    return list.concat(f.mime, f.ext.map(function (e) { return '.' + e; }));
  }, []).join(',');

  var SUMMARY = FORMATS.map(function (f) { return f.label; }).join(', ');

  function extensionOf(name) {
    var match = /\.([a-z0-9]+)$/.exec((name || '').toLowerCase());
    return match ? match[1] : '';
  }

  /* Linux file managers often hand the browser an empty file.type for
     newer formats (AVIF, WebP on older shared-mime-info), so the extension
     is checked as well. */
  function match(list, file) {
    var ext = extensionOf(file.name);
    var type = (file.type || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i].mime.indexOf(type) !== -1 || list[i].ext.indexOf(ext) !== -1) return list[i];
    }
    return null;
  }

  function formatSize(bytes) {
    return bytes >= 1048576
      ? (bytes / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /* One pass over the image: measure its average brightness, which decides
     how heavy a wash the page needs over it, and redraw it when keeping the
     original would be wasteful. A data: URL never taints the canvas, so the
     pixels stay readable. */
  function prepareImage(dataUrl, file, format, done) {
    var img = new Image();

    img.onerror = function () {
      done({ error: 'That ' + format.label + ' file could not be decoded. It may be damaged.' });
    };

    img.onload = function () {
      try {
        var width = img.naturalWidth || MAX_IMAGE_WIDTH;
        var height = img.naturalHeight || Math.round(MAX_IMAGE_WIDTH * 9 / 16);
        var scale = Math.min(1, MAX_IMAGE_WIDTH / width);

        // Brightness first, off a tiny draw: cheap and resolution-proof.
        // Transparent pixels are skipped: they show the page colour, not ink.
        var probe = document.createElement('canvas');
        probe.width = 32;
        probe.height = 32;
        var pctx = probe.getContext('2d');
        pctx.drawImage(img, 0, 0, 32, 32);
        var px = pctx.getImageData(0, 0, 32, 32).data;
        var sum = 0;
        var weight = 0;
        for (var i = 0; i < px.length; i += 4) {
          var a = px[i + 3] / 255;
          sum += a * (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
          weight += a;
        }
        var tone = weight && sum / weight < 0.5 ? 'dark' : 'light';

        var small = file.size <= KEEP_AS_IS_BYTES;
        var keep = format.vector ||
          (!format.reencode && small && (scale === 1 || format.animated));

        if (keep) {
          done({ image: dataUrl, tone: tone, resized: false, flattened: false });
          return;
        }

        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        var out = canvas.toDataURL('image/webp', WEBP_QUALITY);
        // Very old builds silently fall back to PNG; JPEG is smaller then.
        if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', WEBP_QUALITY);

        done({
          image: out,
          tone: tone,
          resized: scale < 1,
          flattened: !!format.animated
        });
      } catch (e) {
        done({ error: 'That image could not be processed.' });
      }
    };

    img.src = dataUrl;
  }

  /* callbacks.status(text, isError) reports progress; callbacks.done(image)
     runs once the image is stored and the wallpaper switched to it. */
  function handleFile(file, callbacks) {
    var status = callbacks.status || function () {};
    if (!file) return;

    var bad = match(UNSUPPORTED, file);
    if (bad) {
      status(bad.message, true);
      return;
    }

    var format = match(FORMATS, file);
    if (!format) {
      status('That file type is not supported. Use ' + SUMMARY + '.', true);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      status('That image is ' + formatSize(file.size) + '. The limit is ' +
        formatSize(MAX_UPLOAD_BYTES) + '.', true);
      return;
    }

    status('Reading ' + file.name + '...', false);

    var reader = new FileReader();
    reader.onerror = function () { status('That image could not be read.', true); };
    reader.onload = function () {
      prepareImage(String(reader.result), file, format, function (result) {
        if (result.error) {
          status(result.error, true);
          return;
        }

        chrome.storage.local.set(
          { wallpaperImage: result.image, wallpaperTone: result.tone },
          function () {
            if (chrome.runtime.lastError) {
              status('There was not enough room to store that image. Try a smaller one.', true);
              return;
            }

            chrome.storage.sync.set({ wallpaper: 'custom' });

            // Stored size is what matters, not the size on disk.
            var notes = [];
            if (result.resized) notes.push('resized to ' + MAX_IMAGE_WIDTH + 'px wide');
            if (result.flattened) notes.push('too big to keep animated, so only the first frame is used');
            status(file.name + ' - ' + formatSize(result.image.length * 0.75) + ' stored' +
              (notes.length ? ', ' + notes.join(', ') : ''), false);

            if (callbacks.done) callbacks.done(result.image);
          }
        );
      });
    };
    reader.readAsDataURL(file);
  }

  /* Deletes the uploaded image. If it was showing, the built-in wallpaper
     takes its place. */
  function remove(done) {
    chrome.storage.local.remove(['wallpaperImage', 'wallpaperTone'], function () {
      chrome.storage.sync.get(['wallpaper'], function (result) {
        if (result && result.wallpaper === 'custom') {
          chrome.storage.sync.set({ wallpaper: 'default' });
        }
        if (done) done();
      });
    });
  }

  window.LmsWallpaperUpload = {
    ACCEPT: ACCEPT,
    SUMMARY: SUMMARY,
    handleFile: handleFile,
    remove: remove
  };
})();
