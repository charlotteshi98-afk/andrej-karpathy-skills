/* Open the side panel when the toolbar icon is clicked. */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

/* Fetch Google Sheet CSV on behalf of the side panel.
   The panel page is blocked by CORS when fetching docs.google.com directly;
   the service worker can use host_permissions without CORS. */
/* Call the Claude-compatible endpoint from the service worker.
   Company gateways rarely send CORS headers for extension origins, and the
   worker's host_permissions bypass CORS entirely. */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'callClaude') return;
  (async () => {
    try {
      const method = msg.method || 'POST';
      const resp = await fetch(msg.url, {
        method,
        headers: msg.headers,
        ...(method === 'GET' ? {} : { body: JSON.stringify(msg.body) }),
      });
      const text = await resp.text();
      sendResponse({ ok: resp.ok, status: resp.status, text });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'fetchSheetCsv') return;
  (async () => {
    try {
      const resp = await fetch(msg.url, { credentials: 'include' });
      if (!resp.ok) {
        sendResponse({ ok: false, status: resp.status });
        return;
      }
      const text = await resp.text();
      // A login redirect returns an HTML page instead of CSV
      if (/^\s*<(!DOCTYPE|html)/i.test(text)) {
        sendResponse({ ok: false, status: 401 });
        return;
      }
      sendResponse({ ok: true, text });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
