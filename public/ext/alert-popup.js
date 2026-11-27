const $ = id => document.getElementById(id);
chrome.storage.sync.get({ enabled: false, duration: 30, refresh: 0 }, s => {
  $("enabled").checked = s.enabled;
  $("duration").value = String(s.duration);
  $("refresh").value = String(s.refresh);
});
function save() {
  chrome.storage.sync.set({
    enabled: $("enabled").checked,
    duration: +$("duration").value,
    refresh: +$("refresh").value
  });
}
["enabled", "duration", "refresh"].forEach(id => $(id).addEventListener("change", save));
$("test").onclick = () => chrome.runtime.sendMessage({ type: "tp-alert-start", seconds: 5 });
$("stop").onclick = () => chrome.runtime.sendMessage({ type: "tp-alert-stop" });

// Upgrade page opens in a normal tab (a popup would close when the folder picker opens).
$("upgrade").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("upgrade.html") }));
