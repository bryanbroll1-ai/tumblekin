// Isolated practice uses the real rules. No socket or multiplayer room is
// created; terminating this Worker discards every practice score and timer.
const { testRules: rules } = require('../server/server.js');
const TYPES = new Set(rules.MINIGAMES.map(game => game.type));
// Kontakt-, Team- und Zugspiele brauchen echte Gegenüber zum Üben.
const WITH_BOTS = new Set(['colorEscape', 'fassrolle', 'zuendstoff', 'farbenjagd', 'tauziehen', 'honigwabe', 'schneeball', 'luftpuck', 'buecherwurm', 'schnappschuss', 'kippboot']);
// Der Trainingsring kommt beliebig oft zurück: in der Partie ist ein Sturz
// das Aus, in der Übung soll man weiterrammen können.
function trainingArena(arena) {
  if (arena?.players?.trainer) arena.players.trainer.lives = 99;
  return arena;
}
let nextBotAt = 0;
let room = null;
let timer = null;
let generation = 0;
let prepared = false;
function stop() {
  clearInterval(timer);
  timer = null;
  if (room) rules.clearRoomTimers(room);
}
function publish() {
  self.postMessage({ kind: 'state', generation, prepared, state: {
    status: 'minigame', phase: 'playingMinigame', players: room.players,
    currentMinigame: room.currentMinigame, serverTime: Date.now()
  } });
}
self.onmessage = ({ data }) => {
  try {
    if (data.kind === 'start') {
      if (!TYPES.has(data.type)) throw new Error('Keine Übung für dieses Spiel.');
      stop();
      generation = data.generation;
      const game = rules.MINIGAMES.find(game => game.type === data.type);
      const player = rules.createPlayer({ id: 'practice', name: 'Du', color: data.color || '#ff5d73' });
      // Allocate the scene first. Its construction must not consume playing
      // time on a slower phone, particularly during Fassmut's short roll.
      const startedAt = Date.now() + 60000;
      const currentMinigame = {
        id: 'practice-' + startedAt, type: game.type, title: game.title,
        startedAt, duration: game.duration, scores: {}, lastInputAt: {}
      };
      const players = game.type === "bounceArena" ? [player, rules.createPlayer({ id: "trainer", name: "Trainingsring", color: "#28c7d9" })] : [player];
      if (WITH_BOTS.has(game.type)) {
        for (let index = 0; index < 3; index++) players.push(rules.createPlayer({ id: 'trainer-' + index, name: ['Mika', 'Lumi', 'Pip'][index], color: ['#28c7d9', '#ffd15c', '#71d97b'][index], isBot: true }));
      }
      if (game.type === "bounceArena") currentMinigame.arena = trainingArena(rules.createArenaState(players, startedAt, game.duration));
      else currentMinigame.arcade = rules.createArcadeState(game.type, players, startedAt, {seed: game.type === "finishRush" ? 39 : undefined});
      room = { code: 'PRACTICE', status: 'minigame', phase: 'playingMinigame',
        players, currentMinigame, timers: new Set() };
      prepared = true;
      publish();
    } else if (data.kind === 'begin') {
      if (!room || data.generation !== generation || !prepared) return;
      prepared = false;
      const currentMinigame = room.currentMinigame;
      const startedAt = Date.now() + 1800;
      currentMinigame.startedAt = startedAt;
      if (currentMinigame.arena) currentMinigame.arena = trainingArena(rules.createArenaState(room.players, startedAt, currentMinigame.duration));
      else currentMinigame.arcade = rules.createArcadeState(currentMinigame.type, room.players, startedAt, {seed: currentMinigame.arcade.seed});
      nextBotAt = startedAt;
      publish();
      timer = setInterval(() => {
        try {
          if (Date.now() >= nextBotAt && !currentMinigame.finaleAt) {
            nextBotAt = Date.now() + 150;
            room.players.filter(player => player.isBot).forEach(player => rules.arcadeBotStep(room, player));
          }
          if (currentMinigame.arena) rules.updateBounceArena(room);
          else rules.updateArcade(room);
          // Finales schedule multiplayer result timers. Practice only needs
          // the locked final state and leaves the scene visible for review.
          if (currentMinigame.finaleAt || Date.now() >= startedAt + currentMinigame.duration) {
            if (!currentMinigame.finaleAt) rules.beginMinigameFinale(room, currentMinigame);
            stop();
          }
          publish();
        } catch (error) { stop(); self.postMessage({ kind: 'error', message: error.message }); }
      }, 30);
    } else if (data.kind === 'input') {
      if (data.generation !== generation || prepared) return;
      if (!room) throw new Error('Übung noch nicht bereit.');
      const response = room.currentMinigame.arena ? rules.handleArenaInput(room, room.players[0], data.input) : rules.handleArcadeInput(room, room.players[0], data.input);
      self.postMessage({ kind: 'reply', generation, id: data.id, response });
      publish();
    }
  } catch (error) {
    self.postMessage({ kind: 'error', message: error.message });
  }
};
