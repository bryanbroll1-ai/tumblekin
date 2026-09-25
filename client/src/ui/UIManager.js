import {
  MODES,
  MARATHON_LENGTHS,
  KNOCKOUT_LIVES,
  modeInfo,
  huntTarget,
  getMyPlayer,
  isHost,
  joinUrlFor,
  sortByStanding,
  minigameTitle
} from "../game/GameState.js?v=tumblekin200";
import { playerStatus } from "../game/Player.js?v=tumblekin200";
import { MINIGAME_CATALOG, GESTURES, gestureMeta, minigameMeta } from "../minigames/catalog.js?v=tumblekin200";

// Die Oberfläche über der Bühne: Start, Lobby, Minispiel-Karte, Ergebnis, Ende.
// Sie zeichnet, was der Server schickt, und sagt der Bühne, was sie zeigen soll.
export class UIManager {
  constructor(handlers, feedback = null, stage = null) {
    this.handlers = handlers;
    this.feedback = feedback;
    this.stage = stage;
    this.state = null;
    this.myPlayerId = null;
    this.controlledPlayerId = null;
    this.connectionStatus = "online";
    this.connectionMessage = "";
    this.actionInFlight = false;
    this.toastTimer = null;
    this.transitionTimer = null;
    this.lastQrCode = "";
    this.config = { lanUrls: [] };
    this.screen = null;
    this.picker = null;
    this.screens = [...document.querySelectorAll(".screen")];
    this.roomLabels = [...document.querySelectorAll("[data-room-code]")];
    this.bindElements();
    this.bindEvents();
    this.prefillFromStorage();
    this.loadConfig();
    this.showScreen("start");
    this.stage?.showStart();
    window.addEventListener("resize", () => this.syncStageBand());
  }

  render(state, myPlayerId) {
    this.state = state;
    this.myPlayerId = myPlayerId;
    if (state?.status !== "minigame") {
      this.hideIntro();
      this.introMinigameId = null;
    }
    if (state?.status !== "result") this.clearResultTimers();
    const inMatch = Boolean(state && ["minigame", "result", "end"].includes(state.status));
    this.el.gameMenuButton.hidden = !inMatch;
    if (!inMatch) this.toggleGameMenu(false);
    if (!state) {
      this.closeOverlay("invite");
      this.closePicker();
      this.showScreen("start");
      this.stage?.showStart();
      return;
    }

    this.roomLabels.forEach((element) => { element.textContent = state.code; });

    if (state.status === "lobby") {
      this.showScreen("lobby");
      this.renderLobby();
    } else if (state.status === "minigame") {
      this.closeOverlay("invite");
      this.closePicker();
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

  bindElements() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      toast: $("toast"),
      connectionBanner: $("connection-banner"),
      sceneTransition: $("scene-transition"),
      name: $("player-name"),
      code: $("room-code"),
      create: $("create-room"),
      join: $("join-room"),
      leave: $("leave-room"),
      openInvite: $("open-invite"),
      invite: $("invite"),
      inviteClose: $("invite-close"),
      copyLink: $("copy-link"),
      qr: $("qr-code"),
      lobbyPlayers: $("lobby-players"),
      addBot: $("add-bot"),
      modeTabs: $("mode-tabs"),
      modeDescription: $("mode-description"),
      modeOptions: $("mode-options"),
      startGame: $("start-game"),
      enableDevMode: $("enable-dev-mode"),
      picker: $("picker"),
      pickerTitle: $("picker-title"),
      pickerEyebrow: $("picker-eyebrow"),
      pickerTools: $("picker-tools"),
      pickerGrid: $("picker-grid"),
      pickerCount: $("picker-count"),
      pickerDone: $("picker-done"),
      pickerClose: $("picker-close"),
      minigameDevController: $("minigame-dev-controller"),
      intro: $("minigame-intro"),
      introReason: $("intro-reason"),
      introTitle: $("intro-title"),
      introGoal: $("intro-goal"),
      introExtra: $("intro-extra"),
      introGestureIcon: $("intro-gesture-icon"),
      introGestureLabel: $("intro-gesture-label"),
      introCount: $("intro-count"),
      resultReason: $("result-reason"),
      resultTitle: $("result-title"),
      resultList: $("result-list"),
      standings: $("standings"),
      resultNext: $("result-next"),
      resultReady: $("result-ready"),
      resultTimer: document.querySelector(".result-timer span"),
      endMode: $("end-mode"),
      endTitle: $("end-title"),
      winnerBanner: $("winner-banner"),
      finalList: $("final-list"),
      rematch: $("rematch"),
      restart: $("restart-game"),
      gameMenuButton: $("game-menu-button"),
      gameMenu: $("game-menu"),
      menuToggleSound: $("menu-toggle-sound"),
      menuToggleVibration: $("menu-toggle-vibration"),
      menuResume: $("menu-resume"),
      menuLeave: $("menu-leave"),
      menuLeaveCancel: $("menu-leave-cancel"),
      menuLeaveConfirm: $("menu-leave-confirm")
    };
  }

