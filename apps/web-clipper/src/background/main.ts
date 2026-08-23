// F207 — seed the server URL only. A token must NEVER be baked into the
// extension: this file used to ship a real full-access Trail key, and this
// repo is public, so it was a published credential for four months. The token
// is entered once in the popup's settings and lives in chrome.storage.local
// on the user's own machine.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ serverUrl: 'https://app.trailmem.com' })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getConfig') {
    chrome.storage.local.get(['serverUrl', 'token'], (result) => {
      sendResponse(result)
    })
    return true
  }

  if (message.action === 'setConfig') {
    chrome.storage.local.set(message.config, () => {
      sendResponse({ ok: true })
    })
    return true
  }
})
