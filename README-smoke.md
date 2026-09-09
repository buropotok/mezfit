# Deploy smoke test

This branch verifies the real deployment path:

GitHub Actions → Vite build → Cloudflare Worker → D1 `mezfit` (`DB_BINDING`).

The deployed Mini App displays `Mezfit is running` and calls `GET /api/health`. A successful health response is:

```json
{"ok":true,"service":"mezfit","d1":"connected"}
```
