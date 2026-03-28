---
description: How to set up Cloudflare Tunnel for GitHub webhooks
---

# Cloudflare Tunnel Setup for GitHub Webhooks

This workflow sets up a persistent Cloudflare Tunnel to expose `localhost:3000` to the internet so GitHub can deliver push event webhooks.

## Prerequisites

- A domain managed by Cloudflare (DNS on Cloudflare)
- `cloudflared` CLI installed ([download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/))

## Steps

### 1. Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser to authenticate. Select the domain you want to use.

### 2. Create the tunnel

```bash
cloudflared tunnel create kontext-webhook
```

This creates a tunnel and outputs a **Tunnel ID** and credentials file.

### 3. Create the DNS route

```bash
cloudflared tunnel route dns kontext-webhook webhook.yourdomain.com
```

Replace `yourdomain.com` with your actual Cloudflare-managed domain.

### 4. Create the config file

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /path/to/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: webhook.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 5. Run the tunnel

```bash
cloudflared tunnel run kontext-webhook
```

### 6. Update environment variables

In `.env.local`:

```
GITHUB_WEBHOOK_SECRET=<generate-a-random-secret>
NEXT_PUBLIC_SITE_URL=https://webhook.yourdomain.com
```

Generate a secret:

```bash
openssl rand -hex 32
```

### 7. Verify

1. Start the Next.js dev server: `npm run dev`
2. Start the tunnel: `cloudflared tunnel run kontext-webhook`
3. Visit `https://webhook.yourdomain.com/api/webhooks/github` — should return 405 (no GET handler)
4. Enable auto-sync on a repo in the Kontext UI — this registers the webhook on GitHub
5. Push a commit to the watched branch — the webhook should fire and trigger an incremental sync

## Production (Railway)

On Railway, you don't need a tunnel — the app is already publicly accessible. Just set:

```
GITHUB_WEBHOOK_SECRET=<same-secret>
NEXT_PUBLIC_SITE_URL=https://your-railway-app.railway.app
```
