# Tombola Busa

Tombola digitale per la cena di Natale di Busa: **tabellone** proiettato sul muro, **telecomando** sullo smartphone del conduttore, **CMS** sul portatile per preparare serata, cartelle, premi e regole. I partecipanti giocano con cartelle di carta: niente app, niente registrazione.

Tutto gira **sul portatile, in rete locale, anche senza internet**: font, immagini e suoni sono inclusi nel progetto.

| Indirizzo | Chi lo usa | Cosa fa |
|---|---|---|
| `/display` | proiettore | Tabellone pubblico 16:9, sola lettura |
| `/control` | telefono del conduttore | Estrai, verifica, conferma, rivela premio |
| `/admin` | portatile | CMS protetto da password |

---

## 1. Installazione (una volta)

Serve **Node.js 22.13 o successivo** (consigliato l'ultimo “LTS” da https://nodejs.org).

```bash
cd tombola
npm install
```

## 2. Avvio

```bash
npm start
```

Il comando compila e avvia il server. Il Terminale mostra:

```
  Su questo portatile:   http://localhost:8080/
    Tabellone (proiettore): http://localhost:8080/display
    CMS:                    http://localhost:8080/admin
  Dal telefono (stessa rete Wi-Fi):
    http://192.168.1.23:8080/
  PRIMO AVVIO — password del CMS: xxxxxxxx
```

**Annota la password**: viene mostrata solo al primo avvio (si cambia dal CMS, *Registro e backup*). Se la perdi, avvia una volta con `ADMIN_PASSWORD=nuovapassword npm start`.

Per fermare: **Ctrl + C**. I dati restano salvati.
Se macOS chiede di consentire a “node” le connessioni in entrata, rispondi **Consenti**.

Variabili facoltative: vedi `.env.example` (`PORT`, `HOST`, `DATA_DIR`, `ADMIN_PASSWORD`).

## 3. Proiettore e telefono

### Proiettore come schermo esteso
1. Collega il proiettore e imposta lo schermo **esteso** (macOS: Impostazioni → Monitor → “Estendi”; Windows: `Win + P` → “Estendi”).
2. Nel CMS → *Panoramica* → **Apri il tabellone**. Trascina la finestra sul proiettore.
3. Clicca **Avvia con audio e schermo intero** (il browser vuole un clic per l'audio). Il CMS resta sullo schermo del portatile.
4. In basso a destra sul tabellone, muovendo il mouse, compare ⚙: volume, silenzia, riduci animazioni, schermo intero. I suoni escono **solo** dal tabellone.

### Abbinare il telefono del conduttore
1. Telefono e portatile sulla **stessa rete**.
2. CMS → *Panoramica* → scegli l'indirizzo del portatile → **Crea QR di abbinamento**.
3. Inquadra il QR con la fotocamera del telefono e apri il link. Il telefono resta abbinato (anche chiudendo il browser) finché la credenziale non scade (12 ore, modificabile) o la revochi dal CMS.
4. Il QR contiene una credenziale: **non mostrarlo sul proiettore**. Il tabellone non mostra mai segreti.

Se il telefono non è disponibile: CMS → *Panoramica* → **Telecomando di riserva (portatile)**.

### Rete: provala prima
Molte reti “ospiti” dei ristoranti **isolano i dispositivi** fra loro: il telefono non raggiunge il portatile. Prima della serata prova, nell'ordine:
1. il Wi-Fi del ristorante;
2. un **router portatile dedicato** (la soluzione più affidabile: portatile e telefono collegati al router, internet non serve);
3. l'**hotspot** del telefono o del portatile (funziona su molti dispositivi, non su tutti: va provato con quelli della serata).

Se il collegamento cade, il tabellone resta sull'ultimo stato confermato, il telefono mostra “Non collegato” e disattiva i comandi; entrambi si ricollegano da soli e recuperano lo stato dal server. Nessun comando viene accodato per dopo.

## 4. Preparare la serata (CMS)

1. **Serate e partite** → crea la serata (es. “Cena di Natale 2026”) e una o più partite.
2. **Cartelle e stampa** → genera un lotto (es. 100 cartelle) → stampa il PDF (vedi §6).
3. **Serate e partite** → *Cartelle* sulla partita → attiva **solo le cartelle distribuite** (es. `B0001-B0070`). Le altre non producono vincitori.
4. **Premi** → per ogni regalo: titolo, descrizione, foto, categoria, quantità. Il numero di premi in palio per categoria si calcola dalle quantità. I *premi di riserva* servono solo per i pari merito.
5. **Regole** → controlla le opzioni (vedi §5) e salva.
6. **Numeri e audio** (facoltativo) → testi Busa, battute per il conduttore, immagini, audio, clacson/camioncino su alcuni numeri.
7. **Aspetto** → titolo, colori, decorazioni natalizie, logo Busa (va caricato il file originale: il progetto non lo ricostruisce).
8. *Serate e partite* → **Mostra sul tabellone** → dal telefono **Avvia partita**.

Per provare tutto senza toccare i dati reali: *Panoramica* → **Crea dati dimostrativi** (serata e partita di PROVA, 1.000 cartelle demo con 70 attive, premi di esempio). La partita di prova si azzera all'infinito con *Azzera prova*.

## 5. Regole implementate

- Numeri 1–90 estratti dal server senza ripetizione, con generatore casuale sicuro e uniforme fra i rimasti. L'animazione non sorteggia nulla: il numero è già deciso e salvato.
- Cartella italiana: 3 righe × 9 colonne, 5 numeri per riga, colonne 1–9, 10–19, …, 80–90.
- **Ambo/terno/quaterna/cinquina** = 2/3/4/5 numeri **sulla stessa riga**; **tombola** = 15 numeri. Righe e cartelle diverse non si sommano.
- **Una sola vincita per riga** (attiva di default, configurabile per partita, congelata all'avvio): dopo un premio confermato quella riga non riceve altri premi di riga; le altre righe restano libere; la **tombola resta sempre possibile**. Il blocco scatta solo alla conferma del conduttore: verifiche, dichiarazioni errate e spareggi persi non bloccano nulla; l'annullamento sblocca la riga e restituisce il premio, lasciando traccia nel registro.
- **Categorie aperte insieme** finché hanno premi (nessuna sequenza ambo → terno).
- **Dichiarazione sull'ultimo numero**: la combinazione vale se si completa con l'ultimo numero estratto, prima dell'estrazione successiva (una cinquina non è un nuovo ambo; nessun arretrato). Ogni verifica registra l'estrazione a cui si riferisce.
- **Pari merito**: le dichiarazioni sullo stesso numero si confermano insieme, senza precedenza a chi è inserito per primo. Se i premi non bastano si apre *Pari merito da risolvere* e si usa la procedura annunciata prima dell'inizio: **scelta del conduttore con motivo obbligatorio** oppure **sorteggio digitale** (separato dalle 90 estrazioni e registrato). Chi perde può ricevere un premio di riserva. Nessun oggetto viene diviso automaticamente.
- Una cartella vince al massimo una tombola per partita; più tombole vanno a cartelle diverse.
- Se c'è una tombola mentre restano premi minori, il telefono avvisa: la partita **non si chiude da sola**. La chiude il conduttore (*Altre azioni → Chiudi partita*), e i premi non assegnati restano indicati.
- Assegnazione del regalo (scelta per partita): **prestabilita** (ordine dell'elenco), **sorteggio** fra i premi disponibili della categoria, **manuale**. Alla conferma il regalo è riservato; la rivelazione mostra quel regalo e non sorteggia di nuovo. Ripetere l'animazione o ricollegare il display non cambia il premio.
- Tombolino e decina non sono previsti.

## 6. Cartelle e stampa

- Lotti fino a 9.999 cartelle; ogni lotto ha un prefisso nuovo (A, B, C…, senza I/O/Q): codici come `B0042`, mai riusati. Sul telefono basta digitare `b42`.
- Nessuna cartella ha gli stessi 15 numeri di un'altra; nel lotto si evitano righe identiche quando possibile (i pari merito restano comunque possibili).
- PDF **vettoriale** con Lato incorporato, generato dagli stessi record del database (i test confrontano il testo del PDF con i numeri salvati).
- **A6 orizzontale 148 × 105 mm**, una cartella diversa per pagina.
- **A4 orizzontale con 4 cartelle diverse**: ogni quarto misura 148,5 × 105 mm; la cartella (148 × 105 mm) è centrata senza deformazioni, con 0,25 mm bianchi a sinistra e a destra. Taglio a 148,5 mm in orizzontale e 105 mm in verticale. Nessuna abbondanza fra cartelle adiacenti: per questo la fascia verde resta dentro il margine di sicurezza.
- **Profilo di stampa** (salvato): abbondanza (solo A6: la pagina si allarga e la fascia verde arriva al bordo), margine di sicurezza, segni di taglio, retro (uguale per tutte le cartelle, quindi nessun problema di allineamento fronte/retro), QR con il codice. Prefisso del QR facoltativo (es. `http://192.168.1.10:8080/control#verifica=`): inquadrandolo con la fotocamera del telefono già abbinato, durante una verifica aperta, il codice viene inserito e verificato da solo. Il QR identifica la cartella, non autorizza comandi. **Non si assume un fornitore**: chiedi alla tipografia abbondanza e margini e regola il profilo.
- *Anteprima PDF* non registra nulla; *PDF per la tipografia* registra la stampa: da quel momento la cartella è immutabile e ogni ristampa riporta “RISTAMPA n. X (stessa cartella)”.
- Import/export JSON e CSV (`;`): `codice;lotto;r1c1;…;r1c9;r2c1;…;r3c9` — 27 caselle riga per riga, `0` = casella vuota.

## 7. Durante la serata (telefono)

- **Estrai numero** (grande, in alto). Durante l'animazione (circa 2 s) e durante verifiche/annunci il server rifiuta altre estrazioni; un doppio tocco non estrae due volte.
- **Vincita dichiarata / Pausa** → estrazioni congelate sull'ultimo numero → digita il codice → **Verifica cartella**: righe ricostruite, numeri estratti evidenziati, motivo preciso di ogni rifiuto → **Dichiara …** (nome facoltativo) → raccogli tutte le dichiarazioni su quel numero → **Conferma vincita**.
- **Annuncia** (vincitore sul tabellone) → **Rivela premio** (pacco che si apre) oppure *Rivela senza animazione*; *Ingrandisci premio* è facoltativo e reversibile → **Riprendi**.
- Sotto: premi rimasti, ultime estrazioni, battuta riservata del numero (solo sul telefono), registro vincite con **Annulla** (motivo obbligatorio e impatto mostrato prima).
- *Altre azioni* (in fondo, lontano da Estrai): silenzia display, riduci animazioni, voce sintetica, ripeti annuncio, pausa, riepilogo finale, chiudi partita, passa a un'altra partita.

## 8. Dati, backup e trasferimento

- Tutto è in `tombola/data/`: database `tombola.sqlite`, file caricati in `uploads/`, backup automatici in `backups/` (a ogni avvio e a ogni partita chiusa; si tengono gli ultimi 30).
- CMS → *Registro e backup* → **Scarica backup completo** (zip con database e file).
- **Ripristino**: carica lo zip → viene validato (integrità del database, versione, contenuto) e mostrato un riepilogo → *Sostituisci i dati attuali*. Prima di sovrascrivere viene salvata una copia di sicurezza in `data/backups/`.
- **Su un altro portatile**: installa il progetto (§1) e ripristina il backup dal CMS, oppure copia l'intera cartella `data/` con il server fermo.
- Chiudere il browser o riavviare il server non perde la partita: ogni estrazione e assegnazione è salvata **prima** di essere annunciata.
- Le partite reali non si cancellano: si chiudono e restano in archivio. Per “ricominciare” usa *Duplica* (nuova partita con stesse regole, premi e cartelle attive).
- *Registro e backup* mostra anche il registro delle operazioni e l'archivio vincitori, esportabile in CSV (le prove sono escluse se non richieste).

## 9. Numeri e smorfia

L'archivio dei 90 numeri ha: significato tradizionale, testo Busa (pubblico), battuta solo conduttore, immagine, audio ed evento speciale (clacson o camioncino). **Il progetto non include il repertorio della smorfia**: non è stato possibile verificarne una fonte affidabile in fase di sviluppo, e non si inventano significati spacciandoli per tradizionali. Se lo inserisci (a mano o con *Importa JSON*), indica la fonte. Formato: *Esporta JSON* dal CMS.

## 10. Sicurezza

- CMS con password (hash scrypt), sessione in cookie `HttpOnly`/`SameSite=Strict`, blocco dopo tentativi ripetuti.
- Telefono con credenziale casuale, a scadenza e revocabile; la revoca chiude subito la connessione.
- Il tabellone è in sola lettura: le API di comando rispondono 401 senza credenziale.
- I regali non rivelati non arrivano mai al tabellone (né nomi né immagini, nemmeno nascosti nella pagina); le immagini dei premi non sono pubbliche finché il premio non è rivelato.
- Upload controllati sul contenuto reale del file (PNG/JPG/WEBP/GIF; MP3/WAV/OGG/M4A).

## 11. Test

```bash
npm test            # motore, generatore, API, PDF, backup (vitest)
npm run test:e2e    # tabellone + telefono in due browser separati (Playwright); richiede npm run build
npm run typecheck
```

I test dei PDF usano `pdfinfo`, `pdffonts` e `pdftotext` (pacchetto *poppler*: `brew install poppler` su macOS, `poppler-utils` su Linux).

Cosa coprono: invarianti su 1.000 cartelle; 90 numeri distinti e nessuna 91ª estrazione; doppio tocco, retry e due controllori concorrenti; vincite solo sulla stessa riga e solo sull'ultimo numero; blocco della riga (ma non della tombola); verifiche che non bloccano; annullamento che ripristina riga e premio; pari merito senza priorità, con motivo obbligatorio, sorteggio separato e premi di riserva; cartelle non attive escluse; tombole su cartelle diverse; riavvio del server e riconnessione del display senza ripetere animazioni; display non autorizzato e senza premi segreti; PDF A6/A4 (dimensioni pagina, font incorporato, codici e numeri uguali al database, ristampa); backup e ripristino; flusso completo telefono → tabellone. Le estrazioni “pilotate” esistono solo nelle fixture di test (`tests/helpers.ts`, `e2e/test-server.ts`): l'applicazione non ha alcun modo di scegliere un numero.

**Non verificato su hardware reale**: i test girano su Chromium headless con viewport 1920×1080, 1280×720 e smartphone 360–390 px. Prima della serata fai la prova sotto con i dispositivi veri.

### Checklist di prova con i dispositivi reali
1. `npm start` sul portatile della serata; apri `/display` sul proiettore, schermo intero, *Prova audio* dal menu ⚙.
2. Abbina il telefono Android con il QR; controlla “Collegato”.
3. Crea i dati dimostrativi e avvia la partita di prova; estrai 10 numeri dal telefono camminando in fondo alla sala: leggibilità di numeri e pannello, tempo di risposta.
4. Spegni il Wi-Fi del telefono 10 secondi: i comandi si disattivano; riaccendi: torna “Collegato” sullo stesso stato.
5. Ricarica la pagina del tabellone durante un annuncio: deve mostrare lo stato attuale senza ripetere l'animazione.
6. Verifica una cartella demo stampata (anteprima PDF), dichiara e conferma una vincita, rivela il premio.
7. Riavvia il server (Ctrl + C, `npm start`): la partita continua da dove era.
8. Stampa una pagina A6 e una A4 di prova e misura le cartelle; regola il profilo con la tipografia.
9. *Azzera prova*, poi prepara la partita reale.

## 12. Architettura

- **Server**: Node.js + TypeScript, Express 5, WebSocket (`ws`), SQLite tramite il modulo integrato `node:sqlite` (nessuna dipendenza nativa da compilare), `pdfkit` + `qrcode` per i PDF, `adm-zip` per i backup.
- **Client**: React + TypeScript + Vite, un'unica app con tre percorsi.
- Stato autorevole sul server; ogni comando ha un id univoco (idempotente), viene eseguito in una transazione e incrementa la versione dello stato. Display e telefono ricevono snapshot completi e versionati; gli effetti (animazioni) hanno un id e un orario e si riproducono una sola volta e solo se recenti.
- Il progetto è separato dall'app MÖVAT! che sta nel resto del repository e non la modifica.
- Pubblicazione futura in HTTPS: il server funziona dietro un proxy (es. Caddy) con `COOKIE_SECURE=1` e `TRUST_PROXY=1`. Serve un server con Node persistente e WebSocket: un normale hosting WordPress/Aruba condiviso in genere non basta. Nulla viene pubblicato automaticamente.

| Cartella | Contenuto |
|---|---|
| `server/src/` | `engine.ts` (regole e stato di gioco), `cards.ts` (generatore e archivio), `admin.ts` (CMS), `app.ts` (HTTP/WebSocket), `pdf.ts`, `backup.ts`, `auth.ts`, `db.ts` (schema) |
| `client/src/` | `display/`, `control/`, `admin/`, `lib/` |
| `shared/` | tipi e regole condivisi |
| `assets/` | font Lato (OFL) e camioncino Busa |
| `tests/`, `e2e/` | test |

## 13. Stato del lavoro

**Completo**: estrazioni, verifica, vincite con una vincita per riga, pari merito, premi e rivelazione, display, telecomando con abbinamento, CMS, generatore e PDF A6/A4, import/export, backup/ripristino, dati dimostrativi e modalità prova, registro e archivio vincitori.

**Facoltativo / non incluso**: lettura del QR della cartella con la fotocamera dentro l'app (richiede HTTPS: su HTTP locale usa la fotocamera del telefono con il prefisso del QR, oppure digita il codice); modalità di apertura sequenziale delle categorie; lotti in serie da sei con copertura 1–90; tombolino e decina; repertorio della smorfia; logo Busa vettoriale (da caricare dal CMS). La voce sintetica usa le voci installate nel sistema e può non essere disponibile offline su tutti i dispositivi.

**Asset**: il camioncino Busa è quello già presente nel repository (`app/assets/img/camioncino.png`), con molla animata e cappello natalizio vettoriale; il pacco regalo è un disegno vettoriale con la scritta BUSA. Sostituibili.
