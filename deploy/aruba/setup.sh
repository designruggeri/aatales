#!/usr/bin/env bash
# MÖVAT! — installazione su un VPS Ubuntu 24.04 (Aruba Cloud).
#
# Uso (sul server, come root, dopo aver estratto il progetto in /opt/movat):
#   bash /opt/movat/deploy/aruba/setup.sh movat.busalogistica.it
#
# Cosa fa (si può rilanciare senza problemi):
#   - aggiornamenti del sistema e aggiornamenti di sicurezza automatici, fuso orario Europe/Rome
#   - firewall: aperte solo SSH (22), HTTP (80) e HTTPS (443)
#   - 1 GB di memoria di scambio (swap), utile sui server piccoli
#   - Node.js 22 LTS, utente di sistema "movat", dati in /var/lib/movat
#   - servizio di avvio automatico "movat" (riparte da solo dopo errori e riavvii)
#   - Caddy davanti all'app: HTTPS automatico e gratuito con Let's Encrypt
#   - backup giornaliero dei dati in /var/backups/movat (ultimi 14 giorni)
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then echo "Uso: bash setup.sh movat.busalogistica.it"; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Esegui lo script come root (oppure con sudo)."; exit 1; fi
APP_DIR=/opt/movat
DATA_DIR=/var/lib/movat
ENV_FILE=/etc/movat/movat.env
HERE="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$APP_DIR/server/server.js" ]] || { echo "Non trovo $APP_DIR/server/server.js: estrai prima il progetto in $APP_DIR."; exit 1; }

step() { echo; echo "==> $*"; }

step "Aggiornamento del sistema"
export DEBIAN_FRONTEND=noninteractive
# Tiene sempre i file di configurazione già presenti (es. /etc/cloud/cloud.cfg personalizzato da Aruba)
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
apt-get update -y
apt-get "${APT_OPTS[@]}" upgrade
apt-get "${APT_OPTS[@]}" install curl ca-certificates gnupg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https
timedatectl set-timezone Europe/Rome || true
dpkg-reconfigure -f noninteractive unattended-upgrades || true

step "Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

step "Memoria di scambio (swap) da 1 GB"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Node.js 22 LTS"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get "${APT_OPTS[@]}" install nodejs
fi
node -v

step "Utente, cartelle e dipendenze"
id -u movat >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin movat
mkdir -p "$DATA_DIR" /etc/movat /var/backups/movat
chown -R movat:movat "$DATA_DIR"
chmod 750 "$DATA_DIR"
chown -R root:root "$APP_DIR"
# Pacchetto facoltativo per le email (nodemailer)
(cd "$APP_DIR/server" && npm install --omit=dev --no-audit --no-fund)

step "Impostazioni dell'app ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  sed "s#__DOMAIN__#$DOMAIN#g" "$HERE/movat.env.example" > "$ENV_FILE"
  echo "Creato $ENV_FILE: completalo con le chiavi Turnstile e i dati SMTP (vedi la guida)."
else
  echo "$ENV_FILE esiste già: lo lascio com'è."
fi
chown root:movat "$ENV_FILE"
chmod 640 "$ENV_FILE"

step "Servizio di avvio automatico"
install -m 644 "$HERE/movat.service" /etc/systemd/system/movat.service
systemctl daemon-reload
systemctl enable movat
systemctl restart movat

step "Caddy (HTTPS automatico)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get "${APT_OPTS[@]}" install caddy
fi
sed "s#__DOMAIN__#$DOMAIN#g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

step "Backup giornaliero"
install -m 755 "$HERE/backup.sh" /usr/local/bin/movat-backup
cat > /etc/cron.d/movat-backup <<'CRON'
# Backup dei dati di MÖVAT! ogni notte alle 3:30
30 3 * * * root /usr/local/bin/movat-backup >/dev/null 2>&1
CRON

step "Fatto!"
sleep 2
systemctl --no-pager --lines=0 status movat || true
echo
echo "Credenziali del CMS (solo al primo avvio):"
journalctl -u movat --no-pager | grep -A3 "ACCESSO AL CMS" | tail -4 || true
echo
echo "Prossimi passi: completa $ENV_FILE (Turnstile, SMTP), poi: systemctl restart movat"
echo "App: https://$DOMAIN/   CMS: https://$DOMAIN/admin/"
