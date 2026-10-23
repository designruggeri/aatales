# MÖVAT! — app e CMS

| Cartella | Cosa contiene |
|---|---|
| `app/` | L'app pubblica per i giocatori (Ascolta, Scopri, Crea, FAQ) |
| `admin/` | Il CMS per gestire tutti i contenuti, protetto da utente e password |
| `server/` | Il server che collega app e CMS e salva i dati |
| `data/` | Creata al primo avvio: contenuti (`db.json`), file caricati (`uploads/`) e credenziali. **Non è nel repository**: va salvata con i backup |
| `stitch/` | Schermate e asset originali esportati da Stitch |
| `tombola/` | **Tombola Busa**: progetto separato (tabellone, telecomando e CMS per la tombola di Natale). Istruzioni in `tombola/README.md` |

## Avviare tutto sul tuo computer

Serve **Node.js** (versione 18 o successiva): scaricalo da https://nodejs.org (scegli la versione “LTS”).

1. Apri il **Terminale** ed entra nella cartella del progetto:
   ```
   cd percorso/della/cartella/aatales
   ```
2. Avvia il server:
   ```
   node server/server.js
   ```
3. La prima volta il Terminale mostra le credenziali del CMS:
   ```
   ================ ACCESSO AL CMS ================
     Utente:   admin
     Password: xxxxxxxxxxxx
   ```
   **Annota la password**: non verrà più mostrata. Potrai cambiarla dal CMS in *Testi e impostazioni*.
4. Apri nel browser:
   - l'app: **http://localhost:8000/**
   - il CMS: **http://localhost:8000/admin/**

**Dal telefono:** il telefono deve essere sulla stessa rete Wi-Fi del Mac. Apri l'indirizzo che il Terminale mostra alla riga *Dal telefono* (per esempio `http://192.168.1.23:8000/`). `localhost` funziona solo sul Mac stesso. Se il Mac chiede di consentire a “node” le connessioni in entrata, rispondi **Consenti**.

Per fermare il server premi **Ctrl + C** nel Terminale. I dati restano salvati nella cartella `data/`.

## Aggiornare a una nuova versione

1. Ferma il server: nel Terminale premi **Ctrl + C**.
2. Scarica la nuova versione e copia la tua cartella `data` dentro la nuova cartella del progetto.
3. Avvia di nuovo il server con `node server/server.js` e ricarica le pagine del browser.

Se aggiorni i file senza riavviare il server, il CMS mostra un avviso rosso “Riavvia il server”: finché non lo riavvii, alcune modifiche (per esempio il logo o i campi nuovi) potrebbero non essere salvate.

## Cosa si gestisce dal CMS

- **Panoramica:** le proposte da controllare e un elenco di tutto ciò che è ancora segnaposto.
- **Carte:** numero, nome, copie (il massimo selezionabile in *Crea*), frase in piacentino, traduzione, testo della carta, **immagine** e **audio** caricati dal computer.
- **Caricamento massivo delle immagini** (in *Carte*):
  - selezioni o trascini tante immagini di carte insieme;
  - per ognuna compili a mano numero, nome, copie nel mazzo, frase, traduzione e testo;
  - se il nome del file contiene un numero (es. `carta-07.png`) viene usato come numero della carta;
  - se il numero corrisponde a una carta esistente, viene proposto di aggiornarla mantenendo il suo audio.
- **Caricamento massivo degli audio** (in *Carte*):
  - selezioni o trascini tanti file audio insieme (MP3, M4A, AAC, WAV, OGG);
  - se il nome del file è un numero viene associato da solo alla carta con lo stesso numero: `1.mp3` → carta 1, `07.mp3` → carta 7;
  - per gli altri file scegli la carta dall'elenco; prima del caricamento puoi ascoltarli e correggere gli abbinamenti;
  - se una carta ha già un audio viene segnalato che sarà sostituito; due file sulla stessa carta bloccano il caricamento finché non ne togli uno.
