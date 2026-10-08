const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const gameState = () => import(pathToFileURL(path.join(__dirname, '../client/src/game/GameState.js')).href);

test('Beitreten: das Codefeld nimmt Codes so, wie Leute sie tippen oder einfügen', async () => {
  const { extractRoomCode } = await gameState();
  assert.equal(extractRoomCode('zp2h'), 'ZP2H');
  // Leerzeichen und Bindestriche zählen nicht — auch nicht gegen die Länge.
  assert.equal(extractRoomCode(' z p 2 h '), 'ZP2H');
  assert.equal(extractRoomCode('ZP-2H'), 'ZP2H');
  // Der ganze Einladungslink aus dem Chat ergibt den Code.
  assert.equal(extractRoomCode('Komm rein: https://tumblekin.onrender.com/?room=ZP2H'), 'ZP2H');
  assert.equal(extractRoomCode('http://192.168.0.5:3000/?dev=1&room=k7qx'), 'K7QX');
  assert.equal(extractRoomCode(''), '');
  assert.equal(extractRoomCode(undefined), '');
});

test('Beitreten: der WLAN-Hinweis gilt nur für Server im Heimnetz', async () => {
  const { isLocalNetworkHost } = await gameState();
  for (const host of ['localhost', '127.0.0.1', '192.168.178.20', '10.0.0.4', '172.20.1.9', 'macbook.local', '[::1]']) {
    assert.equal(isLocalNetworkHost(host), true, host);
  }
  for (const host of ['tumblekin.onrender.com', '172.32.0.1', '8.8.8.8', 'example.org']) {
    assert.equal(isLocalNetworkHost(host), false, host);
  }
});
