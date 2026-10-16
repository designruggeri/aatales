/*
 * MÖVAT — dati dell'app.
 *
 * TUTTI I CONTENUTI QUI SOTTO SONO DIMOSTRATIVI: servono a valutare il layout
 * e vanno sostituiti con i dati ufficiali Busa (nomi, numeri, copie, frasi,
 * audio, modalità e FAQ). Nessuna regola del gioco è stata inventata.
 */

window.MOVAT_CONFIG = {
  // Endpoint che riceve le proposte (POST JSON). Il server le salva "in attesa"
  // e notifica via email il team Busa. Con null l'invio viene simulato.
  submitUrl: null,
  // Pagina dell'informativa privacy (interna all'app o URL esterno).
  privacyUrl: '#/privacy',
  // Proporzioni della carta fisica (larghezza / altezza). Aggiornare con il formato reale.
  cardRatio: 63 / 88,
  // Etichetta mostrata sopra i contenuti segnaposto.
  demoLabel: 'Contenuto dimostrativo',
};

/*
 * Catalogo delle carte Busa.
 * - number: numero stampato sulla carta.
 * - copies: copie reali presenti nella scatola → limite massimo nel configuratore.
 * - audio: percorso del file audio, oppure null se "non ancora disponibile".
 * - image: percorso dell'immagine reale della carta (null → illustrazione segnaposto).
 * Ogni carta compare una sola volta, anche se esiste in più copie.
 */
