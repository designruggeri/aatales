# MÖVAT! online su movat.busalogistica.it (Aruba Cloud VPS)

Server: **VPS O1I1, Ubuntu 24.04** · IPv4 **195.231.79.139** · IPv6 2a00:6d42:1242:1c03::153

Tempo stimato: 30–45 minuti. Tutti i comandi si copiano e incollano nel **Terminale** del Mac.
Dove c'è scritto *sul server*, prima ti colleghi con `ssh movat` (vedi il passo 1).

---

## 1. Collegamento SSH dal Mac

Se non l'hai già fatto, apri il file di configurazione:

```
nano ~/.ssh/config
```

e incolla:

```
Host movat
  HostName 195.231.79.139
  User root
  IdentityFile ~/.ssh/movat_aruba
```

Salva con **Ctrl + O**, **Invio**, esci con **Ctrl + X**. Prova:

```
ssh movat
```

La prima volta chiede se fidarsi del server: scrivi `yes`. Se entri vedrai `root@movat:~#`. Per uscire: `exit`.
(Se Aruba ti ha indicato un utente diverso da `root`, usa quello e anteponi `sudo` ai comandi *sul server*.)

## 2. DNS del sottodominio

Nel pannello Aruba di **busalogistica.it** → *Gestione DNS* (o *Pannello DNS*) → aggiungi un record:

| Tipo | Nome | Valore |
|---|---|---|
| **A** | `movat` | `195.231.79.139` |

Il sito WordPress non viene toccato. Il record diventa attivo di solito in pochi minuti (a volte fino a qualche ora). Controlla dal Mac:

```
nslookup movat.busalogistica.it
```

Deve comparire `195.231.79.139`. **Aspetta che compaia prima del passo 4**: serve per ottenere il certificato HTTPS.

> L'IPv6 (record **AAAA**) aggiungilo solo più avanti, dopo aver verificato che funzioni (passo 10).

## 3. Pacchetto dell'app (sul Mac)

Entra nella cartella del progetto aggiornata (quella con le cartelle `app`, `admin`, `server`):

```
cd percorso/della/cartella/aatales
```

Crea il pacchetto (senza dati locali, cronologia e file di lavoro) e caricalo sul server:

```
COPYFILE_DISABLE=1 tar --exclude='./data' --exclude='./.git' --exclude='./stitch' --exclude='node_modules' -czf ~/Desktop/movat.tar.gz .
scp ~/Desktop/movat.tar.gz movat:/tmp/movat.tar.gz
```

## 4. Installazione (sul server)

```
ssh movat
mkdir -p /opt/movat && tar -xzf /tmp/movat.tar.gz -C /opt/movat
bash /opt/movat/deploy/aruba/setup.sh movat.busalogistica.it
```

Lo script installa tutto (aggiornamenti, firewall, Node.js, servizio di avvio automatico, HTTPS con Caddy, backup notturni). Alla fine mostra **utente e password del CMS**: **annotali**. Se li perdi:

```
journalctl -u movat --no-pager | grep -A3 "ACCESSO AL CMS"
```

