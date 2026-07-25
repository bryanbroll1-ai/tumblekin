import { boardZoneName, getCurrentPlayer, getMyPlayer, isHost, isMyTurn, joinUrlFor, sortByStanding } from "../game/GameState.js?v=tumblekin72";
import { playerStatus } from "../game/Player.js?v=tumblekin72";
import { MINIGAME_CATALOG, gestureMeta, minigameMeta } from "../minigames/catalog.js?v=tumblekin72";

export class UIManager {
  constructor(handlers, feedback = null) {
    this.handlers = handlers;
    this.feedback = feedback;
    this.state = null;
    this.myPlayerId = null;
    this.controlledPlayerId = null;
    this.connectionStatus = "online";
    this.connectionMessage = "";
    this.actionInFlight = false;
    this.devMinigameType = "bounceArena";
    this.toastTimer = null;
    this.transitionTimer = null;
    this.lastQrCode = "";
    this.config = { lanUrls: [] };
    this.screens = [...document.querySelectorAll(".screen")];
    this.roomLabels = [...document.querySelectorAll("[data-room-code]")];
    this.bindElements();
    this.bindEvents();
    this.prefillFromStorage();
    this.loadConfig();
    this.showScreen("start");
  }

  render(state, myPlayerId) {
    this.state = state;
    this.myPlayerId = myPlayerId;
    if (state?.status !== "minigame") {
      this.hideIntro();
      this.introMinigameId = null;
    }
    if (state?.status !== "result") this.clearResultTimers();
    // The in-game menu lives on every screen of a running match.
    const inMatch = Boolean(state && ["board", "minigame", "result", "end"].includes(state.status));
    if (this.el.gameMenuButton) this.el.gameMenuButton.hidden = !inMatch;
    if (!inMatch) this.toggleGameMenu(false);
    if (!state) {
      this.showScreen("start");
      return;
    }

    this.roomLabels.forEach((element) => {
      element.textContent = state.code;
    });

    if (state.status === "lobby") {
      this.showScreen("lobby");
      this.renderLobby();
    } else if (state.status === "board") {
      this.showScreen("board");
      this.renderBoard();
    } else if (state.status === "minigame") {
      this.showScreen("minigame");
      this.renderMinigame();
    } else if (state.status === "result") {
      this.showScreen("result");
      this.renderResult();
    } else if (state.status === "end") {
      this.showScreen("end");
      this.renderEnd();
    }
  }