  bindEvents() {
    const el = this.el;
    el.create.addEventListener("click", () => this.safeAction(() => this.handlers.createRoom(this.playerName())));
    el.join.addEventListener("click", () => this.safeAction(() => this.handlers.joinRoom(el.code.value, this.playerName())));
    el.name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (el.code.value.trim()) el.join.click();
      else el.create.click();
    });
    el.code.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); el.join.click(); }
    });
    el.code.addEventListener("input", () => {
      el.code.value = el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      el.join.classList.toggle("btn-primary", el.code.value.length >= 4);
      el.join.classList.toggle("btn-secondary", el.code.value.length < 4);
    });
    el.leave.addEventListener("click", () => this.safeAction(() => this.handlers.leaveRoom()));
    el.startGame.addEventListener("click", () => this.safeAction(() => this.handlers.startGame()));
    el.addBot.addEventListener("click", () => this.safeAction(() => this.handlers.addBot()));
    el.enableDevMode.addEventListener("click", () => this.safeAction(() => this.handlers.enableDevMode()));
    el.rematch.addEventListener("click", () => this.safeAction(() => this.handlers.rematch()));
    el.restart.addEventListener("click", () => this.safeAction(() => this.handlers.restartGame()));
    el.resultReady.addEventListener("click", () => {
      this.feedback?.sound("tap");
      this.safeAction(() => this.handlers.readyForNext());
    });

    el.openInvite.addEventListener("click", () => {
      this.feedback?.sound("tap");
      this.renderQrCode();
      this.openOverlay("invite");
    });
    el.inviteClose.addEventListener("click", () => this.closeOverlay("invite"));
    el.invite.addEventListener("click", (event) => { if (event.target === el.invite) this.closeOverlay("invite"); });
    el.copyLink.addEventListener("click", () => this.safeAction(() => this.copyJoinLink()));

    el.modeTabs.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (this.state?.mode === button.dataset.mode) return;
        this.feedback?.sound("select");
        this.safeAction(() => this.handlers.selectMode(button.dataset.mode));
      });
    });
    // Optionen werden neu gezeichnet; die Klicks hängen am Behälter.
    el.modeOptions.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-setting]");
      if (chip && !chip.disabled) {
        const value = Number(chip.dataset.value);
        this.feedback?.sound("tap");
        this.safeAction(() => this.handlers.updateSettings({ [chip.dataset.setting]: value }));
        return;
      }
      const open = event.target.closest("[data-open-picker]");
      if (open && !open.disabled) this.openPicker(open.dataset.openPicker);
    });
    el.lobbyPlayers.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-bot]");
      if (remove) {
        this.feedback?.sound("tap");
        this.safeAction(() => this.handlers.removeBot(remove.dataset.removeBot));
        return;
      }
      const chip = event.target.closest("[data-player-chip]");
      if (chip && chip.dataset.playerChip === this.myPlayerId) {
        // Auf sich selbst tippen: die eigene Figur hüpft. Kein Nutzen, nur Spass.
        this.feedback?.sound("pop");
        this.stage?.react(this.myPlayerId, Math.random() < 0.5 ? "hop" : "spin");
      }
    });

    el.pickerClose.addEventListener("click", () => this.closePicker());
    el.picker.addEventListener("click", (event) => { if (event.target === el.picker) this.closePicker(); });
    el.pickerDone.addEventListener("click", () => this.commitPicker());
    el.pickerTools.querySelector("[data-picker-all]").addEventListener("click", () => {
      if (!this.picker) return;
      this.picker.selected = new Set(MINIGAME_CATALOG.map((game) => game.type));
      this.renderPicker();
    });
    el.pickerTools.querySelector("[data-picker-none]").addEventListener("click", () => {
      if (!this.picker) return;
      this.picker.selected = new Set();
      this.renderPicker();
    });
    el.pickerGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-pick]");
      if (!card || !this.picker) return;
      this.feedback?.sound("tap");
      const type = card.dataset.pick;
      if (this.picker.kind === "single") {
        this.picker.selected = new Set(type === "__random" ? [] : [type]);
        this.commitPicker();
        return;
      }
      if (this.picker.selected.has(type)) this.picker.selected.delete(type);
      else this.picker.selected.add(type);
      this.renderPicker();
    });

    el.gameMenuButton.addEventListener("click", () => {
      this.feedback?.sound("tap");
      this.toggleGameMenu(el.gameMenu.hidden !== false);
    });
    el.menuResume.addEventListener("click", () => this.toggleGameMenu(false));
    el.gameMenu.addEventListener("click", (event) => { if (event.target === el.gameMenu) this.toggleGameMenu(false); });
    el.menuToggleSound.addEventListener("click", () => {
      this.feedback?.setSoundEnabled?.(!(this.feedback?.enabled !== false));
      this.feedback?.sound("tap");
      this.syncMenuToggles();
    });
    el.menuToggleVibration.addEventListener("click", () => {
      this.feedback?.setVibrationEnabled?.(!(this.feedback?.vibrationEnabled !== false));
      this.feedback?.vibrate(14);
      this.syncMenuToggles();
    });
    el.menuLeave.addEventListener("click", () => this.setMenuView("confirm"));
    el.menuLeaveCancel.addEventListener("click", () => this.setMenuView("main"));
    el.menuLeaveConfirm.addEventListener("click", () => this.safeAction(async () => {
      this.toggleGameMenu(false);
      await this.handlers.leaveRoom();
    }));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!el.picker.hidden) this.closePicker();
      else if (!el.invite.hidden) this.closeOverlay("invite");
      else if (!el.gameMenu.hidden) this.toggleGameMenu(false);
    });
  }

  // --- Allgemeines ------------------------------------------------------------

  showToast(message) {
    if (!message) return;
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.classList.add("visible");
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove("visible"), 2400);
  }

  showScreen(name) {
    const changed = this.screen !== name;
    this.screen = name;
    document.body.dataset.screen = name;
    this.screens.forEach((screen) => screen.classList.toggle("active", screen.id === `screen-${name}`));
    this.stage?.setActive(name !== "minigame");
    if (changed) requestAnimationFrame(() => this.syncStageBand());
  }

  // Das freie Band zwischen Kopfzeile und Karte vermessen und der Bühne melden.
  syncStageBand() {
    if (!this.stage) return;
    const screen = document.getElementById(`screen-${this.screen}`);
    const band = screen?.querySelector("[data-stage-band]");
    if (band) {
      const rect = band.getBoundingClientRect();
      this.stage.setFocus(rect.top, rect.bottom, rect.left, rect.right);
      return;
    }
    // Startbildschirm: das Band liegt zwischen Schriftzug und Formular.
    const brand = screen?.querySelector(".start-brand")?.getBoundingClientRect();
    const sheet = screen?.querySelector(".sheet")?.getBoundingClientRect();
    if (brand && sheet) this.stage.setFocus(brand.bottom - 10, sheet.top + 20);
    else this.stage.setFocus(0, window.innerHeight);
  }

  setConnectionStatus(status, message = "") {
    if (this.connectionStatus === status && this.connectionMessage === message) return;
    this.connectionStatus = status;
    this.connectionMessage = message;
    const offline = status !== "online";
    this.el.connectionBanner.hidden = !offline;
    this.el.connectionBanner.textContent = message;
    this.el.connectionBanner.dataset.status = status;
    if (offline) {
      this.feedback?.sound("error");
      this.feedback?.vibrate([35, 40, 35]);
    }
  }

  playSceneTransition(kind) {
    const node = this.el.sceneTransition;
    clearTimeout(this.transitionTimer);
    node.classList.remove("active");
    node.dataset.kind = kind;
    void node.offsetWidth;
    node.classList.add("active");
    this.transitionTimer = setTimeout(() => node.classList.remove("active"), 820);
  }

  openOverlay(name) {
    const node = this.el[name];
    if (!node) return;
    node.hidden = false;
  }

  closeOverlay(name) {
    const node = this.el[name];
    if (node) node.hidden = true;
  }

  showVersion(version) {
    if (!version) return;
    const target = this.el.gameMenu.querySelector("[data-menu-view='main']");
    if (!target || target.querySelector(".menu-version")) return;
    const tag = document.createElement("p");
    tag.className = "menu-version";
    tag.textContent = `Version ${version}`;
    target.appendChild(tag);
  }

  toggleGameMenu(open) {
    this.el.gameMenu.hidden = !open;
    if (open) this.setMenuView("main");
    this.syncMenuToggles();
  }

  setMenuView(view) {
    this.el.gameMenu.querySelectorAll("[data-menu-view]").forEach((card) => {
      card.hidden = card.dataset.menuView !== view;
    });
  }

  syncMenuToggles() {
    const sound = this.feedback?.enabled !== false;
    const vibration = this.feedback?.vibrationEnabled !== false;
    [[this.el.menuToggleSound, sound], [this.el.menuToggleVibration, vibration]].forEach(([button, on]) => {
      button.textContent = on ? "An" : "Aus";
      button.classList.toggle("is-off", !on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  prefillFromStorage() {
    let savedName = "";
    try { savedName = localStorage.getItem("tumblekin-name") || ""; } catch (_error) { savedName = ""; }
    this.el.name.value = savedName;
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("room");
    if (codeFromUrl) {
      this.el.code.value = codeFromUrl.toUpperCase();
      this.el.code.dispatchEvent(new Event("input"));
      document.body.classList.add("has-invite");
    }
    this.devToolsRequested = params.get("dev") === "1";
    this.devToolsAllowed = false;
  }

  playerName() {
    const name = this.el.name.value.trim() || "Spieler";
    try { localStorage.setItem("tumblekin-name", name); } catch (_error) { /* privat */ }
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
      this.devToolsAllowed = this.devToolsRequested && this.config.devTools === true;
      this.showVersion(this.config.version);
      if (this.state) this.render(this.state, this.myPlayerId);
    } catch (_error) {
      this.config = { lanUrls: [] };
      this.devToolsAllowed = false;
    }
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
  }

  // --- Lobby ------------------------------------------------------------------

  renderLobby() {
    const state = this.state;
    const host = isHost(state, this.myPlayerId);
    this.stage?.showLobby(state.players, state.hostId);

    this.el.lobbyPlayers.innerHTML = state.players.map((player) => {
      const status = playerStatus(player, state.hostId);
      const mine = player.id === this.myPlayerId;
      const wins = player.sessionWins > 0 ? `<span class="chip-wins" title="Gewonnene Partien">🏆${player.sessionWins}</span>` : "";
      const remove = host && player.isBot
        ? `<button type="button" class="chip-remove" data-remove-bot="${escapeHtml(player.id)}" aria-label="${escapeHtml(player.name)} entfernen">✕</button>`
        : "";
      return `
        <li class="player-chip ${mine ? "is-me" : ""} ${player.connected === false ? "is-offline" : ""}" data-player-chip="${escapeHtml(player.id)}" style="--chip-color:${player.color}">
          <span class="chip-dot"></span>
          <span class="chip-name">${escapeHtml(player.name)}${mine ? " <em>(du)</em>" : ""}</span>
          ${status ? `<span class="chip-tag">${escapeHtml(status)}</span>` : ""}
          ${wins}
          ${remove}
        </li>`;
    }).join("");
    this.el.addBot.hidden = !host || state.players.length >= 4 || state.devMode;

    const mode = state.mode || "marathon";
    this.el.modeTabs.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.disabled = !host && !active;
    });
    this.el.modeDescription.textContent = modeInfo(mode).help;
    this.renderModeOptions(mode, host);

    const enough = state.devMode || state.players.length >= 2;
    this.el.startGame.disabled = !host || !enough;
    this.el.startGame.textContent = !host
      ? "Der Host startet gleich …"
      : (enough ? `${modeInfo(mode).icon} Los geht's` : "Hol dir jemanden dazu");
    this.el.enableDevMode.hidden = !this.devToolsAllowed || state.devMode;
    this.el.enableDevMode.disabled = !host || state.players.length > 1;
    this.renderQrCode();
    requestAnimationFrame(() => this.syncStageBand());
  }

  renderModeOptions(mode, host) {
    const settings = this.state.settings || {};
    const disabled = host ? "" : "disabled";
    const chips = (setting, values, current, label) => `
      <div class="option-row">
        <span class="option-label">${label}</span>
        <div class="chip-row">
          ${values.map((value) => `<button type="button" class="chip ${value === current ? "is-active" : ""}" data-setting="${setting}" data-value="${value}" ${disabled}>${value}</button>`).join("")}
        </div>
      </div>`;
    const pool = settings.pool;
    const poolText = pool && pool.length ? `${pool.length} ausgewählt` : `Alle ${MINIGAME_CATALOG.length}`;
    const poolRow = `
      <div class="option-row">
        <span class="option-label">Spiele</span>
        <button type="button" class="chip chip-wide" data-open-picker="pool" ${disabled}>${poolText} <b>›</b></button>
      </div>`;

    let html = "";
    if (mode === "marathon") {
      html = chips("length", MARATHON_LENGTHS, settings.length || 5, "Anzahl") + poolRow;
    } else if (mode === "hunt") {
      const count = this.state.players.length;
      html = `
        <div class="option-row">
          <span class="option-label">Ziel</span>
          <span class="option-value">${huntTarget(count)} Punkte <small>bei ${count} ${count === 1 ? "Spieler" : "Spielern"}</small></span>
        </div>` + poolRow;
    } else if (mode === "knockout") {
      html = chips("lives", KNOCKOUT_LIVES, settings.lives || 3, "Leben") + poolRow;
    } else {
      const chosen = settings.single ? minigameMeta(settings.single) : null;
      const gesture = chosen ? GESTURES[chosen.gesture] : null;
      html = `
        <div class="option-row">
          <span class="option-label">Spiel</span>
          <button type="button" class="chip chip-wide" data-open-picker="single" ${disabled}>
            ${chosen ? `${gesture?.icon || ""} ${escapeHtml(chosen.title)}` : "🎲 Zufall"} <b>›</b>
          </button>
        </div>`;
    }
    this.el.modeOptions.innerHTML = html;
  }

  // --- Spielauswahl ---------------------------------------------------------------

  openPicker(kind) {
    const settings = this.state?.settings || {};
    const selected = kind === "single"
      ? new Set(settings.single ? [settings.single] : [])
      : new Set(settings.pool && settings.pool.length ? settings.pool : MINIGAME_CATALOG.map((game) => game.type));
    this.picker = { kind, selected };
    this.el.pickerEyebrow.textContent = kind === "single" ? "Einzelspiel" : "Spielauswahl";
    this.el.pickerTitle.textContent = kind === "single" ? "Welches Spiel?" : "Welche Spiele kommen dran?";
    this.el.pickerTools.hidden = kind === "single";
    this.el.pickerDone.hidden = kind === "single";
    this.renderPicker();
    this.openOverlay("picker");
    this.feedback?.sound("tap");
  }

  renderPicker() {
    const picker = this.picker;
    if (!picker) return;
    const random = picker.kind === "single"
      ? `<button type="button" class="pick-card ${picker.selected.size === 0 ? "is-picked" : ""}" data-pick="__random">
          <span class="pick-icon">🎲</span><strong>Zufall</strong><small>Lasst euch überraschen</small>
        </button>`
      : "";
    this.el.pickerGrid.innerHTML = random + MINIGAME_CATALOG.map((game) => {
      const gesture = GESTURES[game.gesture] || GESTURES.tap;
      const picked = picker.selected.has(game.type);
      return `
        <button type="button" class="pick-card ${picked ? "is-picked" : ""}" data-pick="${game.type}" aria-pressed="${picked}">
          <span class="pick-icon">${gesture.icon}</span>
          <strong>${escapeHtml(game.title)}</strong>
          <small>${escapeHtml(gesture.label)}</small>
        </button>`;
    }).join("");
    const count = picker.selected.size;
    this.el.pickerCount.textContent = picker.kind === "single" ? "" : `${count} von ${MINIGAME_CATALOG.length}`;
    this.el.pickerDone.disabled = picker.kind !== "single" && count < 2;
    this.el.pickerDone.textContent = count < 2 && picker.kind !== "single" ? "Mindestens zwei wählen" : "Übernehmen";
  }

  commitPicker() {
    const picker = this.picker;
    if (!picker) return;
    const values = [...picker.selected];
    this.closePicker();
    if (picker.kind === "single") {
      this.safeAction(() => this.handlers.updateSettings({ single: values[0] || null }));
      return;
    }
    const all = values.length >= MINIGAME_CATALOG.length;
    this.safeAction(() => this.handlers.updateSettings({ pool: all ? null : values }));
  }

  closePicker() {
    this.picker = null;
    this.closeOverlay("picker");
  }

  // --- Minispiel ------------------------------------------------------------------

  renderMinigame() {
    this.syncControlledPlayer();
    this.syncIntro(this.state.currentMinigame);
    this.renderDevController();
  }

  // Die Karte vor jedem Spiel: Name, Geste, Ziel — dann 3-2-1-LOS.
  syncIntro(minigame) {
    if (!minigame || this.introMinigameId === minigame.id) return;
    this.introMinigameId = minigame.id;
    clearInterval(this.introTimer);

    const meta = minigameMeta(minigame.type);
    const gesture = gestureMeta(minigame.type);
    this.el.introReason.textContent = minigame.reason || "";
    this.el.introTitle.textContent = minigame.title;
    this.el.introGoal.textContent = meta?.help || "Sammle die meisten Punkte.";
    this.el.introGestureIcon.textContent = gesture.icon;
    this.el.introGestureLabel.textContent = gesture.label;
    this.el.introExtra.innerHTML = this.introExtra();
    this.el.intro.hidden = false;
    this.el.intro.classList.remove("counting", "through");
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
      if (remaining <= -320) {
        this.hideIntro();
        return;
      }
      // Ab dem Startschuss nimmt die Karte keine Berührung mehr an, auch wenn
      // "LOS!" noch einen Moment steht — sonst schluckt sie die ersten Eingaben.
      if (remaining <= 0) this.el.intro.classList.add("through");
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

  // Was vor diesem Spiel für MICH auf dem Spiel steht.
  introExtra() {
    const state = this.state;
    const match = state.match;
    const me = getMyPlayer(state, this.getControlledPlayerId()) || getMyPlayer(state, this.myPlayerId);
    if (!match || !me || match.mode === "single") return "";
    if (match.mode === "knockout") {
      if (me.out) return `<span class="intro-pill">👻 Du bist raus — spiel trotzdem mit</span>`;
      return `<span class="intro-pill">${hearts(me.lives, state.settings?.lives || me.lives)}</span>`;
    }
    if (match.mode === "hunt") {
      const point = match.matchPoint?.includes(me.id) ? " · Matchball!" : "";
      return `<span class="intro-pill">Du: ${me.points} / ${match.target} Punkte${point}</span>`;
    }
    const table = sortByStanding(state.players, match.mode);
    const place = table.findIndex((player) => player.id === me.id) + 1;
    return `<span class="intro-pill">Du: ${me.points} ${me.points === 1 ? "Punkt" : "Punkte"} · Platz ${place}</span>`;
  }

  hideIntro() {
    clearInterval(this.introTimer);
    this.introTimer = null;
    this.el.intro.hidden = true;
    this.el.intro.classList.remove("counting", "through");
  }

  // Im Dev-Testmodus: zwischen den vier lokalen Spielern umschalten.
  renderDevController() {
    const container = this.el.minigameDevController;
    const enabled = Boolean(this.state?.devMode && isHost(this.state, this.myPlayerId) && this.state.status === "minigame");
    container.hidden = !enabled;
    if (!enabled) {
      container.innerHTML = "";
      return;
    }
    const selectedId = this.getControlledPlayerId();
    container.innerHTML = `
      <div class="dev-controller-title">Dev: Spieler</div>
      <div class="dev-player-row">
        ${this.state.players.map((player) => `
          <button class="dev-player-btn ${player.id === selectedId ? "active" : ""}" type="button" style="--dev-color:${player.color}" data-player-id="${player.id}">
            ${escapeHtml(shortName(player.name))}
          </button>`).join("")}
      </div>`;
    container.querySelectorAll("[data-player-id]").forEach((button) => {
      button.addEventListener("click", () => {
        this.controlledPlayerId = button.dataset.playerId;
        this.feedback?.sound("tap");
        this.renderDevController();
      });
    });
  }

  // --- Ergebnis ---------------------------------------------------------------------

  renderResult() {
    const state = this.state;
    const result = state.lastMinigameResult;
    const match = state.match;
    const isNew = this.shownResultId !== result?.id;
    const ranking = result?.ranking || [];
    this.el.resultReason.textContent = result?.reason || "";
    this.el.resultTitle.textContent = result?.title || "Ergebnis";

    this.stage?.showPodium(ranking.map((entry) => ({ playerId: entry.playerId, place: entry.place })), state.players);

    // Plätze von hinten nach vorn aufdecken — die Pointe kommt zuletzt.
    const revealStep = 0.34;
    this.el.resultList.innerHTML = ranking.map((entry, index) => {
      const delay = isNew ? (ranking.length - 1 - index) * revealStep : 0;
      const mine = entry.playerId === this.myPlayerId;
      const gain = match?.mode === "single" ? "" : `<span class="gain ${entry.points > 0 ? "" : "is-zero"}">+${entry.points}</span>`;
      const life = entry.lifeLost ? `<span class="life-lost" title="Leben verloren">💔</span>` : "";
      return `
        <li class="result-row ${mine ? "is-me" : ""} ${isNew ? "revealing" : ""} place-${entry.place}" style="--row-color:${entry.color}; --reveal-delay:${delay}s">
          <span class="place">${placeBadge(entry.place)}</span>
          <span class="who">${escapeHtml(entry.name)}</span>
          <span class="metric">${formatResultMetric(entry)}</span>
          ${life}${gain}
        </li>`;
    }).join("");

    this.renderStandings(isNew ? ranking.length * revealStep + 0.3 : 0);
    this.renderNext(result, match);

    const ready = (state.readyForNext || []).length;
    const needed = state.readyNeeded || 0;
    const mine = (state.readyForNext || []).includes(this.myPlayerId);
    this.el.resultReady.disabled = mine;
    this.el.resultReady.textContent = needed > 1
      ? (mine ? `Warte auf die anderen (${ready}/${needed})` : `Weiter (${ready}/${needed})`)
      : "Weiter";

    if (isNew && ranking.length) {
      this.shownResultId = result.id;
      this.clearResultTimers();
      this.resultTimers = ranking.map((entry, index) => setTimeout(() => {
        this.feedback?.sound(entry.lifeLost ? "error" : "pop");
        this.feedback?.vibrate(10);
      }, ((ranking.length - 1 - index) * revealStep + 0.15) * 1000));
      const winnerDelay = (ranking.length * revealStep) * 1000;
      this.resultTimers.push(setTimeout(() => {
        const iWon = ranking.some((entry) => entry.place === 1 && entry.playerId === this.myPlayerId);
        this.feedback?.sound(iWon ? "win" : "success");
        this.feedback?.vibrate(iWon ? [30, 30, 60] : 18);
      }, winnerDelay));
      this.startResultTimer();
    }
    requestAnimationFrame(() => this.syncStageBand());
  }

  // Gesamtstand nach dieser Runde, mit dem Zuwachs dieser Runde.
  renderStandings(delay) {
    const state = this.state;
    const match = state.match;
    if (!match || match.mode === "single") {
      this.el.standings.hidden = true;
      this.el.standings.innerHTML = "";
      return;
    }
    this.el.standings.hidden = false;
    const table = sortByStanding(state.players, match.mode);
    const places = new Map((state.standings || []).map((row) => [row.playerId, row.place]));
    const best = Math.max(1, ...state.players.map((player) => player.points || 0));
    const target = match.target || best;
    const matchPoint = new Set(match.matchPoint || []);
    const lastResult = new Map((state.lastMinigameResult?.ranking || []).map((entry) => [entry.playerId, entry]));
    const heading = match.mode === "knockout"
      ? "Leben"
      : match.mode === "hunt" ? `Stand · Ziel ${match.target}` : `Stand nach ${match.round} von ${match.total}`;
    this.el.standings.style.setProperty("--standings-delay", `${delay}s`);
    this.el.standings.innerHTML = `
      <h3 class="standings-head">${heading}</h3>
      <ol class="standings-list">
        ${table.map((player) => {
          const place = places.get(player.id) || "";
          const round = lastResult.get(player.id);
          const mine = player.id === this.myPlayerId;
          let value;
          if (match.mode === "knockout") {
            value = player.out
              ? `<span class="ko-out">raus</span>`
              : `<span class="hearts">${hearts(player.lives, state.settings?.lives || 3, round?.lifeLost)}</span>`;
          } else {
            const share = Math.max(0, Math.min(1, (player.points || 0) / target));
            value = `
              <span class="bar"><i style="width:${(share * 100).toFixed(1)}%; background:${player.color}"></i></span>
              <span class="total">${player.points}${round?.points ? `<small>+${round.points}</small>` : ""}</span>`;
          }
          const badge = matchPoint.has(player.id) && !player.out
            ? `<span class="badge-matchpoint">${match.mode === "knockout" ? "letztes Leben" : "Matchball"}</span>`
            : "";
          return `
            <li class="${mine ? "is-me" : ""} ${player.out ? "is-out" : ""}" style="--row-color:${player.color}">
              <span class="place">${place}</span>
              <span class="who">${escapeHtml(player.name)} ${badge}</span>
              ${value}
            </li>`;
        }).join("")}
      </ol>`;
  }

  renderNext(result, match) {
    const node = this.el.resultNext;
    if (!match || match.mode === "single") {
      node.innerHTML = `<span class="next-label">Gleich geht es zurück in die Lobby.</span>`;
      return;
    }
    if (result?.matchOver) {
      node.innerHTML = `<span class="next-label">Die Partie ist entschieden!</span><strong>🏆 Zur Siegerehrung</strong>`;
      return;
    }
    const next = result?.next || match.upcoming;
    if (!next) {
      node.innerHTML = "";
      return;
    }
    const gesture = gestureMeta(next);
    const last = match.mode === "marathon" && match.round === match.total - 1;
    node.innerHTML = `
      <span class="next-label">${last ? "Letztes Spiel:" : "Als Nächstes:"}</span>
      <strong>${gesture.icon} ${escapeHtml(minigameTitle(this.state, next))}</strong>`;
  }

  startResultTimer() {
    const bar = this.el.resultTimer;
    if (!bar) return;
    const endsAt = this.state.resultEndsAt || (Date.now() + 9000);
    const clockOffset = (this.state.serverTime || Date.now()) - Date.now();
    const total = Math.max(1000, endsAt - (Date.now() + clockOffset));
    bar.style.transition = "none";
    bar.style.transform = "scaleX(1)";
    void bar.offsetWidth;
    bar.style.transition = `transform ${total}ms linear`;
    bar.style.transform = "scaleX(0)";
  }

  clearResultTimers() {
    (this.resultTimers || []).forEach((timer) => clearTimeout(timer));
    this.resultTimers = [];
  }

  // --- Ende --------------------------------------------------------------------------

  renderEnd() {
    const state = this.state;
    const match = state.match;
    const mode = match?.mode || state.mode;
    const table = sortByStanding(state.players, mode);
    const places = new Map((state.standings || []).map((row) => [row.playerId, row.place]));
    const winners = state.players.filter((player) => state.winnerIds.includes(player.id));
    const host = isHost(state, this.myPlayerId);

    this.el.endMode.textContent = `${modeInfo(mode).icon} ${modeInfo(mode).name}`;
    this.el.endTitle.textContent = winners.some((player) => player.id === this.myPlayerId) ? "Du hast gewonnen!" : "Siegerehrung";
    const names = winners.map((player) => escapeHtml(player.name)).join(" & ");
    const how = (player) => (mode === "knockout"
      ? `mit ${player.lives} ${player.lives === 1 ? "Leben" : "Leben"} übrig`
      : `mit ${player.points} ${player.points === 1 ? "Punkt" : "Punkten"}`);
    this.el.winnerBanner.innerHTML = winners.length
      ? `<span class="winner-crown">👑</span>
         <strong>${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"}!</strong>
         <span>${how(winners[0])} · ${winners[0].wins}× Platz 1</span>`
      : "";
    this.el.winnerBanner.style.setProperty("--winner-color", winners[0]?.color || "#ffd24a");

    this.el.finalList.innerHTML = table.map((player) => {
      const place = places.get(player.id) || 0;
      const value = mode === "knockout"
        ? (player.out ? "raus" : hearts(player.lives, state.settings?.lives || 3))
        : `${player.points} P`;
      return `
        <li class="${player.id === this.myPlayerId ? "is-me" : ""}" style="--row-color:${player.color}">
          <span class="place">${placeBadge(place)}</span>
          <span class="who">${escapeHtml(player.name)}</span>
          <span class="wins">${player.wins}× Platz 1</span>
          <span class="value">${value}</span>
        </li>`;
    }).join("");

    this.stage?.showPodium(table.map((player) => ({ playerId: player.id, place: places.get(player.id) || 4 })), state.players, { final: true });

    this.el.rematch.disabled = !host;
    this.el.restart.disabled = !host;
    this.el.rematch.textContent = host ? "Revanche" : "Der Host entscheidet …";
    this.el.restart.hidden = !host;
    requestAnimationFrame(() => this.syncStageBand());
  }

  // --- Einladung -----------------------------------------------------------------------

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
    try {
      await navigator.clipboard.writeText(link);
      this.showToast("Link kopiert.");
    } catch (_error) {
      this.showToast(link);
    }
  }

  preferredJoinUrl() {
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    const baseUrl = localHostnames.has(window.location.hostname) && this.config.lanUrls?.[0]
      ? this.config.lanUrls[0]
      : window.location.href;
    return joinUrlFor(this.state.code, baseUrl);
  }
}

