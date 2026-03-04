#!/bin/bash
# ================================================================
#  MAC SSH SETUP - Erlaubt dem Hetzner Server SSH-Zugriff auf den Mac
#
#  Ausfuehren auf dem MAC:
#    bash scripts/setup-mac-ssh.sh
#
#  Was es macht:
#    1. Remote Login (SSH) aktivieren
#    2. Firewall SSH durchlassen
#    3. SSH-Key vom Server autorisieren
#    4. Tailscale installieren (optional)
# ================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

HETZNER_IP="65.21.203.174"

echo "================================================================"
echo "  MAC SSH SETUP"
echo "================================================================"
echo ""

# Check we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}Dieses Script ist nur fuer macOS!${NC}"
  exit 1
fi

MAC_USER=$(whoami)
echo "Mac User: $MAC_USER"
echo "Hetzner Server: $HETZNER_IP"
echo ""

# 1. Enable Remote Login
echo -e "${YELLOW}[1/5] Remote Login aktivieren...${NC}"
sudo systemsetup -setremotelogin on 2>/dev/null || {
  echo "Bitte manuell aktivieren:"
  echo "  Systemeinstellungen > Allgemein > Sharing > Entfernte Anmeldung"
}
echo -e "${GREEN}Remote Login aktiv${NC}"

# 2. Firewall - allow SSH
echo -e "${YELLOW}[2/5] Firewall konfigurieren...${NC}"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/bin/sshd 2>/dev/null || true
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /usr/bin/sshd 2>/dev/null || true
echo -e "${GREEN}SSH in Firewall erlaubt${NC}"

# 3. Create SSH directory if needed
echo -e "${YELLOW}[3/5] SSH-Verzeichnis vorbereiten...${NC}"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo -e "${GREEN}SSH-Verzeichnis bereit${NC}"

# 4. Generate key pair on this Mac (for the server to use)
echo -e "${YELLOW}[4/5] SSH-Key Setup...${NC}"
echo ""
echo "Jetzt musst du den SSH-Key vom Hetzner Server hinzufuegen."
echo ""
echo "Option A - Automatisch (wenn du Passwort-Zugriff auf den Server hast):"
echo "  Auf dem SERVER ausfuehren:"
echo "  ssh-keygen -t ed25519 -f /root/.ssh/mac_id_ed25519 -N '' -q"
echo "  ssh-copy-id -i /root/.ssh/mac_id_ed25519.pub ${MAC_USER}@<deine-mac-ip>"
echo ""
echo "Option B - Manuell:"
echo "  1. Auf dem SERVER: cat /root/.ssh/mac_id_ed25519.pub"
echo "  2. Kopiere die Ausgabe"
echo "  3. Fuege sie hier auf dem Mac ein:"
echo "     echo 'PASTE_KEY_HERE' >> ~/.ssh/authorized_keys"
echo ""
echo "Option C - Key jetzt generieren lassen (Server muss den Public Key bekommen):"
read -p "Soll ich einen Key auf dem Server generieren lassen? [y/N]: " GEN_KEY

if [[ "$GEN_KEY" =~ ^[yY]$ ]]; then
  echo ""
  echo "Verbinde mit Server um Key zu generieren..."
  ssh root@${HETZNER_IP} "
    if [ ! -f /root/.ssh/mac_id_ed25519 ]; then
      ssh-keygen -t ed25519 -f /root/.ssh/mac_id_ed25519 -N '' -q
      echo 'Key generiert!'
    else
      echo 'Key existiert bereits.'
    fi
    cat /root/.ssh/mac_id_ed25519.pub
  " 2>/dev/null | tee /tmp/server_pubkey.txt

  if [ -s /tmp/server_pubkey.txt ]; then
    # Add the public key to authorized_keys
    PUBKEY=$(grep "ssh-ed25519" /tmp/server_pubkey.txt)
    if [ -n "$PUBKEY" ]; then
      if ! grep -q "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
        echo "$PUBKEY" >> ~/.ssh/authorized_keys
        echo -e "${GREEN}Server-Key zum Mac hinzugefuegt!${NC}"
      else
        echo -e "${GREEN}Server-Key bereits vorhanden.${NC}"
      fi
    fi
    rm -f /tmp/server_pubkey.txt
  else
    echo -e "${YELLOW}Konnte nicht mit Server verbinden. Mache es manuell.${NC}"
  fi
fi

echo -e "${GREEN}SSH-Key Setup abgeschlossen${NC}"

# 5. Tailscale
echo -e "${YELLOW}[5/5] Tailscale pruefen...${NC}"
if command -v tailscale &>/dev/null; then
  TS_IP=$(tailscale ip -4 2>/dev/null || echo "nicht verbunden")
  echo -e "${GREEN}Tailscale installiert. IP: ${TS_IP}${NC}"
else
  echo "Tailscale ist nicht installiert."
  read -p "Tailscale jetzt installieren? (empfohlen fuer Fernzugriff) [y/N]: " INSTALL_TS
  if [[ "$INSTALL_TS" =~ ^[yY]$ ]]; then
    if command -v brew &>/dev/null; then
      brew install --cask tailscale
      echo -e "${GREEN}Tailscale installiert! Oeffne die App und logge dich ein.${NC}"
    else
      echo "Brew nicht gefunden. Installiere Tailscale manuell von https://tailscale.com/download"
    fi
  fi
fi

echo ""
echo "================================================================"
echo "  MAC SSH SETUP FERTIG!"
echo "================================================================"
echo ""

# Show connection info
echo "Deine Mac IPs:"
ifconfig | grep "inet " | grep -v 127.0.0.1
if command -v tailscale &>/dev/null; then
  echo "Tailscale: $(tailscale ip -4 2>/dev/null || echo 'nicht verbunden')"
fi

echo ""
echo "Auf dem Hetzner Server in .env eintragen:"
echo "  MAC_SSH_HOST=<ip-von-oben>"
echo "  MAC_SSH_USER=${MAC_USER}"
echo "  MAC_SSH_PORT=22"
echo "  MAC_SSH_KEY=/root/.ssh/mac_id_ed25519"
echo ""
echo "Dann im Telegram Bot:"
echo "  /mac status   - Testen ob es klappt"
echo "  /mac info     - Mac-Info abrufen"
echo "  /mac ls       - Dateien auflisten"
echo ""
