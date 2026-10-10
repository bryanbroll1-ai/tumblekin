// Baut die Browser-Fassung: Spielserver und Oberfläche in einer Seite, ohne
// Node-Server. Wer die Party startet, ist der Server; Gäste verbinden sich
// über die claude.ai-Raumfunktion (net.js). Ergebnis in browser/dist:
// index.html, app.js und die Vorschaubilder — so wie es als Artifact
// veröffentlicht wird.
//
//   node browser/build.mjs
//   ARTIFACT_URL=https://claude.ai/artifact/… node browser/build.mjs
//
// esbuild kommt aus den devDependencies; ESBUILD_PATH zeigt notfalls auf eine
// andere Kopie (…/esbuild/lib/main.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const esbuild = await import(process.env.ESBUILD_PATH ? pathToFileURL(process.env.ESBUILD_PATH).href : "esbuild");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, "dist");
fs.mkdirSync(path.join(OUT, "assets", "games"), { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const shims = { express: "express.js", http: "http.js", os: "os.js", path: "path.js", "socket.io": "socketio.js", qrcode: "qrcode.js" };

const tumblekinPaths = {
  name: "tumblekin-paths",
  setup(build) {
    build.onResolve({ filter: /^(express|http|os|path|socket\.io|qrcode)$/ }, (args) => ({ path: path.join(HERE, "shims", shims[args.path]) }));
    build.onResolve({ filter: /^\/vendor\/three\// }, (args) => ({ path: path.join(ROOT, "node_modules/three/build", args.path.replace(/^\/vendor\/three\//, "").replace(/\?.*$/, "")) }));
    build.onResolve({ filter: /^\/src\// }, (args) => ({ path: path.join(ROOT, "client", args.path.replace(/\?.*$/, "")) }));
    build.onResolve({ filter: /^\.\.?\/.*\?/ }, (args) => ({ path: path.join(args.resolveDir, args.path.replace(/\?.*$/, "")) }));
    // Die Übungslogik als Funktion: `self` und `require` kommen von aussen,
    // jede Übung bekommt so ihren eigenen Zustand.
    build.onResolve({ filter: /^tumblekin:practice-worker$/ }, () => ({ path: "practice-worker", namespace: "tumblekin" }));
    build.onLoad({ filter: /.*/, namespace: "tumblekin" }, () => {
      const source = fs.readFileSync(path.join(ROOT, "scripts/practice-worker.cjs"), "utf8");
      return { contents: `export function createPractice(self, require) {\n${source}\nreturn { stop };\n}`, loader: "js" };
    });
    // Die gemeinsame Physik setzt im Browser eine globale Variable, unter
    // Node `module.exports`. Im Bündel ist sie ein CommonJS-Modul (der Server
    // verlangt sie), also setzt hier das Modul die Variable selbst.
    build.onLoad({ filter: /client\/src\/minigames\/((Bumper|Sprint)Physics|SketchFigures|Bootsphysik)\.js$/ }, (args) => {
      const name = path.basename(args.path, ".js");
      const contents = fs.readFileSync(args.path, "utf8") + `\nglobalThis.Tumblekin${name} = module.exports;\n`;
      return { contents, loader: "js", resolveDir: path.dirname(args.path) };
    });
    // Einen Service-Worker gibt es nur beim Server. Hier liefe die Anmeldung
    // ins Leere — in der Android-App sogar am Abfangen der Assets vorbei
    // gegen den echten Host.
    build.onLoad({ filter: /client\/src\/main\.js$/ }, (args) => {
      const source = fs.readFileSync(args.path, "utf8");
      const sw = /if \("serviceWorker" in navigator\) \{\s*navigator\.serviceWorker\.register\("\/sw\.js"\)\.catch\(\(\) => \{\}\);\s*\}\n/;
      if (!sw.test(source)) throw new Error("main.js: Service-Worker-Anmeldung nicht gefunden");
      return { contents: source.replace(sw, ""), loader: "js", resolveDir: path.dirname(args.path) };
    });
    // Worker und Vorschaubilder kamen vom Server; hier liegen die Bilder
    // neben der Seite, und die Übung läuft im Fenster.
    build.onLoad({ filter: /client\/src\/ui\/(PracticeSession|UIManager)\.js$/ }, (args) => {
      let contents = fs.readFileSync(args.path, "utf8");
      if (args.path.endsWith("PracticeSession.js")) {
        const before = contents;
        contents = contents.replace(/new Worker\((['"])\/src\/practice\/engine-worker\.js[^'"]*\1\)/, "globalThis.__tumblekinPracticeWorker()");
        if (contents === before) throw new Error("PracticeSession: Worker-Aufruf nicht gefunden");
      } else {
        const count = (contents.match(/\/assets\/games\//g) || []).length;
        if (count < 2) throw new Error("UIManager: Vorschaubilder nicht gefunden");
        contents = contents.replaceAll("/assets/games/", "assets/games/");
        // Der QR-Code kam vom Server; hier zeichnet ihn das Fenster selbst,
        // und der Link zeigt auf dieses Artifact (siehe net.js).
        const qr = "this.el.qr.src = `/qr.svg?text=${encodeURIComponent(link)}`;";
        if (!contents.includes(qr)) throw new Error("UIManager: QR-Aufruf nicht gefunden");
        contents = contents.replace(qr, "globalThis.__tumblekinQr(link, (src) => { if (this.lastQrCode === link) this.el.qr.src = src; });");
        const join = "return joinUrlFor(this.state.code, baseUrl);";
        if (!contents.includes(join)) throw new Error("UIManager: Einladungslink nicht gefunden");
        contents = contents.replace(join, "return globalThis.__tumblekinJoinUrl(this.state.code);");
      }
      return { contents, loader: "js", resolveDir: path.dirname(args.path) };
    });
  }
};

await esbuild.build({
  entryPoints: [path.join(HERE, "entry.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: !process.env.NOMIN,
  legalComments: "none",
  outfile: path.join(OUT, "app.js"),
  plugins: [tumblekinPaths],
  define: { __dirname: '"/"', __APP_VERSION__: JSON.stringify(version), __ARTIFACT_URL__: JSON.stringify(process.env.ARTIFACT_URL || "https://claude.ai/artifact/CUmWY61qTe2HMJZCEa2q7c") },
  logLevel: "warning"
});

// Seite: Kopf und Körper aus index.html, die beiden Stylesheets eingebettet.
const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
const body = html.slice(html.indexOf(">", html.indexOf("<body")) + 1, html.lastIndexOf("</body>"))
  .replace(/<script[\s\S]*?<\/script>\s*/g, "");
const css = ["style.css", "minigames.css"].map((f) => fs.readFileSync(path.join(ROOT, "client", f), "utf8")).join("\n");
const offlineCss = `
/* Diese Fassung läuft ohne Server: wer die Party startet, ist der Server.
   Beitreten geht nur in der claude.ai-Ansicht (Raumfunktion, siehe net.js);
   bis die antwortet — oder ausserhalb von claude.ai — spielt man gegen Bots. */
body:not(.can-join) .start-sheet .divider,
body:not(.can-join) .start-sheet .join-row { display: none !important; }
.offline-note { margin: 0; font-size: 13px; font-weight: 700; opacity: .72; text-align: center; }
body.can-join .offline-note .solo { display: none; }
body:not(.can-join) .offline-note .multi { display: none; }
.in-app .offline-note .web-only, html:not(.in-app) .offline-note .app-only { display: none; }
.party-list { display: grid; gap: 8px; order: 5; }
.party-list[hidden] { display: none; }
.party-list-title { margin: 4px 0 0; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.party-items { display: grid; gap: 8px; }
.party-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 48px; padding: 10px 14px; border: 0; border-radius: 14px; background: #fff; box-shadow: 0 4px 0 rgba(36, 48, 64, .12); font: inherit; color: inherit; text-align: left; cursor: pointer; }
.party-item strong { font-size: 15px; }
.party-item span { font-size: 13px; font-weight: 800; letter-spacing: .06em; opacity: .7; }
`;
const note = `<p class="offline-note"><span class="solo"><span class="web-only">Browser-Fassung</span><span class="app-only">Test-App</span>: du spielst gegen Bots. Tippe in der Lobby auf „+ Bot“.</span><span class="multi">Party starten und Freunde per Code einladen — oder unten beitreten.</span></p>`;
const bodyWithNote = body.replace('<button id="create-room"', `${note}\n          <button id="create-room"`);
// Der Zeichensatz muss drinstehen: ohne ihn las ein Browser die Seite als
// Latin-1, und aus dem Menüzeichen wurde Zeichensalat.
const viewport = (html.match(/<meta name="viewport"[^>]*>/) || [""])[0];
const page = `<meta charset="utf-8">
${viewport}
<title>Tumblekin</title>
<style>
${css}
${offlineCss}
</style>
${bodyWithNote}
<script type="module" src="app.js"></script>
`;
fs.writeFileSync(path.join(OUT, "index.html"), page);
for (const file of fs.readdirSync(path.join(ROOT, "client", "assets", "games"))) {
  fs.copyFileSync(path.join(ROOT, "client", "assets", "games", file), path.join(OUT, "assets", "games", file));
}
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + " KB";
console.log("app.js", size("app.js"), "· index.html", size("index.html"));
