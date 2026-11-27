// TopPay Audit Alert - service-worker part (loaded via importScripts from background.js).
(function () {
  async function ensureOffscreen() {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (ctxs.length) return;
    await chrome.offscreen.createDocument({
      url: "alert-offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play alert beep when new audit data arrives"
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.target === "offscreen") return;
    if (msg.type === "tp-alert-start") {
      ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ target: "offscreen", type: "start", seconds: msg.seconds }))
        .catch(() => {});
    } else if (msg.type === "tp-alert-stop") {
      chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
    }
  });

  // Keep background tabs ticking (Chrome throttles timers in hidden tabs)
  function tick() {
    chrome.runtime.getPlatformInfo(() => {});
    chrome.tabs.query({ url: ["https://web.toppaybd.com/*", "http://web.toppaybd.com/*"] }, (tabs) => {
      (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type: "tp-alert-tick" }).catch(() => {}));
    });
  }
  setInterval(tick, 10000);

  function setupAlarm() {
    chrome.alarms.get("tp-alert-wake", (a) => {
      if (!a) chrome.alarms.create("tp-alert-wake", { periodInMinutes: 0.5 });
    });
  }
  chrome.runtime.onInstalled.addListener(setupAlarm);
  chrome.runtime.onStartup.addListener(setupAlarm);
  setupAlarm();
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tp-alert-wake") tick(); });
})();
