# ✚ healthmanager

a minimal medical file manager for you and your friends. built on cloudflare.

**live at [health.beenex.company](https://health.beenex.company)**

## stack

- **frontend** — vanilla html/css/js, buildspace-inspired design
- **api** — cloudflare workers (typescript)
- **database** — cloudflare d1 (sqlite)
- **storage** — cloudflare r2
- **auth** — email + password, pbkdf2 hashing, session cookies

## features

- add/manage people
- upload medical files (drag & drop)
- preview images, pdfs, and csvs inline
- filter by person
- mcp server for programmatic access

## setup

```bash
npm install
wrangler d1 create health-manager-db
wrangler r2 bucket create health-manager-files
# update database_id in wrangler.jsonc
wrangler d1 execute health-manager-db --remote --file=schema.sql
wrangler deploy
```

## mcp server

```bash
cd mcp && npm install
```

set `HEALTHMANAGER_EMAIL` and `HEALTHMANAGER_PASSWORD` env vars in your mcp config.
