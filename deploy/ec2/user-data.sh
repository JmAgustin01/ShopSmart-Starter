#!/bin/bash
# ShopSmart single-EC2 bootstrap (Ubuntu 24.04 LTS). Paste into EC2 "Advanced details > User data".
# Installs Node 22, PostgreSQL 16 (local only), Caddy (automatic HTTPS), builds ShopSmart and runs it
# with systemd. NO secrets are written in this script: user data is visible to anyone who can view
# the instance in the AWS console. The database password is generated on the instance itself.
set -euxo pipefail
exec > >(tee -a /var/log/shopsmart-setup.log) 2>&1

REPO_URL="https://github.com/JmAgustin01/ShopSmart-Starter.git"
BRANCH="aws-release"
APP_DIR=/opt/shopsmart/app

export DEBIAN_FRONTEND=noninteractive

# 1 GB t3.micro needs swap for npm install and the Vite build.
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https postgresql
# Node.js 22 (Ubuntu's own package is too old for Vite 7 / Prisma 6)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Caddy (official repository)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Public hostname: <public-ip-with-dashes>.sslip.io resolves to this instance, so Caddy can get a certificate.
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
SITE_HOST="${PUBLIC_IP//./-}.sslip.io"

# App user and code
id shopsmart >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/shopsmart --shell /usr/sbin/nologin shopsmart
if [ ! -d "$APP_DIR/.git" ]; then sudo -u shopsmart git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"; fi

# PostgreSQL: listens on localhost only (Ubuntu default). Port 5432 is not opened in the security group.
mkdir -p /etc/shopsmart
if [ ! -f /etc/shopsmart/api.env ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER shopsmart_app WITH PASSWORD '$DB_PASSWORD';"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE shopsmart OWNER shopsmart_app;"
  cat > /etc/shopsmart/api.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://shopsmart_app:${DB_PASSWORD}@127.0.0.1:5432/shopsmart?schema=public
FRONTEND_URL=https://${SITE_HOST}
TRUST_PROXY=1
# AI is off by default: answers come straight from the catalog and are labelled as such.
# To use Gemini: set AI_PROVIDER=gemini and GEMINI_API_KEY=... here (never in the repo), then restart.
AI_PROVIDER=off
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
AI_TIMEOUT_MS=8000
ENV
fi
chown root:shopsmart /etc/shopsmart/api.env
chmod 640 /etc/shopsmart/api.env

# Build and migrate (see deploy/ec2/update.sh for later releases)
cd "$APP_DIR"
sudo -u shopsmart npm ci --include=dev
sudo -u shopsmart npm run db:generate
set -a; . /etc/shopsmart/api.env; set +a
sudo -u shopsmart --preserve-env=DATABASE_URL,NODE_ENV npm run db:deploy
# Sample products only on a brand-new, empty database. The seed refuses when orders exist.
if [ "$(sudo -u postgres psql -tAc 'SELECT count(*) FROM "Product"' shopsmart)" = "0" ]; then
  sudo -u shopsmart --preserve-env=DATABASE_URL,NODE_ENV npm run db:seed
fi
# Same-origin build: the browser calls https://<host>/api, which Caddy forwards to Express.
sudo -u shopsmart env VITE_API_URL=/api npm run build
mkdir -p /var/www/shopsmart
rsync -a --delete frontend/dist/ /var/www/shopsmart/ 2>/dev/null || { rm -rf /var/www/shopsmart/*; cp -r frontend/dist/. /var/www/shopsmart/; }

# systemd keeps the API running and starts it after a reboot. Logs: journalctl -u shopsmart-api
cp deploy/ec2/shopsmart-api.service /etc/systemd/system/shopsmart-api.service
sed "s/__SITE_HOST__/${SITE_HOST}/" deploy/ec2/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now shopsmart-api
systemctl restart caddy

echo "ShopSmart ready at https://${SITE_HOST}" | tee /etc/shopsmart/site-url.txt
