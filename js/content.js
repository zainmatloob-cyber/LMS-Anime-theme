/* ============================================================
   LMS content script  (lms.bahria.edu.pk - AdminLTE 2)
   Theme/dark-mode state is handled by js/theme-core.js, which the
   manifest loads first. This file only holds the DOM tweaks that
   CSS alone cannot express.
   ============================================================ */
(function () {
  'use strict';

  var Theme = window.LmsTheme;

  /* ============================================================
     Initials avatar
     The LMS ships a generic person.png for everyone. We swap it for
     an SVG monogram tinted with the active theme colour.
     ============================================================ */

  var AVATAR_SELECTORS = [
    'img.user-image',
    'li.user-header img.img-circle',
    'img[src*="_viewfiles/images/person.png"]',
    'img[src*="/images/person.png"]'
  ].join(', ');

  function getDisplayName() {
    var selectors = [
      '.navbar-nav > .user-menu > a .hidden-xs',
      '.navbar-nav > .user-menu > a span',
      '.user-header > p'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;

      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // The dropdown variant reads "01-136242-004 ABDUR RAFAY" - drop the roll number.
      var cleaned = text.replace(/^\d[\d\-\s]+/, '').trim();
      if (cleaned) return cleaned;
    }

    return 'User';
  }

  function getInitials(name) {
    var words = (name || '')
      .replace(/[^A-Za-z\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return 'U';
  }

  function buildAvatarDataUri(initials, background, foreground) {
    var safe = (initials || 'U').slice(0, 2).toUpperCase();
    var svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
      '<rect width="128" height="128" rx="64" ry="64" fill="' + (background || '#1e3a8a') + '"/>',
      '<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"',
      ' font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="700"',
      ' fill="' + (foreground || '#ffffff') + '">',
      safe,
      '</text>',
      '</svg>'
    ].join('');

    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  // Rebuilding the SVG on every mutation is wasteful: the name never changes
  // and the colours only move on a theme switch. Cache on those inputs.
  var avatarCache = { key: null, src: '', initials: 'U' };

  function currentAvatar() {
    var styles = getComputedStyle(document.documentElement);
    var background = styles.getPropertyValue('--lms-primary').trim() || '#1e3a8a';
    var foreground = styles.getPropertyValue('--lms-on-primary').trim() || '#ffffff';
    var initials = getInitials(getDisplayName());
    var key = initials + '|' + background + '|' + foreground;

    if (avatarCache.key !== key) {
      avatarCache = {
        key: key,
        src: buildAvatarDataUri(initials, background, foreground),
        initials: initials
      };
    }

    return avatarCache;
  }

  function applyAvatar() {
    var avatar = currentAvatar();

    document.querySelectorAll(AVATAR_SELECTORS).forEach(function (img) {
      if (img.getAttribute('src') !== avatar.src) {
        img.setAttribute('src', avatar.src);
        img.setAttribute('alt', avatar.initials);
      }
    });
  }

  /* ============================================================
     Themed select menus
     The native <select> popup is drawn by the OS and ignores the
     theme entirely - a bright white list on a dark page. We mirror
     it with a styled listbox and keep the real select authoritative
     so the page's own onchange handlers still fire.
     ============================================================ */

  var TARGET_SELECTS = ['semesterId', 'courseId'];

  // Only one menu may be open at a time, across both selects.
  var openSelect = null;

  function closeOpenSelect() {
    if (openSelect) openSelect.close();
  }

  function initThemedSelects() {
    TARGET_SELECTS.forEach(function (id) {
      var select = document.getElementById(id);
      if (!select || select.dataset.lmsCustomSelect === '1') return;
      buildCustomSelect(select, id);
    });
  }

  function buildCustomSelect(select, id) {
    select.dataset.lmsCustomSelect = '1';
    select.classList.add('lms-native-select-hidden');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    var wrapper = document.createElement('div');
    wrapper.className = 'lms-custom-select';
    wrapper.dataset.selectId = id;

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lms-custom-select-trigger form-control';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var menu = document.createElement('ul');
    menu.className = 'lms-custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.dataset.lmsMenu = id;

    var isOpen = false;
    var activeIndex = -1;

    function syncTriggerLabel() {
      var selected = select.options[select.selectedIndex];
      trigger.textContent = selected ? selected.textContent.trim() : '';
    }

    function buildMenu() {
      menu.textContent = '';

      Array.prototype.forEach.call(select.options, function (option, index) {
        var item = document.createElement('li');
        item.className = 'lms-custom-select-option';
        item.setAttribute('role', 'option');
        item.textContent = option.textContent.trim();

        if (index === select.selectedIndex) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.setAttribute('aria-selected', 'false');
        }

        item.addEventListener('click', function () { commit(index); });
        item.addEventListener('mousemove', function () { setActive(index); });
        menu.appendChild(item);
      });
    }

    function setActive(index) {
      var items = menu.children;
      if (!items.length) return;

      activeIndex = Math.max(0, Math.min(index, items.length - 1));

      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('is-active', i === activeIndex);
      }

      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function commit(index) {
      if (index === select.selectedIndex) {
        close();
        return;
      }

      select.selectedIndex = index;
      syncTriggerLabel();
      buildMenu();
      close();
      // The LMS wires SelectSemester()/course handlers to the change event.
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // The menu is portalled to <body> so it escapes the overflow AdminLTE puts
    // on .box-header. That means we own its position.
    function position() {
      var rect = trigger.getBoundingClientRect();
      var spaceBelow = window.innerHeight - rect.bottom;
      var menuHeight = Math.min(menu.scrollHeight, 280);

      // Flip above the trigger when there is not enough room underneath.
      if (spaceBelow < menuHeight + 16 && rect.top > spaceBelow) {
        menu.style.top = Math.max(8, rect.top - menuHeight - 4) + 'px';
      } else {
        menu.style.top = (rect.bottom + 4) + 'px';
      }

      menu.style.left = rect.left + 'px';
      menu.style.minWidth = rect.width + 'px';
    }

    var onViewportChange = Theme.rafDebounce(function () {
      if (isOpen) position();
    });

    function open() {
      if (isOpen) return;
      closeOpenSelect();

      isOpen = true;
      openSelect = { close: close };

      document.body.appendChild(menu);
      position();
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      setActive(select.selectedIndex);

      // Scrolling repositions rather than closes: the LMS content area scrolls
      // independently of the window, so a fixed menu would visibly detach.
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);
    }

    function close() {
      if (!isOpen) return;

      isOpen = false;
      if (openSelect && openSelect.close === close) openSelect = null;

      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      if (menu.parentNode) menu.parentNode.removeChild(menu);

      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (isOpen) close(); else open();
    });

    trigger.addEventListener('keydown', function (event) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (isOpen) setActive(activeIndex + 1); else open();
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (isOpen) setActive(activeIndex - 1); else open();
          break;
        case 'Home':
          if (isOpen) { event.preventDefault(); setActive(0); }
          break;
        case 'End':
          if (isOpen) { event.preventDefault(); setActive(menu.children.length - 1); }
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (isOpen && activeIndex >= 0) commit(activeIndex); else open();
          break;
        case 'Escape':
          if (isOpen) { event.preventDefault(); close(); }
          break;
        case 'Tab':
          close();
          break;
      }
    });

    // Keep the mirror honest if the page changes the select itself.
    select.addEventListener('change', function () {
      syncTriggerLabel();
      buildMenu();
    });

    wrapper.appendChild(trigger);
    select.insertAdjacentElement('afterend', wrapper);

    syncTriggerLabel();
    buildMenu();
  }

  document.addEventListener('click', function (event) {
    if (!openSelect) return;
    if (event.target.closest('.lms-custom-select, .lms-custom-select-menu')) return;
    closeOpenSelect();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeOpenSelect();
  });

  /* ============================================================
     Sidebar Active State Fix
     LMS server HTML hardcodes `class="active"` on the Dashboard item
     even when viewing course pages (which add `class="li-highlight"` to
     the selected course link). We strip `active` from Dashboard when
     another menu item is highlighted/active.
     ============================================================ */

  function fixSidebarActiveState() {
    var menu = document.querySelector('.sidebar-menu');
    if (!menu) return;

    var items = menu.querySelectorAll(':scope > li');
    if (!items || items.length <= 1) return;

    var hasHighlightedCourse = false;
    for (var i = 1; i < items.length; i++) {
      var li = items[i];
      if (li.classList.contains('li-highlight') || li.classList.contains('active')) {
        hasHighlightedCourse = true;
        break;
      }
    }

    if (hasHighlightedCourse) {
      var dashboardLi = items[0];
      if (dashboardLi) {
        dashboardLi.classList.remove('active', 'li-highlight');
      }
    }
  }

  /* ============================================================
     Wiring
     ============================================================ */

  function refresh() {
    applyAvatar();
    initThemedSelects();
    fixSidebarActiveState();
  }

  Theme.onChange(applyAvatar);

  function boot() {
    refresh();

    // AdminLTE re-renders the avatar markup as the dropdown opens, so we watch
    // for it coming back. The observer suspends itself while our own writes
    // land, otherwise setting img.src would retrigger it forever.
    Theme.selfHealingObserver(
      document.body,
      { childList: true, subtree: true },
      refresh
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Catch anything the LMS swaps in after load without a mutation we observed.
  window.addEventListener('load', refresh);
})();