function hearts(lives, max, lostNow = false) {
  const full = "❤️".repeat(Math.max(0, lives || 0));
  const broken = lostNow ? "💔" : "";
  const empty = "🤍".repeat(Math.max(0, (max || 0) - (lives || 0) - (lostNow ? 1 : 0)));
  return `${full}${broken}${empty}`;
}

function placeBadge(place) {
  return ["", "🥇", "🥈", "🥉"][place] || `${place}.`;
}

function shortName(name) {
  return String(name || "?").replace(/\s+/g, " ").slice(0, 7);
}

function formatScore(value) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

// EINE Zahl je Spiel, und zwar die, nach der auch sortiert wird. Stand eine
// andere Grösse im Vordergrund, widersprach die Anzeige der Rangfolge.
export function formatResultMetric(entry) {
  const detail = entry?.detail;
  if (!detail) return `${formatScore(entry?.score)} Punkte`;
  if (detail.kind === "time") return `${formatMilliseconds(detail.value)} Zielzeit`;
  if (detail.kind === "progress") return `${detail.value}/${detail.total} ${detail.label}`;
  if (detail.kind === "zoneTime") return `${formatMilliseconds(detail.value)} ${detail.label}`;
  if (detail.kind === "deviation") {
    return detail.value === null || detail.value === undefined
      ? "Nicht gedrückt"
      : `${formatMilliseconds(detail.value)} ${detail.label}`;
  }
  if (detail.kind === "sumTime") return `${formatMilliseconds(detail.value)} ${detail.label}`;
  if (detail.kind === "bestTime") {
    return detail.value === null || detail.value === undefined
      ? "Kein gültiger Versuch"
      : `Bestzeit ${Math.round(detail.value)} ms`;
  }
  if (detail.kind === "standing") {
    return detail.survived ? "Überlebt" : `Raus nach ${formatMilliseconds(detail.value)}`;
  }
  if (detail.kind === "survival") {
    return detail.alive ? "Bis zuletzt dabei" : `${formatMilliseconds(detail.value)} überlebt`;
  }
  if (detail.kind === "out") return `Raus · ${countNoun(detail.value, detail.label)}`;
  if (detail.kind === "lives") return `${countNoun(detail.value, "Leben")} · ${countNoun(detail.knockouts, "Rauswürfe")}`;
  if (detail.kind === "strikes") return countNoun(detail.value, "Treffer");
  if (detail.kind === "fit") return `${detail.value}/${detail.total} ${detail.label}`;
  if (detail.value !== undefined && detail.label) return countNoun(detail.value, detail.label);
  if (detail.value !== undefined) return formatScore(detail.value);
  return `${formatScore(entry?.score)} Punkte`;
}

const SINGULAR_NOUNS = {
  "Münzen": "Münze",
  "Felder": "Feld",
  "Reihen": "Reihe",
  "Lichter": "Licht",
  "Pässe": "Pass",
  "Ziele": "Ziel",
  "Rauswürfe": "Rauswurf",
  "Fehlgriffe": "Fehlgriff",
  "Fische": "Fisch",
  "Runden": "Runde",
  "Punkte": "Punkt",
  "Meter": "Meter",
  "Wellen": "Welle",
  "Pumps": "Pump",
  "Etagen": "Etage",
  "Sprossen": "Sprosse",
  "Griffe": "Griff",
  "Pakete": "Paket",
  "Ring-Punkte": "Ring-Punkt"
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

export { MODES };