Apri **https://movat.busalogistica.it**: l'app dovrebbe già comparire con il lucchetto HTTPS.
Voti, proposte e messaggi però vengono rifiutati finché non completi il passo 5 (è voluto: in produzione l'antibot è obbligatorio).

## 5. Antibot Cloudflare Turnstile (obbligatorio)

1. Crea un account gratuito su https://dash.cloudflare.com (non serve spostare il dominio su Cloudflare).
2. Menu **Turnstile** → **Add widget**: nome `MÖVAT!`, hostname **`movat.busalogistica.it`**, modalità **Managed** → crea.
3. Copia **Site Key** e **Secret Key**. Sul server:

```
nano /etc/movat/movat.env
```

compila `TURNSTILE_SITE_KEY=` e `TURNSTILE_SECRET_KEY=`, salva (**Ctrl + O**, **Invio**, **Ctrl + X**) e riavvia:

```
systemctl restart movat
```

Nel CMS, *Testi e impostazioni → Protezioni e classifica* deve indicare **Antibot: attivo**.

## 6. Email (facoltative ma consigliate)

Servono per le email di conferma e le notifiche agli autori, e per avvisare il team di nuove proposte e messaggi.

1. Nel pannello Aruba crea una casella, ad esempio **movat@busalogistica.it**.
2. Sul server, in `/etc/movat/movat.env`, togli il `#` davanti alle righe `SMTP_…` e inserisci indirizzo e password della casella:

```
SMTP_HOST=smtps.aruba.it
SMTP_PORT=465
SMTP_USER=movat@busalogistica.it
SMTP_PASS=la-password-della-casella
SMTP_FROM="MÖVAT! <movat@busalogistica.it>"
```

3. `systemctl restart movat`, poi nel CMS imposta in *Testi e impostazioni* le email del team per le notifiche.

## 7. Portare online i contenuti già caricati in locale (se ne hai)

Se sul Mac hai già lavorato nel CMS (carte, immagini, audio, FAQ), copia l'intera cartella `data`, che contiene anche i file caricati. Sul Mac, nella cartella del progetto:

```
COPYFILE_DISABLE=1 tar -czf ~/Desktop/movat-data.tar.gz data
scp ~/Desktop/movat-data.tar.gz movat:/tmp/
```

Sul server:

```
systemctl stop movat
tar -xzf /tmp/movat-data.tar.gz -C /tmp
cp -a /tmp/data/. /var/lib/movat/
chown -R movat:movat /var/lib/movat
systemctl start movat
```

Le credenziali del CMS diventano quelle che usavi in locale.

## 8. Ultimi ritocchi

- **Informativa privacy** (CMS → *Testi e impostazioni*): fornitore di hosting **Aruba S.p.A., server in Italia**; fornitore email **Aruba S.p.A.**
- **Sito WordPress**: una voce di menu o un pulsante “MÖVAT!” verso `https://movat.busalogistica.it`.
- **QR code**: `https://movat.busalogistica.it`. Provalo con il telefono prima di stamparlo.

## 9. Aggiornare a una nuova versione

Sul Mac, nella cartella del progetto aggiornata, ripeti il passo 3 (pacchetto + `scp`). Poi sul server:

```
bash /opt/movat/deploy/aruba/update.sh
```

Lo script fa un backup, installa la nuova versione e riavvia l'app. Se qualcosa non va, torna da solo alla versione precedente. Dati e impostazioni non vengono toccati.

## 10. Comandi utili (sul server)

| Cosa | Comando |
|---|---|
| Stato dell'app | `systemctl status movat` |
| Ultimi messaggi dell'app | `journalctl -u movat -n 50 --no-pager` |
| Riavviare l'app | `systemctl restart movat` |
| Stato di HTTPS (Caddy) | `systemctl status caddy` |
| Fare subito un backup | `movat-backup` |
| Elenco dei backup | `ls -lh /var/backups/movat` |

**Scaricare un backup sul Mac** (consigliato una volta al mese, oltre al backup dal CMS):

```
scp movat:/var/backups/movat/movat-2026-10-21.tar.gz ~/Desktop/
```

(cambia la data con quella del backup che vuoi.) I backup contengono anche `secret.key` e le credenziali: conservali in un posto sicuro.

**IPv6 (facoltativo)**: sul server prova `curl -6 -sI https://www.google.com | head -1`. Se risponde `HTTP/2 200`, aggiungi nel DNS il record **AAAA** `movat` → `2a00:6d42:1242:1c03::153`.

**Più sicurezza SSH (facoltativo)**: se l'accesso con la chiave funziona, puoi disattivare l'accesso con password:

```
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
```

Prima di farlo verifica di poter entrare con `ssh movat` da un'altra finestra del Terminale.
