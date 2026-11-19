#!/bin/bash
# ShopSmart single-EC2 bootstrap for Amazon Linux 2023.
# Packages come from Amazon's own repositories inside AWS (not Ubuntu's public mirrors, which returned
# 503 during the 19 Nov 2026 outage). Same layout as the Ubuntu version: Caddy (HTTPS) -> Express on
# 127.0.0.1:3000 -> PostgreSQL on localhost. No secrets in this script; the DB password is generated here.
set -euxo pipefail
exec > >(tee -a /var/log/shopsmart-setup.log) 2>&1

REPO_URL="https://github.com/JmAgustin01/ShopSmart-Starter.git"
BRANCH="aws-release"
APP_DIR=/opt/shopsmart/app
NODE_MAJOR=22
CADDY_VERSION=2.10.2

retry() { for n in 1 2 3 4 5; do "$@" && return 0; sleep 15; done; return 1; }

# Swap for npm install and the Vite build on a 1 GB t3.micro.
if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=2048; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

retry dnf install -y git tar xz postgresql16-server postgresql16 libcap

# Node.js 22 (official linux-x64 build)
NODE_FILE=$(retry curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-x64.tar.xz" | head -1)
retry curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${NODE_FILE}"
mkdir -p /usr/local/lib/nodejs && tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
NODE_DIR=/usr/local/lib/nodejs/${NODE_FILE%.tar.xz}
for b in node npm npx; do ln -sf "$NODE_DIR/bin/$b" /usr/local/bin/$b; done
node -v

# Caddy (official static binary) with its own service user
retry curl -fsSLo /tmp/caddy.tgz "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && chmod 755 /usr/local/bin/caddy
setcap cap_net_bind_service=+ep /usr/local/bin/caddy
id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell /sbin/nologin caddy
mkdir -p /etc/caddy /var/log/caddy && chown caddy:caddy /var/log/caddy
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

# PostgreSQL 16: localhost only; password login for the app user from 127.0.0.1
if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then postgresql-setup --initdb; fi
sed -i -E 's/^(host\s+all\s+all\s+(127\.0\.0\.1\/32|::1\/128)\s+)ident/\1scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf
systemctl enable --now postgresql

# Public hostname from the instance's public IP
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
SITE_HOST="${PUBLIC_IP//./-}.sslip.io"

# App user and code
id shopsmart >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/shopsmart --shell /sbin/nologin shopsmart
if [ ! -d "$APP_DIR/.git" ]; then retry sudo -u shopsmart git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"; fi

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
AI_PROVIDER=off
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
AI_TIMEOUT_MS=8000
ENV
fi
chown root:shopsmart /etc/shopsmart/api.env
chmod 640 /etc/shopsmart/api.env

cd "$APP_DIR"
export PATH=/usr/local/bin:$PATH
retry sudo -u shopsmart env PATH="$PATH" npm ci --include=dev
sudo -u shopsmart env PATH="$PATH" npm run db:generate
set -a; . /etc/shopsmart/api.env; set +a
sudo -u shopsmart env PATH="$PATH" DATABASE_URL="$DATABASE_URL" NODE_ENV="$NODE_ENV" npm run db:deploy
if [ "$(sudo -u postgres psql -tAc 'SELECT count(*) FROM "Product"' shopsmart)" = "0" ]; then
  sudo -u shopsmart env PATH="$PATH" DATABASE_URL="$DATABASE_URL" NODE_ENV="$NODE_ENV" npm run db:seed
fi
sudo -u shopsmart env PATH="$PATH" VITE_API_URL=/api npm run build
mkdir -p /var/www/shopsmart && rm -rf /var/www/shopsmart/* && cp -r frontend/dist/. /var/www/shopsmart/

# Same service and Caddy config as the Ubuntu version; node lives in /usr/local/bin here.
sed 's#/usr/bin/node#/usr/local/bin/node#' deploy/ec2/shopsmart-api.service > /etc/systemd/system/shopsmart-api.service
sed "s/__SITE_HOST__/${SITE_HOST}/" deploy/ec2/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now shopsmart-api
systemctl enable --now caddy

echo "ShopSmart ready at https://${SITE_HOST}" | tee /etc/shopsmart/site-url.txt
