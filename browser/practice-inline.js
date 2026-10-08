// Die Übung läuft sonst in einem Worker, den der Server als eigene Datei
// ausliefert. Diese Fassung hat keinen Server: dieselbe Übungslogik
// (scripts/practice-worker.cjs) läuft hier im selben Fenster, mit eigenem
// Raum und eigenen Timern. Nachrichten werden wie über die Leitung kopiert
// und eine Runde später zugestellt — wie beim echten Worker.
import server from "../server/server.js";
import { createPractice } from "tumblekin:practice-worker";

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

globalThis.__tumblekinPracticeWorker = () => {
  let alive = true;
  const worker = { onmessage: null, onerror: null };
  const scope = {
    onmessage: null,
    postMessage(data) {
      const copy = clone(data);
      setTimeout(() => { if (alive) worker.onmessage?.({ data: copy }); }, 0);
    }
  };
  const practice = createPractice(scope, () => server);
  worker.postMessage = (data) => {
    const copy = clone(data);
    setTimeout(() => { if (alive) scope.onmessage?.({ data: copy }); }, 0);
  };
  worker.terminate = () => {
    alive = false;
    practice.stop();
  };
  return worker;
};
