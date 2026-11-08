# pxt-iot-sim — die Dashboard-Ansicht neben dem Simulator

Eine **Simulator-Extension** (simx) für MakeCode: ein Panel neben dem Simulator,
das die Feeds des verknüpften IoT-Dashboards live zeigt. Damit sieht ein Kind
beim Programmieren, was auf dem Dashboard gerade steht — ohne Gerät am Kabel.

## The look comes from Campus

This repository is pinned by sha in `pxt-calliope/targetconfig.json`, so every
change here costs a gh-pages commit, a sha bump and a target redeploy. It
therefore keeps only the **communication**: the `ready` handshake (`simx.ts`),
the program's `IOT1:` announcement, the poll of `GET <server>/read`
(`dashboard.ts`), the `IOT1:t/z/v` lines into the simulator, the feed names for
the editor and the state the picture is drawn from (`main.ts`).

The **picture** is a Campus page, `<campus>/embed/iot-sim`, in a nested iframe
(`campus.ts`). It ships with every Campus release (route
`src/routes/(embed)/embed/iot-sim` in calliope-campus, with the same contract in
its README).

- **Which Campus.** The shell asks the program's server: `GET <server>/sim`
  answers `{ "page": "<url>" }` (only https, or http on localhost, is taken).
  The API lives on its own host (`campus-api.…`), so its origin is not the
  Campus origin; the server knows which Campus it belongs to (its Application
  URL). Without an answer: `https://campus.calliope.cc/embed/iot-sim`. With the
  panel served from localhost (`simxdev`): always the local Campus,
  `?campus=<origin>` on the panel URL, else `VITE_CAMPUS_ORIGIN`, else
  `https://localhost:5173`.
- **Fallback.** If the page has not reported ready within 3 s (Campus
  unreachable, offline), the shell draws a bare list of its own (`fallback.ts`):
  the four states, name and current value per feed, no table, no font. If the
  page reports ready later, it takes over. A page that drew before keeps drawing
  while the next one loads.
- **Origins.** The shell accepts `iot-sim-ready` only from the frame it created,
  from the origin it loaded it from, and posts the state to that origin only.
  Only the editor (`window.parent`) is heard as the simulator; nothing the page
  sends reaches the simulator.

### Contract

**Rule: Campus may only extend it, never break it.** Old shells stay pinned in
old target versions. This shell must never stop sending a field or change what
one means; the page ignores unknown fields and draws a `v` it does not know as
well as the known fields allow.

Page → shell, once it listens (and again after every reload; the shell answers
with the current state each time):

```js
{ type: 'iot-sim-ready', v: 1 }
```

Shell → page, on every change, with the page's origin as target:

```js
{
  type: 'iot-sim-view',
  v: 1,
  state: 'none' | 'connecting' | 'cut-off' | 'live',
  view: null | { feeds, values: [{ feed, from_dev, to_dev, num, str, ts }], clock, zone },
  changedAt: { [`${feed} ${from_dev || '0'} ${to_dev || ''}`]: msSinceEpoch },
  answeredAt: msSinceEpoch,          // 0 = never
  failure: null | 'address' | 'refused' | 'unreachable',
  ref: string,                       // without the write token; see below
  server: string,                    // as the program names it (IOT1:s:)
  scope: 'dashboard' | 'devices' | 'all'
}
```

- `state`: `none` no program named a dashboard; `connecting` no answer yet;
  `cut-off` three failed polls in a row (`view` keeps the last answer,
  `answeredAt` says from when); `live` the last poll answered.
- `view.values` come newest first, so a feed's first row is its current value.
  `num` is null for text. `ts` is the fetch time, not a server time.
- `changedAt` has no entry for a reading that was already there when the shell
  connected.
- `ref` is slug plus read token when the page is the one the program's server
  names (or the local Campus in dev), only the slug otherwise. The write token
  never leaves the shell.

## Was zu sehen ist

Je Feed **eine Zeile**: links der Name, rechts der aktuelle Wert, groß. Das ist
die Frage, für die das Panel da ist, und sie bekommt die ganze Breite.

Alles Weitere zu diesem Wert — **Zeit, Wert, Von, An** — steht in einer kleinen
Tabelle einen Klick darunter. Meist hat ein Feed ohnehin nur eine Zeile; die
flache Liste aller Absender verbrauchte die Höhe des Panels damit, das Wort
„Dashboard" zu wiederholen. Geöffnete Feeds bleiben geöffnet: Der Poll zeichnet
nur neu, wenn sich am Bild wirklich etwas geändert hat.

