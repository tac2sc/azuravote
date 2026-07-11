(function () {
  var root = document.querySelector(".azsv-widget");
  if (!root) return;

  var translations = {
    en: {
      htmlLang: "en",
      pageTitle: "Song voting",
      label: "Song rating",
      title: "Vote this track",
      score: "Score",
      voteButtons: "Vote buttons",
      like: "Like",
      dislike: "Dislike",
      likes: "Likes",
      dislikes: "Dislikes",
      loadError: "Unable to load vote totals",
      voteThanks: "Thanks for voting",
      voteError: "Unable to save vote"
    },
    es: {
      htmlLang: "es",
      pageTitle: "Votación de canciones",
      label: "Calificación de la canción",
      title: "Vota esta canción",
      score: "Puntuación",
      voteButtons: "Botones de votación",
      like: "Me gusta",
      dislike: "No me gusta",
      likes: "Me gusta",
      dislikes: "No me gusta",
      loadError: "No se pudieron cargar los votos",
      voteThanks: "Gracias por votar",
      voteError: "No se pudo guardar el voto"
    },
    ru: {
      htmlLang: "ru",
      pageTitle: "Оценка трека",
      label: "Рейтинг трека",
      title: "Оцените трек",
      score: "Счёт",
      voteButtons: "Кнопки голосования",
      like: "Нравится",
      dislike: "Не нравится",
      likes: "Нравится",
      dislikes: "Не нравится",
      loadError: "Не удалось загрузить голоса",
      voteThanks: "Спасибо за голос",
      voteError: "Не удалось сохранить голос"
    },
    uk: {
      htmlLang: "uk",
      pageTitle: "Оцінка треку",
      label: "Рейтинг треку",
      title: "Оцініть трек",
      score: "Рахунок",
      voteButtons: "Кнопки голосування",
      like: "Подобається",
      dislike: "Не подобається",
      likes: "Подобається",
      dislikes: "Не подобається",
      loadError: "Не вдалося завантажити голоси",
      voteThanks: "Дякуємо за голос",
      voteError: "Не вдалося зберегти голос"
    }
  };

  function getLocale() {
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < languages.length; i += 1) {
      var code = String(languages[i] || "").toLowerCase().split("-")[0];
      if (translations[code]) return code;
    }
    return "en";
  }

  var locale = getLocale();
  var text = translations[locale] || translations.en;

  function applyLocale() {
    document.documentElement.lang = text.htmlLang || locale;
    document.title = text.pageTitle;

    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      var key = el.getAttribute("data-i18n");
      if (text[key]) el.textContent = text[key];
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-title]"), function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (text[key]) el.title = text[key];
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria-label]"), function (el) {
      var key = el.getAttribute("data-i18n-aria-label");
      if (text[key]) el.setAttribute("aria-label", text[key]);
    });
  }

  var state = { songKey: "", pending: false, streamActive: true };
  var els = {
    upvotes: root.querySelector("[data-upvotes]"),
    downvotes: root.querySelector("[data-downvotes]"),
    score: root.querySelector("[data-score]"),
    message: root.querySelector("[data-message]"),
    downvoteStat: root.querySelector("[data-downvote-stat]"),
    buttons: Array.prototype.slice.call(root.querySelectorAll("[data-vote]")),
  };

  function apiPath(name) {
    var base = window.location.pathname.replace(/\/widget(?:\.html)?\/?$/, "");
    return (base || "") + "/api/" + name;
  }

  function setWidgetVisible(visible) {
    state.streamActive = visible;
    root.hidden = !visible;
  }
  function setMessage(messageKeyOrText) {
    els.message.textContent = text[messageKeyOrText] || messageKeyOrText || "";
  }

  function setPending(value) {
    state.pending = value;
    els.buttons.forEach(function (button) { button.disabled = value; });
  }

  function updateVoteButtons(myVote) {
    els.buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.vote) === Number(myVote)));
    });
  }

  function render(data) {
    if (data.stream_active === false) {
      state.songKey = "";
      setWidgetVisible(false);
      return;
    }
    setWidgetVisible(true);
    var song = data.song || {};
    var votes = data.votes || {};
    state.songKey = song.song_key || "";
    els.upvotes.textContent = votes.upvotes || 0;
    els.downvotes.textContent = votes.downvotes || 0;
    els.score.textContent = votes.score || 0;
    updateVoteButtons(votes.my_vote);
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || "Request failed");
        return body;
      });
    });
  }

  function loadConfig() {
    return fetchJson(apiPath("config")).then(function (cfg) {
      root.dataset.theme = cfg.theme === "light" ? "light" : "dark";
      if (cfg.hidePublicDownvotes && els.downvoteStat) els.downvoteStat.hidden = true;
    }).catch(function () {});
  }

  function loadNowPlaying() {
    return fetchJson(apiPath("now-playing"))
      .then(function (data) {
        render(data);
        setMessage("");
      })
      .catch(function () {
        setWidgetVisible(false);
        setMessage("loadError");
      });
  }

  function submitVote(vote) {
    if (state.pending || !state.streamActive) return;
    setPending(true);
    fetchJson(apiPath("vote"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song_key: state.songKey, vote: vote }),
    }).then(function (data) {
      render(data);
      setMessage("voteThanks");
    }).catch(function (error) {
      setMessage(error.message || "voteError");
    }).finally(function () {
      setPending(false);
    });
  }

  applyLocale();

  els.buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      submitVote(Number(button.dataset.vote));
    });
  });

  loadConfig().then(loadNowPlaying);
  window.setInterval(loadNowPlaying, 15000);
})();
