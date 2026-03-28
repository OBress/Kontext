# Cloudflare Tunnel Setup for GitHub Webhooks

This guide sets up a persistent Cloudflare Tunnel to expose your local Next.js dev server to the internet, enabling GitHub to deliver push event webhooks to `POST /api/webhooks/github`.

## Prerequisites

- A domain managed by Cloudflare (DNS on Cloudflare)
- `cloudflared` CLI installed — [download here](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

---

## Step 1: Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser to authenticate with your Cloudflare account. Select the domain you want to use.

## Step 2: Create the tunnel

```bash
cloudflared tunnel create kontext-webhook
```

This outputs a **Tunnel ID** (UUID) and creates a credentials JSON file at `~/.cloudflared/<TUNNEL_ID>.json`.

Save the Tunnel ID — you'll need it for the config.

## Step 3: Create the DNS route

```bash
cloudflared tunnel route dns kontext-webhook webhook.yourdomain.com
```

> Replace `yourdomain.com` with your actual Cloudflare-managed domain.

This creates a CNAME record pointing `webhook.yourdomain.com` → your tunnel.

## Step 4: Create the config file

Create or edit `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: webhook.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

## Step 5: Generate a webhook secret

```bash
openssl rand -hex 32
```

Copy the output — this is your `GITHUB_WEBHOOK_SECRET`.

## Step 6: Update environment variables

Add to your `.env.local`:

```env
GITHUB_WEBHOOK_SECRET=<the-hex-string-from-step-5>
NEXT_PUBLIC_SITE_URL=https://webhook.yourdomain.com
```

## Step 7: Run everything

**Terminal 1** — Next.js dev server:
```bash
npm run dev
```

**Terminal 2** — Cloudflare tunnel:
```bash
cloudflared tunnel run kontext-webhook
```

## Step 8: Verify

1. Visit `https://webhook.yourdomain.com` — should load your Kontext app
2. Open a repo in Kontext that's been ingested
3. Go to the **Overview** tab → **Sync Settings** → toggle **Auto-sync** ON
4. This registers a GitHub webhook on the repo
5. Push a commit to the watched branch
6. The webhook fires → Kontext receives it → incremental sync runs automatically
7. Check the **Timeline** tab to see the tracked commit

---

## Production (Railway)

On Railway, the app is already publicly accessible — no tunnel needed. Just set:

```env
GITHUB_WEBHOOK_SECRET=<same-secret>
NEXT_PUBLIC_SITE_URL=https://your-app.railway.app
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cloudflared: command not found` | Install from [cloudflare downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |
| Webhook returns 401 | Check `GITHUB_WEBHOOK_SECRET` matches between `.env.local` and what GitHub has |
| Webhook returns 500 | Check server logs — likely `GITHUB_WEBHOOK_SECRET` is empty |
| Tunnel not connecting | Verify `config.yml` tunnel ID matches the created tunnel |
| DNS not resolving | Wait a few minutes for Cloudflare DNS propagation |