Die **Zeit** ist der Moment, in dem das Panel diesen Wert gesehen hat, nicht der
Zeitstempel des Servers — `/read` liefert keinen. Werte, die schon auf dem
Dashboard standen, als das Panel dazukam, tragen deshalb einen Punkt statt einer
Uhrzeit, statt sich den Startzeitpunkt des Panels zu borgen.

Den **Mitschnitt der rohen `IOT1:`-Zeilen** gibt es nicht mehr. Er kostete ein
Fünftel der Höhe, um in Protokollform zu wiederholen, was die Werte darüber in
Worten sagen. Wer die Zeilen braucht, findet sie dort, wo sie ohnehin gelesen
werden: in der seriellen Konsole des Editors und im Campus-Stream.

## Woher die Daten kommen

**Direkt vom Server**, nicht über den Campus-Tab. Das Panel braucht dafür genau
zwei Dinge: eine Adresse und ein Token. Beides steht im Programm — der
Dashboard-Block trägt Slug oder Token und optional die Serveradresse —, und das
Programm sagt beides dem Panel über den simx-Kanal (siehe unten). Damit braucht
der Simulator keinen Rückkanal zum Campus und funktioniert auch im nackten
MakeCode.

**Lesen** geht über `GET <server>/read` und läuft immer: Das Panel zeigt das
Dashboard, das im Programm steht, live neben dem Simulator, und reicht neue
Werte als `IOT1:v:`-Zeilen an das simulierte Gerät weiter.

**Geschrieben wird nicht.** Früher gab es einen Schalter „Simulierte Werte ins
Dashboard schreiben", der die Werte des Simulators per `POST <server>/ingest`
mit einer negativen Seriennummer ans Dashboard schickte. Der Campus liest das
Vorzeichen aber nicht mehr als „Simulator", ein schreibender Simulator erschiene
dort also als ganz normales Gerät. Bis Simulatoren eine eigene Kennzeichnung
bekommen, bleibt das Panel deshalb rein lesend; die `IOT1:d:`-Zeilen des
Programms ignoriert es.

## Wie das Panel erfährt, welches Dashboard gemeint ist

Über die `IOT1:`-Zeilen, die das Programm ohnehin schickt. pxt reicht
Simulator-Nachrichten als `messagepacket` an das simx-Panel weiter; die
Extension sendet ihre Anmeldung als

```
IOT1:r:<leseumfang>
IOT1:i:<seriennummer>
IOT1:s:<serveradresse>
IOT1:h:<slug oder token>
```

Das Panel hört auf `h:` (welches Dashboard), `s:` (welcher Server) und `r:`
(wessen Werte) und fragt dann den Server. Mehr braucht es nicht.

Es reagiert erst, wenn die Anmeldung vollständig ist, also mit der `h:`-Zeile,
die immer als letzte kommt. Vorher stünde noch das Dashboard des VORIGEN
Programms im Panel: Ein neu gestartetes Programm, das ein anderes Dashboard
nennt, bekäme sonst für einen Moment die alten Werte geschickt. Nennt das
Programm nach dem Neustart dasselbe Dashboard, schickt das Panel ihm Uhrzeit und
aktuelle Werte noch einmal, wie der Campus es beim Gerät tut.

Der Schalter „im Simulator senden" ist weg — er entfällt ersatzlos, weil der
Grund für ihn weg ist. Er stand im Übertragungsblock, weil pxt die Ausgaben des
Simulators an keinen Host weiterreichte; mit diesem Panel gibt es eine
Gegenseite, also schickt der Simulator seine Zeilen jetzt immer mit. Ins
Dashboard gelangen sie trotzdem nicht (siehe oben).

## Was das Panel startet

Nicht das Panel meldet sich, sondern das Programm. pxt erzeugt das simx-iframe
erst, wenn der Simulator ein `messagepacket` schickt, dessen `channel` GENAU dem
Schlüssel in `approvedRepoLib` entspricht (`pxt/pxtsim/simdriver.ts`, Suche nach
`simulatorExtensions[messageChannel]`). `pxt-grove` schickt dafür einmal je
Programmlauf ein leeres Paket auf `amerlander/pxt-grove` und danach jede
`IOT1:`-Zeile auf dem Kanal `iot`.

