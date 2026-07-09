(function () {
  var cfg = window.AZSV_CONFIG || {};
  var script = document.currentScript;
  var apiBase = cfg.apiBase || (script ? new URL("./api/", script.src).toString() : "/api/");
  var widgetUrl = cfg.widgetUrl || (script ? new URL("./widget", script.src).toString() : "/widget");
  var selectors = [cfg.targetSelector, "#public-radio-player", "main", ".public-page", "body"].filter(Boolean);

  var translations = {
    en: { vote: "Vote", like: "Like", dislike: "Dislike", ratings: "Ratings", ratingsTitle: "Song ratings", closeRatings: "Close ratings", loading: "Loading...", noVotes: "No votes yet", topRated: "Top rated", lowRated: "Low rated", ratingsLoadError: "Unable to load ratings", unknownSong: "Unknown song", unknownArtist: "Unknown artist", loadError: "Unable to load votes", voteError: "Unable to save vote" },
    es: { vote: "Vota", like: "Me gusta", dislike: "No me gusta", ratings: "Calificaciones", ratingsTitle: "Calificaciones", closeRatings: "Cerrar calificaciones", loading: "Cargando...", noVotes: "Sin votos todavР В РІР‚СљР вЂ™Р’В­a", topRated: "Mejor valoradas", lowRated: "Peor valoradas", ratingsLoadError: "No se pudieron cargar las calificaciones", unknownSong: "CanciР В РІР‚СљР РЋРІР‚вЂњn desconocida", unknownArtist: "Artista desconocido", loadError: "No se pudieron cargar los votos", voteError: "No se pudo guardar el voto" },
    ru: { vote: "Голосуй", like: "Нравится", dislike: "Не нравится", ratings: "Рейтинги", ratingsTitle: "Рейтинг треков", closeRatings: "Закрыть рейтинги", loading: "Загрузка...", noVotes: "Пока нет голосов", topRated: "Лучшие", lowRated: "Низкие оценки", ratingsLoadError: "Не удалось загрузить рейтинги", unknownSong: "Неизвестный трек", unknownArtist: "Неизвестный артист", loadError: "Не удалось загрузить голоса", voteError: "Не удалось сохранить голос" },
    uk: { vote: "Голосуй", like: "Подобається", dislike: "Не подобається", ratings: "Рейтинги", ratingsTitle: "Рейтинг треків", closeRatings: "Закрити рейтинги", loading: "Завантаження...", noVotes: "Поки немає голосів", topRated: "Найкращі", lowRated: "Низькі оцінки", ratingsLoadError: "Не вдалося завантажити рейтинги", unknownSong: "Невідомий трек", unknownArtist: "Невідомий артист", loadError: "Не вдалося завантажити голоси", voteError: "Не вдалося зберегти голос" }

  };

  function getLocale() {
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < languages.length; i += 1) {
      var code = String(languages[i] || "").toLowerCase().split("-")[0];
      if (translations[code]) return code;
    }
    return "en";
  }

  var text = translations[getLocale()] || translations.en;
  var state = { songKey: "", songTitle: "", pending: false, hidePublicDownvotes: false, ratingsOpen: false, ratingsLoaded: false, streamActive: false, apiStreamActive: false };

  function apiPath(name) {
    return new URL(name, apiBase).toString();
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || "Request failed");
        return body;
      });
    });
  }

  function findTarget() {
    for (var i = 0; i < selectors.length; i += 1) {
      var target = document.querySelector(selectors[i]);
      if (target) return target;
    }
    return document.body;
  }

  function rectIsVisible(rect) {
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function findPlayerPanel() {
    var root = document.getElementById("public-radio-player");
    if (!root) return null;

    var candidates = Array.prototype.slice.call(root.querySelectorAll("div,section,article"));
    candidates.push(root);

    var best = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var el = candidates[i];
      if (el.id === "azsv-song-vote-overlay" || el.id === "azsv-ratings-panel" || el.id === "azsv-ratings-link" || el.closest("#azsv-song-vote-overlay") || el.closest("#azsv-ratings-panel")) continue;
      var rect = el.getBoundingClientRect();
      if (!rectIsVisible(rect)) continue;
      if (rect.width < 260 || rect.width > 820 || rect.height < 130 || rect.height > 620) continue;

      var style = window.getComputedStyle(el);
      var hasPanelBackground = style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
      var score = rect.width * rect.height;
      if (hasPanelBackground) score += 120000;
      if (style.borderRadius && style.borderRadius !== "0px") score += 30000;
      if (style.boxShadow && style.boxShadow !== "none") score += 10000;

      if (!best || score > best.score) best = { el: el, score: score };
    }

    return best ? best.el : null;
  }

  function installStyles() {
    if (document.getElementById("azsv-embed-layout-style")) return;
    var style = document.createElement("style");
    style.id = "azsv-embed-layout-style";
    style.textContent = "#azsv-ratings-link{position:absolute;z-index:22;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:2px 8px;color:#d1a83a;background:rgba(15,20,28,.66);box-shadow:0 1px 4px rgba(0,0,0,.18);font:inherit;font-size:11px;font-weight:800;line-height:1.35;cursor:pointer}#azsv-ratings-link:hover,#azsv-ratings-link[aria-expanded='true']{color:#f7f3ea;background:rgba(209,168,58,.32)}#azsv-ratings-panel{position:absolute;z-index:31;width:310px;max-height:330px;overflow:auto;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#1f2430;color:#f7f3ea;box-shadow:0 18px 42px rgba(0,0,0,.34);font-family:inherit}#azsv-ratings-panel[hidden]{display:none}#azsv-ratings-panel .azsv-ratings-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px}#azsv-ratings-panel .azsv-ratings-title{margin:0;color:#d1a83a;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}#azsv-ratings-panel .azsv-ratings-close{border:0;background:transparent;color:rgba(247,243,234,.72);font:inherit;font-size:18px;line-height:1;cursor:pointer}#azsv-ratings-panel .azsv-ratings-section{margin:10px 0 0}#azsv-ratings-panel .azsv-ratings-section-title{margin:0 0 6px;color:rgba(247,243,234,.58);font-size:11px;font-weight:900;text-transform:uppercase}#azsv-ratings-panel .azsv-ratings-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}#azsv-ratings-panel .azsv-ratings-song{min-width:0}#azsv-ratings-panel .azsv-ratings-main{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:800}#azsv-ratings-panel .azsv-ratings-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;color:rgba(247,243,234,.62);font-size:11px}#azsv-ratings-panel .azsv-ratings-score{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:900;white-space:nowrap}#azsv-ratings-panel .azsv-rating-up{color:#4ade80}#azsv-ratings-panel .azsv-rating-down{color:#fb7185}#azsv-ratings-panel .azsv-ratings-empty{margin:8px 0;color:rgba(247,243,234,.62);font-size:12px}@media(max-width:760px){#azsv-ratings-panel{width:100%;max-width:none;max-height:none}}#azsv-song-vote-overlay{position:absolute;z-index:20;top:60px;right:32px;min-width:110px;color:#f7f3ea;font-family:inherit;text-align:center}#azsv-song-vote-overlay .azsv-native-title{display:none}#azsv-song-vote-overlay .azsv-native-actions{display:flex;align-items:center;justify-content:center;gap:7px}#azsv-song-vote-overlay button{display:inline-flex;align-items:center;gap:3px;border:0;padding:1px 0;color:inherit;background:transparent;font:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer}#azsv-song-vote-overlay button:disabled{cursor:wait;opacity:.58}#azsv-song-vote-overlay button[aria-pressed='true']{filter:drop-shadow(0 0 5px rgba(209,168,58,.45))}#azsv-song-vote-overlay .azsv-plus{color:#4ade80}#azsv-song-vote-overlay .azsv-minus{color:#fb7185}#azsv-song-vote-overlay svg{width:13px;height:13px;fill:currentColor;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}#azsv-song-vote-overlay .azsv-count{min-width:7px;color:currentColor}#azsv-song-vote-overlay .azsv-native-message{min-height:12px;margin:7px 0 0;color:#d1a83a;font-size:11px;font-weight:700}@media(max-width:620px){#azsv-song-vote-overlay{top:54px;right:18px;min-width:96px}#azsv-song-vote-overlay .azsv-native-title{font-size:12px}#azsv-song-vote-overlay .azsv-native-actions{gap:7px}#azsv-song-vote-overlay button{font-size:12px}}#azsv-song-vote-overlay.azsv-mobile-inline{position:static;z-index:auto;display:flex;align-items:center;justify-content:flex-start;gap:8px;min-width:0;margin:7px 0 0 0;text-align:left;color:rgba(247,243,234,.72)}#azsv-song-vote-overlay.azsv-mobile-inline .azsv-native-title{display:none}#azsv-song-vote-overlay.azsv-mobile-inline .azsv-native-actions{justify-content:flex-start;gap:8px}#azsv-song-vote-overlay.azsv-mobile-inline button{font-size:12px}#azsv-song-vote-overlay.azsv-mobile-inline svg{width:14px;height:14px}#azsv-song-vote-overlay.azsv-mobile-inline .azsv-native-message{margin:0 0 0 2px}#azsv-song-vote-overlay.azsv-desktop-inline{position:absolute;z-index:23;display:flex;align-items:center;justify-content:flex-start;gap:7px;min-width:0;margin:0;text-align:left;color:rgba(247,243,234,.92)}#azsv-song-vote-overlay.azsv-desktop-inline .azsv-native-title{display:none}#azsv-song-vote-overlay.azsv-desktop-inline .azsv-native-actions{justify-content:flex-start;gap:7px}#azsv-song-vote-overlay.azsv-desktop-inline .azsv-native-message{margin:0 0 0 2px}#azsv-song-vote-widget{width:100%;max-width:280px;margin:0;padding:0}#azsv-song-vote-widget iframe{display:block;width:100%;height:170px;border:0;border-radius:12px;overflow:hidden;background:transparent}";
    document.head.appendChild(style);
  }


  function createRatingsLink() {
    var existing = document.getElementById("azsv-ratings-link");
    if (existing) return existing;
    var link = document.createElement("button");
    link.id = "azsv-ratings-link";
    link.type = "button";
    link.textContent = text.ratings;
    link.setAttribute("aria-expanded", "false");
    link.addEventListener("click", function () {
      toggleRatingsPanel();
    });
    return link;
  }

  function createRatingsPanel() {
    var existing = document.getElementById("azsv-ratings-panel");
    if (existing) return existing;
    var panel = document.createElement("div");
    panel.id = "azsv-ratings-panel";
    panel.hidden = true;
    panel.innerHTML = "<div class='azsv-ratings-head'><h3 class='azsv-ratings-title'></h3><button type='button' class='azsv-ratings-close' aria-label=''>x</button></div><div data-ratings-body><p class='azsv-ratings-empty'></p></div>";
    panel.querySelector(".azsv-ratings-title").textContent = text.ratingsTitle;
    panel.querySelector(".azsv-ratings-close").setAttribute("aria-label", text.closeRatings);
    panel.querySelector(".azsv-ratings-empty").textContent = text.loading;
    panel.querySelector(".azsv-ratings-close").addEventListener("click", function () {
      setRatingsOpen(false);
    });
    return panel;
  }

  function createRatingsRow(song) {
    var row = document.createElement("div");
    row.className = "azsv-ratings-row";

    var details = document.createElement("div");
    details.className = "azsv-ratings-song";
    var main = document.createElement("div");
    main.className = "azsv-ratings-main";
    main.textContent = song.title || text.unknownSong;
    var sub = document.createElement("div");
    sub.className = "azsv-ratings-sub";
    sub.textContent = song.artist || text.unknownArtist;
    details.appendChild(main);
    details.appendChild(sub);

    var score = document.createElement("div");
    score.className = "azsv-ratings-score";
    var up = document.createElement("span");
    up.className = "azsv-rating-up";
    up.textContent = "+" + (song.upvotes || 0);
    var down = document.createElement("span");
    down.className = "azsv-rating-down";
    down.textContent = "-" + (song.downvotes || 0);
    score.appendChild(up);
    if (!state.hidePublicDownvotes) score.appendChild(down);

    row.appendChild(details);
    row.appendChild(score);
    return row;
  }

  function renderRatingsSection(body, title, songs) {
    var section = document.createElement("section");
    section.className = "azsv-ratings-section";
    var heading = document.createElement("h4");
    heading.className = "azsv-ratings-section-title";
    heading.textContent = title;
    section.appendChild(heading);
    if (!songs.length) {
      var empty = document.createElement("p");
      empty.className = "azsv-ratings-empty";
      empty.textContent = text.noVotes;
      section.appendChild(empty);
    } else {
      songs.forEach(function (song) { section.appendChild(createRatingsRow(song)); });
    }
    body.appendChild(section);
  }

  function loadRatingsPanel() {
    var panel = createRatingsPanel();
    var body = panel.querySelector("[data-ratings-body]");
    body.innerHTML = "<p class='azsv-ratings-empty'>" + text.loading + "</p>";
    return Promise.all([
      fetchJson(apiPath("top?limit=8")),
      fetchJson(apiPath("bottom?limit=6"))
    ]).then(function (results) {
      body.innerHTML = "";
      renderRatingsSection(body, text.topRated, results[0].songs || []);
      renderRatingsSection(body, text.lowRated, results[1].songs || []);
      state.ratingsLoaded = true;
    }).catch(function () {
      body.innerHTML = "<p class='azsv-ratings-empty'>" + text.ratingsLoadError + "</p>";
    });
  }

  function cleanStreamLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function looksLikeStreamChoice(value) {
    var label = cleanStreamLabel(value);
    return !!label && (/\//.test(label) || /\b(kbps|mp3|aac|ogg|opus|flac)\b/.test(label));
  }

  function playerMainStreamActive(panel) {
    if (!panel) return true;

    var selects = Array.prototype.slice.call(panel.querySelectorAll("select"));
    for (var i = 0; i < selects.length; i += 1) {
      var select = selects[i];
      if (select.closest("#azsv-song-vote-overlay") || select.closest("#azsv-ratings-panel")) continue;
      if (select.options && select.options.length > 1) return select.selectedIndex <= 0;
    }

    var buttons = Array.prototype.slice.call(panel.querySelectorAll("button,a"));
    var current = null;
    for (var j = 0; j < buttons.length; j += 1) {
      var button = buttons[j];
      if (button.closest("#azsv-song-vote-overlay") || button.closest("#azsv-ratings-panel") || button.id === "azsv-ratings-link") continue;
      if (!rectIsVisible(button.getBoundingClientRect())) continue;
      var buttonLabel = cleanStreamLabel(button.textContent);
      if (!looksLikeStreamChoice(buttonLabel)) continue;
      current = buttonLabel;
      break;
    }

    if (!current) return true;

    var choices = [];
    var choiceNodes = Array.prototype.slice.call(panel.querySelectorAll(".dropdown-menu a,.dropdown-menu button,[role='menu'] a,[role='menu'] button,option"));
    for (var k = 0; k < choiceNodes.length; k += 1) {
      var label = cleanStreamLabel(choiceNodes[k].textContent || choiceNodes[k].label || choiceNodes[k].value);
      if (looksLikeStreamChoice(label)) choices.push(label);
    }

    if (!choices.length) return true;
    return current === choices[0];
  }

  function mainStreamActive(data) {
    if (!data || data.stream_active !== true) return false;
    return playerMainStreamActive(findPlayerPanel());
  }

  function updateVoteUiVisibility() {
    setVoteUiVisible(state.apiStreamActive && playerMainStreamActive(findPlayerPanel()));
  }

  function setVoteUiVisible(visible) {
    state.streamActive = visible;
    var overlay = document.getElementById("azsv-song-vote-overlay");
    var link = document.getElementById("azsv-ratings-link");
    var panel = document.getElementById("azsv-ratings-panel");
    if (overlay) overlay.hidden = !visible;
    if (link) link.hidden = !visible;
    if (!visible) {
      state.ratingsOpen = false;
      if (panel) panel.hidden = true;
      if (link) link.setAttribute("aria-expanded", "false");
    }
  }
  function setRatingsOpen(open) {
    state.ratingsOpen = !!open;
    var panel = document.getElementById("azsv-ratings-panel");
    var link = document.getElementById("azsv-ratings-link");
    if (panel) panel.hidden = !state.ratingsOpen;
    if (link) link.setAttribute("aria-expanded", String(state.ratingsOpen));
    if (state.ratingsOpen && !state.ratingsLoaded) loadRatingsPanel();
  }

  function toggleRatingsPanel() {
    setRatingsOpen(!state.ratingsOpen);
  }
  function createNativeOverlay() {
    var existing = document.getElementById("azsv-song-vote-overlay");
    if (existing) return existing;

    var overlay = document.createElement("div");
    overlay.id = "azsv-song-vote-overlay";
    overlay.innerHTML = "<div class='azsv-native-title'></div><div class='azsv-native-actions'><button type='button' class='azsv-plus' data-vote='1'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M7 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Zm2 0V10l5.6-7.3c.7-.9 2.1-.8 2.6.3.2.4.2.9.1 1.3L16.5 9H20a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 18.8 21H9Z'/></svg><span class='azsv-count' data-upvotes>0</span></button><button type='button' class='azsv-minus' data-vote='-1'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M7 3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3V3Zm2 0v11l5.6 7.3c.7.9 2.1.8 2.6-.3.2-.4.2-.9.1-1.3L16.5 15H20a2 2 0 0 0 2-2.3l-1.2-8A2 2 0 0 0 18.8 3H9Z'/></svg><span class='azsv-count' data-downvotes>0</span></button></div><div class='azsv-native-message' data-message></div>";
    overlay.querySelector(".azsv-native-title").textContent = "";
    overlay.querySelector("[data-vote='1']").title = text.like;
    overlay.querySelector("[data-vote='1']").setAttribute("aria-label", text.like);
    overlay.querySelector("[data-vote='-1']").title = text.dislike;
    overlay.querySelector("[data-vote='-1']").setAttribute("aria-label", text.dislike);

    Array.prototype.forEach.call(overlay.querySelectorAll("[data-vote]"), function (button) {
      button.addEventListener("click", function () {
        submitVote(Number(button.getAttribute("data-vote")));
      });
    });

    return overlay;
  }

  function getOverlayEls() {
    var overlay = document.getElementById("azsv-song-vote-overlay");
    if (!overlay) return null;
    return {
      overlay: overlay,
      upvotes: overlay.querySelector("[data-upvotes]"),
      downvotes: overlay.querySelector("[data-downvotes]"),
      downvoteButton: overlay.querySelector("[data-vote='-1']"),
      message: overlay.querySelector("[data-message]"),
      buttons: Array.prototype.slice.call(overlay.querySelectorAll("[data-vote]"))
    };
  }

  function setMessage(value) {
    var els = getOverlayEls();
    if (els) els.message.textContent = value || "";
  }

  function setPending(value) {
    state.pending = value;
    var els = getOverlayEls();
    if (!els) return;
    els.buttons.forEach(function (button) { button.disabled = value; });
  }

  function render(data) {
    var els = getOverlayEls();
    if (!els) return;
    state.apiStreamActive = data && data.stream_active === true;
    if (!mainStreamActive(data)) {
      state.songKey = "";
      state.songTitle = "";
      updateVoteUiVisibility();
      return;
    }
    updateVoteUiVisibility();
    var song = data.song || {};
    var votes = data.votes || {};
    state.songKey = song.song_key || "";
    state.songTitle = song.title || "";
    els.upvotes.textContent = votes.upvotes || 0;
    els.downvotes.textContent = votes.downvotes || 0;
    if (state.hidePublicDownvotes && els.downvoteButton) els.downvoteButton.hidden = true;
    els.buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-vote")) === Number(votes.my_vote)));
    });
    var panel = findPlayerPanel();
    if (panel) placeNativeOverlay(panel, els.overlay);
  }

  function loadConfig() {
    return fetchJson(apiPath("config")).then(function (config) {
      state.hidePublicDownvotes = !!config.hidePublicDownvotes;
    }).catch(function () {});
  }

  function loadNowPlaying() {
    return fetchJson(apiPath("now-playing")).then(function (data) {
      render(data);
      setMessage("");
    }).catch(function () {
      setVoteUiVisible(false);
      setMessage(text.loadError);
    });
  }

  function submitVote(vote) {
    if (state.pending || !state.streamActive || !state.songKey) return;
    setPending(true);
    fetchJson(apiPath("vote"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song_key: state.songKey, vote: vote })
    }).then(function (data) {
      render(data);
      setMessage("");
    }).catch(function (error) {
      setMessage(error.message || text.voteError);
    }).finally(function () {
      setPending(false);
    });
  }