  showToast(message) {
    if (!message) return;
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.classList.add("visible");
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove("visible"), 2400);
  }

  showBoardMove(move) {
    const player = this.state?.players?.find((candidate) => candidate.id === move.playerId);
    this.el.boardMessage.textContent = `${player?.name || "Figur"} zieht ${move.dice} Felder.`;
    this.el.diceLabel.textContent = `Würfel: ${move.dice}`;
  }

  showFieldResult(landing) {
    const message = landing.message || landing.fieldEffect?.message;
    if (!message) return;
    this.el.boardMessage.textContent = message;
    this.showToast(message);
  }

  bindElements() {
    this.el = {
      toast: document.getElementById("toast"),
      connectionBanner: document.getElementById("connection-banner"),
      sceneTransition: document.getElementById("scene-transition"),
      name: document.getElementById("player-name"),
      code: document.getElementById("room-code"),
      create: document.getElementById("create-room"),
      join: document.getElementById("join-room"),
      leave: document.getElementById("leave-room"),
      copyLink: document.getElementById("copy-link"),
      qr: document.getElementById("qr-code"),
      lobbyPlayers: document.getElementById("lobby-players"),
      playerCount: document.getElementById("player-count"),
      boardOptions: document.getElementById("board-options"),
      selectedBoardLabel: document.getElementById("selected-board-label"),
      modeOptions: document.getElementById("mode-options"),
      selectedModeLabel: document.getElementById("selected-mode-label"),
      singleOptions: document.getElementById("single-options"),
      selectedSingleLabel: document.getElementById("selected-single-label"),
      startGame: document.getElementById("start-game"),
      addTestPlayers: document.getElementById("add-test-players"),
      enableDevMode: document.getElementById("enable-dev-mode"),
      boardDevController: document.getElementById("board-dev-controller"),
      minigameDevController: document.getElementById("minigame-dev-controller"),
      roundLabel: document.getElementById("round-label"),
      maxRoundLabel: document.getElementById("max-round-label"),
      boardZone: document.getElementById("board-zone-label"),
      currentPlayer: document.getElementById("current-player-label"),
      scoreStrip: document.getElementById("score-strip"),
      itemBar: document.getElementById("item-bar"),
      starTracker: document.getElementById("star-tracker"),
      boardMessage: document.getElementById("board-message"),
      diceLabel: document.getElementById("dice-label"),
      rollDice: document.getElementById("roll-dice"),
      minigameReason: document.getElementById("minigame-reason"),
      intro: document.getElementById("minigame-intro"),
      introReason: document.getElementById("intro-reason"),
      introTitle: document.getElementById("intro-title"),
      introGoal: document.getElementById("intro-goal"),
      introGestureIcon: document.getElementById("intro-gesture-icon"),
      introGestureLabel: document.getElementById("intro-gesture-label"),
      introCount: document.getElementById("intro-count"),
      minigameTitle: document.getElementById("minigame-title"),
      myPlayerLabel: document.getElementById("my-player-label"),
      resultReason: document.getElementById("result-reason"),
      resultWinner: document.getElementById("result-winner"),
      resultList: document.getElementById("result-list"),
      winnerBanner: document.getElementById("winner-banner"),
      finalList: document.getElementById("final-list"),
      restart: document.getElementById("restart-game"),
      gameMenuButton: document.getElementById("game-menu-button"),
      gameMenu: document.getElementById("game-menu"),
      menuToggleSound: document.getElementById("menu-toggle-sound"),
      menuToggleVibration: document.getElementById("menu-toggle-vibration"),
      menuResume: document.getElementById("menu-resume"),
      menuLeave: document.getElementById("menu-leave"),
      menuLeaveCancel: document.getElementById("menu-leave-cancel"),
      menuLeaveConfirm: document.getElementById("menu-leave-confirm")
    };
  }

  // Build version in the menu: the first thing needed for a support request.
  showVersion(version) {
    if (!version) return;
    const target = this.el.gameMenu?.querySelector("[data-menu-view='main']");
    if (!target || target.querySelector(".menu-version")) return;
    const tag = document.createElement("p");
    tag.className = "menu-version";
    tag.textContent = `Version ${version}`;
    target.appendChild(tag);
  }

  // The floating in-game menu: settings plus a confirmed way out of a match.
  toggleGameMenu(open) {
    if (!this.el.gameMenu) return;
    this.el.gameMenu.hidden = !open;
    if (open) this.setMenuView("main");
    this.syncMenuToggles();
  }

  setMenuView(view) {
    this.el.gameMenu?.querySelectorAll("[data-menu-view]").forEach((card) => {
      card.hidden = card.dataset.menuView !== view;
    });
  }

  syncMenuToggles() {
    const sound = this.feedback?.enabled !== false;
    const vibration = this.feedback?.vibrationEnabled !== false;
    if (this.el.menuToggleSound) {
      this.el.menuToggleSound.textContent = sound ? "An" : "Aus";
      this.el.menuToggleSound.classList.toggle("is-off", !sound);
      this.el.menuToggleSound.setAttribute("aria-pressed", String(sound));
    }
    if (this.el.menuToggleVibration) {
      this.el.menuToggleVibration.textContent = vibration ? "An" : "Aus";
      this.el.menuToggleVibration.classList.toggle("is-off", !vibration);
      this.el.menuToggleVibration.setAttribute("aria-pressed", String(vibration));
    }
  }

  bindEvents() {
    this.el.create.addEventListener("click", () => this.safeAction(() => this.handlers.createRoom(this.playerName())));
    this.el.join.addEventListener("click", () => this.safeAction(() => this.handlers.joinRoom(this.el.code.value, this.playerName())));
    this.el.leave.addEventListener("click", () => this.safeAction(() => this.handlers.leaveRoom()));
    this.el.startGame.addEventListener("click", () => this.safeAction(() => this.handlers.startGame()));
    this.el.addTestPlayers.addEventListener("click", () => this.safeAction(() => this.handlers.addTestPlayers()));
    this.el.enableDevMode.addEventListener("click", () => this.safeAction(() => this.handlers.enableDevMode()));
    this.el.rollDice.addEventListener("click", () => this.safeAction(() => this.handlers.rollDice()));
    this.el.restart.addEventListener("click", () => this.safeAction(() => this.handlers.restartGame()));
    this.el.copyLink.addEventListener("click", () => this.safeAction(() => this.copyJoinLink()));
    this.el.modeOptions?.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => this.safeAction(() => this.handlers.selectMode(button.dataset.mode)));
    });
    this.el.gameMenuButton?.addEventListener("click", () => {
      this.feedback?.sound("tap");
      this.toggleGameMenu(this.el.gameMenu?.hidden !== false);
    });
    this.el.menuResume?.addEventListener("click", () => this.toggleGameMenu(false));
    this.el.gameMenu?.addEventListener("click", (event) => {
      if (event.target === this.el.gameMenu) this.toggleGameMenu(false);
    });
    this.el.menuToggleSound?.addEventListener("click", () => {
      this.feedback?.setSoundEnabled?.(!(this.feedback?.enabled !== false));
      this.feedback?.sound("tap");
      this.syncMenuToggles();
    });
    this.el.menuToggleVibration?.addEventListener("click", () => {
      this.feedback?.setVibrationEnabled?.(!(this.feedback?.vibrationEnabled !== false));
      this.feedback?.vibrate(14);
      this.syncMenuToggles();
    });
    // Leaving needs an explicit confirmation step.
    this.el.menuLeave?.addEventListener("click", () => this.setMenuView("confirm"));
    this.el.menuLeaveCancel?.addEventListener("click", () => this.setMenuView("main"));
    this.el.menuLeaveConfirm?.addEventListener("click", () => this.safeAction(async () => {
      this.toggleGameMenu(false);
      await this.handlers.leaveRoom();
    }));
    this.el.code.addEventListener("input", () => {
      this.el.code.value = this.el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    });
  }

  prefillFromStorage() {
    const savedName = localStorage.getItem("tumblekin-name") || localStorage.getItem("party-board-name");
    this.el.name.value = savedName || "";
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("room");
    if (codeFromUrl) this.el.code.value = codeFromUrl.toUpperCase();
    // Requested via URL, but only granted once /config confirms this build
    // ships dev tools (see loadConfig).
    this.devToolsRequested = params.get("dev") === "1";
    this.devToolsAllowed = false;
  }

  playerName() {
    const name = this.el.name.value.trim() || "Spieler";
    localStorage.setItem("tumblekin-name", name);
    return name;
  }

  async safeAction(action) {
    if (this.actionInFlight) return;
    this.actionInFlight = true;
    try {
      await action();
    } catch (error) {
      this.feedback?.sound("error");
      this.feedback?.vibrate([25, 30, 25]);
      this.showToast(error.message || "Aktion fehlgeschlagen.");
    } finally {
      this.actionInFlight = false;
    }
  }

  async loadConfig() {
    try {
      const response = await fetch("/config");
      this.config = await response.json();
      this.lastQrCode = "";
      // The URL flag only asks for dev tools; the server decides whether this
      // build has them at all.
      this.devToolsAllowed = this.devToolsRequested && this.config.devTools === true;
      this.showVersion(this.config.version);
      if (this.state?.status === "lobby") this.renderLobby();
      else if (this.state) this.render(this.state, this.myPlayerId);
    } catch (_error) {
      this.config = { lanUrls: [] };
      this.devToolsAllowed = false;
    }
  }

  showScreen(name) {
    document.body.dataset.screen = name;
    this.screens.forEach((screen) => {
      screen.classList.toggle("active", screen.id === `screen-${name}`);
    });
  }

  setConnectionStatus(status, message = "") {
    if (this.connectionStatus === status && this.connectionMessage === message) return;
    this.connectionStatus = status;
    this.connectionMessage = message;
    const offline = status !== "online";
    this.el.connectionBanner.hidden = !offline;
    this.el.connectionBanner.textContent = message;
    if (offline) {
      this.feedback?.sound("error");
      this.feedback?.vibrate([35, 40, 35]);
    }
  }

  playSceneTransition(kind) {
    if (!this.el.sceneTransition) return;
    clearTimeout(this.transitionTimer);
    this.el.sceneTransition.classList.remove("active");
    this.el.sceneTransition.dataset.kind = kind;
    this.el.sceneTransition.setAttribute("aria-hidden", "false");
    void this.el.sceneTransition.offsetWidth;
    this.el.sceneTransition.classList.add("active");
    this.transitionTimer = setTimeout(() => {
      this.el.sceneTransition.classList.remove("active");
      this.el.sceneTransition.setAttribute("aria-hidden", "true");
    }, 820);
  }

  getControlledPlayerId() {
    return this.controlledPlayerId || this.myPlayerId;
  }

  syncControlledPlayer() {
    if (!this.state) {
      this.controlledPlayerId = null;
      return;
    }
    const hasSelected = this.state.players.some((player) => player.id === this.controlledPlayerId);
    if (!hasSelected) this.controlledPlayerId = this.myPlayerId;

    const current = getCurrentPlayer(this.state);
    const localDevHost = this.state.devMode && isHost(this.state, this.myPlayerId);
    if (localDevHost && this.state.status === "board" && current?.isLocalDev) {
      this.controlledPlayerId = current.id;
    }
  }

  renderLobby() {
    const state = this.state;
    const host = isHost(state, this.myPlayerId);
    this.el.playerCount.textContent = `${state.players.length}/4`;
    this.el.lobbyPlayers.innerHTML = state.players.map((player, index) => `
      <li class="player-card ${player.connected === false ? "offline" : ""}" style="--player-color:${player.color}">
        <span class="player-dot avatar-${index % 4}" style="background:${player.color}"></span>
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-meta">${(player.wins || 0) > 0 ? `🏆 ${player.wins} · ` : ""}${playerStatus(player)}</span>
      </li>
    `).join("");
    this.el.startGame.disabled = !host || (!state.devMode && state.players.length < 2);
    this.el.startGame.textContent = !host || state.devMode || state.players.length >= 2
      ? "Runde starten"
      : "Warte auf Mitspieler ...";
    this.el.addTestPlayers.disabled = !host || state.players.length >= 4;
    this.el.enableDevMode.hidden = !this.devToolsAllowed;
    this.el.enableDevMode.disabled = !host || state.players.length > 1;
    this.renderModeOptions(host);
    this.renderBoardOptions(host);
    this.renderQrCode();
    this.renderDevControllers();
  }

  renderModeOptions(host) {
    const mode = this.state?.mode || "board";
    if (this.el.selectedModeLabel) {
      this.el.selectedModeLabel.textContent = mode === "arcade"
        ? "Minispiel-Marathon"
        : mode === "single" ? "Einzelspiel" : "Brettspiel";
    }
    this.el.modeOptions?.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
      button.disabled = !host;
    });
    // The board picker only matters in board mode; the game picker in single.
    const boardPanel = this.el.boardOptions?.closest(".board-picker-panel");
    if (boardPanel) boardPanel.hidden = mode !== "board";
    const singlePanel = this.el.singleOptions?.closest(".single-picker-panel");
    if (singlePanel) singlePanel.hidden = mode !== "single";
    if (mode === "single") this.renderSingleOptions(host);
  }

  renderSingleOptions(host) {
    const selected = this.state?.singleType || null;
    const games = MINIGAME_CATALOG;
    if (this.el.selectedSingleLabel) {
      this.el.selectedSingleLabel.textContent = games.find((game) => game.type === selected)?.title || "Zufällig";
    }
    if (!this.el.singleOptions) return;
    const signature = `${selected}|${host}|${games.length}`;
    if (this.el.singleOptions.dataset.signature !== signature) {
      this.el.singleOptions.dataset.signature = signature;
      this.el.singleOptions.innerHTML = games.map((game) => `
        <button type="button" class="single-option ${game.type === selected ? "is-active" : ""}" data-single-game="${game.type}" ${host ? "" : "disabled"}>
          <strong>${escapeHtml(game.title)}</strong>
          <span>${escapeHtml(game.help)}</span>
        </button>
      `).join("");
      this.el.singleOptions.querySelectorAll("[data-single-game]").forEach((button) => {
        button.addEventListener("click", () => this.safeAction(() => this.handlers.selectSingleGame(button.dataset.singleGame)));
      });
    }
  }

  renderBoard() {
    this.syncControlledPlayer();
    const state = this.state;
    const current = getCurrentPlayer(state);
    const selectedPlayerId = this.getControlledPlayerId();
    const localDevHost = state.devMode && isHost(state, this.myPlayerId);
    const myTurn = isMyTurn(state, this.myPlayerId)
      || (localDevHost && state.phase === "waitingRoll" && current?.id === selectedPlayerId);
    this.el.roundLabel.textContent = state.round;
    this.el.maxRoundLabel.textContent = state.maxRounds;
    this.el.boardZone.textContent = boardZoneName(state, current?.position || 0);
    this.el.currentPlayer.textContent = current?.name || "-";
    this.el.currentPlayer.closest(".turn-pill")?.style.setProperty("--active-player", current?.color || "#ffe25c");
    this.el.boardMessage.textContent = state.lastMessage || "Warte auf den nächsten Zug.";
    const pendingModifiers = [
      current?.nextRollBoost ? `+${current.nextRollBoost}` : "",
      current?.nextRollPenalty ? `-${current.nextRollPenalty}` : ""
    ].filter(Boolean).join(" ");
    this.el.diceLabel.textContent = state.phase === "moving" && state.lastMove?.dice
      ? `Würfel: ${state.lastMove.dice}`
      : (pendingModifiers
          ? `Nächster Wurf ${pendingModifiers}`
          : (current?.diceValue ? `Letzter Wurf: ${current.diceValue}` : "Würfel bereit"));
    this.el.rollDice.disabled = !myTurn || current?.connected === false;
    this.el.rollDice.textContent = myTurn ? "Würfeln" : (current?.connected === false ? "Offline" : (current?.isBot ? "Bot würfelt ..." : "Warten"));
    this.el.scoreStrip.innerHTML = state.players.map((player, index) => `
      <div class="score-chip ${player.id === current?.id ? "current" : ""} ${player.connected === false ? "offline" : ""}"
        style="--chip-color:${player.color}"
        title="${escapeHtml(player.name)}: ${player.stars || 0} Sterne, ${player.coins} Münzen">
        <span class="player-dot avatar-${index % 4}" style="background:${player.color}"></span>
        <span class="score-name">${escapeHtml(shortName(player.name))}</span>
        <strong><span class="star-count">★ ${player.stars || 0}</span><span class="coin-count">● ${player.coins}</span></strong>
      </div>
    `).join("");
    this.renderStarTracker(state);
    this.renderItemBar(state, myTurn);
    this.renderDevControllers();
  }

  // The lit star is the whole point of the board, but the camera follows the
  // active player, so the 3D beacon is frequently off screen. This tracker
  // always answers the two questions that drive the turn: how far away is the
  // star, and can I afford it?
  renderStarTracker(state) {
    const el = this.el.starTracker;
    if (!el) return;
    const index = state.starIndex;
    const size = state.fieldTypes?.length || 32;
    const me = getMyPlayer(state, this.getControlledPlayerId()) || getMyPlayer(state, this.myPlayerId);
    if (index === null || index === undefined || !me) {
      el.hidden = true;
      return;
    }
    const distance = (index - (me.position || 0) + size) % size;
    const price = state.starPrice ?? 20;
    const short = Math.max(0, price - me.coins);
    el.hidden = false;
    el.classList.toggle("is-close", distance > 0 && distance <= 6);
    el.classList.toggle("is-here", distance === 0);
    el.innerHTML = `
      <span class="star-tracker-icon">⭐</span>
      <span class="star-tracker-copy">
        <strong>${distance === 0 ? "Du stehst am Stern!" : `${distance} ${distance === 1 ? "Feld" : "Felder"}`}</strong>
        <small>${short > 0 ? `noch ${short} Münzen nötig` : `${price} Münzen — bezahlbar!`}</small>
      </span>
    `;
  }

  // Your hand of items. Only tappable on your own turn before rolling — that
  // is the board's real decision point, so the bar makes it obvious when it is
  // live and greys out otherwise instead of vanishing.
  renderItemBar(state, myTurn) {
    const bar = this.el.itemBar;
    if (!bar) return;
    const mine = getMyPlayer(state, this.getControlledPlayerId()) || getMyPlayer(state, this.myPlayerId);
    const items = mine?.items || [];
    const catalog = state.itemCatalog || [];

    if (!items.length) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    const armed = Boolean(mine?.pendingItem);
    const usable = myTurn && !armed;
    bar.innerHTML = `
      <div class="item-bar-head">
        <span>Deine Items</span>
        ${mine?.shielded ? '<span class="item-shield">🛡️ Schild aktiv</span>' : ""}
        ${armed ? '<span class="item-armed">Würfel-Item bereit</span>' : ""}
      </div>
      <div class="item-cards">
        ${items.map((id, slot) => {
          const meta = catalog.find((entry) => entry.id === id) || { icon: "❔", name: id, help: "" };
          return `
            <button type="button" class="item-card" data-item-id="${escapeHtml(id)}" data-slot="${slot}"
              ${usable ? "" : "disabled"} title="${escapeHtml(meta.help || "")}">
              <span class="item-icon">${meta.icon}</span>
              <span class="item-name">${escapeHtml(meta.name)}</span>
            </button>
          `;
        }).join("")}
      </div>
      <p class="item-hint">${usable
        ? "Vor dem Würfeln einsetzen."
        : (armed ? "Jetzt würfeln — das Item wirkt auf diesen Wurf." : "Nur an deinem Zug einsetzbar.")}</p>
    `;
    bar.querySelectorAll("[data-item-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.itemId;
        this.feedback?.sound("lock");
        this.feedback?.vibrate(14);
        this.safeAction(() => this.handlers.useItem(id));
      });
    });
  }

  renderMinigame() {
    this.syncControlledPlayer();
    const minigame = this.state.currentMinigame;
    const mine = getMyPlayer(this.state, this.getControlledPlayerId()) || getMyPlayer(this.state, this.myPlayerId);
    this.el.minigameTitle.textContent = minigame?.title || "Minispiel";
    this.el.minigameReason.textContent = minigame?.reason || "Tumblekin Challenge";
    this.el.myPlayerLabel.textContent = mine?.name || "-";
    this.syncIntro(minigame);
    this.renderDevControllers();
  }

  // Tutorial card (name, goal, gesture) that hands over to a big 3-2-1-LOS
  // countdown — the same intro flow for every minigame.
  syncIntro(minigame) {
    if (!minigame || this.introMinigameId === minigame.id) return;
    this.introMinigameId = minigame.id;
    clearInterval(this.introTimer);

    const meta = minigameMeta(minigame.type);
    const gesture = gestureMeta(minigame.type);
    this.el.introTitle.textContent = minigame.title;
    this.el.introGoal.textContent = meta?.help || "Sammle die meisten Punkte.";
    this.el.introGestureIcon.textContent = gesture.icon;
    this.el.introGestureLabel.textContent = gesture.label;
    this.el.intro.hidden = false;
    this.el.intro.classList.remove("counting");
    this.el.introCount.hidden = true;

    const clockOffset = (this.state?.serverTime || Date.now()) - Date.now();
    let lastShown = null;
    const step = () => {
      if (this.state?.status !== "minigame" || this.state?.currentMinigame?.id !== minigame.id) {
        this.hideIntro();
        return;
      }
      const remaining = minigame.startedAt - (Date.now() + clockOffset);
      if (remaining > 3400) return;
      if (remaining <= -600) {
        this.hideIntro();
        return;
      }
      this.el.intro.classList.add("counting");
      const value = remaining > 0 ? String(Math.min(3, Math.ceil(remaining / 1000))) : "LOS!";
      if (value !== lastShown) {
        lastShown = value;
        this.el.introCount.hidden = false;
        this.el.introCount.textContent = value;
        this.el.introCount.classList.toggle("go", value === "LOS!");
        this.el.introCount.classList.remove("pop");
        void this.el.introCount.offsetWidth;
        this.el.introCount.classList.add("pop");
        if (value === "LOS!") {
          this.feedback?.sound("success");
          this.feedback?.vibrate([20, 24, 40]);
        } else {
          this.feedback?.sound("countdown");
          this.feedback?.vibrate(14);
        }
      }
    };
    this.introTimer = setInterval(step, 90);
    step();
  }

  hideIntro() {
    clearInterval(this.introTimer);
    this.introTimer = null;
    this.el.intro.hidden = true;
    this.el.intro.classList.remove("counting");
  }

  renderResult() {
    const result = this.state.lastMinigameResult;
    const isNewResult = this.shownResultId !== result?.id;
    this.el.resultReason.textContent = result ? `${result.reason} · ${result.title}` : "Ergebnis";
    const ranking = result?.ranking || [];
    const winner = ranking[0];
    const winners = winner ? ranking.filter((entry) => entry.score === winner.score) : [];
    const winnerNames = winners.map((entry) => escapeHtml(entry.name)).join(" & ");
    const tie = winners.length > 1;

    // Placements are revealed from last place up to the winner.
    const revealStep = 0.55;
    const winnerDelay = ranking.length * revealStep + 0.25;
    this.el.resultWinner.hidden = !winner;
    this.el.resultWinner.style.setProperty("--winner-color", winner?.color || "#ffe25c");
    this.el.resultWinner.style.setProperty("--reveal-delay", isNewResult ? `${winnerDelay}s` : "0s");
    this.el.resultWinner.innerHTML = winner ? `
      <span class="player-dot" style="background:${winner.color}"></span>
      <strong>${tie ? `${winnerNames} teilen Platz 1!` : `${winnerNames} gewinnt!`}</strong>
      <span>${formatResultMetric(winner)} · ${tie ? "je " : ""}+${countNoun(winner.award, "Münzen")}</span>
      ${tie ? '<span class="tie-badge">Gleichstand!</span>' : ""}
    ` : "";

    let displayedRank = 0;
    let previousScore = null;
    this.el.resultList.innerHTML = ranking.map((entry, index) => {
      if (entry.score !== previousScore) displayedRank = index + 1;
      previousScore = entry.score;
      const delay = isNewResult ? (ranking.length - 1 - index) * revealStep : 0;
      return `
        <li class="ranking-card revealing" style="--rank-color:${entry.color}; --reveal-delay:${delay}s">
          <span class="rank-number">${displayedRank}</span>
          <span class="player-name">${escapeHtml(entry.name)}</span>
          <span class="player-meta">${formatResultMetric(entry)} · +${countNoun(entry.award, "Münzen")}</span>
        </li>
      `;
    }).join("");

    if (isNewResult && ranking.length) {
      this.shownResultId = result.id;
      this.clearResultTimers();
      this.resultTimers = ranking.map((entry, index) => setTimeout(() => {
        this.feedback?.sound("pop");
        this.feedback?.vibrate(10);
      }, ((ranking.length - 1 - index) * revealStep + 0.15) * 1000));
      this.resultTimers.push(setTimeout(() => {
        this.feedback?.sound("win");
        this.feedback?.vibrate([30, 30, 60]);
      }, winnerDelay * 1000));
    }
    this.renderDevControllers();
  }

  clearResultTimers() {
    (this.resultTimers || []).forEach((timer) => clearTimeout(timer));
    this.resultTimers = [];
  }

  renderEnd() {
    const arcadeMode = this.state.mode === "arcade";
    const winners = this.state.players.filter((player) => this.state.winnerIds.includes(player.id));
    this.el.winnerBanner.innerHTML = winners.map((player) => `
      <div><span class="player-dot" style="background:${player.color}"></span> ${escapeHtml(player.name)} mit ${arcadeMode ? `${player.wins || 0} Siegen` : `${player.coins} Münzen`}</div>
    `).join("");
    const ordered = arcadeMode
      ? [...this.state.players].sort((a, b) => ((b.wins || 0) - (a.wins || 0)) || (b.coins - a.coins))
      : sortByStanding(this.state.players);
    this.el.finalList.innerHTML = ordered.map((player, index) => `
      <li class="ranking-card" style="--rank-color:${player.color}">
        <span class="rank-number">${index + 1}</span>
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-meta">${arcadeMode ? `🏆 ${player.wins || 0} Siege · ● ${player.coins}` : `● ${player.coins} Münzen`}</span>
      </li>
    `).join("");
    this.el.restart.disabled = !isHost(this.state, this.myPlayerId);
    this.renderDevControllers();
  }

  renderDevControllers() {
    const containers = [this.el.boardDevController, this.el.minigameDevController];
    containers.forEach((container) => {
      if (!container) return;
      const screenOk = (this.state?.status === "board" && container === this.el.boardDevController)
        || (this.state?.status === "minigame" && container === this.el.minigameDevController);
      const enabled = Boolean(this.state?.devMode && isHost(this.state, this.myPlayerId) && screenOk);
      container.hidden = !enabled;
      if (!enabled) {
        container.innerHTML = "";
        return;
      }

      const selectedId = this.getControlledPlayerId();
      container.innerHTML = `
        <div class="dev-controller-title">Dev-Controller</div>
        <div class="dev-player-row">
          ${this.state.players.map((player) => `
            <button class="dev-player-btn ${player.id === selectedId ? "active" : ""} ${player.connected === false ? "offline" : ""}"
              type="button"
              style="--dev-color:${player.color}"
              data-player-id="${player.id}">
              ${escapeHtml(shortName(player.name))}
            </button>
          `).join("")}
        </div>
        ${this.state.status === "board" ? `
          <div class="dev-game-launcher">
            <select class="dev-game-select" aria-label="Dev-Challenge auswählen" data-dev-game-select>
              ${MINIGAME_CATALOG.map((game) => `<option value="${game.type}" ${game.type === this.devMinigameType ? "selected" : ""}>${game.title}</option>`).join("")}
            </select>
            <button class="dev-challenge-btn" type="button" data-dev-challenge>Start</button>
          </div>
        ` : ""}
      `;
      container.querySelectorAll("[data-player-id]").forEach((button) => {
        button.addEventListener("click", () => {
          this.controlledPlayerId = button.dataset.playerId;
          this.feedback?.sound("tap");
          this.feedback?.vibrate(12);
          this.renderDevControllers();
          if (this.state?.status === "minigame") this.renderMinigame();
          if (this.state?.status === "board") this.renderBoard();
        });
      });
      container.querySelector("[data-dev-game-select]")?.addEventListener("change", (event) => {
        this.devMinigameType = event.currentTarget.value;
      });
      container.querySelector("[data-dev-challenge]")?.addEventListener("click", () => {
        this.feedback?.sound("impact");
        this.feedback?.vibrate([14, 18, 30]);
        const selectedType = container.querySelector("[data-dev-game-select]")?.value || this.devMinigameType;
        this.devMinigameType = selectedType;
        this.safeAction(() => this.handlers.startDevMinigame(selectedType));
      });
    });
  }

  renderBoardOptions(host) {
    const boards = this.state?.availableBoards || [];
    const selected = boards.find((board) => board.id === this.state?.boardId);
    this.el.selectedBoardLabel.textContent = selected?.shortName || "Spielwelt";
    this.el.boardOptions.innerHTML = boards.map((board) => `
      <button class="board-option ${board.id === this.state.boardId ? "active" : ""}" type="button"
        data-board-id="${board.id}" ${host ? "" : "disabled"} aria-pressed="${board.id === this.state.boardId}">
        <span class="board-preview board-preview-${board.id}" aria-hidden="true">
          <i class="preview-ground"></i>
          <i class="preview-route"></i>
          <i class="preview-mark"></i>
        </span>
        <span class="board-option-copy">
          <span class="board-option-badge">${escapeHtml(board.badge || "Spielwelt")}</span>
          <strong>${escapeHtml(board.shortName)}</strong>
          <small>${escapeHtml(board.subtitle)}</small>
          <em>${escapeHtml(board.feature || "Eigener Rundweg")}</em>
        </span>
        <span class="board-selected-mark" aria-hidden="true">&#10003;</span>
      </button>
    `).join("");
    this.el.boardOptions.querySelectorAll("[data-board-id]").forEach((button) => {
      button.addEventListener("click", () => this.safeAction(() => this.handlers.selectBoard(button.dataset.boardId)));
    });
  }

  renderQrCode() {
    if (!this.state?.code) return;
    const link = this.preferredJoinUrl();
    if (this.lastQrCode === link) return;
    this.lastQrCode = link;
    this.el.qr.src = `/qr.svg?text=${encodeURIComponent(link)}`;
  }

  async copyJoinLink() {
    if (!this.state?.code) return;
    const link = this.preferredJoinUrl();
    await navigator.clipboard.writeText(link);
    this.showToast("Beitrittslink kopiert.");
  }

  preferredJoinUrl() {
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    const baseUrl = localHostnames.has(window.location.hostname) && this.config.lanUrls?.[0]
      ? this.config.lanUrls[0]
      : window.location.href;
    return joinUrlFor(this.state.code, baseUrl);
  }
}

