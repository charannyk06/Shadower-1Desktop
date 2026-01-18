# Collabora CODE VPS Setup Guide

This guide covers setting up Collabora CODE (Collabora Online Development Edition) on a VPS for document editing integration.

## Prerequisites

- VPS with at least 4GB RAM, 2 CPU cores
- Docker installed
- Domain name with SSL certificate (required for production)
- Nginx or Apache for reverse proxy

## Quick Start (Development)

For local development/testing without SSL:

```bash
docker run -d \
  -p 9980:9980 \
  -e "aliasgroup1=http://localhost:3000" \
  -e "username=admin" \
  -e "password=your-admin-password" \
  --cap-add MKNOD \
  --restart always \
  --name collabora \
  collabora/code
```

Then set in your `.env.local`:
```
NEXT_PUBLIC_COLLABORA_URL=http://localhost:9980
WOPI_SECRET=your-super-secret-key-min-32-chars
```

## Production Setup

### 1. DNS Configuration

Point your domain to the VPS IP:
```
collabora.yourdomain.com  →  YOUR_VPS_IP
```

### 2. SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --standalone -d collabora.yourdomain.com
```

### 3. Docker Container

```bash
docker run -d \
  -p 9980:9980 \
  -e "aliasgroup1=https://yourdomain.com:443" \
  -e "server_name=collabora.yourdomain.com" \
  -e "extra_params=--o:ssl.enable=false --o:ssl.termination=true" \
  -e "username=admin" \
  -e "password=your-secure-admin-password" \
  --cap-add MKNOD \
  --restart always \
  --name collabora \
  collabora/code
```

**Important**: `ssl.termination=true` means SSL is terminated at the reverse proxy (nginx), not Collabora.

### 4. Nginx Reverse Proxy

Create `/etc/nginx/sites-available/collabora`:

```nginx
server {
    listen 443 ssl http2;
    server_name collabora.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/collabora.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collabora.yourdomain.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;

    # Static files served by Collabora
    location ^~ /browser {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Host $http_host;
    }

    # WOPI discovery
    location ^~ /hosting/discovery {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Host $http_host;
    }

    # Capabilities
    location ^~ /hosting/capabilities {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Host $http_host;
    }

    # Main websocket connection
    location ~ ^/cool/(.*)/ws$ {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $http_host;
        proxy_read_timeout 36000s;
    }

    # Download, upload, etc
    location ~ ^/(c|l)ool {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Host $http_host;
    }

    # Admin console
    location ^~ /cool/adminws {
        proxy_pass http://127.0.0.1:9980;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $http_host;
        proxy_read_timeout 36000s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name collabora.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/collabora /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Environment Variables

Set these in your production environment (Vercel, etc.):

```
NEXT_PUBLIC_COLLABORA_URL=https://collabora.yourdomain.com
WOPI_SECRET=your-super-secret-key-at-least-32-characters-long
```

## Verification

### Test Collabora is Running

```bash
curl https://collabora.yourdomain.com/hosting/discovery
```

You should see an XML response with WOPI actions.

### Test Admin Console

Visit: `https://collabora.yourdomain.com/browser/dist/admin/admin.html`

Login with the username/password you set in the Docker command.

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs collabora
```

Common issues:
- Memory: Collabora needs at least 4GB RAM
- Ports: Ensure port 9980 is not in use

### WebSocket connection fails

- Ensure nginx proxy settings include WebSocket headers
- Check that `proxy_read_timeout` is set high enough

### CORS errors

Ensure your app domain is in the `aliasgroup1` environment variable:
```bash
-e "aliasgroup1=https://yourdomain.com:443,https://app.yourdomain.com:443"
```

### SSL issues

- Verify SSL certificate is valid: `sudo certbot certificates`
- Check nginx config: `sudo nginx -t`
- Ensure `ssl.termination=true` is set in Docker

## Security Considerations

1. **WOPI Secret**: Use a strong, random secret for JWT token signing
2. **Admin Password**: Use a strong password for the admin console
3. **CORS**: Only allow trusted domains in `aliasgroup1`
4. **Firewall**: Only expose port 443 (HTTPS), keep 9980 internal

## Resource Usage

Collabora CODE resource requirements:

| Concurrent Users | RAM | CPU |
|-----------------|-----|-----|
| 1-10 | 4GB | 2 cores |
| 10-20 | 8GB | 4 cores |
| 20-50 | 16GB | 8 cores |

## Docker Commands

```bash
# View logs
docker logs -f collabora

# Restart container
docker restart collabora

# Stop container
docker stop collabora

# Remove container
docker rm collabora

# Update to latest version
docker pull collabora/code
docker stop collabora
docker rm collabora
# Re-run the docker run command
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your App (Vercel)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌──────────────────────────────────┐   │
│  │  Theater Panel  │    │  CollaboraEditor (iframe)        │   │
│  │  (Preview Mode) │    │  src={collaboraUrl}              │   │
│  └────────┬────────┘    └──────────────┬───────────────────┘   │
│           │                            │                        │
│           ▼                            ▼                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    WOPI Endpoints                        │   │
│  │  /api/wopi/files/{id}           - CheckFileInfo          │   │
│  │  /api/wopi/files/{id}/contents  - GetFile, PutFile       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼ (HTTPS)
┌─────────────────────────────────────────────────────────────────┐
│                  VPS (collabora.yourdomain.com)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Nginx (SSL termination, reverse proxy)                  │   │
│  │  Port 443 → localhost:9980                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Collabora CODE (Docker)                                 │   │
│  │  Port 9980 (internal only)                               │   │
│  │  MPL-2.0 License - Safe for commercial SaaS!             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## License

Collabora CODE uses the **MPL-2.0 license**, which is business-friendly:
- ✅ You can use it in proprietary SaaS products
- ✅ No requirement to open-source your app
- ✅ Commercial use allowed
- ✅ Official Docker image maintained by Collabora Ltd
