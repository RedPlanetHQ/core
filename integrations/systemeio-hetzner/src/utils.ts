import axios from 'axios';
import { randomBytes } from 'crypto';

// ============================================================================
// SYSTEME.IO API CLIENT
// Docs: https://developer.systeme.io/reference
// ============================================================================

const SYSTEME_API_BASE = 'https://api.systeme.io/api';

export async function systemeRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  apiKey: string,
  data?: any,
) {
  const response = await axios({
    method,
    url: `${SYSTEME_API_BASE}${endpoint}`,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    data,
  });
  return response.data;
}

// --- Contacts (Leads/Kunden) ---

export async function getContacts(apiKey: string, page = 1, limit = 20) {
  return systemeRequest('GET', `/contacts?page=${page}&limit=${limit}`, apiKey);
}

export async function createContact(apiKey: string, contact: {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: { name: string }[];
  fields?: { slug: string; value: string }[];
}) {
  return systemeRequest('POST', '/contacts', apiKey, contact);
}

export async function getContact(apiKey: string, contactId: string) {
  return systemeRequest('GET', `/contacts/${contactId}`, apiKey);
}

export async function updateContact(apiKey: string, contactId: string, data: any) {
  return systemeRequest('PATCH', `/contacts/${contactId}`, apiKey, data);
}

export async function addTagToContact(apiKey: string, contactId: string, tagName: string) {
  return systemeRequest('POST', `/contacts/${contactId}/tags`, apiKey, { name: tagName });
}

// --- Tags ---

export async function getTags(apiKey: string) {
  return systemeRequest('GET', '/tags', apiKey);
}

// --- Sales / Orders ---

export async function getSales(apiKey: string, page = 1) {
  return systemeRequest('GET', `/sales?page=${page}`, apiKey);
}

// --- Funnels ---

export async function getFunnels(apiKey: string, page = 1) {
  return systemeRequest('GET', `/funnels?page=${page}`, apiKey);
}

// --- Courses ---

export async function getCourses(apiKey: string, page = 1) {
  return systemeRequest('GET', `/courses?page=${page}`, apiKey);
}

export async function grantCourseAccess(apiKey: string, courseId: string, studentEmail: string) {
  return systemeRequest('POST', `/courses/${courseId}/students`, apiKey, {
    email: studentEmail,
  });
}

// ============================================================================
// HETZNER CLOUD API CLIENT
// Docs: https://docs.hetzner.cloud/
// ============================================================================

const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1';

export async function hetznerRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  apiToken: string,
  data?: any,
) {
  const response = await axios({
    method,
    url: `${HETZNER_API_BASE}${endpoint}`,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    data,
  });
  return response.data;
}

// --- Servers ---

export async function listServers(apiToken: string) {
  return hetznerRequest('GET', '/servers', apiToken);
}

export async function createServer(apiToken: string, config: {
  name: string;
  server_type: string;
  image: string;
  location: string;
  ssh_keys?: string[];
  user_data?: string;
  labels?: Record<string, string>;
}) {
  return hetznerRequest('POST', '/servers', apiToken, config);
}

export async function getServer(apiToken: string, serverId: string) {
  return hetznerRequest('GET', `/servers/${serverId}`, apiToken);
}

export async function deleteServer(apiToken: string, serverId: string) {
  return hetznerRequest('DELETE', `/servers/${serverId}`, apiToken);
}

export async function rebuildServer(apiToken: string, serverId: string, image: string) {
  return hetznerRequest('POST', `/servers/${serverId}/actions/rebuild`, apiToken, { image });
}

// --- SSH Keys ---

export async function listSSHKeys(apiToken: string) {
  return hetznerRequest('GET', '/ssh_keys', apiToken);
}

export async function createSSHKey(apiToken: string, name: string, publicKey: string) {
  return hetznerRequest('POST', '/ssh_keys', apiToken, {
    name,
    public_key: publicKey,
  });
}

// --- Server Types ---

export async function listServerTypes(apiToken: string) {
  return hetznerRequest('GET', '/server_types', apiToken);
}

// --- Images ---

export async function listImages(apiToken: string) {
  return hetznerRequest('GET', '/images?type=system', apiToken);
}

// ============================================================================
// AUTO-PROVISIONING - KI Server Setup Script
// This cloud-init script auto-installs the full KI stack on a new Hetzner server
// ============================================================================

