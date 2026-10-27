const SOUNDS = {
  confirmProperty: "/sound/vrbo/confirm-property.wav",
  sendProperty: "/sound/vrbo/send-property.wav",
  tapProperty: "/sound/vrbo/tap-property.wav",
  tapAmenity: "/sound/vrbo/tap-amenity.wav",
  tapSearch: "/sound/vrbo/tap-search.wav",
  propertyText: "/sound/vrbo/property-text.wav",
  textAppear: "/sound/vrbo/text-appear.wav",
};

const clips = new Map();
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("vrbo-sfx") : null;
const claimed = new Set();
const suppressUntil = new Map();

channel?.addEventListener("message", (event) => {
  if (event.data?.type === "played" && event.data.key) claimed.add(event.data.key);
  if (event.data?.type === "suppress" && Array.isArray(event.data.ids)) {
    holdSuppress(event.data.ids, event.data.until);
  }
});

function holdSuppress(ids, until) {
  ids.forEach((id) => {
    suppressUntil.set(id, Math.max(suppressUntil.get(id) || 0, until));
  });
}

function isSuppressed(id) {
  return (suppressUntil.get(id) || 0) > Date.now();
}

/** Mute the automatic sounds that follow this interaction. */
function suppressFollowups(ids, ms) {
  const until = Date.now() + ms;
  holdSuppress(ids, until);
  channel?.postMessage({ type: "suppress", ids, until });
}

/**
 * Playback uses the Web Audio API: every file is decoded once up front and held in memory,
 * so a tap starts the sound right away (an <audio> element has a slow, uneven start on iPhone).
 * If a buffer isn't ready yet (or Web Audio is unavailable) we fall back to an <audio> element.
 */

/** Seconds of dead air at the start of a file to skip (so the files don't need re-exporting). */
const START_OFFSET_S = {
  // tap-amenity.wav is silent for its first ~56 ms and the click starts at ~60 ms.
  // Skipping 36 ms leaves ~24 ms of natural lead-in before the click (56 = no gap at all).
  tapAmenity: 0.036,
};

/**
 * Per-sound loudness multiplier (Web Audio gain; 1 = file as recorded).
 * Search button + "send property to group chat" both play tapSearch.
 */
const GAIN = {
  tapSearch: 2,
  confirmProperty: 2,
  sendProperty: 2,
};

let ctx = null;
const buffers = new Map();
const loading = new Map();
const playing = new Map();

function getContext() {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

function decode(context, data) {
  // Older Safari only has the callback form of decodeAudioData.
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(data, resolve, reject);
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
}

function loadBuffer(id) {
  if (buffers.has(id)) return Promise.resolve(buffers.get(id));
  if (loading.has(id)) return loading.get(id);
  const src = SOUNDS[id];
  const context = getContext();
  if (!src || !context) return Promise.resolve(null);

  const promise = fetch(src)
    .then((response) => response.arrayBuffer())
    .then((data) => decode(context, data))
    .then((buffer) => {
      buffers.set(id, buffer);
      return buffer;
    })
    .catch(() => null)
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}

function clip(id) {
  const src = SOUNDS[id];
  if (!src) return null;
  let audio = clips.get(id);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    clips.set(id, audio);
  }
  return audio;
}

function startWithAudioElement(id) {
  const audio = clip(id);
  if (!audio) return;
  audio.volume = 1;
  try {
    audio.currentTime = START_OFFSET_S[id] || 0;
  } catch {
    // Ignore seek errors before the file has metadata.
  }
  audio.play()?.catch(() => {});
}

function playBuffer(id, buffer) {
  const context = ctx;
  if (!context) return false;
  // A fresh tap replaces the same sound still playing (same as rewinding one <audio> element).
  try {
    playing.get(id)?.stop();
  } catch {
    // Already finished.
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gainValue = GAIN[id] ?? 1;
  if (gainValue !== 1) {
    const gain = context.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    if (gainValue > 1 && typeof context.createDynamicsCompressor === "function") {
      // tap-search peaks near 0.64 FS, so 2x would clip. Limit the top end instead.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;
      gain.connect(limiter);
      limiter.connect(context.destination);
    } else {
      gain.connect(context.destination);
    }
  } else {
    source.connect(context.destination);
  }
  source.onended = () => {
    if (playing.get(id) === source) playing.delete(id);
  };
  playing.set(id, source);
  const offset = Math.min(START_OFFSET_S[id] || 0, Math.max(0, buffer.duration - 0.01));
  source.start(0, offset);
  return true;
}

const SEARCH_ONLY_IDS = new Set(["tapSearch", "confirmProperty", "sendProperty"]);

function start(id, { allowTapSearch = false } = {}) {
  // confirm-property / send-property are the same recording as tap-search.
  if (SEARCH_ONLY_IDS.has(id) && !allowTapSearch) return;
  if (!SOUNDS[id]) return;

  const context = getContext();
  const buffer = buffers.get(id);
  if (!context || !buffer) {
    // Not decoded yet: play it the old way this once and finish loading for next time.
    startWithAudioElement(id);
    loadBuffer(id);
    return;
  }

  if (context.state === "running") {
    playBuffer(id, buffer);
    return;
  }

  // Suspended (first touch hasn't unlocked it yet): resume, then play.
  context
    .resume()
    .then(() => playBuffer(id, buffer))
    .catch(() => startWithAudioElement(id));
}

/** Blue Search button only. */
export function playTapSearchSound() {
  start("tapSearch", { allowTapSearch: true });
  suppressFollowups(["sendProperty", "propertyText"], 4000);
}

/** Sound for the screen that was just touched. Later sounds from that same action stay quiet. */
export function playVrboSound(id) {
  if (SEARCH_ONLY_IDS.has(id)) {
    if (id === "confirmProperty") {
      // "Share this stay to the group" = same sound as the blue Search button.
      // Group-chat messages after Share (Jamie, card, reactions) keep their own sounds.
      start("tapSearch", { allowTapSearch: true });
    }
    return;
  }
  start(id);
}

/**
 * Chat and scene sounds. The full-bleed kiosk plays immediately.
 * The five-up overview waits, then stays quiet if a kiosk already played it.
 */
export function playSharedVrboSound(id) {
  const key = `${id}:${Math.floor(Date.now() / 450)}`;
  const kiosk = /\/vrbo-(left|right)(\/|$|-)/.test(window.location.pathname);
  window.setTimeout(() => {
    if (isSuppressed(id) || claimed.has(key)) return;
    claimed.add(key);
    channel?.postMessage({ type: "played", key });
    start(id);
  }, kiosk ? 0 : 140);
}

export function preloadVrboSounds() {
  Object.keys(SOUNDS).forEach((id) => {
    loadBuffer(id);
  });
}

/** Unlock Web Audio on a touch/click (iOS and Chrome keep it suspended until then). */
let unlocked = false;

function unlockAudio() {
  const context = getContext();
  if (!context) return;
  if (context.state !== "running") {
    unlocked = false;
    context.resume().catch(() => {});
  }
  if (unlocked) return;
  unlocked = true;
  // Silent one-sample blip: iOS only fully unlocks output after something has played.
  try {
    const blip = context.createBufferSource();
    blip.buffer = context.createBuffer(1, 1, 22050);
    blip.connect(context.destination);
    blip.start(0);
  } catch {
    // Ignore.
  }
}

if (typeof window !== "undefined") {
  ["pointerdown", "touchend", "click", "keydown"].forEach((type) => {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  });
  // Start decoding right away so the first tap already has its buffer.
  preloadVrboSounds();
}
