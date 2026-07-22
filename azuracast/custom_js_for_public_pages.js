(function () {
"use strict";

const AZURAVOTE_SCRIPT_URL = "/votes/embed.js?v=10";
const REMOTE_METADATA_INTERVAL_MS = 10000;

const REMOTE_METADATA_SOURCES = [
{
id: "loops-radio",
streamUrlContains: "progressive.ozelip.com/7670/stream",
metadataUrl: "/loopsradio-metadata",
fallbackArtist: "Loops Radio",
fallbackTitle: "Unknown programme"
},
{
id: "yoga-chill",
streamUrlContains: "radio4.vip-radios.fm:18027",
metadataUrl: "/yogachill-metadata",
fallbackArtist: "Vip-Radios.FM",
fallbackTitle: "Yoga Chill"
}
];

const LOOPS_RADIO_URL = "https://loopsradio.com";

const LOOPS_RADIO_LOGO_URL =
"https://loopsradio.com/wp-content/uploads/2023/09/loops-radio-logo-2026.png";

const TELEGRAM_URL = "https://t.me/uk_psy";

const TELEGRAM_IMAGE_URL =
"https://i.postimg.cc/69MLHnPY/Chat-GPT-Image-resized50.png?dl=1g";

const BANNER_URL = "https://t.me/tranceconnections/714";

const BANNER_IMAGE_URL =
"https://i.postimg.cc/KvkySdmk/trypilla2026en.png";

let metadataTimer = null;
let metadataAbortController = null;
let activeMetadataSource = null;
let nativeMetadata = null;
let metadataOverrideActive = false;

function publishExternalMetadata(payload) {
window.AZURAVOTE_EXTERNAL_METADATA = payload;
window.dispatchEvent(new CustomEvent(
"azuravote:external-metadata",
{ detail: payload }
));
}

function publishMetadataUnavailable(source) {
publishExternalMetadata({
active: true,
source: source.id,
available: false
});
}

function runWhenReady(callback) {
if (document.readyState === "loading") {
document.addEventListener(
"DOMContentLoaded",
callback,
{ once: true }
);
} else {
callback();
}
}

function loadScriptOnce(src, id) {
if (document.getElementById(id)) {
return;
}

const script = document.createElement("script");

script.id = id;
script.src = src;
script.defer = true;

document.head.appendChild(script);

}

function addStyleOnce(cssText, id) {
if (document.getElementById(id)) {
return;
}

const style = document.createElement("style");

style.id = id;
style.textContent = cssText;

document.head.appendChild(style);

}

function getActiveAudioElement() {
const audioElements = Array.from(
document.querySelectorAll("audio")
);

return (
  audioElements.find(function (audio) {
    return !audio.paused && !audio.ended;
  }) ||
  audioElements[0] ||
  null
);

}

function getActiveAudioUrl() {
const audio = getActiveAudioElement();

if (!audio) {
  return "";
}

const sourceElement = audio.querySelector("source");

return String(
  audio.currentSrc ||
  audio.src ||
  sourceElement?.src ||
  ""
);

}

function getActiveMetadataSource() {
const audioUrl = getActiveAudioUrl().toLowerCase();

if (!audioUrl) {
  return null;
}

return (
  REMOTE_METADATA_SOURCES.find(function (source) {
    return audioUrl.includes(
      source.streamUrlContains.toLowerCase()
    );
  }) ||
  null
);

}

function parseMetadata(rawValue, source) {
const raw = String(rawValue || "")
.replace(/\0/g, "")
.replace(/\s+/g, " ")
.trim();

if (!raw) {
  return {
    artist: source.fallbackArtist,
    title: source.fallbackTitle
  };
}

const separatorIndex = raw.indexOf(" - ");

if (separatorIndex === -1) {
  return {
    artist: source.fallbackArtist,
    title: raw
  };
}

return {
  artist:
    raw.slice(0, separatorIndex).trim() ||
    source.fallbackArtist,

  title:
    raw.slice(separatorIndex + 3).trim() ||
    source.fallbackTitle
};

}

function getNowPlayingElements() {
return {
title: document.querySelector(".now-playing-title"),
artist: document.querySelector(".now-playing-artist")
};
}

function saveNativeMetadata() {
if (metadataOverrideActive) {
return;
}

const elements = getNowPlayingElements();

nativeMetadata = {
  title: elements.title?.textContent || "",
  artist: elements.artist?.textContent || ""
};

}

function renderRemoteMetadata(metadata) {
const elements = getNowPlayingElements();

if (!metadataOverrideActive) {
  saveNativeMetadata();
}

metadataOverrideActive = true;

if (elements.title) {
  elements.title.textContent = metadata.title;
}

if (elements.artist) {
  elements.artist.textContent = metadata.artist;
}

}

function restoreNativeMetadata() {
if (!metadataOverrideActive) {
return;
}

metadataOverrideActive = false;

const elements = getNowPlayingElements();

if (nativeMetadata) {
  if (elements.title) {
    elements.title.textContent =
      nativeMetadata.title;
  }

  if (elements.artist) {
    elements.artist.textContent =
      nativeMetadata.artist;
  }
}

nativeMetadata = null;

}


async function updateMetadata() {
  const source = getActiveMetadataSource();

  if (!source || source !== activeMetadataSource) {
    stopMetadataUpdates(true);
    return;
  }

  if (metadataAbortController) {
    metadataAbortController.abort();
  }

  metadataAbortController = new AbortController();

  const fallbackMetadata = {
    artist: source.fallbackArtist,
    title: source.fallbackTitle
  };

  try {
    const response = await fetch(source.metadataUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: metadataAbortController.signal,
      headers: {
        Accept: "text/plain"
      }
    });

    if (!response.ok) {
      if (getActiveMetadataSource() === source) {
        renderRemoteMetadata(fallbackMetadata);
        publishMetadataUnavailable(source);
      }

      return;
    }

    const rawMetadata = await response.text();

    if (!String(rawMetadata || "").replace(/\0/g, "").trim()) {
      if (getActiveMetadataSource() === source) {
        renderRemoteMetadata(fallbackMetadata);
        publishMetadataUnavailable(source);
      }
      return;
    }

    const metadata = parseMetadata(
      rawMetadata,
      source
    );

    if (getActiveMetadataSource() === source) {
      renderRemoteMetadata(metadata);
      publishExternalMetadata({
        active: true,
        source: source.id,
        available: true,
        artist: metadata.artist,
        title: metadata.title
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    if (getActiveMetadataSource() === source) {
      renderRemoteMetadata(fallbackMetadata);
      publishMetadataUnavailable(source);
    }
  }
}  


function stopMetadataUpdates(
restoreMetadata = true
) {
if (metadataTimer) {
window.clearInterval(metadataTimer);
metadataTimer = null;
}

if (metadataAbortController) {
  metadataAbortController.abort();
  metadataAbortController = null;
}

activeMetadataSource = null;

if (restoreMetadata) {
  restoreNativeMetadata();
}

}

function syncMetadataUpdates() {
const source = getActiveMetadataSource();

if (!source) {
  stopMetadataUpdates(true);
  publishExternalMetadata({ active: false });

  /*
   * AzuraCast may update the main-stream song
   * shortly after the audio source changes.
   */
  window.setTimeout(
    saveNativeMetadata,
    500
  );

  window.setTimeout(
    saveNativeMetadata,
    1500
  );

  return;
}

if (
  source === activeMetadataSource &&
  metadataTimer
) {
  return;
}

/*
 * When switching between Loops Radio and
 * Yoga Chill, do not briefly restore the
 * previous native metadata.
 */
stopMetadataUpdates(false);

saveNativeMetadata();

activeMetadataSource = source;

publishMetadataUnavailable(source);

updateMetadata();

metadataTimer = window.setInterval(
  updateMetadata,
  REMOTE_METADATA_INTERVAL_MS
);

}

function installPlayerListeners() {
[
"play",
"playing",
"loadedmetadata",
"canplay",
"emptied",
"ended"
].forEach(function (eventName) {
document.addEventListener(
eventName,
function (event) {
if (
!(
event.target instanceof
HTMLAudioElement
)
) {
return;
}

      window.setTimeout(
        syncMetadataUpdates,
        100
      );
    },
    true
  );
});

if (window.jQuery) {
  window.jQuery(document).on(
    "now-playing",
    function () {
      const source =
        getActiveMetadataSource();

      if (source) {
        window.setTimeout(
          updateMetadata,
          100
        );
      } else {
        /*
         * The main stream is active.
         * Let AzuraCast keep its own metadata.
         */
        metadataOverrideActive = false;
        nativeMetadata = null;
      }
    }
  );
}

}

const publicPageCss = `
.loops-radio-footer-logo {
display: block;
position: absolute;
bottom: 10px;
left: 50%;
transform: translateX(-50%);
width: 100px;
height: 24px;
background-position: center;
background-repeat: no-repeat;
background-size: contain;
z-index: 1;
}

.telegram-promo {
  position: fixed;
  right: 15px;
  bottom: 30px;
  width: 10vw;
  min-width: 65px;
  max-width: 110px;
  aspect-ratio: 1 / 1;
  display: block;
  opacity: 0.7;
  z-index: 10000;
  transition:
    transform 0.2s ease-in-out,
    opacity 0.2s ease-in-out;
}

.telegram-promo:hover {
  transform: scale(1.05);
  opacity: 0.9;
}

.telegram-promo img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 50%;
  box-shadow:
    0 4px 10px rgba(0, 0, 0, 0.8);
}

.zoom-banner-container {
  position: fixed;
  top: 30px;
  right: 20px;
  width: 12vw;
  min-width: 80px;
  max-width: 120px;
  opacity: 0.7;
  z-index: 10000;
  transition:
    opacity 0.2s ease-in-out;
}

.zoom-banner-container:hover {
  opacity: 0.9;
}

.zoom-banner {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 12px;
  cursor: pointer;
  transform-origin: top right;
  box-shadow:
    0 4px 15px rgba(0, 0, 0, 0.6);
  transition:
    transform 0.5s
      cubic-bezier(
        0.175,
        0.885,
        0.32,
        1.275
      ),
    box-shadow 0.5s ease;
}

.zoom-banner:hover {
  transform: scale(2.55);
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.9);
}

@media (max-width: 600px) {
  .telegram-promo {
    right: 10px;
    bottom: 20px;
  }

  .zoom-banner-container {
    top: 15px;
    right: 10px;
    min-width: 65px;
  }

  .zoom-banner:hover {
    transform: scale(1.8);
  }
}

`;

function createLoopsRadioFooterLogo() {
if (
document.getElementById(
"loops-radio-footer-logo"
)
) {
return;
}

const footer =
  document.querySelector("footer") ||
  document.body;

if (
  footer !== document.body &&
  window
    .getComputedStyle(footer)
    .position === "static"
) {
  footer.style.position = "relative";
}

const link =
  document.createElement("a");

link.id =
  "loops-radio-footer-logo";

link.className =
  "loops-radio-footer-logo";

link.href = LOOPS_RADIO_URL;
link.target = "_blank";
link.rel = "noopener noreferrer";

link.setAttribute(
  "aria-label",
  "Open Loops Radio"
);

link.style.backgroundImage =
  'url("' +
  LOOPS_RADIO_LOGO_URL +
  '")';

footer.appendChild(link);

}

function createTelegramPromo() {
if (
document.getElementById(
"telegram-promo"
)
) {
return;
}

const link =
  document.createElement("a");

link.id = "telegram-promo";
link.className = "telegram-promo";
link.href = TELEGRAM_URL;
link.target = "_blank";
link.rel = "noopener noreferrer";

link.setAttribute(
  "aria-label",
  "Open Telegram channel"
);

const image =
  document.createElement("img");

image.src = TELEGRAM_IMAGE_URL;
image.alt = "Telegram";
image.loading = "lazy";

link.appendChild(image);
document.body.appendChild(link);

}

function createTopBanner() {
if (
document.getElementById(
"trypilla-banner"
)
) {
return;
}

const link =
  document.createElement("a");

link.id = "trypilla-banner";

link.className =
  "zoom-banner-container";

link.href = BANNER_URL;
link.target = "_blank";
link.rel = "noopener noreferrer";

link.setAttribute(
  "aria-label",
  "Open event information"
);

const image =
  document.createElement("img");

image.src = BANNER_IMAGE_URL;
image.className = "zoom-banner";
image.alt = "Trypilla 2026";
image.loading = "lazy";

link.appendChild(image);
document.body.appendChild(link);

}

function initialise() {
loadScriptOnce(
AZURAVOTE_SCRIPT_URL,
"azuravote-public-page-script"
);

addStyleOnce(
  publicPageCss,
  "azuracast-custom-public-page-style"
);

///createLoopsRadioFooterLogo();
//createTelegramPromo();
///createTopBanner();

installPlayerListeners();
syncMetadataUpdates();

}

runWhenReady(initialise);
})();
