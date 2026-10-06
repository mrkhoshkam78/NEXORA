# Nexora V1

Local-first AI coding assistant powered by Cloudflare Workers AI.

## Run

```bash
npm install
npm start
```

Open http://127.0.0.1:8787

### Cloudflare token

Use a Cloudflare API token with Workers AI Read + Edit permissions. Nexora validates access, discovers available models, prefers `@cf/qwen/qwen3.8-27b`, and falls back when a model-level request fails.

### Security

Cloudflare credentials stay server-side. The token is encrypted at rest with AES-256-GCM using a local machine key file. No credentials are returned to browser JavaScript.