function shortName(name) {
  return String(name || "?").replace(/\s+/g, " ").slice(0, 7);
}

function formatScore(value) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatResultMetric(entry) {
  const detail = entry?.detail;
  if (!detail) return `${formatScore(entry?.score)} Punkte`;
  if (detail.kind === "time") return `${formatMilliseconds(detail.value)} Zielzeit`;
  if (detail.kind === "progress") return `${detail.value}/${detail.total} ${detail.label}`;
  if (detail.kind === "territory") return countNoun(detail.value, detail.label);
  if (detail.kind === "survival") {
    const knockoutText = detail.knockouts ? ` · ${detail.knockouts} K.O.` : "";
    return detail.alive ? `Bis zuletzt auf der Platte${knockoutText}` : `${formatMilliseconds(detail.value)} überlebt${knockoutText}`;
  }
  if (detail.kind === "knockouts") {
    const survived = detail.survivedMs ? ` · ${formatMilliseconds(detail.survivedMs)} auf der Platte` : "";
    return `${countNoun(detail.value, "Rauswürfe")}${survived}`;
  }
  if (detail.kind === "strikes") return `${countNoun(detail.value, "Treffer")} · ${countNoun(detail.passes, "Pässe")}`;
  if (detail.kind === "hits" || detail.kind === "lines") return countNoun(detail.value, detail.label);
  if (detail.kind === "fit") return `${detail.value}/${detail.total} ${detail.label}`;
  if (detail.kind === "coins") return `${countNoun(detail.value, "Münzen")}${detail.mistakes ? ` · ${countNoun(detail.mistakes, "Treffer")}` : ""}`;
  if (detail.kind === "catches") return `${countNoun(detail.value, detail.label)}${detail.mistakes ? ` · ${countNoun(detail.mistakes, "Stürme")}` : ""}`;
  if (detail.kind === "zoneTime") return `${formatMilliseconds(detail.value)} ${detail.label}`;
  if (detail.kind === "correct" || detail.kind === "targets") {
    return `${countNoun(detail.value, detail.label)}${detail.mistakes ? ` · ${countNoun(detail.mistakes, "Fehler")}` : ""}`;
  }
  if (detail.kind === "precision") return `${detail.value} ${detail.label}`;
  if (detail.kind === "points") return `${detail.value} ${detail.label}`;
  return `${formatScore(entry?.score)} Punkte`;
}

const SINGULAR_NOUNS = {
  "Münzen": "Münze",
  "Felder": "Feld",
  "Reihen": "Reihe",
  "Blätter": "Blatt",
  "Lichter": "Licht",
  "Stürme": "Sturm",
  "Pässe": "Pass",
  "Ziele": "Ziel",
  "Rauswürfe": "Rauswurf",
  "Punkte": "Punkt"
};

function countNoun(value, plural) {
  const count = Number(value) || 0;
  const noun = count === 1 ? (SINGULAR_NOUNS[plural] || plural) : plural;
  return `${count} ${noun}`;
}

function formatMilliseconds(value) {
  return `${(Math.max(0, Number(value) || 0) / 1000).toFixed(2).replace(".", ",")} s`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
