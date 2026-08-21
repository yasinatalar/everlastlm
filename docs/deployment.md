# Deployment

Two Vercel projects from one repository, plus a hosted Supabase project.

```
everlastlm.com      → Vercel project "everlastlm-web"  (Next.js)
api.everlastlm.com  → Vercel project "everlastlm-api"  (NestJS, serverless)
                    → Supabase (Postgres + Auth + Storage)
```

Deploys run through GitHub Actions rather than Vercel's Git integration, so
typecheck, unit tests and a full build gate every release, and the API's health
is verified after it ships.

---

## Function timeout: this needs Pro

Vercel freezes a function the moment the response is sent, and kills it at the
plan's ceiling. Measured on this app with six real sources:

| Work                                                    | Time              |
| ------------------------------------------------------- | ----------------- |
| Studio briefing doc / study guide (Opus 5, effort high) | ~121s             |
| Audio overview (script + one TTS call per turn)         | longer still      |
| Source ingestion, large PDF at 3 RPM embeddings         | can exceed 60s    |
| Chat answer                                             | comfortably under |

**Hobby's 60s ceiling is therefore not enough** — `apps/api/vercel.json` sets
`maxDuration: 300`, which requires **Pro**. On Hobby the value is clamped and
studio generation is killed mid-run, leaving the artifact stuck at `generating`.

Things that do _not_ fix this, tested:

- **A queue (QStash/Inngest) does not extend the timeout.** It adds durability
  and retries, but each callback is still a function bound by the same ceiling.
  Useful for reliability; useless for a single 121s model call.
- **Lowering `maxTokens` does not speed generation up.** It truncates the JSON
  mid-object and the structured parse then fails outright — measured as a
  briefing doc failing at 73s that would otherwise have succeeded.
- Lowering `effort` to `low` roughly halves the time but still landed at ~64s,
  and costs real depth.

**Rate limiting is in-memory**, so on serverless each instance keeps its own
counter and the effective limit is looser than configured. It blunts a single
client hammering the API but is not a hard spend cap. Move the throttler to a
shared store (`@nest-lab/throttler-storage-redis` with Upstash) before opening
signups.

## 1. Supabase (production)

You already have a project. Get its **Project Ref** from the dashboard URL
(`supabase.com/dashboard/project/<ref>`).

Apply the schema. Either route works; the CLI is the repeatable one:

```bash
supabase login
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations in order
```

Or, with no CLI setup, paste **`supabase/schema.sql`** into the dashboard's SQL
Editor and run it. That file is every migration concatenated in order
(`pnpm db:schema` regenerates it) and is verified to apply as a single script.

Confirm it worked — this should list 10 tables:

```bash
curl -s "https://<ref>.supabase.co/rest/v1/notebooks?select=id&limit=1" \
  -H "apikey: <service_role key>" -H "Authorization: Bearer <service_role key>"
```

`{"code":"PGRST205"}` means the schema was never applied.

Then in **Authentication → URL Configuration**:

- Site URL: `https://everlastlm.com`
- Redirect URLs: `https://everlastlm.com/auth/callback`

> Add `http://localhost:3000/auth/callback` too if you want the same project to
> serve local development. Prefer a separate project for that.

In **Authentication → Providers → Email**, keep _Confirm email_ on.

**Configure custom SMTP before you test signup**, under Project Settings → Auth
→ SMTP. This is not a nicety — Supabase's built-in sender has two limits that
look exactly like a broken app:

- It **only delivers to addresses on your project's team**. Sign up with any
  other address and no mail is sent, with no error surfaced anywhere.
- It is capped at **2 messages per hour**, with no delivery SLA.

Supabase documents it as being for demos and template testing only. Any SMTP
provider works — Resend, Postmark, SES, or your own mail server.

> Note that this is separate from local development, where **no** mail ever
> leaves the machine: `supabase start` captures it in Mailpit at
> http://127.0.0.1:54324 regardless of SMTP settings.