export function generateCloudInitScript(params: {
  customerEmail: string;
  customerId: string;
  domainName?: string;
  adminPassword: string;
}) {
  return `#!/bin/bash
set -euo pipefail

# ============================================================
# KI-POWER SERVER - Automated Setup
# Customer: ${params.customerEmail}
# Customer ID: ${params.customerId}
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================

export DEBIAN_FRONTEND=noninteractive
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || hostname -I | awk '{print $1}')
PROVISION_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# System Update
apt-get update && apt-get upgrade -y

# Install Base Dependencies
apt-get install -y \\
  curl wget git unzip software-properties-common \\
  apt-transport-https ca-certificates gnupg lsb-release \\
  nginx certbot python3-certbot-nginx \\
  ufw fail2ban

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Firewall Setup
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

# Fail2Ban Setup
systemctl enable fail2ban && systemctl start fail2ban

# Create app directory
mkdir -p /opt/ki-power
cd /opt/ki-power

# Create Docker Compose Stack
cat > docker-compose.yml << 'DOCKER_EOF'
version: '3.8'

services:
  # Open WebUI - ChatGPT-like interface for local AI
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: always
    ports:
      - "3000:8080"
    environment:
      - WEBUI_AUTH=true
      - WEBUI_NAME=KI-Power System
      - ENABLE_SIGNUP=false
    volumes:
      - open-webui-data:/app/backend/data

  # n8n - Workflow Automation (like Zapier but self-hosted)
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    restart: always
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=${params.adminPassword}
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - GENERIC_TIMEZONE=Europe/Berlin
    volumes:
      - n8n-data:/home/node/.n8n

  # Postgres - Database
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    restart: always
    environment:
      - POSTGRES_USER=kipower
      - POSTGRES_PASSWORD=${params.adminPassword}
      - POSTGRES_DB=kipower
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"

  # Redis - Cache & Queue
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: always
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:6379:6379"

volumes:
  open-webui-data:
  n8n-data:
  postgres-data:
  redis-data:
DOCKER_EOF

# Start all services
docker-compose up -d

# Create customer info file
cat > /opt/ki-power/customer-info.json << INFO_EOF
{
  "customerId": "${params.customerId}",
  "customerEmail": "${params.customerEmail}",
  "provisionedAt": "\$PROVISION_DATE",
  "services": {
    "openWebUI": "http://\$SERVER_IP:3000",
    "n8n": "http://\$SERVER_IP:5678",
    "adminUser": "admin",
    "adminPassword": "${params.adminPassword}"
  },
  "plan": "ki-power-99",
  "monthlyPrice": 99
}
INFO_EOF

# Setup Nginx Reverse Proxy
cat > /etc/nginx/sites-available/ki-power << 'NGINX_EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /n8n/ {
        proxy_pass http://localhost:5678/;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/ki-power /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Setup auto-updates
cat > /etc/cron.d/ki-power-updates << 'CRON_EOF'
# Auto-update containers weekly (Sunday 3am)
0 3 * * 0 root cd /opt/ki-power && docker-compose pull && docker-compose up -d
CRON_EOF

echo "KI-Power Server setup complete!"
echo "Open WebUI: http://\$SERVER_IP:3000"
echo "n8n: http://\$SERVER_IP:5678"
`;
}

// ============================================================================
// CUSTOMER PROVISIONING PIPELINE
// End-to-end: Systeme.io sale → Hetzner server → Customer access
// ============================================================================

export async function provisionCustomerServer(params: {
  systemeApiKey: string;
  hetznerApiToken: string;
  customerEmail: string;
  customerId: string;
  customerName: string;
  serverType?: string;
  location?: string;
}) {
  const adminPassword = generateSecurePassword();
  const serverName = `ki-power-${params.customerId.slice(0, 8)}`;

  // 1. Create Hetzner server with cloud-init
  const cloudInit = generateCloudInitScript({
    customerEmail: params.customerEmail,
    customerId: params.customerId,
    adminPassword,
  });

  const server = await createServer(params.hetznerApiToken, {
    name: serverName,
    server_type: params.serverType || 'cpx31', // 4 vCPU, 8GB RAM - good for KI
    image: 'ubuntu-24.04',
    location: params.location || 'nbg1', // Nuremberg, Germany
    user_data: cloudInit,
    labels: {
      customer_id: params.customerId,
      customer_email: params.customerEmail,
      plan: 'ki-power-99',
      managed_by: 'ki-fastfood-system',
    },
  });

  const serverIp = server.server?.public_net?.ipv4?.ip || 'pending';

  // 2. Tag customer in Systeme.io
  try {
    await addTagToContact(params.systemeApiKey, params.customerId, 'ki-power-active');
    await addTagToContact(params.systemeApiKey, params.customerId, 'server-provisioned');
  } catch {
    // Contact may not exist yet in systeme.io
  }

  return {
    serverId: server.server?.id,
    serverName,
    serverIp,
    adminPassword,
    status: 'provisioning',
    estimatedReadyIn: '3-5 minutes',
    accessUrls: {
      openWebUI: `http://${serverIp}:3000`,
      n8n: `http://${serverIp}:5678`,
    },
    credentials: {
      user: 'admin',
      password: adminPassword,
    },
  };
}

function generateSecurePassword(): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(24);
  let password = '';
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(bytes[i] % chars.length);
  }
  return password;
}
