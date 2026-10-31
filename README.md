# Pocket Miner – Bitcoin-Lotterie-Miner fürs Handy

Eine Web-App (PWA), die im Handy-Browser **echtes Bitcoin-Proof-of-Work** rechnet:
doppeltes SHA-256 (SHA-256d) auf einem 80-Byte-Blockheader, der auf dem aktuellen
Bitcoin-Block aufbaut. Läuft komplett lokal, ohne Installation aus dem App Store,
ohne Tracking und ohne Konto.

## Ehrlicher Hinweis vorab

Bitcoin-Mining auf dem Handy bringt **kein Geld**. Ein Smartphone schafft im Browser
etwa 1–10 MH/s, das Bitcoin-Netzwerk mehrere hundert EH/s (≈ 10²⁰ H/s). Die App zeigt
dir das live an. Typisch sind „1 zu 10¹²“ pro Tag bzw. Milliarden Jahre bis zum ersten
Block. Bei Pool-Mining wäre der Ertrag Bruchteile eines Cents pro Jahr, deutlich
weniger als der Strom kostet.

Das Projekt ist deshalb als **Lern- und Lotterie-Miner** gedacht: Du siehst, wie Mining
wirklich funktioniert, und jeder Hash ist ein (winziges) Los.

## Funktionen

- Echtes SHA-256d mit Midstate-Optimierung, verifiziert am Genesis-Block
- Multithreading über Web Worker (Anzahl einstellbar)
- Leistungsregler (10–100 %) gegen Hitze und Akkuverbrauch
- „Nur minen, wenn das Handy lädt“ (Battery API, Android/Chrome) und Auto-Pause unter 15 % Akku
- Optional: Bildschirm wach halten (Wake Lock API)
- Live-Daten vom aktuellen Bitcoin-Block über [mempool.space](https://mempool.space), mit Offline-Fallback
- Statistik: Hashrate, beste Share (Difficulty), Chance pro Tag, erwartete Zeit bis zum Block
- Installierbar auf dem Homescreen, funktioniert offline (Service Worker)

## Starten

### Option A: GitHub Pages (empfohlen fürs Handy)

1. Im Repo auf GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**
2. Branch mit diesen Dateien auswählen, Ordner `/ (root)`, speichern
3. Nach ca. 1 Minute die angezeigte URL (`https://<name>.github.io/btc/`) auf dem Handy öffnen
4. Im Browser-Menü **„Zum Startbildschirm hinzufügen“** wählen, dann läuft es wie eine App

### Option B: Lokal

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen (oder http://<PC-IP>:8000 im selben WLAN)
```

> Service Worker und Installation funktionieren nur über `https://` oder `localhost`.

## Tests

```bash
node test/core.test.js
```

Prüft den SHA-256d-Kern gegen den Bitcoin-Genesis-Block (Hash, Nonce, Difficulty)
und macht einen kleinen Benchmark.

## Wie es funktioniert

| Datei | Aufgabe |
|---|---|
| `miner-core.js` | SHA-256d-Kern: Midstate, Nonce-Scan, Target-Vergleich, Difficulty |
| `miner-worker.js` | Web Worker: hasht Nonces in Paketen, drosselt, meldet Fortschritt |
| `app.js` | Oberfläche, Blockdaten von mempool.space, Akku- und Wake-Lock-Steuerung |
| `sw.js`, `manifest.webmanifest` | PWA: Offline-Cache und Installation |

Der Header besteht aus Version, Hash des letzten Blocks, Merkle-Root, Zeit, `bits`
(Ziel-Schwierigkeit) und Nonce. Pro Versuch wird die Nonce erhöht. Ist der Hash
(als Zahl gelesen) kleiner als das Target, wäre der Block gültig. Nach 2³² Nonces
würfelt der Worker die Merkle-Root neu („Extranonce“).

### Grenzen dieser Version

- Die Merkle-Root ist **zufällig**, es gibt also keine echte Coinbase-Transaktion mit
  deiner Adresse. Ein Treffer wäre zwar ein Hash unter dem Target, aber **kein
  einreichbarer Block**. Für echtes Solo-Mining bräuchte man eine Coinbase mit deiner
  Adresse und Blockhöhe (BIP34) sowie einen Weg, den Block einzureichen (eigener Node
  oder Stratum-Pool). Browser können kein Stratum (TCP) sprechen, dafür wäre ein
  WebSocket-Proxy nötig.
- An Retarget-Grenzen (alle 2016 Blöcke) wird kurzzeitig noch die alte Difficulty angezeigt.
- Mobile Browser pausieren Web Worker, wenn die App im Hintergrund ist.

## Wenn du wirklich etwas mit dem Handy minen willst

- **Duino-Coin**: extra für schwache Geräte gemacht, mit offizieller Android-App.
  Der Ertrag ist minimal, aber nicht null.
- **Monero (XMR)** mit XMRig in Termux (Android): RandomX läuft auf CPUs, aber das
  Handy wird heiß und der Akku leidet dauerhaft. Nur am Ladekabel und mit Kühlung.
- Mining-Apps sind in den App Stores von Google und Apple verboten, deshalb ist dieses
  Projekt eine Web-App.

**Achtung, Gesundheit des Handys:** Dauerlast bei Hitze verschleißt den Akku spürbar.
Nutze wenige Threads, eine niedrige Leistung und die Option „Nur beim Laden“.
