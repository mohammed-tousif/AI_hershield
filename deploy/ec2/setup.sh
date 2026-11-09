#!/usr/bin/env bash
# HerShield backend on a fresh Ubuntu 24.04 EC2 instance (see deploy/ec2/README.md).
#
#   sudo bash setup.sh            first install; safe to re-run
#   sudo bash setup.sh --update   pull the latest main, reinstall deps, restart
#
# Layout: code in /opt/hershield/app (owned by the unprivileged "hershield" user),
# secrets in /opt/hershield/shared (mode 700), Node behind nginx on 127.0.0.1:3000,
# HTTPS from Let's Encrypt on <public-ip-with-dashes>.sslip.io (no signup needed).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mohammed-tousif/AI_hershield.git}"
BRANCH="${BRANCH:-main}"
APP_USER=hershield
BASE=/opt/hershield
APP_DIR=$BASE/app
SHARED=$BASE/shared
PORT=3000
FRONTEND_URL=https://hershield-web.web.app
# Files copied up with scp land in the SSH user's home (usually /home/ubuntu).
UPLOAD_HOME=$(getent passwd "${SUDO_USER:-ubuntu}" | cut -d: -f6)

log()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }
as_app() { sudo -u "$APP_USER" -H "$@"; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo bash $0"

public_host() {
    # IMDSv2 (the default on new instances) needs a session token first.
    local token ip
    token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
    ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4) \
        || die "No public IPv4 on this instance. Attach an Elastic IP first."
    echo "${ip//./-}.sslip.io"
}

sync_code() {
    if [ -d "$APP_DIR/.git" ]; then
        log "Updating code ($BRANCH)"
        as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
        as_app git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
    else
        log "Cloning $REPO_URL"
        as_app git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    fi
    log "Installing production dependencies"
    (cd "$APP_DIR" && as_app npm ci --omit=dev --no-audit --no-fund --loglevel=error)
    ln -sfn "$SHARED/.env" "$APP_DIR/.env"
}

health_check() {
    local url=$1 i
    for i in $(seq 1 30); do
        if curl -fsS --max-time 5 -o /dev/null "$url"; then echo "healthy: $url"; return 0; fi
        sleep 2
    done
    return 1
}

if [ "${1:-}" = "--update" ]; then
    sync_code
    systemctl restart hershield
    health_check "http://127.0.0.1:$PORT/api/health" || die "Backend did not come back. Logs: journalctl -u hershield -n 80"
    exit 0
fi

HOST="${HOST:-$(public_host)}"
log "Public hostname: $HOST"

# ── 1. Swap: npm ci and Node together can exceed 1 GB of RAM on a micro ──────
if ! swapon --show | grep -q .; then
    log "Adding 2 GB swap"
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── 2. System packages ────────────────────────────────────────────────────────
log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx certbot python3-certbot-nginx >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    log "Installing Node.js 22 LTS"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v), npm $(npm -v)"

# ── 3. App user, code, secrets ────────────────────────────────────────────────
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$BASE"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SHARED"

for f in .env hershield-firebase-adminsdk.json; do
    if [ -f "$UPLOAD_HOME/$f" ]; then
        dest="$SHARED/$f"; [ "$f" = hershield-firebase-adminsdk.json ] && dest="$SHARED/firebase-adminsdk.json"
        log "Moving uploaded $f into $SHARED"
        install -o "$APP_USER" -g "$APP_USER" -m 600 "$UPLOAD_HOME/$f" "$dest" && rm -f "$UPLOAD_HOME/$f"
    fi
done
[ -f "$SHARED/.env" ] || die "Missing $SHARED/.env — copy it up first (see README step 3), then re-run."
[ -f "$SHARED/firebase-adminsdk.json" ] || warn "No Firebase Admin key — Firestore features will be off until $SHARED/firebase-adminsdk.json exists."

sync_code

# ── 4. systemd service ────────────────────────────────────────────────────────
# Deployment settings live here, not in .env: dotenv never overrides variables
# that are already set, so these win over any local values copied up in .env.
log "Installing systemd service"
cat > /etc/systemd/system/hershield.service <<EOF
[Unit]
Description=HerShield backend
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=PORT_RANGE=1
Environment=TRUST_PROXY=1
Environment=APP_URL=https://$HOST
Environment=FRONTEND_URL=$FRONTEND_URL
Environment=FIREBASE_SERVICE_ACCOUNT_PATH=$SHARED/firebase-adminsdk.json
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet hershield
systemctl restart hershield
health_check "http://127.0.0.1:$PORT/api/health" || die "Backend did not start. Logs: journalctl -u hershield -n 80"

# ── 5. nginx reverse proxy (WebSocket-aware for Socket.IO) ────────────────────
log "Configuring nginx"
cat > /etc/nginx/sites-available/hershield <<EOF
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

server {
    listen 80;
    listen [::]:80;
    server_name $HOST;

    # Multer caps uploads at 10 MB; leave headroom for multipart overhead.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 75s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/hershield /etc/nginx/sites-enabled/hershield
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload nginx

# ── 6. HTTPS (auto-renews via certbot's systemd timer) ────────────────────────
log "Requesting Let's Encrypt certificate for $HOST"
if certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring -q; then
    health_check "https://$HOST/api/health" || warn "HTTPS health check failed — is port 443 open in the security group?"
else
    warn "Certificate request failed (port 80 closed in the security group, or a rate limit). HTTP works; re-run this script to retry."
fi

log "Done"
cat <<EOF
  Backend URL : https://$HOST
  Health      : https://$HOST/api/health
  Logs        : sudo journalctl -u hershield -f
  Update      : sudo bash $APP_DIR/deploy/ec2/setup.sh --update
EOF
