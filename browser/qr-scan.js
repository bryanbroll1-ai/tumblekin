// Kamera auf einen QR-Code, und einen QR-Code gross zeigen — für die
// QR-Kopplung (net.js). Gelesen wird mit dem eingebauten BarcodeDetector,
// wo es ihn gibt, sonst mit qr-decode.mjs.
import { decodeQr } from "./qr-decode.mjs";

let native;          // undefined = noch nicht gefragt, null = gibt es nicht
async function nativeDetector() {
  if (native !== undefined) return native;
  native = null;
  try {
    if ("BarcodeDetector" in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) native = new window.BarcodeDetector({ formats: ["qr_code"] });
    }
  } catch {
    native = null;
  }
  return native;
}

function overlay(className, html) {
  const el = document.createElement("div");
  el.className = "qr-overlay " + className;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// Dieselbe Meldung unten am Rand wie die der Oberfläche.
export function toast(message) {
  const el = document.getElementById("toast");
  if (!el || !message) return;
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 3200);
}

// Öffnet die Kamera und liefert den ersten passenden Text — oder null, wenn
// abgebrochen. `accept(text)` sagt true (passt), oder einen Hinweis, und es
// wird weitergescannt.
export function openScanner({ title = "QR-Code scannen", hint = "", accept = () => true } = {}) {
  return new Promise((resolve) => {
    const el = overlay("qr-scan", `
      <p class="qr-title"></p>
      <div class="qr-view"><video playsinline muted autoplay></video><span class="qr-frame" aria-hidden="true"></span></div>
      <p class="qr-hint"></p>
      <button type="button" class="btn btn-secondary qr-cancel">Abbrechen</button>`);
    el.querySelector(".qr-title").textContent = title;
    const hintEl = el.querySelector(".qr-hint");
    hintEl.textContent = hint;
    const video = el.querySelector("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let stream = null;
    let done = false;
    let timer = null;
    let lastRejected = "";
    let frame = 0;
    const finish = (text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      el.remove();
      resolve(text);
    };
    el.querySelector(".qr-cancel").addEventListener("click", () => finish(null));
    const read = async () => {
      const detector = await nativeDetector();
      if (detector) {
        try {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || null;
        } catch {
          native = null;
        }
      }
      // Abwechselnd das ganze Bild, auf höchstens 640 Pixel verkleinert, und
      // die Mitte im Rahmen in voller Auflösung (höchstens 720 Pixel): ein
      // kleiner oder weiter entfernter Code hat dort genug Pixel je Modul.
      // So bleibt jedes Bild unter ~50 ms, auch auf älteren Handys.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      frame += 1;
      if (frame % 2) {
        const scale = Math.min(1, 640 / Math.max(vw, vh));
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        const side = Math.round(Math.min(vw, vh) * 0.8);
        const size = Math.min(side, 720);
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
      }
      return decodeQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    const tick = async () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const text = await read();
        if (done) return;
        if (text) {
          const verdict = accept(text);
          if (verdict === true) {
            navigator.vibrate?.(30);
            finish(text);
            return;
          }
          if (typeof verdict === "string" && verdict !== lastRejected) {
            lastRejected = verdict;
            hintEl.textContent = verdict;
          }
        }
      }
      timer = setTimeout(tick, 100);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (done) { s.getTracks().forEach((track) => track.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
        tick();
      })
      .catch(() => {
        hintEl.textContent = "Keine Kamera. Ist der Zugriff erlaubt? (Einstellungen → Apps → Tumblekin → Berechtigungen)";
      });
  });
}

// Einen QR-Code gross zeigen, mit Abbrechen. `render(text, done)` erzeugt
// das Bild (net.js: __tumblekinQr). Gibt { setCode, close, cancelled } zurück.
export function showCode({ title, hint, render }) {
  const el = overlay("qr-show", `
    <p class="qr-title"></p>
    <div class="qr-code-box"><img alt="QR-Code"><span class="qr-wait">Einen Moment …</span></div>
    <p class="qr-hint"></p>
    <button type="button" class="btn btn-secondary qr-cancel">Abbrechen</button>`);
  el.querySelector(".qr-title").textContent = title;
  el.querySelector(".qr-hint").textContent = hint;
  const img = el.querySelector("img");
  let closed = false;
  let cancel;
  const cancelled = new Promise((resolve) => { cancel = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    cancel(null);
  };
  el.querySelector(".qr-cancel").addEventListener("click", close);
  return {
    cancelled,
    close,
    setHint(text) { el.querySelector(".qr-hint").textContent = text; },
    setCode(text) {
      render(text, (src) => {
        if (closed) return;
        img.src = src;
        el.classList.add("has-code");
      });
    }
  };
}
