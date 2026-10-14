/* ============================================================
   Background service worker.
   Only job: the keyboard shortcut (Alt+Shift+D by default, change it
   at edge://extensions/shortcuts) that flips dark mode without
   opening the popup.
   ============================================================ */

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-dark-mode') return;

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];

    // An LMS/CMS tab knows what it is actually showing (including "Auto"
    // resolving against the OS), so let it decide and write the setting.
    if (tab && tab.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, { type: 'toggleDarkShortcut' }, function () {
        if (chrome.runtime.lastError) toggleFromStorage();
      });
    } else {
      toggleFromStorage();
    }
  });
});

/* Any other tab: flip the stored value. A worker has no matchMedia, so with
   "Auto" on this flips relative to the last manual choice. */
function toggleFromStorage() {
  chrome.storage.sync.get(['darkMode'], function (result) {
    chrome.storage.sync.set({ darkMode: !(result && result.darkMode), darkAuto: false });
  });
}
