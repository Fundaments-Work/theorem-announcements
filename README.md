# theorem-announcements

Cloudflare Worker serving announcements, status advisories, and release notifications for [Theorem](https://github.com/Fundaments-Work/Theorem).

## Overview

- **Global Edge Serving**: Powered by Cloudflare Workers and KV (`ANNOUNCEMENTS_KV`).
- **Zero-Dependency Read Path**: Pure JSON responses with strict CORS and 5-minute HTTP edge caching (`Cache-Control: public, max-age=300`, `ETag`).
- **Fail-Safe Fallback**: Bundled fallback seed ensures announcements serve reliably even during KV cold starts or migrations.
- **GitOps Workflow**: Modify `announcements.json` via reviewed PRs. Merging to `main` deploys and updates the edge KV store automatically.

---

## API Endpoints

### 1. `GET /api/announcements`
Returns all active announcements. Expired (`expiresAt <= now`) and future scheduled (`publishedAt > now`) announcements are filtered on read.

**Response**:
```json
{
  "announcements": [
    {
      "id": "theorem-1-6-0-release",
      "severity": "info",
      "title": "Theorem 1.6.0 is available",
      "body": "Welcome to Theorem 1.6.0! Support local development via Buy Me Momo, or view what's new on GitHub.\nDetails at https://github.com/Fundaments-Work/Theorem/releases/tag/v1.6.0",
      "link": "https://github.com/Fundaments-Work/Theorem/releases/tag/v1.6.0",
      "linkLabel": "See what's new",
      "publishedAt": "2026-10-08T00:00:00Z",
      "expiresAt": null
    }
  ],
  "updatedAt": "2026-10-08T00:00:00Z"
}
```

### 2. `POST /api/announcements`
Authorized endpoint for urgent updates or automated publishing.

- **Header**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Content-Type**: `application/json`
- **Body**: `{ "announcements": [ ... ] }` matching `schema.json`.

---

## How to Publish an Announcement

### Standard Workflow (GitOps)
1. Edit `announcements.json`.
2. Ensure each announcement has a unique, stable `id` (users store dismissed IDs locally; never reuse an ID).
3. Validate and test locally:
   ```bash
   pnpm test
   ```
4. Open a Pull Request on GitHub.
5. Upon merging into `main`, GitHub Actions automatically validates the schema and deploys the update to Cloudflare KV.

---

## Announcement Schema & Invariants

Defined formally in [`schema.json`](./schema.json):

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique, stable identifier (e.g. `theorem-1-6-0-release`). Required. |
| `severity` | `"info" \| "warning" \| "critical"` | Severity level. Required. |
| `title` | `string` | Headline text. Required. |
| `body` | `string` | Body message. Supports `**bold**` formatting and bare `https://` URLs. Required. |
| `link` | `string` (URI) | Optional primary CTA URL. Must be `https://` without credentials. |
| `linkLabel` | `string` | Optional button label for the CTA link. |
| `publishedAt`| `string` (ISO 8601)| Publication date. Required. |
| `expiresAt` | `string \| null` | Optional expiration date after which the announcement is hidden. |

---

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Start local dev worker
pnpm dev
```
