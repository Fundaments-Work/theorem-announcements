# theorem-announcements — Agent Guide

## What this is

A Cloudflare Worker serving announcements and status advisories for Theorem at
`announcements.fundaments.work`. Zero-dependency read path, one KV binding, a
bundled fallback seed.

## Commands

| What | Command |
| --- | --- |
| Dev | `pnpm dev` (wrangler dev) |
| Deploy | `pnpm deploy` |
| Typecheck | `pnpm typecheck` |
| Tests | `pnpm test` |
| Format | `pnpm format` |

Deploys are handled by Cloudflare's own GitHub integration, **not** by a workflow
here. See `sync.yml` for why that split exists.

## The one thing to understand

**Editing code does not change the live feed. Editing `announcements.json` and
merging to `main` does.**

The Worker is redeployed on push, but the feed is served from KV. The only
thing that writes the live feed is the `kv key put` step in
`.github/workflows/sync.yml`. So:

- Change `src/index.ts` → deploys, feed unchanged.
- Change `announcements.json` → the workflow validates, tests, then writes KV.
- **Change both** if you change the data shape.

That is also why the workflow only triggers on `paths: ["announcements.json"]`:
it exists to sync data, not to ship code.

## Publishing

GitOps, no manual steps:

1. Edit `announcements.json`.
2. **Give every announcement a unique, stable `id`.** Clients store dismissed ids
   locally; a reused id silently suppresses an announcement someone has already
   dismissed, and it will never appear for them again.
3. `pnpm test` — validates against `schema.json`.
4. Open a PR, merge to `main`.

`POST /api/announcements` with `Authorization: Bearer <ADMIN_TOKEN>` exists for
urgent updates that cannot wait for a merge. Use it sparingly.

## Rules

- **Validate every external URL with `isSafeHttpUrl`.** https only, no embedded
  credentials. Announcement `link` values are attacker-visible if the endpoint is
  ever exposed further.
- **`expiresAt` and `publishedAt` are filtered on read**, not at write time, so a
  scheduled announcement needs no deploy to go live.
- **The bundled seed must stay in sync with `announcements.json`.** It is the
  fallback for a KV cold start; a stale seed means an outage shows old content.
- Admin-token comparison uses `timingSafeEqualString`. Do not replace it with `===`.
- Responses are cached 5 minutes at the edge with an `ETag`; the worker computes
  it with `computeEtag`.
- CORS is `*` on GET/POST/OPTIONS. Narrowing it is a behaviour change, not a
  refactor.

## Cross-repo contracts

- **`Theorem` is the consumer.** It fetches this feed at runtime to show the
  in-app announcement banner. Announcement wording should match what actually
  shipped in that release — check `Theorem/CHANGELOG.md` before writing one.
- **`Fundaments-Work/content`** holds shared machine-readable facts across
  products (support channels today). Announcements are **not** a shared fact:
  they are Theorem-specific, one-off, and time-boxed, so they belong here and
  nowhere else.
- A Buy Me Momo link inside an announcement body is a URL literal like any
  other. If the canonical link changes, update announcement bodies here too —
  they are historical records with real links in them, so treat changing one as
  a deliberate act rather than a routine sync.

## Before committing

```bash
pnpm typecheck
pnpm test
```

`pnpm test` validates `announcements.json` against `schema.json`. Merging without
it can put a malformed feed into KV, and `sync.yml` runs the same tests — but by
then the bad data is already in the PR.