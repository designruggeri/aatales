#!/usr/bin/env bash
# Backup dei dati di MÖVAT! (contenuti, file caricati, credenziali e chiave segreta).
# Tiene gli ultimi 14 giorni in /var/backups/movat.
set -euo pipefail
DEST=/var/backups/movat
mkdir -p "$DEST"
chmod 700 "$DEST"
tar -czf "$DEST/movat-$(date +%Y-%m-%d).tar.gz" -C /var/lib movat
find "$DEST" -name 'movat-*.tar.gz' -mtime +14 -delete
