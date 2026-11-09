# HerShield backend on AWS EC2

The frontend stays on Firebase Hosting (`https://hershield-web.web.app`). Only the
Node/Express + Socket.IO backend moves from Render (Oregon, sleeps when idle) to an
always-on EC2 instance in Mumbai. Render stays deployed as a backup.

```
Browser ──► hershield-web.web.app (Firebase Hosting, static files)
   │
   └─ /api + Socket.IO ──► https://<ip-with-dashes>.sslip.io
                              nginx :443 (Let's Encrypt) ──► node server.js :3000 (systemd)
                                                               └─► Firestore, Cloudinary, Gmail, Twilio
```

`sslip.io` turns an IP into a hostname (`13-233-45-67.sslip.io` → `13.233.45.67`), so
the backend gets a real HTTPS certificate with no domain purchase or signup.

## Cost

t3.micro (Mumbai) + public IPv4 + 20 GB gp3 ≈ **$13–14/month**, paid from AWS credits.
Set a budget alert (step 1) so nothing is charged by surprise once credits run out.

## 1. AWS console (about 10 minutes)

1. Top-right region menu → **Asia Pacific (Mumbai) ap-south-1**.
2. *Optional, recommended:* **Billing → Budgets → Create budget → Monthly cost budget**,
   $15, your email.
3. **EC2 → Launch instance**
   - Name: `hershield-backend`
   - AMI: **Ubuntu Server 24.04 LTS** (64-bit x86)
   - Instance type: **t3.micro**
   - Key pair: **Create new key pair** → name `hershield-key`, RSA, `.pem` → it downloads
   - Network settings → **Edit**:
     - SSH (22): source **My IP**
     - Tick **Allow HTTPS traffic from the internet** and **Allow HTTP traffic from the internet**
       (port 80 is needed for the certificate check and redirects to HTTPS)
   - Storage: **20 GiB gp3**
   - **Launch instance**
4. **EC2 → Elastic IPs → Allocate Elastic IP address → Allocate**, then
   **Actions → Associate** → pick `hershield-backend`. The IP (and so the hostname)
   now survives stop/start.

## 2. Install (run from the project folder on your PC)

```bash
KEY=~/Downloads/hershield-key.pem
IP=13.233.45.67   # your Elastic IP
scp -i $KEY deploy/ec2/setup.sh .env hershield-firebase-adminsdk.json ubuntu@$IP:~
ssh -i $KEY ubuntu@$IP 'sudo bash setup.sh'
```

`setup.sh` is idempotent. It:

1. Adds 2 GB swap. npm needs it on a 1 GB instance.
2. Installs nginx, certbot, git and Node.js 22 LTS.
3. Clones `main` into `/opt/hershield/app` and runs `npm ci --omit=dev`. The code runs as the unprivileged `hershield` user.
4. Moves the uploaded secrets into `/opt/hershield/shared` (mode 700/600). The `.env` there is symlinked into the app.
5. Installs the `hershield` systemd service, which restarts on crash and on reboot.
6. Configures nginx as a reverse proxy, with WebSocket upgrade headers for Socket.IO and a 12 MB upload limit.
7. Gets a Let's Encrypt certificate, which auto-renews, and redirects HTTP to HTTPS.

Production settings live in the systemd unit, not `.env`:

- `NODE_ENV`
- `PORT`
- `TRUST_PROXY`
- `APP_URL`
- `FRONTEND_URL`
- the Firebase key path

dotenv never overrides variables that are already set, so a development `.env` is safe to copy up as-is.

## 3. Point the frontend at EC2

In `config.js`, `index.html` (preconnect) and `.github/workflows/keep-backend-awake.yml`,
replace `https://ai-hershield.onrender.com` with `https://<ip-with-dashes>.sslip.io`,
then `firebase deploy --only hosting`.

**Switching back to Render** is the same edit in reverse plus a hosting deploy. Render
keeps its own environment variables, so it works immediately (allow ~40 s for it to wake).

## Day-to-day

| Task | Command (on the instance) |
|---|---|
| Deploy latest `main` | `sudo bash /opt/hershield/app/deploy/ec2/setup.sh --update` |
| Live logs | `sudo journalctl -u hershield -f` |
| Restart | `sudo systemctl restart hershield` |
| Status | `systemctl status hershield nginx` |
| Edit secrets | `sudo nano /opt/hershield/shared/.env` then restart |
| Certificate status | `sudo certbot certificates` |

Unlike Render, pushing to GitHub does **not** deploy here; run the update command.

## Security notes

- SSH is key-only (Ubuntu default) and the security group limits port 22 to your IP.
  If your IP changes, edit the security group's SSH rule.
- Node listens on 3000 but is reachable only through nginx (port 3000 is not open in the
  security group).
- Ubuntu installs security updates automatically (`unattended-upgrades`).
- Secrets are never in the repo or in shell history; they are copied with `scp`.
