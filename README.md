# MÖVAT! — app e CMS

| Cartella | Cosa contiene |
|---|---|
| `app/` | L'app pubblica per i giocatori (Ascolta, Scopri, Crea, FAQ) |
| `admin/` | Il CMS per gestire tutti i contenuti, protetto da utente e password |
| `server/` | Il server che collega app e CMS e salva i dati |
| `data/` | Creata al primo avvio: contenuti (`db.json`), file caricati (`uploads/`) e credenziali. **Non è nel repository**: va salvata con i backup |
| `stitch/` | Schermate e asset originali esportati da Stitch |

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
- **Caricamento massivo** (in *Carte*):
  - selezioni o trascini tante immagini di carte insieme;
  - per ognuna compili a mano numero, nome, copie nel mazzo, frase, traduzione e testo;
  - se il nome del file contiene un numero (es. `carta-07.png`) viene usato come numero della carta;
  - se il numero corrisponde a una carta esistente, viene proposto di aggiornarla mantenendo il suo audio.
- **Copertine delle modalità:** i giocatori possono caricarne una quadrata in *Crea* (1024 × 1024 px, JPG, PNG o WEBP); dal CMS puoi sostituirla o toglierla. Senza copertina si usa quella automatica colorata con il camioncino.
- **Carte proposte** (carte Busa inventate dai giocatori in *Crea → Una carta Busa*):
  - arrivano *In attesa*: le correggi con l'anteprima dal vivo, poi le approvi e pubblichi oppure le rifiuti;
  - quelle pubblicate compaiono in *Scopri → Carte dei giocatori*, dove si votano e si condividono come immagine PNG o JPG;
  - in *Testi e impostazioni → Crea una carta Busa* carichi il **template** (carta vuota con sfondo e camioncino), imposti il **numero massimo di caratteri** di titolo, frase, traduzione e testo, e regoli la **posizione** di balloon e riquadro del testo guardando l'anteprima.
- **Modalità:**
  - le proposte inviate dai giocatori arrivano *In attesa* e non sono visibili nell'app;
  - puoi correggerle e poi **approvarle e pubblicarle** oppure **rifiutarle**;
  - puoi creare modalità del team Busa, modificare quelle pubblicate, leggere l'email privata dell'autore e scrivere note interne.
- **Voti:** media e numero di voti per modalità e ultimi voti ricevuti. Puoi eliminare voti singoli, azzerare una modalità o togliere in un colpo i voti dimostrativi.
- **FAQ:** domande e risposte, categorie (anche da rinominare), ordine e pulsante verso una sezione dell'app.
  - Una FAQ collegata a una carta compare anche nel box *Dubbi su questa carta*, quando si apre la carta nell'app.
  - Puoi scegliere se mostrarla **nella lista FAQ e sulla carta** oppure **solo sulla carta**.
- **Testi e impostazioni:** (compreso il **logo Busa** in fondo alla Home)
  - frase di benvenuto, footer, formato delle carte e informativa privacy;
  - email per le notifiche delle nuove proposte;
  - cambio di utente e password.
- **Backup:** scarica un file con tutti i contenuti o ripristinane uno.

Al primo avvio il CMS contiene i dati dimostrativi, segnalati come “Demo” o “Segnaposto”. Sostituiscili o eliminali dal CMS.

## Mettere online

L'app e il CMS girano insieme sullo stesso server Node.js. Servono:

1. **Un hosting che esegua Node.js con un disco permanente**, per esempio un piccolo server VPS (Hetzner, DigitalOcean, Aruba Cloud), Render o Railway con un *persistent disk*. Il disco serve perché i contenuti e i file caricati stanno nella cartella dei dati.
2. **HTTPS**, attivo di serie su Render e Railway; su un VPS si usa ad esempio Caddy o Nginx con Let's Encrypt.
3. Queste **impostazioni** (variabili d'ambiente), da indicare nel pannello dell'hosting:

| Variabile | A cosa serve |
|---|---|
| `PORT` | Porta del server (spesso la imposta l'hosting) |
| `DATA_DIR` | Percorso del disco permanente, per esempio `/var/data` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Facoltative: se impostate, sostituiscono le credenziali generate al primo avvio |
| `COOKIE_SECURE=1` | Da usare quando il sito è in HTTPS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Facoltative: attivano le email di notifica delle nuove proposte. Richiedono `npm install` nella cartella `server` |

Comando di avvio: `node server/server.js`.

## Senza server

Aprendo solo la cartella `app/` (per esempio con `python3 -m http.server`), l'app funziona con i dati dimostrativi di `app/js/data.js`. Il CMS, l'invio delle proposte e i voti condivisi invece funzionano solo con il server.

## Note tecniche

- Il PDF delle modalità (15 × 19 cm) viene creato direttamente nel browser con [jsPDF](https://github.com/parallax/jsPDF) 2.5.1, incluso in `app/assets/vendor/` con la sua licenza MIT: non serve collegarsi ad altri siti.
- Le preferenze di visualizzazione (1 per riga, 2 per riga, griglia, lista) sono ricordate su ogni dispositivo.