window.MOVAT_CARDS = [
  { id: 'fermo-li', number: 1, name: 'Fermo lì!', copies: 2, color: '#e02e2a', icon: 'back_hand',
    dialect: 'Tè svelt cmé un gatt ad màrmul!', translation: 'Sei svelto come un gatto di marmo!',
    audio: 'assets/audio/demo-voce-1.wav', image: null },
  { id: 'svuota-colore', number: 2, name: 'Svuota colore', copies: 2, color: '#1292e8', icon: 'format_color_reset',
    dialect: "A t'ho ciapà col sacco in testa!", translation: null,
    audio: 'assets/audio/demo-voce-2.wav', image: null },
  { id: 'ultimo-paga', number: 3, name: "L'ultimo paga", copies: 1, color: '#ffc300', icon: 'euro',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-1.wav', image: null },
  { id: 'affare-fatto', number: 4, name: 'Affare fatto', copies: 3, color: '#8a3ffc', icon: 'handshake',
    dialect: null, translation: null, audio: null, image: null },
  { id: 'mano-lesta', number: 5, name: 'Mano lesta', copies: 2, color: '#f08a00', icon: 'pan_tool',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-2.wav', image: null },
  { id: 'silenzio-cabina', number: 6, name: 'Silenzio in cabina', copies: 1, color: '#0ea5e9', icon: 'volume_off',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-1.wav', image: null },
  { id: 're-bancale', number: 7, name: 'Re del bancale', copies: 1, color: '#c08a00', icon: 'crown',
    dialect: null, translation: null, audio: null, image: null },
  { id: 'sorpasso', number: 8, name: 'Sorpasso', copies: 4, color: '#32731c', icon: 'fast_forward',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-2.wav', image: null },
  { id: 'cambio-rotta', number: 9, name: 'Cambio rotta', copies: 3, color: '#005f9c', icon: 'u_turn_left',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-1.wav', image: null },
  { id: 'carico-pesante', number: 10, name: 'Carico pesante', copies: 2, color: '#52614e', icon: 'weight',
    dialect: null, translation: null, audio: null, image: null },
  { id: 'pieno-gasolio', number: 11, name: 'Pieno di gasolio', copies: 2, color: '#d1495b', icon: 'local_gas_station',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-2.wav', image: null },
  { id: 'consegna-express', number: 12, name: 'Consegna express', copies: 1, color: '#1e6a00', icon: 'local_shipping',
    dialect: null, translation: null, audio: 'assets/audio/demo-voce-1.wav', image: null },
];

/*
 * Modalità pubblicate (già approvate dal team Busa).
 * ratingSum/ratingCount arrivano dal server; qui sono valori di esempio.
 */
window.MOVAT_MODES = [
  { id: 'sorpassi-a-sorpresa', title: 'Sorpassi a sorpresa', author: 'Ruota libera',
    date: '2026-10-10', players: '3–6',
    description: 'Modalità di esempio: una partita con molti sorpassi e cambi di direzione. Testo segnaposto da sostituire con la descrizione inviata dal giocatore.',
    rules: 'Regola aggiuntiva di esempio, scritta dal giocatore. Testo segnaposto.',
    cards: { 'fermo-li': 2, 'sorpasso': 3, 'cambio-rotta': 2, 'svuota-colore': 1 },
    ratingSum: 76, ratingCount: 18 },
  { id: 'caos-in-cabina', title: 'Caos in cabina', author: 'Strada matta',
    date: '2026-10-02', players: '4–6',
    description: 'Modalità di esempio pensata per gruppi numerosi. Testo segnaposto da sostituire con la descrizione inviata dal giocatore.',
    rules: '',
    cards: { 'silenzio-cabina': 1, 'mano-lesta': 2, 'affare-fatto': 2, 'ultimo-paga': 1, 're-bancale': 1 },
    ratingSum: 165, ratingCount: 41 },
  { id: 'consegna-veloce', title: 'Consegna veloce', author: 'Bancale49',
    date: '2026-09-21', players: '2–4',
    description: 'Modalità di esempio per partite brevi. Testo segnaposto da sostituire con la descrizione inviata dal giocatore.',
    rules: 'Regola aggiuntiva di esempio. Testo segnaposto.',
    cards: { 'consegna-express': 1, 'pieno-gasolio': 2, 'carico-pesante': 1 },
    ratingSum: 23, ratingCount: 5 },
  { id: 'tutto-in-una-notte', title: 'Tutto in una notte', author: 'Gattodimarmo',
    date: '2026-10-14', players: '3–5',
    description: 'Modalità di esempio appena pubblicata, ancora senza valutazioni. Testo segnaposto.',
    rules: '',
    cards: { 'fermo-li': 1, 'svuota-colore': 2, 'cambio-rotta': 1 },
    ratingSum: 0, ratingCount: 0 },
];

/*
 * FAQ segnaposto: domande e risposte NON ufficiali, da sostituire.
 * cardId (facoltativo) collega la risposta alla carta citata: la risposta compare anche nel dettaglio carta.
 * showInList: false la mostra solo sulla carta, non nella lista FAQ.
 */
window.MOVAT_FAQ_CATEGORIES = ['Preparazione', 'Regole generali', 'Carte Busa', 'Modalità di gioco'];
window.MOVAT_FAQ = [
  { id: 'prep-1', category: 'Preparazione', q: '[Segnaposto] Come si prepara il mazzo?',
    a: ['Risposta segnaposto: qui andrà la spiegazione ufficiale della preparazione.', 'Esempio: un secondo paragrafo breve con un caso concreto.'] },
  { id: 'prep-2', category: 'Preparazione', q: '[Segnaposto] Quante carte si distribuiscono?',
    a: ['Risposta segnaposto da sostituire con il testo ufficiale.'] },
  { id: 'reg-1', category: 'Regole generali', q: '[Segnaposto] Cosa succede se finisce il mazzo?',
    a: ['Risposta segnaposto da sostituire con il testo ufficiale.'] },
  { id: 'reg-2', category: 'Regole generali', q: '[Segnaposto] Si può giocare più di una carta per turno?',
    a: ['Risposta segnaposto da sostituire con il testo ufficiale.', 'Esempio: caso pratico segnaposto.'] },
  { id: 'busa-1', category: 'Carte Busa', q: '[Segnaposto] Come funziona la carta “Fermo lì!”?', cardId: 'fermo-li',
    a: ['Risposta segnaposto: qui andrà la spiegazione ufficiale dell’effetto della carta.', 'Esempio: un caso di gioco segnaposto in cui la carta viene giocata.'] },
  { id: 'busa-2', category: 'Carte Busa', q: '[Segnaposto] “Svuota colore” si può combinare con altre carte?', cardId: 'svuota-colore',
    a: ['Risposta segnaposto da sostituire con il testo ufficiale.'] },
  { id: 'busa-3', category: 'Carte Busa', q: '[Segnaposto] Domanda visibile solo sulla carta “Fermo lì!”', cardId: 'fermo-li', showInList: false,
    a: ['Esempio di FAQ collegata a una carta che non compare nella lista FAQ: si legge solo aprendo la carta.'] },
  { id: 'mod-1', category: 'Modalità di gioco', q: 'Come propongo una modalità?', action: { label: 'Vai a Crea', href: '#/crea' },
    a: ['Apri Crea, scegli le carte Busa e indica le quantità. Aggiungi nome e descrizione, controlla il riepilogo e invia.', 'La proposta sarà pubblicata in Scopri solo dopo il controllo del team Busa.'] },
  { id: 'mod-2', category: 'Modalità di gioco', q: 'Serve un account per votare una modalità?',
    a: ['No: puoi votare senza registrarti. Il voto resta salvato su questo dispositivo e puoi modificarlo quando vuoi.'] },
];

/*
 * Carte Busa inventate dai giocatori e pubblicate dal team Busa (Scopri → Carte).
 * Esempi segnaposto: il disegno viene generato dall'app sul template impostato nel CMS.
 */
window.MOVAT_USER_CARDS = [
  { id: 'gira-la-rotonda', title: 'Gira la rotonda', author: 'Ruota libera', date: '2026-10-12',
    dialect: 'Frase in dialetto di esempio', translation: 'Traduzione di esempio',
    text: 'Testo di esempio della carta: qui il giocatore spiega cosa succede quando la si gioca.', ratingSum: 17, ratingCount: 4 },
  { id: 'pausa-caffe', title: 'Pausa caffè', author: 'Bancale49', date: '2026-10-08',
    dialect: 'Altra frase di esempio', translation: 'Altra traduzione di esempio',
    text: 'Testo segnaposto di una seconda carta proposta da un giocatore.', ratingSum: 0, ratingCount: 0 },
];
// Impostazioni della creazione carte (con il server arrivano dal CMS).
window.MOVAT_CONFIG.cardMaker = { template: '', limits: { title: 22, dialect: 70, translation: 80, text: 200 }, layout: null };
