#!/bin/bash
# Release a new commit to the running EC2 instance without touching existing data.
# Run on the instance: sudo bash /opt/shopsmart/app/deploy/ec2/update.sh
set -euo pipefail
cd /opt/shopsmart/app
sudo -u shopsmart git pull --ff-only
sudo -u shopsmart npm ci --include=dev
sudo -u shopsmart npm run db:generate
set -a; . /etc/shopsmart/api.env; set +a
# migrate deploy applies committed migrations only. It never resets data. Never run db:seed here.
sudo -u shopsmart --preserve-env=DATABASE_URL,NODE_ENV npm run db:deploy
sudo -u shopsmart env VITE_API_URL=/api npm run build
rm -rf /var/www/shopsmart/* && cp -r frontend/dist/. /var/www/shopsmart/
systemctl restart shopsmart-api
sleep 2 && curl -s http://127.0.0.1:3000/api/health && echo