Once SMTP works, replace the default Supabase-branded mail with the templates in
`supabase/templates/`:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...        # supabase.com/dashboard/account/tokens
pnpm email:push --ref <ref>                 # prints a diff, sends nothing
pnpm email:push --ref <ref> --yes
```

The `content_path` entries in `config.toml` are read by the local CLI only —
production knows nothing about the repository — so this has to be repeated
whenever the templates change. Do **not** reach for `supabase config push`
instead: it applies the whole `[auth]` block, including
`site_url = "http://localhost:3000"`, which would point every confirmation link
on the live site at a developer's laptop. Pasting into **Authentication →
Emails** by hand works too. See
[supabase/templates/README.md](../supabase/templates/README.md).

Grab from **Project Settings → API**: the Project URL, the `anon` key, and the
`service_role` key.

---

## 2. Vercel projects

Create **two** projects from the same GitHub repository.

### everlastlm-web

| Setting                    | Value                                  |
| -------------------------- | -------------------------------------- |
| Root Directory             | `apps/web`                             |
| Include files outside root | **on** (needed for the pnpm workspace) |
| Framework                  | Next.js (auto-detected)                |

Environment variables (Production):

```
NEXT_PUBLIC_SUPABASE_URL       https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key>
NEXT_PUBLIC_API_URL            https://api.everlastlm.com
```

All three are `NEXT_PUBLIC_*`, meaning they are **inlined into the browser
bundle at build time**. Never put the `service_role` key here — anything with
that prefix is public by definition.

### everlastlm-api

| Setting                    | Value      |
| -------------------------- | ---------- |
| Root Directory             | `apps/api` |
| Include files outside root | **on**     |
| Framework                  | Other      |

`apps/api/vercel.json` supplies the build command, the 300s `maxDuration` (see
above — this needs Pro), and the rewrite sending every path to the Nest handler.

Environment variables (Production):

```
NODE_ENV                      production
LOG_LEVEL                     info
WEB_ORIGINS                   https://everlastlm.com,https://www.everlastlm.com
SUPABASE_URL                  https://<ref>.supabase.co
SUPABASE_ANON_KEY             <anon key>
SUPABASE_SERVICE_ROLE_KEY     <service_role key>   ← secret
ANTHROPIC_API_KEY             <key>                ← secret
VOYAGE_API_KEY                <key>                ← secret
TTS_PROVIDER                  elevenlabs           ← or `none` for script-only
ELEVENLABS_API_KEY            <key>                ← secret, if TTS is on
ALLOW_PRIVATE_NETWORK_FETCH   false
RATE_LIMIT_LIMIT              120
RATE_LIMIT_AI_LIMIT           20
```

**`SUPABASE_JWT_SECRET` depends on how your project signs tokens.** Check the
`alg` in the header of your anon key:

```bash
node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[0],'base64url')))" "<anon key>"
```

- `HS256` — a legacy JWT-secret project. **Set it**, to the JWT Secret from
  Project Settings → API. Without it the verifier refuses every token.
- `ES256`/`RS256` — the project publishes a JWKS and the verifier finds the key
  itself. Leave it unset.

An empty value counts as unset, so `SUPABASE_JWT_SECRET=` is safe.

`PORT` is meaningless on serverless — the schema defaults it and it is ignored.

---

## 3. Domain

Add in the **web** project → Settings → Domains:

- `everlastlm.com` (primary)
- `www.everlastlm.com` (redirect to primary)

Add in the **api** project → Settings → Domains:

- `api.everlastlm.com`

DNS at your registrar:

| Type  | Name  | Value                  |
| ----- | ----- | ---------------------- |
| A     | `@`   | `76.76.21.21`          |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `api` | `cname.vercel-dns.com` |

Vercel shows the exact records for your account — prefer those over this table
if they differ. Certificates are issued automatically once DNS resolves.

Two things depend on this split and will break if the API is not on
`api.everlastlm.com`:

- `WEB_ORIGINS` on the API must list the web origins exactly, or the browser's
  preflight fails and every request is blocked by CORS.
- The web app's CSP `connect-src` is built from `NEXT_PUBLIC_API_URL`, so a
  mismatch blocks fetches with a CSP violation rather than a network error.

---

## 4. GitHub Actions

Repository → Settings → Secrets and variables → Actions:

| Secret                  | Where to get it                                              |
| ----------------------- | ------------------------------------------------------------ |
| `VERCEL_TOKEN`          | Vercel → Account Settings → Tokens                           |
| `VERCEL_ORG_ID`         | `.vercel/project.json` after `vercel link`, or Team Settings |
| `VERCEL_PROJECT_ID_WEB` | web project → Settings → General                             |
| `VERCEL_PROJECT_ID_API` | api project → Settings → General                             |
| `SUPABASE_ACCESS_TOKEN` | `supabase login`, or Account → Access Tokens                 |
| `SUPABASE_DB_PASSWORD`  | database password from project creation                      |
| `SUPABASE_PROJECT_REF`  | the `<ref>` from the dashboard URL                           |

The workflows:

| Workflow      | Trigger                   | Does                                                                                        |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `ci.yml`      | every push and PR         | install, build contracts, typecheck, unit tests, full build                                 |
| `deploy.yml`  | push to `main`, or manual | runs CI, then deploys only the projects whose files changed; verifies API health afterwards |
| `migrate.yml` | **manual only**           | `supabase db push`, with a dry run by default and a typed confirmation                      |

Migrations are deliberately not automatic. This schema carries the RLS policies
that _are_ the authorisation boundary; a half-applied migration during a deploy
is worse than one applied a minute later while you watch. Run `migrate.yml`
(dry run first), then let `deploy.yml` ship the code.

Since deploys go through Actions, turn **off** the Vercel Git integration's
automatic production deploys on both projects (Settings → Git → Ignored Build
Step, or disconnect Git) so the two do not race.

---

## 5. Verify

```bash
curl https://api.everlastlm.com/health/ready     # {"status":"ok","database":true}
curl -I https://everlastlm.com                   # 200, with CSP + HSTS headers
```

Then run the smoke suite against production — it creates and deletes its own
throwaway accounts and notebooks:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon> \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
API_URL=https://api.everlastlm.com \
node scripts/smoke.mjs
```

The last section checks the web app's auth-callback routing and will report
`SKIP` unless a web server is reachable on `localhost:3000`.

Finally, sign up through the UI with a real address and confirm the email
arrives — that path depends on SMTP, which nothing else exercises.

---

## Preview deployments

Preview builds get a `*.vercel.app` origin that is **not** in `WEB_ORIGINS`, so
a preview of the web app cannot call the production API. That is the safe
default: it stops an unreviewed branch from writing to production data.

To let previews talk to a backend, give the API project a _Preview_-scoped
`WEB_ORIGINS` and point previews at a staging Supabase project. Do not widen
production's allowlist to `*.vercel.app` — every preview from every fork would
then be a trusted origin.
