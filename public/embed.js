(function () {
  "use strict";

  var cfg = window.AZSV_CONFIG || {};
  var script = document.currentScript;
  var apiBase = cfg.apiBase || (script ? new URL("./api/", script.src).toString() : "/api/");
  var widgetUrl = cfg.widgetUrl || (script ? new URL("./widget", script.src).toString() : "/widget");

  var translations = {
    en: { like: "Like", dislike: "Dislike", ratings: "Ratings", ratingsTitle: "Song ratings", closeRatings: "Close ratings", topRated: "Top rated", lowRated: "Low rated", chat: "Chat", chatTitle: "Station chat", closeChat: "Close chat", postingAs: "Posting as", message: "Message", send: "Send", loadError: "Unable to load votes", voteError: "Unable to save vote", ratingsError: "Unable to load ratings", chatLoadError: "Unable to load chat", chatPostError: "Unable to post message", chatLengthError: "Message must be between 1 and 200 characters" },
    es: { like: "Me gusta", dislike: "No me gusta", ratings: "Calificaciones", ratingsTitle: "Calificaciones", closeRatings: "Cerrar calificaciones", topRated: "Mejor valoradas", lowRated: "Peor valoradas", chat: "Chat", chatTitle: "Chat de la estación", closeChat: "Cerrar chat", postingAs: "Publicando como", message: "Mensaje", send: "Enviar", loadError: "No se pudieron cargar los votos", voteError: "No se pudo guardar el voto", ratingsError: "No se pudieron cargar las calificaciones", chatLoadError: "No se pudo cargar el chat", chatPostError: "No se pudo publicar el mensaje", chatLengthError: "El mensaje debe tener entre 1 y 200 caracteres" },
    ru: { like: "Нравится", dislike: "Не нравится", ratings: "Рейтинги", ratingsTitle: "Рейтинг треков", closeRatings: "Закрыть рейтинги", topRated: "Лучшие", lowRated: "Низкие оценки", chat: "Чат", chatTitle: "Чат станции", closeChat: "Закрыть чат", postingAs: "Ваш псевдоним", message: "Сообщение", send: "Отправить", loadError: "Не удалось загрузить голоса", voteError: "Не удалось сохранить голос", ratingsError: "Не удалось загрузить рейтинги", chatLoadError: "Не удалось загрузить чат", chatPostError: "Не удалось отправить сообщение", chatLengthError: "Сообщение должно содержать от 1 до 200 символов" },
    uk: { like: "Подобається", dislike: "Не подобається", ratings: "Рейтинги", ratingsTitle: "Рейтинг треків", closeRatings: "Закрити рейтинги", topRated: "Найкращі", lowRated: "Низькі оцінки", chat: "Чат", chatTitle: "Чат станції", closeChat: "Закрити чат", postingAs: "Ваш псевдонім", message: "Повідомлення", send: "Надіслати", loadError: "Не вдалося завантажити голоси", voteError: "Не вдалося зберегти голос", ratingsError: "Не вдалося завантажити рейтинги", chatLoadError: "Не вдалося завантажити чат", chatPostError: "Не вдалося надіслати повідомлення", chatLengthError: "Повідомлення має містити від 1 до 200 символів" }
  };
  translations.en.noVotes = "No votes yet";
  translations.en.unknownSong = "Unknown song";
  translations.en.unknownArtist = "Unknown artist";
  translations.es.noVotes = "Sin votos todavía";
  translations.es.unknownSong = "Canción desconocida";
  translations.es.unknownArtist = "Artista desconocido";
  translations.ru.noVotes = "Пока нет голосов";
  translations.ru.unknownSong = "Неизвестный трек";
  translations.ru.unknownArtist = "Неизвестный артист";
  translations.uk.noVotes = "Поки немає голосів";
  translations.uk.unknownSong = "Невідомий трек";
  translations.uk.unknownArtist = "Невідомий артист";

  function localeText() {
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var index = 0; index < languages.length; index += 1) {
      var code = String(languages[index] || "").toLowerCase().split("-")[0];
      if (translations[code]) return translations[code];
    }
    return translations.en;
  }

  var text = localeText();

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

  function loadAdapter(start) {
    if (window.AzuraVotePublicPlayerAdapter) return start(window.AzuraVotePublicPlayerAdapter);
    if (!script) return;
    var loader = document.createElement("script");
    loader.src = new URL("./public/player-adapter.js", script.src).toString();
    loader.defer = true;
    loader.onload = function () {
      if (window.AzuraVotePublicPlayerAdapter) start(window.AzuraVotePublicPlayerAdapter);
    };
    loader.onerror = function () { console.error("AzuraVote public-player adapter failed to load"); };
    document.head.appendChild(loader);
  }

  loadAdapter(function (adapterApi) {
    var state = {
      snapshot: { pageKind: "other", playerPresent: false, mainStreamSelected: true, layout: "desktop" },
      apiStreamActive: false,
      songKey: "",
      votes: { upvotes: 0, downvotes: 0, my_vote: null },
      hideDownvotes: false,
      votePending: false,
      voteMessage: "",
      ratingsOpen: false,
      ratingsLoaded: false,
      ratingsLoading: false,
      ratingsError: "",
      ratingSections: [],
      chatOpen: false,
      chatLoaded: false,
      chatPending: false,
      chatError: "",
      chatNickname: "",
      chatMessages: [],
      latestChatId: 0,
      chatResetToken: 0,
      chatPoll: null,
      playerStarted: false,
      externalMode: false,
      externalIdentity: "",
      externalRequestToken: 0
    };

    var adapter = adapterApi.createPublicPlayerAdapter({
      window: window,
      document: document,
      labels: text,
      config: {
        widgetUrl: widgetUrl,
        targetSelector: cfg.targetSelector,
        position: cfg.position,
        maxWidth: cfg.maxWidth,
        height: cfg.height
      }
    });

    function isStationPlayer() {
      return state.snapshot.pageKind === "station-player" && state.snapshot.playerPresent;
    }

    function voteUiVisible() {
      return isStationPlayer()
        // Voting applies to every selectable stream.
        // && state.snapshot.mainStreamSelected
        && state.apiStreamActive;
    }

    function render() {
      var voteVisible = voteUiVisible();
      adapter.render({
        voting: {
          visible: voteVisible,
          upvotes: state.votes.upvotes,
          downvotes: state.votes.downvotes,
          myVote: state.votes.my_vote,
          hideDownvotes: state.hideDownvotes,
          pending: state.votePending,
          message: state.voteMessage
        },
        ratings: {
          visible: voteVisible,
          open: voteVisible && state.ratingsOpen,
          hideDownvotes: state.hideDownvotes,
          sections: state.ratingSections,
          error: state.ratingsError
        },
        chat: {
          visible: isStationPlayer(),
          open: isStationPlayer() && state.chatOpen,
          nickname: state.chatNickname,
          messages: state.chatMessages,
          pending: state.chatPending,
          error: state.chatError,
          resetToken: state.chatResetToken
        }
      });
    }

    function loadConfig() {
      return fetchJson(apiPath("config")).then(function (config) {
        state.hideDownvotes = !!config.hidePublicDownvotes;
        render();
      }).catch(function () {});
    }

    function loadNowPlaying() {
      if (!isStationPlayer() || state.externalMode) return Promise.resolve();
      return fetchJson(apiPath("now-playing")).then(function (data) {
        if (state.externalMode) return;
        state.apiStreamActive = data.stream_active === true;
        state.songKey = data.song && data.song.song_key || "";
        state.votes = data.votes || { upvotes: 0, downvotes: 0, my_vote: null };
        state.voteMessage = "";
        render();
      }).catch(function () {
        if (state.externalMode) return;
        state.apiStreamActive = false;
        state.voteMessage = text.loadError;
        render();
      });
    }

    function disableExternalVoting(message) {
      state.apiStreamActive = false;
      state.songKey = "";
      state.votes = { upvotes: 0, downvotes: 0, my_vote: null };
      state.voteMessage = message || "";
      render();
    }

    function invalidateExternalMetadata(message) {
      state.externalIdentity = "";
      state.externalRequestToken += 1;
      disableExternalVoting(message);
    }

    function externalRequestIsCurrent(requestToken, identity) {
      return state.externalMode && requestToken === state.externalRequestToken && identity === state.externalIdentity;
    }

    function handleExternalMetadata(metadata) {
      metadata = metadata || {};
      if (metadata.active !== true) {
        var wasExternal = state.externalMode;
        state.externalMode = false;
        if (wasExternal) {
          invalidateExternalMetadata("");
          loadNowPlaying();
        } else {
          state.externalIdentity = "";
          state.externalRequestToken += 1;
        }
        return;
      }

      state.externalMode = true;
      if (metadata.available !== true) {
        invalidateExternalMetadata("");
        return;
      }

      var sourceId = String(metadata.source || "").trim();
      var artist = String(metadata.artist || "").trim();
      var title = String(metadata.title || "").trim();
      if (!sourceId || !artist || !title) {
        invalidateExternalMetadata("");
        return;
      }

      var identity = sourceId + "\u0000" + artist + "\u0000" + title;
      if (identity === state.externalIdentity) return;
      state.externalIdentity = identity;
      state.externalRequestToken += 1;
      var requestToken = state.externalRequestToken;
      disableExternalVoting("");

      fetchJson(apiPath("external-now-playing"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artist: artist, title: title })
      }).then(function (data) {
        if (!externalRequestIsCurrent(requestToken, identity)) return;
        state.apiStreamActive = true;
        state.songKey = data.song && data.song.song_key || "";
        state.votes = data.votes || { upvotes: 0, downvotes: 0, my_vote: null };
        state.voteMessage = "";
        render();
      }).catch(function () {
        if (!externalRequestIsCurrent(requestToken, identity)) return;
        disableExternalVoting(text.loadError);
      });
    }

    function submitVote(vote) {
      if (state.votePending || !voteUiVisible() || !state.songKey) return;
      var submittedSongKey = state.songKey;
      state.votePending = true;
      state.voteMessage = "";
      render();
      fetchJson(apiPath("vote"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ song_key: submittedSongKey, vote: vote })
      }).then(function (data) {
        if (state.songKey !== submittedSongKey) return;
        state.apiStreamActive = data.stream_active !== false;
        state.votes = data.votes || state.votes;
      }).catch(function (error) {
        if (state.songKey !== submittedSongKey) return;
        state.voteMessage = error.message || text.voteError;
      }).finally(function () {
        state.votePending = false;
        render();
      });
    }

    function loadRatings() {
      if (state.ratingsLoading) return;
      state.ratingsLoading = true;
      state.ratingsError = "";
      render();
      Promise.all([
        fetchJson(apiPath("top?limit=8")),
        fetchJson(apiPath("bottom?limit=6"))
      ]).then(function (results) {
        state.ratingSections = [
          { title: text.topRated, songs: results[0].songs || [] },
          { title: text.lowRated, songs: results[1].songs || [] }
        ];
        state.ratingsLoaded = true;
      }).catch(function () {
        state.ratingsError = text.ratingsError;
      }).finally(function () {
        state.ratingsLoading = false;
        render();
      });
    }

    function toggleRatings(open) {
      state.ratingsOpen = !!open;
      if (state.ratingsOpen) {
        state.chatOpen = false;
        stopChatPolling();
      }
      if (state.ratingsOpen && !state.ratingsLoaded) loadRatings();
      render();
    }

    function mergeMessages(messages, replace) {
      var merged = replace ? [] : state.chatMessages.slice();
      var byId = {};
      merged.forEach(function (message) { byId[message.id] = message; });
      (messages || []).forEach(function (message) { byId[message.id] = message; });
      state.chatMessages = Object.keys(byId).map(function (id) { return byId[id]; }).sort(function (left, right) { return left.id - right.id; });
    }

    function loadChat(initial) {
      if (!state.chatOpen) return Promise.resolve();
      var query = initial || !state.chatLoaded ? "?limit=50" : "?after=" + state.latestChatId + "&limit=100";
      return fetchJson(apiPath("chat/messages" + query)).then(function (data) {
        state.chatNickname = data.nickname || state.chatNickname;
        mergeMessages(data.messages, initial || !state.chatLoaded);
        state.latestChatId = Number(data.latest_id || state.latestChatId || 0);
        state.chatLoaded = true;
        state.chatError = "";
        render();
      }).catch(function () {
        state.chatError = text.chatLoadError;
        render();
      });
    }

    function stopChatPolling() {
      if (state.chatPoll) window.clearInterval(state.chatPoll);
      state.chatPoll = null;
    }

    function startChatPolling() {
      stopChatPolling();
      state.chatPoll = window.setInterval(function () { loadChat(false); }, 5000);
    }

    function toggleChat(open) {
      state.chatOpen = !!open;
      if (state.chatOpen) {
        state.ratingsOpen = false;
        loadChat(!state.chatLoaded);
        startChatPolling();
      } else {
        stopChatPolling();
      }
      render();
    }

    function postChat(message) {
      var body = String(message || "").trim();
      if (!body || Array.from(body).length > 200) {
        state.chatError = text.chatLengthError;
        render();
        return;
      }
      if (state.chatPending || !state.chatOpen) return;
      state.chatPending = true;
      state.chatError = "";
      render();
      fetchJson(apiPath("chat/messages"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: body })
      }).then(function (data) {
        mergeMessages([data.message], false);
        state.latestChatId = Math.max(state.latestChatId, Number(data.message.id || 0));
        state.chatNickname = data.message.nickname || state.chatNickname;
        state.chatResetToken += 1;
      }).catch(function (error) {
        state.chatError = error.message || text.chatPostError;
      }).finally(function () {
        state.chatPending = false;
        render();
      });
    }

    function onExternalMetadata(event) {
      handleExternalMetadata(event.detail);
    }

    window.addEventListener("azuravote:external-metadata", onExternalMetadata);
    if (window.AZURAVOTE_EXTERNAL_METADATA) {
      handleExternalMetadata(window.AZURAVOTE_EXTERNAL_METADATA);
    }

    adapter.install({
      onVote: submitVote,
      onRatingsToggle: toggleRatings,
      onChatToggle: toggleChat,
      onChatSubmit: postChat
    });

    var unobserve = adapter.observe(function (snapshot) {
      state.snapshot = snapshot;
      if (isStationPlayer()) {
        if (!state.playerStarted) {
          state.playerStarted = true;
          loadConfig().then(loadNowPlaying);
        }
      } else {
        state.playerStarted = false;
        state.ratingsOpen = false;
        state.chatOpen = false;
        stopChatPolling();
      }
      render();
    });

    var nowPlayingPoll = window.setInterval(loadNowPlaying, 15000);
    window.addEventListener("beforeunload", function () {
      window.clearInterval(nowPlayingPoll);
      window.removeEventListener("azuravote:external-metadata", onExternalMetadata);
      stopChatPolling();
      unobserve();
      adapter.dispose();
    }, { once: true });
  });
})();
