# MÖVAT! — web app companion

Web app mobile-first che accompagna il gioco di carte MÖVAT! di Busa Trasporti e Logistica.
Si apre di solito dal QR code stampato nei materiali del gioco. È HTML/CSS/JS statico:
non richiede build, login o registrazione.

## Avvio

Con il CMS (consigliato): dalla cartella principale lancia `node server/server.js` e apri `http://localhost:8000`.
I contenuti arrivano dal CMS (`/admin/`). Vedi il `README.md` principale.

Solo l'app con i dati dimostrativi, senza server:

```bash
cd app
python3 -m http.server 8000
# apri http://localhost:8000
```

## Schermate e percorsi

| Schermata | Indirizzo |
|---|---|
| Home | `#/` |
| Ascolta — elenco delle carte parlanti | `#/ascolta` (la ricerca resta in `?q=`) |
| Ascolta — dettaglio carta con player | `#/ascolta/<id-carta>` |
| Scopri — gallery delle modalità | `#/scopri` (`?q=` ricerca, `?ord=recenti\|valutazione\|voti`) |
| Scopri — dettaglio modalità e votazione | `#/scopri/<id-modalità>` (`?vista=lista` per la lista compatta) |
| Crea 1 — carte | `#/crea/carte` |
| Crea 2 — dettagli | `#/crea/dettagli` |
| Crea 3 — riepilogo e invio | `#/crea/riepilogo` |
| Conferma di invio | `#/crea/inviata` |
| FAQ | `#/faq` (`?open=<id>` apre una risposta, `?cat=` categoria) |
| Informativa privacy | `#/privacy` |

**Per provare gli stati d'errore:**
- In *Crea 2*, prova a passare al riepilogo lasciando vuoti i campi obbligatori o con un'email non valida.
- Apri `#/crea/riepilogo?simula=errore` per vedere l'invio non riuscito con il pulsante «Riprova».

## Dove si cambiano i contenuti

Con il server, tutti i contenuti si gestiscono dal CMS. Il file `js/data.js` contiene solo i dati **dimostrativi**: si usano quando l'app gira senza server e per popolare il CMS al primo avvio.

- `MOVAT_CARDS` è il catalogo configurabile delle carte Busa. Ogni carta ha numero, nome,
  numero di `copies` (il massimo selezionabile in *Crea*), frase in dialetto, traduzione,
  file audio (`null` mostra «Audio non ancora disponibile») e immagine reale (`image`; con
  `null` viene usata un'illustrazione segnaposto).
- `MOVAT_MODES` contiene le modalità pubblicate, con la somma e il numero dei voti.
- `MOVAT_FAQ` e `MOVAT_FAQ_CATEGORIES` contengono domande e risposte segnaposto. Nessuna regola del gioco è stata inventata.
- `MOVAT_CONFIG` contiene `submitUrl` (endpoint delle proposte), `privacyUrl` e `cardRatio` (le proporzioni della carta fisica).

Gli audio in `assets/audio/` sono solo toni segnaposto.

## Cosa serve lato server (non incluso)

1. **Proposte.** `POST submitUrl` con JSON `{ title, description, players, rules, tried, nickname,
   email, cards: { idCarta: quantità }, startedFrom, consent, status: "in_attesa", submittedAt }`.
   Il server salva la proposta *in attesa*, invia un'email al team Busa e risponde con un 2xx.
   Le proposte non compaiono in *Scopri* finché non vengono approvate dall'area riservata, che è separata da quest'app.
2. **Voti.** Oggi il voto è salvato sul dispositivo (localStorage) e sommato ai valori di esempio.
   In produzione serve un endpoint anonimo (per esempio con un id casuale per dispositivo) che
   accetti voti da 1 a 5, permetta di modificarli e restituisca media e numero di voti.

## Comportamenti già implementati

- Un solo audio alla volta, nessun avvio automatico; l'audio si ferma quando si esce da *Ascolta*.
- Ogni carta compare una sola volta in elenco, anche se ne esistono più copie.
- La bozza in *Crea* viene salvata a ogni modifica: tornando indietro o ricaricando la pagina non si perde nulla.
- «Crea una variante» apre il configuratore con le carte della modalità già selezionate.
- «Condividi» copia il link della modalità.

## Asset

Logo, camioncino, sfondo e icone vengono dagli asset caricati nel progetto Stitch
«MÖVAT Card Companion App» (vedi `../stitch/assets/`).