- **Copertine delle modalità:** i giocatori possono caricarne una quadrata in *Crea* (1024 × 1024 px, JPG, PNG o WEBP); dal CMS puoi sostituirla o toglierla. Senza copertina si usa quella automatica colorata con il camioncino.
- **Carte proposte** (carte Busa inventate dai giocatori in *Crea → Una carta Busa*):
  - arrivano *In attesa*: le correggi con l'anteprima dal vivo, poi le approvi e pubblichi oppure le rifiuti;
  - quelle pubblicate compaiono in *Scopri → Carte dei giocatori*, dove si votano e si condividono come immagine PNG o JPG;
  - in *Testi e impostazioni → Crea una carta Busa* carichi il **template** (carta vuota con sfondo e camioncino), imposti il **numero massimo di caratteri** di titolo, frase, traduzione e testo, e regoli la **posizione** di balloon e riquadro del testo guardando l'anteprima.
- **Modalità:**
  - le proposte inviate dai giocatori arrivano *In attesa* e non sono visibili nell'app;
  - puoi correggerle e poi **approvarle e pubblicarle** oppure **rifiutarle**;
  - puoi creare modalità del team Busa, modificare quelle pubblicate, leggere l'email privata dell'autore e scrivere note interne.
  - alle modalità del team Busa puoi aggiungere un'**icona** (PNG trasparente) che compare in un cerchio verde accanto al titolo: ne regoli la dimensione e la **posizione**, trascinandola nel cerchio grande, con i cursori o con le frecce della tastiera (*Centra* la riporta al centro).
- **Proposte (modalità e carte):** arrivano sempre *In attesa* e non sono visibili nell'app finché non le approvi. Nella scheda vedi se l'autore ha chiesto le notifiche e se ha confermato l'email, e un avviso di **possibile duplicato** quando un'altra proposta ha lo stesso titolo o contenuto (solo una segnalazione: nessuna proposta viene scartata in automatico).
- **Voti:** per ogni modalità e carta dei giocatori: media, voti validi, **distribuzione delle stelle**, nuovi voti degli ultimi 30 giorni e **segnali da verificare** (picchi, raffiche, più voti dalla stessa rete, voti cambiati spesso). Puoi **escludere** un voto dalla media indicando il motivo e **ripristinarlo**, e **sospendere/riattivare** le votazioni di un contenuto. I voti dimostrativi si eliminano in un colpo.
- **Messaggi:** domande e segnalazioni inviate dal modulo contatti dell'app, visibili solo nel CMS (con stato, note interne e risposta dalla tua posta).
- **FAQ:** domande e risposte, categorie (anche da rinominare) e ordine.
  - Una FAQ collegata a una carta compare anche nel box *Dubbi su questa carta*, quando si apre la carta nell'app.
  - Puoi scegliere se mostrarla **nella lista FAQ e sulla carta** oppure **solo sulla carta**.
  - In fondo alle FAQ c'è il box **“Non trovi la risposta? Contattaci!”**: apre l'app di posta con destinatario e oggetto già compilati. Testo, email e oggetto si cambiano in *Testi e impostazioni*.
- **Testi e impostazioni:** (compreso il **logo Busa** in fondo alla Home)
  - frase di benvenuto, testi sotto le 4 voci del menu in Home, footer, formato delle carte e informativa privacy;
  - **informativa privacy**: il pulsante *Usa il modello aggiornato* carica un'informativa completa, scritta in base alle funzioni dell'app (testo leggibile anche in `docs/informativa-privacy.md`). Completa le parti `[DA COMPLETARE]` e `[DA VERIFICARE]`, salva e togli l'avviso “testo segnaposto”;
  - email per le notifiche delle nuove proposte e dei nuovi messaggi;
  - **protezioni e classifica:** proposte al giorno per browser (predefinite 3) e voti minimi per entrare nella classifica “Valutazione più alta” (predefiniti 5), con lo stato di antibot ed email;
  - **grandezza delle carte** quando sono mostrate da sole: vista “1 per riga”, scheda della carta in *Guarda*, anteprima ingrandita nelle modalità, carta dei giocatori e anteprima in *Crea una carta Busa*, con un'anteprima su un telefono;
  - cambio di utente e password.
- **Backup:** scarica un file con tutti i contenuti o ripristinane uno.

Al primo avvio il CMS contiene i dati dimostrativi, segnalati come “Demo” o “Segnaposto”. Sostituiscili o eliminali dal CMS.

## Mettere online

