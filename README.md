# Everlast

A NotebookLM-style research workspace: upload your sources, ask questions, and get
answers grounded in those sources with citations you can click back to the exact
passage.

**everlastlm.com**

- **Frontend** — Next.js 16 (App Router, React 19), Tailwind v4, next-intl (EN/DE),
  light & dark themes
- **Backend** — NestJS 11 in a domain-driven layout
- **Data** — Supabase (Postgres 17 + pgvector + Storage + Auth), row level security
  on every table
- **AI** — Claude for answering and generation, Voyage for embeddings

---

## Quick start

```bash
pnpm install

# 1. Start Postgres, Auth, Storage and apply all migrations.
pnpm db:start          # prints ANON_KEY / SERVICE_ROLE_KEY / JWT_SECRET

# 2. Fill in the environment.
cp .env.example apps/api/.env        # paste the Supabase keys + your AI keys
cp .env.example apps/web/.env.local  # keep only the NEXT_PUBLIC_* lines

# 3. Run both apps.
pnpm dev               # api :3001, web :3000
```

Check the keys landed before wondering why an upload failed:

```bash
pnpm check:providers
```

It asks each provider directly and tells you what to fix. A bad key is
otherwise only visible when a source fails to ingest.

You need two API keys for the AI features:

| Key                 | Used for                                    | Get one at          |
| ------------------- | ------------------------------------------- | ------------------- |
| `ANTHROPIC_API_KEY` | chat answers, summaries, studio artifacts   | console.anthropic.com |
| `VOYAGE_API_KEY`    | embeddings for retrieval                    | voyageai.com **or** MongoDB Atlas |

> **Two sources for the embedding key.** MongoDB owns Voyage, so the same models
> are served from two hosts, each accepting only its own credential:
> `pa-…` keys from voyageai.com go to `api.voyageai.com`, and `al-…` keys from
> Atlas (*AI Model APIs → Model API Keys*) go to `ai.mongodb.com`. The host is
> chosen from the prefix automatically. Sending one to the other's host returns
> a plain 401 that looks exactly like an expired key.

Everything except answering and retrieval works without them — accounts, notebooks,
sharing, uploads and notes are all independent of the model providers.

`TTS_PROVIDER=elevenlabs` additionally enables spoken audio overviews; with the
default `none`, an audio overview is still generated but stored as a script.

### Local email

Local Supabase never sends real mail. Signup confirmations, invites and password
resets are captured by **Mailpit at http://127.0.0.1:54324** — open it and click
the link there. Waiting on your real inbox will not work.

To skip confirmation while developing, set `enable_confirmations = false` under
`[auth.email]` in `supabase/config.toml`, then `pnpm db:stop && pnpm db:start`.
Keep it enabled anywhere deployed.

### Commands

| Command           | Does                                              |
| ----------------- | ------------------------------------------------- |
| `pnpm dev`        | Run API and web together                          |
| `pnpm build`      | Build contracts → API → web                       |
| `pnpm typecheck`  | Typecheck every workspace                         |
| `pnpm test`       | Run all unit tests                                |
| `pnpm db:reset`   | Drop, recreate and re-migrate the local database  |
| `pnpm db:push`    | Apply migrations to the linked hosted project     |

---

## How it fits together

```
Browser ──► Next.js ──► NestJS API ──► Supabase (Postgres + Storage)
             │             │
             │             └─► Claude (answers)  ·  Voyage (embeddings)
             │
             └─► Supabase Auth (session cookies, httpOnly)
```

The browser holds a Supabase session in httpOnly cookies. It sends the access token
to the API as a bearer token; the API verifies it locally, then executes **every**
query through a Supabase client bound to that token, so row level security applies
to each statement. The service-role key is used only where there is no
authenticated caller — the ingestion pipeline, the audit log, and the invite
lookup.

### Retrieval

1. A source is uploaded, fetched or pasted, and text is extracted (per page for
   PDFs, following headings for HTML/Markdown/DOCX).
2. Text is chunked on paragraph boundaries with overlap, and each chunk is prefixed
   with its heading path so the embedding carries document context.
3. Chunks are embedded with Voyage and stored in `source_chunks.embedding`
   (`vector(1024)`, HNSW index, cosine).
4. A question is embedded, then `match_source_chunks()` fuses a dense search with a
   Postgres full-text search using reciprocal rank fusion.
5. The retrieved chunks are passed to Claude as citable `document` blocks. The
   model's own citation records are mapped back to chunk ids, so a `[1]` in the
   answer always points at the passage the model actually used — not at a
   post-hoc string match.

---

## Repository layout

```
apps/
  api/                        NestJS, one module per bounded context
    src/modules/<context>/
      domain/                 entities, value objects, repository ports
      application/            use cases
      infrastructure/         Supabase + vendor adapters
      presentation/           controllers
    src/shared/               kernel, security, ports, HTTP plumbing
    src/infrastructure/       Supabase client, AI adapters, safe HTTP
  web/                        Next.js App Router
    src/app/[locale]/         (auth) and (app) route groups
    src/components/           ui primitives + feature components
    src/hooks/                React Query data hooks
packages/
  contracts/                  Zod schemas shared by both apps
supabase/migrations/          schema, RLS, retrieval, storage, grants
docs/                         domain model and security notes
```

The dependency rule runs one way: `presentation → application → domain`, with
`infrastructure` implementing ports the domain declares. The domain layer imports
nothing from NestJS or Supabase, which is what makes it testable without either.

See [`docs/domain-model.md`](docs/domain-model.md) for the ubiquitous language and
[`docs/security.md`](docs/security.md) for the threat model.

---

## Verified

Run against a live local Supabase (`scripts/smoke.mjs`, 35 checks): authentication
rejection paths, cross-tenant isolation, role enforcement across owner/editor/
viewer, SSRF blocking, duplicate detection, ingestion failure handling, and the
ownership invariants. Plus 57 unit tests covering chunking, citation mapping,
address filtering and token parsing.

The chat and studio paths need real `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` values
to exercise end to end; without them the pipeline is verified only as far as
"fails cleanly into a terminal state".

---

## License

Copyright © 2026 Yasin Atalar.

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

You may run, study, modify and redistribute this software. The one obligation
that matters in practice is **§13**: if you offer a modified version to users
over a network, you must also offer them its source. Self-hosting an unmodified
copy carries no such obligation.

For a license without that condition, contact the copyright holder.
