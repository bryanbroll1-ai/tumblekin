# Drittanbieter-Lizenzen

Tumblekin bindet die folgenden Open-Source-Pakete ein. Alle stehen unter der
MIT-Lizenz, die das Weitergeben erlaubt, solange Copyright- und Lizenzhinweis
mitgeliefert werden. Diese Datei erfüllt diese Bedingung und muss jeder
Distribution (auch einem Store-Build) beiliegen.

Beim Veröffentlichen einer neuen Version bitte die Versionsnummern hier gegen
`package.json` abgleichen — ein Build mit einer nicht aufgeführten Abhängigkeit
verletzt deren Lizenz.

| Paket | Version | Lizenz | Projekt |
| --- | --- | --- | --- |
| three | 0.166.1 | MIT | https://github.com/mrdoob/three.js |
| socket.io | 4.8.3 | MIT | https://github.com/socketio/socket.io |
| express | 4.22.2 | MIT | https://github.com/expressjs/express |
| qrcode | 1.5.4 | MIT | https://github.com/soldair/node-qrcode |

`three.module.js` wird an den Client ausgeliefert und ist damit Teil des
verteilten Produkts. Die übrigen Pakete laufen nur serverseitig; socket.io
liefert zusätzlich seinen Client (`/socket.io/socket.io.js`) an den Browser.

## MIT-Lizenztext

Der Wortlaut ist für alle vier Pakete identisch; es unterscheiden sich nur die
Rechteinhaber:

- three.js: Copyright © 2010–2024 three.js authors
- Socket.IO: Copyright © 2014–2018 Guillermo Rauch
- Express: Copyright © 2009–2014 TJ Holowaychuk, 2013–2014 Roman Shtylman,
  2014–2015 Douglas Christopher Wilson
- node-qrcode: Copyright © 2012 Ryan Day

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Die vollständigen Originaltexte liegen nach `npm install` unter
`node_modules/<paket>/LICENSE`.
