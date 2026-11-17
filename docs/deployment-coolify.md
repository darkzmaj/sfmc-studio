# Deploying with Docker and Coolify

SFMC Studio builds into static files served by an unprivileged nginx container. It needs **no database, no secrets and no environment variables**. The only optional volume is the read-only TF2 asset pack described below.

## Hosted TF2 asset pack (optional, operator's decision)

By default visitors link their own TF2 installation. To make all nine classes and every cosmetic load with **no import at all**, the operator can host an asset pack built from their own TF2 install:

```bash
node scripts/asset-pack.ts --tf "/path/to/Team Fortress 2/tf" --out ./asset-pack   # ~3.5 GB, ~46,500 files
# smaller: add --max-texture 512
```

It contains the 9 class models, every catalog cosmetic model (all classes and styles), their materials and textures, and 128 px PNG icons, plus `index.json`. The app detects `/tf2/index.json` at startup and uses it automatically; a visitor's own linked files still take priority.

- **Never commit it** (`/asset-pack/` is git- and docker-ignored). It is not part of the image.
- **Legal note:** hosting these files publicly redistributes Valve's copyrighted game assets. Fan sites do this and Valve has tolerated it, but it is the operator's risk and Valve can request removal at any time. Delete the volume to switch back to bring-your-own-files mode.
- **Docker Compose:** mounted read-only from `./asset-pack` (or `ASSET_PACK=/srv/sfmc/asset-pack`).
- **Coolify:** in the resource's *Storages*, add a **Directory mount**: source `/srv/sfmc/asset-pack` (on the host), destination `/usr/share/nginx/html/tf2`. Upload the pack once with `rsync -a --delete asset-pack/ server:/srv/sfmc/asset-pack/`. Redeploys keep it.
- **Extra model entries (also 18+):** put a `types.json` in the pack root with entries like `{ "id": "hosted.my-model", "name": "My Model", "modelPath": "models/custom/my_model.mdl", "category": "custom", "cosmeticClass": "scout", "skeleton": "tf2-biped", "mature": false, "attribution": "Model by …" }` and add the model files under the same paths. Entries with `"mature": true` stay hidden until a visitor confirms they are 18+. Only host community models you have permission to redistribute.

Nginx serves `/tf2/` with a 7-day cache (and `index.json` with `no-cache`), gzip-compressed.

## Price snapshot

`public/catalog/prices.json` holds lowest Steam Community Market listings (Unique quality, USD) for the Try Out page. Refresh it with `node scripts/build-prices.mjs` (throttled, about 6 minutes; keeps old prices if Steam rate-limits). The weekly catalog workflow also runs it.

## Why the server never holds visitor data

Visitor projects are stored in each visitor's browser (IndexedDB), never on the server. Rebuilding, redeploying or deleting the container therefore cannot lose anyone's characters.

What *does* matter for persistence is the **origin**. Browser storage is bound to scheme + host + port. Keep serving the app from the same URL (`https://sfmc-studio.kori.my`). If you move it to another domain, visitors' existing libraries stay behind on the old origin and have to be moved with a ZIP backup and restore.

## Coolify (recommended: Dockerfile build pack)

1. **Push the repository** to GitHub (public), or fork it.
2. In Coolify: **Projects → your project → + New → Public Repository** (or **Private Repository (GitHub App)** for a fork you keep private).
   - Repository URL: `https://github.com/darkzmaj/sfmc-studio`
   - Branch: `main`
   - **Build Pack: Dockerfile**. The Dockerfile is at the repository root.
3. **General → Network**
   - **Ports Exposes: `8080`** (the container listens on 8080, not 80).
   - Ports Mappings: leave empty when using a domain through Coolify's proxy.
4. **Domains**: set `https://sfmc-studio.kori.my`. Coolify's proxy (Traefik or Caddy) requests a Let's Encrypt certificate automatically once DNS points to the server.
5. **Health check** (optional, the image already declares one): path `/healthz`, port `8080`, expected status `200`.
6. **Environment variables**: none required.
7. **Deploy**. The first build takes about a minute.

### DNS

Create an `A` record (and `AAAA` if your server has IPv6) for `sfmc-studio.kori.my` pointing to the Coolify server's public IP, or a `CNAME` to a hostname that resolves there. Wait for DNS to propagate before the first deploy so the certificate challenge succeeds.

### Recommended proxy settings

- Enable **Force HTTPS** / HTTP to HTTPS redirect in Coolify.
- Add HSTS at the proxy. In Coolify you can add a custom Traefik label on the resource, for example:
  ```
  traefik.http.middlewares.sfmc-hsts.headers.stsSeconds=31536000
  traefik.http.middlewares.sfmc-hsts.headers.stsIncludeSubdomains=true
  ```
  then attach the middleware to the router. HSTS is set at the proxy rather than in nginx because nginx only sees plain HTTP behind the proxy.
- The container already sends CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP and CORP headers.

### Alternative: Docker Compose build pack

Pick **Build Pack: Docker Compose** and keep `docker-compose.yml`. Remove the `ports:` mapping (Coolify routes through its proxy), or leave it if you want direct access. Then set the domain on the `sfmc-studio` service with port 8080.

### Auto-deploy

Enable **Automatic deployment** (GitHub App or webhook) so pushes to `main` redeploy. The weekly catalog-sync workflow opens a pull request; merging it triggers a redeploy with the new item metadata.

## Plain Docker

```bash
docker build -t sfmc-studio .
docker run -d --name sfmc-studio -p 8080:8080 --restart unless-stopped \
  --read-only --tmpfs /tmp --tmpfs /var/cache/nginx \
  --cap-drop ALL --security-opt no-new-privileges:true sfmc-studio
curl -fsS http://localhost:8080/healthz   # -> ok
```

Or `docker compose up -d --build`.

## Caching behaviour

| Path | Cache-Control |
|---|---|
| `/assets/*` (fingerprinted JS/CSS/fonts) | `public, max-age=31536000, immutable` |
| `/catalog/*.json` | `public, max-age=86400, stale-while-revalidate=604800` |
| `/` and all app routes (SPA fallback to `index.html`) | `no-cache` |
| `/healthz` | not logged, returns `ok` |

## Verifying a deployment

```bash
curl -sI https://sfmc-studio.kori.my/ | grep -i content-security-policy
curl -s  https://sfmc-studio.kori.my/healthz
curl -s -o /dev/null -w "%{http_code}\n" https://sfmc-studio.kori.my/editor/anything   # 200 (SPA fallback)
```

Then open the site, create a character, save it, reload: it must still be there.

## Updating

Redeploy from Coolify (or `git pull && docker compose up -d --build`). Visitor data is untouched because it never lived on the server.
