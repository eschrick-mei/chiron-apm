#!/bin/bash
# ============================================================================
# Chiron APM — EC2 Deployment Script (Amazon Linux 2023)
#
# Provisions an Amazon Linux 2023 EC2 instance with:
#   - PostgreSQL 15 (local mirror database)
#   - Redis 7 (API cache)
#   - Python 3.11 (backend + sync worker)
#   - Node.js 20 (frontend build)
#   - Nginx (reverse proxy + SSL)
#   - systemd services for all components
#
# Usage:
#   1. Launch Amazon Linux 2023 EC2 (t3.medium, 30GB EBS)
#   2. SSH in and clone the repo
#   3. Run: sudo bash deploy/setup_ec2.sh
#   4. Configure: nano /opt/chiron/.env
#   5. Start: sudo systemctl start chiron-sync chiron-api chiron-frontend
# ============================================================================

set -euo pipefail

APP_DIR="/opt/chiron"
APP_USER="chiron"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=============================="
echo "Chiron APM — EC2 Setup"
echo "=============================="

# ---------- System packages ----------
echo "[1/8] Installing system packages..."
dnf update -y -q
dnf install -y -q \
    python3.11 python3.11-pip python3.11-devel \
    nginx \
    gcc make libpq-devel \
    curl git tar

# Install PostgreSQL 15
dnf install -y -q postgresql15-server postgresql15
postgresql-setup --initdb 2>/dev/null || true

# Install Redis
dnf install -y -q redis6

# Install Node.js 20
if ! command -v node &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y -q nodejs
fi

# ---------- Create app user ----------
echo "[2/8] Creating app user..."
id -u "$APP_USER" &>/dev/null || useradd -m -s /bin/bash "$APP_USER"

# ---------- PostgreSQL ----------
echo "[3/8] Configuring PostgreSQL..."
# Fix pg_hba.conf to allow local password auth
PG_HBA=$(find /var/lib/pgsql -name pg_hba.conf 2>/dev/null | head -1)
if [ -n "$PG_HBA" ]; then
    # Replace ident with md5 for local connections
    sed -i 's/ident$/md5/g' "$PG_HBA"
    sed -i 's/peer$/md5/g' "$PG_HBA"
fi
systemctl enable --now postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='chiron'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER chiron WITH PASSWORD 'chiron';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='chiron_apm'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE chiron_apm OWNER chiron;"

# ---------- Redis ----------
echo "[4/8] Configuring Redis..."
REDIS_CONF=$(find /etc -name "redis*.conf" 2>/dev/null | head -1)
if [ -n "$REDIS_CONF" ]; then
    sed -i 's/^# maxmemory .*/maxmemory 256mb/' "$REDIS_CONF"
    sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' "$REDIS_CONF"
fi
systemctl enable --now redis6 2>/dev/null || systemctl enable --now redis 2>/dev/null || true

# ---------- Application ----------
echo "[5/8] Setting up application..."
mkdir -p "$APP_DIR"
cp -r "$REPO_DIR"/* "$APP_DIR/"

# Create Python venv
python3.11 -m venv "$APP_DIR/backend/.venv"
"$APP_DIR/backend/.venv/bin/pip" install --upgrade pip
"$APP_DIR/backend/.venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
"$APP_DIR/backend/.venv/bin/pip" install psycopg2-binary

# Build frontend
cd "$APP_DIR/frontend"
npm ci
npm run build

# ---------- Environment ----------
echo "[6/8] Creating environment file..."
if [ ! -f "$APP_DIR/.env" ]; then
    cat > "$APP_DIR/.env" <<'ENVEOF'
# Chiron APM — Environment Configuration
# Edit these values for your deployment

# PostgreSQL (local mirror — set this to enable PG mode)
CHIRON_PG_DSN=postgresql://chiron:chiron@localhost/chiron_apm

# Redis
CHIRON_REDIS_URL=redis://localhost:6379/0

# CORS — add your domain
CHIRON_CORS_ORIGINS=http://localhost:3000,https://chiron.yourdomain.com

# Snowflake (for sync worker — reads from config.json by default)
# SNOWFLAKE_ACCOUNT=
# SNOWFLAKE_USER=
# SNOWFLAKE_PASSWORD=

# Request timeout
CHIRON_ROUTE_TIMEOUT=30

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
PORT=3000
ENVEOF
    echo "  Created $APP_DIR/.env — EDIT THIS before starting services"
else
    echo "  $APP_DIR/.env already exists, skipping"
fi

# Apply PG schema
echo "  Applying PostgreSQL schema..."
PGPASSWORD=chiron psql -U chiron -h localhost -d chiron_apm -f "$APP_DIR/backend/pg_schema.sql" 2>/dev/null || true

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- Systemd Services ----------
echo "[7/8] Installing systemd services..."

# API server
cat > /etc/systemd/system/chiron-api.service <<EOF
[Unit]
Description=Chiron APM API Server
After=network.target postgresql.service redis6.service
Wants=postgresql.service redis6.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/backend/.venv/bin/gunicorn main:app \
    -k uvicorn.workers.UvicornWorker \
    -w 4 -b 127.0.0.1:8000 \
    --timeout 60 --graceful-timeout 30 \
    --access-logfile - --error-logfile -
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Sync worker
cat > /etc/systemd/system/chiron-sync.service <<EOF
[Unit]
Description=Chiron APM Snowflake Sync Worker
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/backend/.venv/bin/python sync_worker.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

# Frontend
cat > /etc/systemd/system/chiron-frontend.service <<EOF
[Unit]
Description=Chiron APM Frontend (Next.js)
After=network.target chiron-api.service

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/frontend
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# ---------- Nginx ----------
echo "[8/8] Configuring Nginx..."
cat > /etc/nginx/conf.d/chiron.conf <<'NGINXEOF'
server {
    listen 80;
    server_name _;  # Replace with your domain

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINXEOF

nginx -t && systemctl enable --now nginx

echo ""
echo "=============================="
echo "Setup complete!"
echo "=============================="
echo ""
echo "Next steps:"
echo "  1. Edit config:     nano $APP_DIR/.env"
echo "  2. Copy config.json to $APP_DIR/ (for Snowflake credentials)"
echo "  3. Run initial sync: sudo -u $APP_USER $APP_DIR/backend/.venv/bin/python $APP_DIR/backend/sync_worker.py --full"
echo "  4. Start services:  sudo systemctl enable --now chiron-sync chiron-api chiron-frontend"
echo "  5. Add SSL:         sudo certbot --nginx -d chiron.yourdomain.com"
echo ""
echo "Check status:  systemctl status chiron-api chiron-sync chiron-frontend"
echo "View logs:     journalctl -u chiron-api -f"
