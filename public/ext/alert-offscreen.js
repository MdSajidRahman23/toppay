let ctx = null, beepTimer = null, stopTimer = null;

function beepOnce() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const t = ctx.currentTime;
  [0, 0.25].forEach(off => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.3, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t + off);
    o.stop(t + off + 0.2);
  });
}

function stop() {
  clearInterval(beepTimer);
  clearTimeout(stopTimer);
  beepTimer = stopTimer = null;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start") {
    stop();
    beepOnce();
    beepTimer = setInterval(beepOnce, 900);
    stopTimer = setTimeout(stop, msg.seconds * 1000);
  } else if (msg.type === "stop") {
    stop();
  }
});
