#!/usr/bin/env bash
# MÖVAT! — aggiornamento a una nuova versione (sul server, come root).
#
# Uso: carica il nuovo pacchetto in /tmp/movat.tar.gz (vedi la guida), poi:
#   bash /opt/movat/deploy/aruba/update.sh
#
# I dati (/var/lib/movat) e le impostazioni (/etc/movat/movat.env) non vengono toccati.
set -euo pipefail
PKG=${1:-/tmp/movat.tar.gz}
[[ $EUID -eq 0 ]] || { echo "Esegui come root."; exit 1; }
[[ -f "$PKG" ]] || { echo "Non trovo $PKG"; exit 1; }

echo "==> Backup dei dati prima dell'aggiornamento"
/usr/local/bin/movat-backup || true

echo "==> Nuova versione in /opt/movat"
NEW=$(mktemp -d)
tar -xzf "$PKG" -C "$NEW"
[[ -f "$NEW/server/server.js" ]] || { echo "Il pacchetto non contiene server/server.js"; rm -rf "$NEW"; exit 1; }
rm -rf /opt/movat.prev
mv /opt/movat /opt/movat.prev
mv "$NEW" /opt/movat
chown -R root:root /opt/movat
chmod 755 /opt/movat
(cd /opt/movat/server && npm install --omit=dev --no-audit --no-fund)
install -m 644 /opt/movat/deploy/aruba/movat.service /etc/systemd/system/movat.service
install -m 755 /opt/movat/deploy/aruba/backup.sh /usr/local/bin/movat-backup
systemctl daemon-reload

echo "==> Riavvio"
systemctl restart movat
sleep 2
if systemctl is-active --quiet movat; then
  echo "Aggiornamento riuscito. La versione precedente resta in /opt/movat.prev."
else
  echo "Il servizio non si avvia: ripristino la versione precedente."
  rm -rf /opt/movat && mv /opt/movat.prev /opt/movat && systemctl restart movat
  journalctl -u movat --no-pager -n 30
  exit 1
fi