**Su Aruba Cloud (movat.busalogistica.it):** c'è un kit pronto in `deploy/aruba/` con la guida passo passo [`deploy/aruba/GUIDA.md`](deploy/aruba/GUIDA.md): script di installazione per Ubuntu 24.04, avvio automatico, HTTPS con Caddy, backup notturni e aggiornamenti con ritorno automatico alla versione precedente in caso di problemi.

In generale:

L'app e il CMS girano insieme sullo stesso server Node.js. Servono:

1. **Un hosting che esegua Node.js con un disco permanente**, per esempio un piccolo server VPS (Hetzner, DigitalOcean, Aruba Cloud), Render o Railway con un *persistent disk*. Il disco serve perché i contenuti e i file caricati stanno nella cartella dei dati.
2. **HTTPS**, attivo di serie su Render e Railway; su un VPS si usa ad esempio Caddy o Nginx con Let's Encrypt.
3. Queste **impostazioni** (variabili d'ambiente), da indicare nel pannello dell'hosting:

| Variabile | A cosa serve |
|---|---|
| `PORT` | Porta del server (spesso la imposta l'hosting) |
| `HOST` | Indirizzo su cui ascoltare: `127.0.0.1` se davanti c'è un proxy come Caddy o Nginx |
| `DATA_DIR` | Percorso del disco permanente, per esempio `/var/data` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Facoltative: se impostate, sostituiscono le credenziali generate al primo avvio |
| `NODE_ENV=production` | **Obbligatoria online.** Rende obbligatorio l'antibot (senza chiavi gli invii vengono rifiutati, mai saltati) e attiva i cookie `Secure` |
| `PUBLIC_URL` | **Obbligatoria online.** Indirizzo pubblico, es. `https://movat.esempio.it`: link nelle email, controllo dell'origine e dell'hostname di Turnstile |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | **Obbligatorie online.** Chiavi di Cloudflare Turnstile (vedi *Protezioni* qui sotto) |
| `TURNSTILE_HOSTNAMES` | Facoltativa: hostname accettati nei token Turnstile, separati da virgola (predefinito: quello di `PUBLIC_URL`) |
| `TRUST_PROXY_HOPS` | Numero di proxy davanti al server (Render, Railway, Nginx, Caddy: di solito `1`). Lascia `0` se il server riceve le connessioni direttamente |
| `ANON_ID_DAYS` | Durata del cookie anonimo del browser in giorni (predefinita 180) |
| `RATE_LIMITS_JSON` | Facoltativa: cambia i limiti alle richieste, es. `{"voteNewPerAid":[50,3600]}` (elenco in `server/security.js`) |
| `DATA_RETENTION_DAYS`, `MESSAGE_RETENTION_DAYS` | Conservazione dei dati tecnici (predefiniti 30 giorni) e dei messaggi dei contatti (365) |
| `MOVAT_SECRET` | Facoltativa: segreto per firme e impronte (almeno 32 caratteri). Se manca viene creato `data/secret.key` |
| `COOKIE_SECURE=1` | Cookie `Secure` anche senza `NODE_ENV=production` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Facoltative: attivano le email di notifica delle nuove proposte. Richiedono `npm install` nella cartella `server` |

Comando di avvio: `node server/server.js`.

## Protezioni delle interazioni pubbliche

Votare, proporre modalità e carte e scrivere dal modulo contatti **non richiede account**. Per limitare spam, invii automatici, doppioni e voti manipolati il server combina:

1. **Moderazione:** proposte sempre *In attesa*; le API pubbliche (`/api/content`) restituiscono solo contenuti pubblicati e mai email, note o dati tecnici. Lo stato si cambia solo dal CMS (con login).
2. **Antibot Cloudflare Turnstile** su voti, proposte e contatti. La verifica parte solo quando si preme *Invia*/*Conferma*, di solito è invisibile, e ogni token viene controllato dal server con Siteverify (esito, `action` e hostname). Token assenti, scaduti, già usati o non validi vengono rifiutati; se il token scade l'app ne chiede uno nuovo da sola, senza perdere i dati.
3. **Identificativo anonimo del browser:** un codice casuale assegnato e firmato dal server, in un cookie `HttpOnly` (vedi sotto). Il server non accetta codici inventati dal browser e nei dati salva solo un'impronta del codice.
4. **Un voto per browser e contenuto:** un nuovo voto dallo stesso browser aggiorna il precedente. Media e conteggi li calcola il server, solo sui voti validi. Le scritture avvengono in un'unica sezione sincrona con una chiave univoca (browser + contenuto), quindi anche richieste simultanee non creano doppioni.
5. **Limiti alle richieste** (contatori salvati su disco, validi anche dopo un riavvio), per browser, più generosi per rete, per tipo di operazione e contro le raffiche. Superato un limite l'app mostra un messaggio con il tempo di attesa (HTTP 429 con `Retry-After`).
6. **Controlli sui contenuti:** campi, tipi, lunghezze, carte esistenti e quantità entro le copie, formato email e dimensione delle richieste. Tutti i testi sono trattati come testo semplice, sia nell'app sia nel CMS; una *Content-Security-Policy* blocca script di altri siti.
7. **Niente doppioni da doppio clic o rete instabile:** ogni invio porta una chiave unica; lo stesso contenuto dallo stesso browser nelle 24 ore viene riconosciuto come già ricevuto.
8. **Email facoltativa:** la proposta arriva anche senza email. Le notifiche partono solo se richieste *e* dopo che la persona ha confermato l'indirizzo (link monouso valido 48 ore, conferma con un pulsante). Ogni email contiene il link per disattivarle. Nessuna newsletter.
9. **Richieste da altri siti bloccate:** controllo dell'origine, intestazione dedicata e corpo JSON per l'app; cookie `SameSite=Strict` e intestazione dedicata per il CMS.

### Da configurare prima di andare online

1. **Cloudflare Turnstile** (gratuito):
   - su <https://dash.cloudflare.com> apri *Turnstile* → *Add widget*;
   - nome a piacere, **dominio** del sito (es. `movat.esempio.it`), modalità **Managed**;
   - copia *Site Key* e *Secret Key* nelle variabili `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` dell'hosting. La chiave segreta va **solo** sul server.
2. `NODE_ENV=production` e `PUBLIC_URL=https://…` (l'indirizzo esatto del sito).
3. `TRUST_PROXY_HOPS=1` se l'hosting mette un proxy davanti al server (Render, Railway, Nginx, Caddy). Senza, l'indirizzo di rete dei visitatori non viene riconosciuto e i limiti per rete varrebbero per tutti insieme.
4. **Email** (facoltative, per le notifiche agli autori e al team): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` e `npm install` nella cartella `server`. In *Testi e impostazioni* indica le email del team. Senza SMTP tutto funziona, ma le notifiche non partono e l'app lo dice.
5. Se il server può uscire su Internet solo tramite un proxy aziendale, avvialo con `NODE_USE_ENV_PROXY=1` (Node 22.21 o successivo) perché raggiunga Cloudflare.

Con `NODE_ENV=production` e senza chiavi Turnstile **gli invii vengono rifiutati** (e il CMS mostra un avviso rosso): i controlli non si disattivano mai in silenzio. In sviluppo, senza chiavi, l'antibot viene saltato con un avviso nel Terminale e nel CMS. Per provarlo in locale si possono usare le chiavi di prova di Cloudflare (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`).

Il server deve girare in **una sola istanza** (i dati stanno in file JSON sul disco). Contatori e limiti sono salvati su disco nella cartella dei dati e valgono anche dopo un riavvio, ma non sono condivisi tra più istanze: per scalare su più istanze andrebbe prima spostato l'archivio su un database condiviso.

### Limiti predefiniti

| Operazione | Per browser | Per rete (IP) |
|---|---|---|
| Proposte (modalità + carte insieme) | **3 al giorno** (modificabile dal CMS) | 20 al giorno, 6 in 10 minuti |
| Nuovi voti | 30 all'ora | 300 all'ora |
| Modifiche ai voti | 20 all'ora, 3 in 10 minuti sullo stesso voto | 200 all'ora |
| Messaggi dei contatti | 3 all'ora, 6 al giorno | 20 al giorno |
| Email di conferma | 5 al giorno (max 3 al giorno per indirizzo) | 10 al giorno |
| Raffiche (qualsiasi invio) | 8 in 10 secondi | 30 in 10 secondi |

I limiti per rete sono più alti perché più persone possono condividere la stessa Wi-Fi: un voto da una rete non impedisce agli altri sulla stessa rete di votare. Tutte le soglie si cambiano con `RATE_LIMITS_JSON`.

### Cookie, servizi esterni e dati (per l'informativa privacy)

| Cosa | Dettagli |
|---|---|
| Cookie `movat_aid` | Tecnico, impostato dal server al primo invio. Codice casuale firmato, senza dati personali. `HttpOnly`, `SameSite=Lax`, `Secure` online, valido solo per `/api/`, durata 180 giorni (`ANON_ID_DAYS`). Serve a riconoscere lo stesso browser per voti e limiti; non traccia la navigazione e non crea profili. |
| Cookie `movat_admin` | Sessione del CMS (12 ore), solo per chi accede al CMS. |
| Archiviazione locale del browser | Bozze dei moduli, preferenze di visualizzazione e ultima proposta inviata, solo sul dispositivo. |
| Cloudflare Turnstile | Al momento dell'invio il browser carica lo script di Cloudflare, che valuta la richiesta; il server invia a Cloudflare il token e l'IP del visitatore per la verifica (Siteverify). Va citato come servizio di terze parti. |
| Google Fonts | Caratteri tipografici caricati da Google (già presenti prima). |
| Voti | Valore, data, numero di modifiche, impronta del codice del browser (conservata finché esiste il voto) e un'impronta della rete (cancellata dopo 30 giorni). L'IP **non** viene salvato in chiaro. |
| Proposte | Contenuti, nickname pubblico, email facoltativa (privata) e stato delle notifiche. Impronte di browser e rete cancellate dopo 30 giorni; l'email delle proposte rifiutate dopo 180 giorni. |
| Messaggi dei contatti | Argomento, testo, email solo se indicata. Cancellati dopo 365 giorni (`MESSAGE_RETENTION_DAYS`). |
| Contatori dei limiti | Solo impronte e numeri, in `data/runtime-state.json`, cancellati alla scadenza della finestra. |

`data/secret.key` va conservato insieme ai backup: se cambia, i cookie dei visitatori smettono di valere e chiunque potrebbe votare di nuovo una volta.

### Cosa non si può garantire senza account

L'identificativo anonimo riconosce **un browser, non una persona**. Chi cancella i cookie, usa la navigazione in incognito, un altro browser o un altro dispositivo può votare di nuovo. Antibot e limiti per rete rendono questi tentativi lenti e costosi, e i segnali nel CMS aiutano a individuarli, ma non è possibile garantire in assoluto “una persona, un voto”. I segnali sono indizi da verificare, non prove: nessun voto viene escluso in automatico.

### Aggiornamento dei dati

Al primo avvio della nuova versione i dati vengono aggiornati da soli (versione 2): i voti esistenti restano, i vecchi codici dispositivo scelti dal browser vengono sostituiti da impronte e gli eventuali doppioni dello stesso dispositivo ridotti a uno. Fai comunque un **backup** dal CMS prima di aggiornare.

### Verifiche automatiche

```
node server/tests/security-api.test.js
node server/tests/security-config.test.js
```

Avviano server di prova con dati temporanei (un Siteverify simulato e le email scritte su file) e controllano moderazione, antibot, limiti, voti simultanei, esclusioni, email e visualizzazione sicura dei testi.

## Senza server

Aprendo solo la cartella `app/` (per esempio con `python3 -m http.server`), l'app funziona con i dati dimostrativi di `app/js/data.js`. Il CMS, l'invio delle proposte e i voti condivisi invece funzionano solo con il server.

## Note tecniche

- Il PDF delle modalità (15 × 19 cm) viene creato direttamente nel browser con [jsPDF](https://github.com/parallax/jsPDF) 2.5.1, incluso in `app/assets/vendor/` con la sua licenza MIT: non serve collegarsi ad altri siti.
- Le preferenze di visualizzazione (1 per riga, 2 per riga, griglia, lista) sono ricordate su ogni dispositivo.
- Le animazioni (ingresso delle pagine, liste a cascata, stelle, conferme, menu) sono brevi, partono solo all'apertura di una pagina e si disattivano da sole se il telefono o il computer ha attiva l'opzione “riduci movimento”. Sono raccolte in fondo a `app/css/app.css`.
