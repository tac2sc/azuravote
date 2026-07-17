(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AzuraVotePublicPlayerAdapter = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var INJECTED_IDS = [
    "azsv-player-controls",
    "azsv-song-vote-overlay",
    "azsv-ratings-panel",
    "azsv-chat-panel",
    "azsv-song-vote-widget",
    "azsv-player-adapter-style",
  ];
  var PLAYER_UI_SELECTOR = "#azsv-player-controls,#azsv-song-vote-overlay,#azsv-ratings-panel,#azsv-chat-panel";

  function createPublicPlayerAdapter(options) {
    options = options || {};
    var win = options.window || window;
    var doc = options.document || win.document;
    var config = options.config || {};
    var labels = options.labels || {};
    var actions = {};
    var listeners = [];
    var installed = false;
    var mutationObserver = null;
    var lastChatResetToken = null;
    var boundRefresh = function () { refresh(); };

    function label(name, fallback) {
      return labels[name] || fallback;
    }

    function pageKind() {
      var path = win.location && win.location.pathname || "";
      if (doc.body.classList.contains("page-station-public-player") || doc.getElementById("public-radio-player")) {
        return "station-player";
      }
      if (/^\/public\/[^/]+\/?$/.test(path)) return "station-public";
      if (/^\/public\//.test(path)) return "other-public";
      return "other";
    }

    function visibleRect(element) {
      var rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    }

    function findPlayerPanel() {
      var root = doc.getElementById("public-radio-player");
      if (!root) return null;
      var candidates = Array.prototype.slice.call(root.querySelectorAll("section,article,div"));
      candidates.push(root);
      var best = null;
      candidates.forEach(function (element) {
        if (element.closest(PLAYER_UI_SELECTOR)) return;
        var rect = visibleRect(element);
        if (!rect || rect.width < 260 || rect.width > 820 || rect.height < 130 || rect.height > 620) return;
        var score = rect.width * rect.height;
        if (!best || score > best.score) best = { element: element, score: score };
      });
      return best ? best.element : root;
    }

    function mainStreamSelected(panel) {
      if (!panel) return true;
      var selects = panel.querySelectorAll("select");
      for (var index = 0; index < selects.length; index += 1) {
        if (selects[index].options.length > 1) return selects[index].selectedIndex <= 0;
      }

      function cleanStreamLabel(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      }
      function looksLikeStreamChoice(value) {
        var valueLabel = cleanStreamLabel(value);
        return !!valueLabel && (/\//.test(valueLabel) || /\b(kbps|mp3|aac|ogg|opus|flac)\b/.test(valueLabel));
      }
      var current = "";
      var buttons = panel.querySelectorAll("button,a");
      for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
        if (buttons[buttonIndex].closest(PLAYER_UI_SELECTOR)) continue;
        var buttonLabel = cleanStreamLabel(buttons[buttonIndex].textContent);
        if (looksLikeStreamChoice(buttonLabel)) {
          current = buttonLabel;
          break;
        }
      }
      if (!current) return true;
      var choices = [];
      var choiceNodes = panel.querySelectorAll(".dropdown-menu a,.dropdown-menu button,[role='menu'] a,[role='menu'] button,option");
      for (var choiceIndex = 0; choiceIndex < choiceNodes.length; choiceIndex += 1) {
        var choiceLabel = cleanStreamLabel(choiceNodes[choiceIndex].textContent || choiceNodes[choiceIndex].label || choiceNodes[choiceIndex].value);
        if (looksLikeStreamChoice(choiceLabel)) choices.push(choiceLabel);
      }
      if (choices.length) return current === choices[0];
      return true;
    }

    function layout(panel) {
      if (win.matchMedia && win.matchMedia("(max-width: 768px) and (orientation: portrait)").matches) return "mobile";
      var rect = panel && visibleRect(panel);
      return rect && rect.width < 540 && win.innerHeight > win.innerWidth ? "mobile" : "desktop";
    }

    function snapshot() {
      var kind = pageKind();
      var panel = kind === "station-player" ? findPlayerPanel() : null;
      return {
        pageKind: kind,
        playerPresent: !!panel,
        mainStreamSelected: mainStreamSelected(panel),
        layout: layout(panel),
      };
    }

    function emitSnapshot() {
      var current = snapshot();
      listeners.slice().forEach(function (listener) { listener(current); });
    }

    function ensureStyles() {
      if (doc.getElementById("azsv-player-adapter-style")) return;
      var style = doc.createElement("style");
      style.id = "azsv-player-adapter-style";
      style.textContent = "#azsv-player-controls{position:absolute;z-index:22;top:10px;right:12px;display:flex;gap:6px}#azsv-player-controls button{border:0;border-radius:999px;padding:2px 8px;color:#d1a83a;background:rgba(15,20,28,.66);box-shadow:0 1px 4px rgba(0,0,0,.18);font:inherit;font-size:11px;font-weight:800;line-height:1.35;cursor:pointer}#azsv-player-controls button:hover,#azsv-player-controls button[aria-expanded='true']{color:#f7f3ea;background:rgba(209,168,58,.32)}#azsv-song-vote-overlay{position:absolute;z-index:23;display:flex;align-items:center;gap:7px;color:rgba(247,243,234,.92);font-family:inherit}#azsv-song-vote-overlay button{display:inline-flex;align-items:center;gap:3px;border:0;padding:1px;color:inherit;background:transparent;font:inherit;font-size:12px;font-weight:800;cursor:pointer}#azsv-song-vote-overlay button:disabled{cursor:wait;opacity:.58}#azsv-song-vote-overlay svg{width:13px;height:13px;fill:currentColor;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}#azsv-song-vote-overlay [data-vote='1']{color:#4ade80}#azsv-song-vote-overlay [data-vote='-1']{color:#fb7185}#azsv-ratings-panel,#azsv-chat-panel{position:fixed;z-index:31;width:310px;max-height:360px;overflow:auto;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#1f2430;color:#f7f3ea;box-shadow:0 18px 42px rgba(0,0,0,.34);font-family:inherit;font-size:12px}#azsv-ratings-panel[hidden],#azsv-chat-panel[hidden],#azsv-song-vote-overlay[hidden]{display:none}.azsv-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;color:#d1a83a}.azsv-panel-head button{border:0;background:transparent;color:rgba(247,243,234,.72);font:inherit;font-size:18px;cursor:pointer}.azsv-chat-message{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;padding:3px 0;border-top:1px solid rgba(255,255,255,.08)}.azsv-chat-message-content{min-width:0;overflow-wrap:anywhere}.azsv-chat-message strong{color:#d1a83a}.azsv-chat-timestamp{align-self:start;color:rgba(247,243,234,.48);font-size:10px;white-space:nowrap}#azsv-chat-panel form{display:flex;align-items:end;gap:6px;margin-top:10px}#azsv-chat-panel label{flex:1}#azsv-chat-panel input{display:block;width:100%;margin-top:4px;padding:6px;border:1px solid rgba(255,255,255,.18);border-radius:5px;color:#f7f3ea;background:rgba(255,255,255,.06)}#azsv-chat-panel [data-chat-submit]{padding:6px 9px;border:0;border-radius:5px;color:#1f2430;background:#d1a83a;font:inherit;font-weight:800;cursor:pointer}@media(max-width:760px){#azsv-ratings-panel,#azsv-chat-panel{right:14px!important;left:14px!important;width:auto;max-height:45vh}}";
      style.textContent += "#azsv-ratings-panel .azsv-ratings-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px}#azsv-ratings-panel .azsv-ratings-title{margin:0;color:#d1a83a;font-size:12px;font-weight:900;text-transform:uppercase}#azsv-ratings-panel .azsv-ratings-close{border:0;background:transparent;color:rgba(247,243,234,.72);font:inherit;font-size:18px;line-height:1;cursor:pointer}#azsv-ratings-panel .azsv-ratings-section{margin:10px 0 0}#azsv-ratings-panel .azsv-ratings-section-title{margin:0 0 6px;color:rgba(247,243,234,.58);font-size:11px;font-weight:900;text-transform:uppercase}#azsv-ratings-panel .azsv-ratings-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}#azsv-ratings-panel .azsv-ratings-song{min-width:0}#azsv-ratings-panel .azsv-ratings-main{overflow-wrap:anywhere;font-size:12px;font-weight:800}#azsv-ratings-panel .azsv-ratings-sub{margin-top:2px;color:rgba(247,243,234,.62);font-size:11px;overflow-wrap:anywhere}#azsv-ratings-panel .azsv-ratings-score{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:900;white-space:nowrap}#azsv-ratings-panel .azsv-rating-up{color:#4ade80}#azsv-ratings-panel .azsv-rating-down{color:#fb7185}#azsv-ratings-panel .azsv-ratings-empty{margin:8px 0;color:rgba(247,243,234,.62);font-size:12px}";
      doc.head.appendChild(style);
    }

    function ensurePlayerUi(panel) {
      ensureStyles();
      if (win.getComputedStyle(panel).position === "static") panel.style.position = "relative";

      var controls = doc.getElementById("azsv-player-controls");
      if (!controls) {
        controls = doc.createElement("div");
        controls.id = "azsv-player-controls";
        controls.innerHTML = "<button id='azsv-ratings-link' type='button' aria-expanded='false'></button><button id='azsv-chat-link' type='button' aria-expanded='false'></button>";
        controls.querySelector("#azsv-ratings-link").textContent = label("ratings", "Ratings");
        controls.querySelector("#azsv-chat-link").textContent = label("chat", "Chat");
        controls.querySelector("#azsv-ratings-link").addEventListener("click", function () {
          if (actions.onRatingsToggle) actions.onRatingsToggle(controls.querySelector("#azsv-ratings-link").getAttribute("aria-expanded") !== "true");
        });
        controls.querySelector("#azsv-chat-link").addEventListener("click", function () {
          if (actions.onChatToggle) actions.onChatToggle(controls.querySelector("#azsv-chat-link").getAttribute("aria-expanded") !== "true");
        });
      }
      if (controls.parentNode !== panel) panel.appendChild(controls);

      var voting = doc.getElementById("azsv-song-vote-overlay");
      if (!voting) {
        voting = doc.createElement("div");
        voting.id = "azsv-song-vote-overlay";
        voting.innerHTML = "<button type='button' data-vote='1'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M7 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Zm2 0V10l5.6-7.3c.7-.9 2.1-.8 2.6.3.2.4.2.9.1 1.3L16.5 9H20a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 18.8 21H9Z'/></svg><span data-upvotes>0</span></button><button type='button' data-vote='-1'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M7 3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3V3Zm2 0v11l5.6 7.3c.7.9 2.1.8 2.6-.3.2-.4.2-.9.1-1.3L16.5 15H20a2 2 0 0 0 2-2.3l-1.2-8A2 2 0 0 0 18.8 3H9Z'/></svg><span data-downvotes>0</span></button><span data-vote-message></span>";
        voting.querySelector("[data-vote='1']").setAttribute("aria-label", label("like", "Like"));
        voting.querySelector("[data-vote='-1']").setAttribute("aria-label", label("dislike", "Dislike"));
        Array.prototype.forEach.call(voting.querySelectorAll("[data-vote]"), function (button) {
          button.addEventListener("click", function () {
            if (actions.onVote) actions.onVote(Number(button.getAttribute("data-vote")));
          });
        });
      }
      if (voting.parentNode !== panel) panel.appendChild(voting);
      var panelRect = visibleRect(panel);
      var nowPlaying = panel.querySelector(".now-playing-main");
      var nowPlayingRect = nowPlaying && visibleRect(nowPlaying);
      var mobile = layout(panel) === "mobile";
      voting.classList.toggle("azsv-mobile", mobile);
      voting.style.left = (nowPlayingRect && panelRect ? Math.max(8, nowPlayingRect.left - panelRect.left) : (mobile ? 92 : 126)) + "px";
      voting.style.top = (nowPlayingRect && panelRect ? Math.max(8, nowPlayingRect.top - panelRect.top + (nowPlayingRect.height - voting.offsetHeight) / 2) : (mobile ? 148 : 175)) + "px";

      var chat = doc.getElementById("azsv-chat-panel");
      if (!chat) {
        chat = doc.createElement("section");
        chat.id = "azsv-chat-panel";
        chat.hidden = true;
        chat.setAttribute("aria-label", label("chatTitle", "Station chat"));
        chat.innerHTML = "<div class='azsv-panel-head'><strong data-chat-title></strong><button type='button' data-chat-close>x</button></div><p><span data-posting-as></span> <strong data-chat-nickname></strong></p><div data-chat-messages aria-live='polite'></div><form><label><span data-message-label></span> <input data-chat-input maxlength='200' autocomplete='off'></label><button type='submit' data-chat-submit></button></form><p data-chat-error role='status'></p>";
        chat.querySelector("[data-chat-title]").textContent = label("chatTitle", "Station chat");
        chat.querySelector("[data-chat-close]").setAttribute("aria-label", label("closeChat", "Close chat"));
        chat.querySelector("[data-posting-as]").textContent = label("postingAs", "Posting as");
        chat.querySelector("[data-message-label]").textContent = label("message", "Message");
        chat.querySelector("[data-chat-submit]").textContent = label("send", "Send");
        chat.querySelector("[data-chat-close]").addEventListener("click", function () {
          if (actions.onChatToggle) actions.onChatToggle(false);
        });
        chat.querySelector("form").addEventListener("submit", function (event) {
          event.preventDefault();
          var input = chat.querySelector("[data-chat-input]");
          if (actions.onChatSubmit) actions.onChatSubmit(input.value);
        });
        doc.body.appendChild(chat);
      }

      var ratings = doc.getElementById("azsv-ratings-panel");
      if (!ratings) {
        ratings = doc.createElement("section");
        ratings.id = "azsv-ratings-panel";
        ratings.hidden = true;
        ratings.setAttribute("aria-label", label("ratingsTitle", "Song ratings"));
        ratings.innerHTML = "<div class='azsv-ratings-head'><h3 class='azsv-ratings-title'></h3><button type='button' class='azsv-ratings-close' aria-label=''>x</button></div><div data-ratings-body></div><p data-ratings-error role='status'></p>";
        ratings.querySelector(".azsv-ratings-title").textContent = label("ratingsTitle", "Song ratings");
        ratings.querySelector(".azsv-ratings-close").setAttribute("aria-label", label("closeRatings", "Close ratings"));
        ratings.querySelector(".azsv-ratings-close").addEventListener("click", function () {
          if (actions.onRatingsToggle) actions.onRatingsToggle(false);
        });
        doc.body.appendChild(ratings);
      }

      [chat, ratings].forEach(function (floatingPanel) {
        var rect = panelRect || panel.getBoundingClientRect();
        var panelWidth = floatingPanel.offsetWidth || 310;
        var left = rect.right + 14;
        if (left + panelWidth > win.innerWidth - 14) left = Math.max(14, rect.left - panelWidth - 14);
        floatingPanel.style.left = left + "px";
        floatingPanel.style.top = Math.max(14, Math.min(rect.top, win.innerHeight - 374)) + "px";
      });
    }

    function removeInjectedUi() {
      INJECTED_IDS.forEach(function (id) {
        var element = doc.getElementById(id);
        if (element && element.parentNode) element.parentNode.removeChild(element);
      });
    }

    function ensureFallbackWidget() {
      if (doc.getElementById("azsv-song-vote-widget")) return;
      var target = config.targetSelector && doc.querySelector(config.targetSelector)
        || doc.querySelector("main,.public-page")
        || doc.body;
      var box = doc.createElement("div");
      box.id = "azsv-song-vote-widget";
      box.style.maxWidth = config.maxWidth || "280px";
      var iframe = doc.createElement("iframe");
      iframe.src = config.widgetUrl || "/widget";
      iframe.title = "Song voting";
      iframe.loading = "lazy";
      iframe.style.width = "100%";
      iframe.style.height = config.height || "170px";
      iframe.style.border = "0";
      box.appendChild(iframe);
      if (config.position === "before" && target.parentNode) target.parentNode.insertBefore(box, target);
      else if (config.position === "after" && target.parentNode) target.parentNode.insertBefore(box, target.nextSibling);
      else target.appendChild(box);
    }

    function refresh() {
      var current = snapshot();
      if (current.pageKind === "station-player" && current.playerPresent) ensurePlayerUi(findPlayerPanel());
      else if (current.pageKind === "other") ensureFallbackWidget();
      else removeInjectedUi();
      emitSnapshot();
      if (mutationObserver) mutationObserver.takeRecords();
    }

    function install(nextActions) {
      if (!installed) {
        actions = nextActions || {};
        installed = true;
        doc.addEventListener("change", boundRefresh);
        doc.addEventListener("click", boundRefresh);
        win.addEventListener("resize", boundRefresh);
        if (win.MutationObserver) {
          mutationObserver = new win.MutationObserver(function () { refresh(); });
          mutationObserver.observe(doc.body, { childList: true, subtree: true });
        }
      }
      refresh();
      return api;
    }

    function observe(listener) {
      listeners.push(listener);
      listener(snapshot());
      return function () {
        listeners = listeners.filter(function (candidate) { return candidate !== listener; });
      };
    }

    function formatChatTimestamp(value) {
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      function pad(number) { return String(number).padStart(2, "0"); }
      return pad(date.getMonth() + 1) + "." + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
    }

    function renderChat(model) {
      var link = doc.getElementById("azsv-chat-link");
      var panel = doc.getElementById("azsv-chat-panel");
      if (!link || !panel) return;
      model = model || {};
      link.hidden = model.visible === false;
      link.setAttribute("aria-expanded", String(!!model.open));
      panel.hidden = !model.open;
      panel.querySelector("[data-chat-nickname]").textContent = model.nickname || "";
      panel.querySelector("[data-chat-error]").textContent = model.error || "";

      var messages = panel.querySelector("[data-chat-messages]");
      messages.replaceChildren();
      (model.messages || []).slice().reverse().forEach(function (message) {
        var item = doc.createElement("article");
        item.className = "azsv-chat-message";
        item.dataset.messageId = String(message.id);
        var content = doc.createElement("span");
        content.className = "azsv-chat-message-content";
        var nickname = doc.createElement("strong");
        nickname.setAttribute("data-chat-message-nickname", "");
        nickname.textContent = message.nickname || "";
        var body = doc.createElement("span");
        body.setAttribute("data-chat-body", "");
        body.textContent = message.body || "";
        content.appendChild(nickname);
        content.appendChild(doc.createTextNode(": "));
        content.appendChild(body);
        item.appendChild(content);
        var timestamp = doc.createElement("time");
        timestamp.className = "azsv-chat-timestamp";
        timestamp.setAttribute("data-chat-timestamp", "");
        timestamp.dateTime = message.created_at || "";
        timestamp.textContent = formatChatTimestamp(message.created_at);
        item.appendChild(timestamp);
        messages.appendChild(item);
      });

      var input = panel.querySelector("[data-chat-input]");
      var submit = panel.querySelector("[data-chat-submit]");
      if (model.resetToken !== undefined && model.resetToken !== lastChatResetToken) {
        input.value = "";
        lastChatResetToken = model.resetToken;
      }
      input.disabled = !!model.pending;
      submit.disabled = !!model.pending;
    }

    function renderVoting(model) {
      var overlay = doc.getElementById("azsv-song-vote-overlay");
      if (!overlay) return;
      model = model || {};
      overlay.hidden = !model.visible;
      overlay.querySelector("[data-upvotes]").textContent = String(model.upvotes || 0);
      overlay.querySelector("[data-downvotes]").textContent = String(model.downvotes || 0);
      overlay.querySelector("[data-vote='-1']").hidden = !!model.hideDownvotes;
      overlay.querySelector("[data-vote-message]").textContent = model.message || "";
      Array.prototype.forEach.call(overlay.querySelectorAll("[data-vote]"), function (button) {
        button.disabled = !!model.pending;
        button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-vote")) === Number(model.myVote)));
      });
    }

    function renderRatings(model) {
      var link = doc.getElementById("azsv-ratings-link");
      var panel = doc.getElementById("azsv-ratings-panel");
      if (!link || !panel) return;
      model = model || {};
      link.hidden = !model.visible;
      link.setAttribute("aria-expanded", String(!!model.open));
      panel.hidden = !model.visible || !model.open;
      panel.querySelector("[data-ratings-error]").textContent = model.error || "";
      var body = panel.querySelector("[data-ratings-body]");
      body.replaceChildren();
      (model.sections || []).forEach(function (sectionModel) {
        var section = doc.createElement("section");
        section.className = "azsv-ratings-section";
        var heading = doc.createElement("h4");
        heading.className = "azsv-ratings-section-title";
        heading.textContent = sectionModel.title || "";
        section.appendChild(heading);
        var songs = sectionModel.songs || [];
        if (!songs.length) {
          var empty = doc.createElement("p");
          empty.className = "azsv-ratings-empty";
          empty.textContent = label("noVotes", "No votes yet");
          section.appendChild(empty);
        }
        songs.forEach(function (song) {
          var row = doc.createElement("div");
          row.className = "azsv-ratings-row";
          var details = doc.createElement("div");
          details.className = "azsv-ratings-song";
          var main = doc.createElement("div");
          main.className = "azsv-ratings-main";
          main.textContent = song.title || label("unknownSong", "Unknown song");
          var sub = doc.createElement("div");
          sub.className = "azsv-ratings-sub";
          sub.textContent = song.artist || label("unknownArtist", "Unknown artist");
          details.appendChild(main);
          details.appendChild(sub);
          var score = doc.createElement("div");
          score.className = "azsv-ratings-score";
          var up = doc.createElement("span");
          up.className = "azsv-rating-up";
          up.textContent = "+" + (song.upvotes || 0);
          score.appendChild(up);
          if (!model.hideDownvotes) {
            var down = doc.createElement("span");
            down.className = "azsv-rating-down";
            down.textContent = "-" + (song.downvotes || 0);
            score.appendChild(down);
          }
          row.appendChild(details);
          row.appendChild(score);
          section.appendChild(row);
        });
        body.appendChild(section);
      });
    }

    function render(model) {
      model = model || {};
      renderVoting(model.voting);
      renderRatings(model.ratings);
      renderChat(model.chat);
      if (mutationObserver) mutationObserver.takeRecords();
    }

    function dispose() {
      if (mutationObserver) mutationObserver.disconnect();
      doc.removeEventListener("change", boundRefresh);
      doc.removeEventListener("click", boundRefresh);
      win.removeEventListener("resize", boundRefresh);
      removeInjectedUi();
      listeners = [];
      installed = false;
    }

    var api = { install: install, observe: observe, render: render, dispose: dispose };
    return api;
  }

  return { createPublicPlayerAdapter: createPublicPlayerAdapter };
});