/*  function isMobileLayout(panel) {
    if (window.matchMedia && window.matchMedia("(max-width: 620px)").matches) return true;
    return !!(panel && panel.getBoundingClientRect().width < 540);
  }
*/
  function isMobileLayout(panel) {
    // 1. Media Query: Checks for a mobile-width screen AND portrait orientation
    if (window.matchMedia && window.matchMedia("(max-width: 768px) and (orientation: portrait)").matches) {
      return true;
    }
  
    // 2. Fallback: Checks if the panel is narrow AND the browser itself is taller than it is wide
    var isPortrait = window.innerHeight > window.innerWidth;
    return !!(panel && panel.getBoundingClientRect().width < 540 && isPortrait);
  }

  function findProgressItem(panel) {
    var direct = panel.querySelector("[role='progressbar'], progress, .progress, [class*='progress']");
    if (direct && !direct.closest("#azsv-song-vote-overlay") && !direct.closest("#azsv-ratings-panel") && direct.id !== "azsv-ratings-link") {
      var node = direct;
      while (node.parentElement && node.parentElement !== panel) {
        var rect = node.parentElement.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 8 && rect.height < 48) node = node.parentElement;
        else break;
      }
      return node;
    }

    var timePattern = /\b\d{1,2}:\d{2}\b/g;
    var nodes = Array.prototype.slice.call(panel.querySelectorAll("div,span"));
    for (var i = 0; i < nodes.length; i += 1) {
      var candidate = nodes[i];
      if (candidate.closest("#azsv-song-vote-overlay") || candidate.closest("#azsv-ratings-panel") || candidate.id === "azsv-ratings-link") continue;
      var text = String(candidate.textContent || "");
      var matches = text.match(timePattern) || [];
      if (matches.length < 2) continue;
      var rect = candidate.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 8 && rect.height < 56) return candidate;
    }

    return null;
  }
  function findProgressBar(panel) {
    var panelRect = panel.getBoundingClientRect();
    var nodes = Array.prototype.slice.call(panel.querySelectorAll("[role='progressbar'], progress, .progress, [class*='progress'], div, span"));
    var best = null;

    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest("#azsv-song-vote-overlay") || node.closest("#azsv-ratings-panel") || node.id === "azsv-ratings-link") continue;
      var rect = node.getBoundingClientRect();
      if (!rectIsVisible(rect)) continue;
      if (rect.width < 120 || rect.height < 2 || rect.height > 10) continue;
      if (rect.left < panelRect.left + 70 || rect.top < panelRect.top + 34 || rect.top > panelRect.top + 170) continue;
      if (rect.right < panelRect.right - 110) continue;

      var style = window.getComputedStyle(node);
      var hasProgressHint = /progress|range|seek|time/i.test(String(node.className || "") + " " + String(node.getAttribute("role") || ""));
      var score = rect.width;
      if (hasProgressHint) score += 500;
      if (rect.height <= 6) score += 120;
      if (!best || score > best.score) best = { el: node, score: score };
    }

    return best ? best.el : null;
  }
  function findLastPlayedItem(panel) {
    var needles = ["played earlier", "recently played", "last played", "Р В Р’В Р РЋРІР‚ВР В Р’В Р РЋРІР‚вЂњР В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р вЂ™Р’В»Р В Р’В Р РЋРІР‚Сћ Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р вЂ™Р’ВµР В Р’В Р вЂ™Р’Вµ", "Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р’В Р вЂ™Р’ВµР В Р’В Р вЂ™Р’Вµ", "Р В Р Р‹Р Р†Р вЂљРІР‚СљР В Р Р‹Р В РЎвЂњР В Р Р‹Р Р†Р вЂљРЎв„ўР В Р’В Р РЋРІР‚СћР В Р Р‹Р В РІР‚С™Р В Р Р‹Р Р†Р вЂљРІР‚СљР В Р Р‹Р В Р РЏ", "Р В Р’В Р РЋРІР‚вЂњР В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р вЂ™Р’В»Р В Р’В Р РЋРІР‚Сћ Р В Р Р‹Р В РІР‚С™Р В Р’В Р вЂ™Р’В°Р В Р’В Р В РІР‚В¦Р В Р Р‹Р Р†Р вЂљРІР‚СљР В Р Р‹Р Р†РІР‚С™Р’В¬Р В Р’В Р вЂ™Р’Вµ"];
    var nodes = Array.prototype.slice.call(panel.querySelectorAll("a,button,span,div"));
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest("#azsv-song-vote-overlay")) continue;
      var label = String(node.textContent || "").trim().toLowerCase();
      if (!label) continue;
      for (var j = 0; j < needles.length; j += 1) {
        if (label.indexOf(needles[j]) !== -1) {
          return node.closest("a,button") || node;
        }
      }
    }
    return null;
  }


  function findPlayerLayoutElement(panel, selector) {
    var scoped = panel.querySelector(selector);
    if (scoped && rectIsVisible(scoped.getBoundingClientRect())) return scoped;
    var global = document.querySelector(selector);
    return global && rectIsVisible(global.getBoundingClientRect()) ? global : null;
  }
  function placeRatingsLink(panel) {
    var link = createRatingsLink();
    if (link.parentNode !== panel) panel.appendChild(link);
    link.style.position = "absolute";
    link.style.left = "";
    link.style.right = "12px";
    link.style.top = "10px";
  }

  function placeRatingsPanel(panel) {
    var ratings = createRatingsPanel();
    var panelRect = panel.getBoundingClientRect();
    var width = ratings.offsetWidth || 310;
    var height = ratings.offsetHeight || 330;
    var canFitRight = panelRect.right + 14 + width <= window.innerWidth - 14;
    var mobile = isMobileLayout(panel) && !canFitRight;
    var parent = mobile ? (panel.parentElement || panel) : document.body;
    if (ratings.parentNode !== parent) parent.appendChild(ratings);

    if (mobile) {
      var parentRect = parent.getBoundingClientRect();
      var parentStyle = window.getComputedStyle(parent);
      if (parentStyle.position === "static") parent.style.position = "relative";
      ratings.style.position = "absolute";
      ratings.style.left = Math.max(0, panelRect.left - parentRect.left) + "px";
      ratings.style.top = panelRect.bottom - parentRect.top + 10 + "px";
      return;
    }

    var left = panelRect.right + 14;
    var top = panelRect.top;
    if (!canFitRight) left = Math.max(14, panelRect.left - width - 14);
    top = Math.min(Math.max(14, top), window.innerHeight - height - 14);
    ratings.style.position = "fixed";
    ratings.style.left = left + "px";
    ratings.style.top = top + "px";
  }
  function placeNativeOverlay(panel, overlay) {
    var mobile = isMobileLayout(panel);
    overlay.classList.toggle("azsv-mobile-inline", mobile);
    overlay.classList.toggle("azsv-desktop-inline", !mobile);
    if (overlay.parentNode !== panel) panel.appendChild(overlay);

    var panelRect = panel.getBoundingClientRect();
    var main = findPlayerLayoutElement(panel, "div.now-playing-main");
    var radioWidget = findPlayerLayoutElement(panel, "div.radio-player-widget");
    var overlayHeight = overlay.offsetHeight || 18;
    var left = mobile ? 92 : 126;
    var top = mobile ? 148 : 160;

    if (main) {
      left = main.getBoundingClientRect().left - panelRect.left;
    }
    if (radioWidget) {
      top = radioWidget.getBoundingClientRect().top - panelRect.top - overlayHeight - 4;
    }

    overlay.style.position = "absolute";
    overlay.style.right = "";
    overlay.style.left = Math.min(panelRect.width - 84, Math.max(8, left)) + "px";
    overlay.style.top = Math.max(8, top + (mobile ? -2 : 15)) + "px";
  }
  function installNativeOverlay() {
    installStyles();

    var oldWidget = document.getElementById("azsv-song-vote-widget");
    if (oldWidget && oldWidget.parentNode) oldWidget.parentNode.removeChild(oldWidget);

    var panel = findPlayerPanel();
    if (!panel) return false;

    var panelStyle = window.getComputedStyle(panel);
    if (panelStyle.position === "static") panel.style.position = "relative";

    var overlay = createNativeOverlay();
    placeNativeOverlay(panel, overlay);
    placeRatingsLink(panel);
    placeRatingsPanel(panel);
    updateVoteUiVisibility();
    return true;
  }

  function createIframeWidget() {
    var existing = document.getElementById("azsv-song-vote-widget");
    if (existing) return existing;

    var box = document.createElement("div");
    box.id = "azsv-song-vote-widget";
    box.style.maxWidth = cfg.maxWidth || "280px";

    var iframe = document.createElement("iframe");
    iframe.src = widgetUrl;
    iframe.title = "Song voting";
    iframe.loading = "lazy";
    iframe.style.width = "100%";
    iframe.style.height = cfg.height || "170px";
    iframe.style.border = "0";
    iframe.style.borderRadius = "12px";
    iframe.style.overflow = "hidden";
    iframe.style.background = "transparent";

    box.appendChild(iframe);
    return box;
  }


  function isAzuraCastPublicPage() {
    return document.body.classList.contains("page-station-public-player")
      || document.getElementById("public-radio-player")
      || /^\/public\//.test(window.location.pathname);
  }

  function removeVoteUi() {
    ["azsv-song-vote-widget", "azsv-song-vote-overlay", "azsv-ratings-link", "azsv-ratings-panel"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }
  function insertFallbackWidget() {
    installStyles();
    if (document.getElementById("azsv-song-vote-widget")) return;
    var widget = createIframeWidget();
    var target = findTarget();
    if (cfg.position === "before" && target.parentNode) {
      target.parentNode.insertBefore(widget, target);
    } else if (cfg.position === "after" && target.parentNode) {
      target.parentNode.insertBefore(widget, target.nextSibling);
    } else {
      target.appendChild(widget);
    }
  }

  function boot() {
    if (document.body.classList.contains("page-station-public-player")) {
      if (installNativeOverlay()) {
        loadConfig().then(loadNowPlaying);
        return;
      }
      setTimeout(boot, 250);
      return;
    }

    if (isAzuraCastPublicPage()) {
      removeVoteUi();
      return;
    }

    insertFallbackWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("change", function (event) {
    if (event.target && event.target.closest && event.target.closest("#public-radio-player")) {
      updateVoteUiVisibility();
    }
  });
  document.addEventListener("click", function (event) {
    if (event.target && event.target.closest && event.target.closest("#public-radio-player")) {
      window.setTimeout(updateVoteUiVisibility, 0);
    }
  });

  window.addEventListener("load", boot);
  window.setInterval(function () {
    if (document.body.classList.contains("page-station-public-player")) {
      installNativeOverlay();
      loadNowPlaying();
    }
  }, 15000);
})();