Zwei Kanäle also, und das ist kein Versehen: Der Repo-Name startet, der
Datenkanal trägt. `pxt-jacdac` macht es genauso (`jacdac/pxt-jacdac` startet,
`jacdac` trägt). Wer beides zusammenlegt, bekommt ein Panel, das startet und
nie etwas hört — oder Zeilen, die an ein Panel gehen, das es nicht gibt.

Nebenbei erreicht dasselbe Paket auch den Campus-Tab: pxt reicht jedes
Broadcast-`messagepacket` zusätzlich an das Eltern-Fenster des Editors weiter,
und dort wartet `serialRelay.handleSimulatorMessage` auf genau den Kanal `iot`.

## Eintragen im Target

In `pxt-calliope/targetconfig.json` unter `packages.approvedRepoLib` — und zwar
beim Schlüssel der EXTENSION, nicht bei dem des Panels. pxt schlägt den simx
über den Kanal nach, den das Programm sendet, und das ist der Repo-Name der
Extension (`iotsim.panelKey()` in `pxt-calliope-iot`):

```json
"calliope-edu/pxt-calliope-iot": {
    "simx": {
        "repo": "calliope-edu/pxt-iot-sim",
        "sha": "<commit-sha auf gh-pages>",
        "devUrl": "http://localhost:3400",
        "aspectRatio": 0.78
    }
}
```

`repo` ist nötig, weil das Panel nicht im Repo der Extension liegt: Ohne den
Eintrag sucht MakeCode den `gh-pages`-Zweig von `pxt-calliope-iot`.

`aspectRatio` ist **Breite geteilt durch Höhe** und die einzige Stelle, an der
die Höhe des Panels festgelegt wird: pxt setzt daraus `padding-bottom: 100/r %`
auf den Rahmen (`applyAspectRatioToFrame` in `pxtsim/simdriver.ts`). Der
Vorgabewert 1.22 stammt vom Simulator selbst — ein liegendes Board — und gab
dem Panel eine Höhe von 0,82 Breiten; eine Werteliste ist das Gegenteil eines
liegenden Boards. 0.78 macht sie 1,28 Breiten hoch, also gut die Hälfte mehr.

`devUrl` greift, solange der Editor mit `simxdev=1` läuft — das tut die
Campus-Einbettung bereits (die iframe-URL trägt den Parameter, sobald der Editor
selbst auf localhost liegt). Für den Produktivbetrieb zählt der `sha`.

## Veröffentlichen

Das gehostete MakeCode (makecode.calliope.cc) lädt ein Panel **nie** von einer
fremden Adresse. Außerhalb von localhost mit `simxdev` berechnet pxt die URL
selbst: `<sim-origin>/simx/calliope-edu/pxt-calliope-iot/-/index.html`. Den
Inhalt dahinter holt das MakeCode-Backend aus dem `gh-pages`-Zweig von `repo`,
und zwar genau den Commit aus `sha`. Eine eigene GitHub Page oder ein Hosting im
Campus-Stack nimmt es nicht, auch kein Redirect dorthin: Der Simulator postet
nur an die Origin der berechneten URL (`frame.dataset['origin']` in
`pxtsim/simdriver.ts`). `pxt-jacdac` geht denselben Weg.

Also:

1. Push auf `main` → der Workflow `gh-pages` baut `dist/` und legt es als neuen
   Commit auf `gh-pages` (ohne Force-Push, damit jeder einmal eingetragene
   `sha` erreichbar bleibt). Von Hand geht dasselbe mit `npm run build` und
   einem Commit von `dist/` (plus `.nojekyll`) auf `gh-pages`.
2. Den neuen `gh-pages`-Commit als `sha` in `pxt-calliope/targetconfig.json`
   eintragen.
3. Das Target neu ausrollen. Erst danach sieht makecode.calliope.cc das Panel.

Nebenbei liegt derselbe Stand unter https://calliope-edu.github.io/pxt-iot-sim/:
zum Anschauen, und als `devUrl`, wenn man lokal ohne `npm run dev` testen will.

## Entwickeln

```
npm install
npm run dev     # http://localhost:3400
```

Port 3400, nicht 3000: Der Campus zeigt mit `PUBLIC_PYEDITOR_BASE_URL` bereits
auf `localhost:3000`, und zwei Server auf einem Port sind kein Fehler, den man
sieht — man sieht ein Panel, das nicht lädt.

Dann in MakeCode ein Programm mit den IoT-Blöcken öffnen und den Simulator
starten.
