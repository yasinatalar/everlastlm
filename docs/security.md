# Security

What is defended, how, and what is deliberately still open.

---

## Threat model

Everlast stores documents people consider private and answers questions about
them with an LLM. The consequences worth designing against, in order:

1. **Cross-tenant read** — one user seeing another's sources, answers or notes.
2. **Privilege escalation** — a viewer writing, or a member acting as owner.
3. **Server-side request forgery** — the "import from URL" feature used to reach
   cloud metadata, internal services, or the database itself.
4. **Prompt injection** — a document instructing the model to misbehave.
5. **Credential and secret exposure** — keys reaching a browser or a log.
6. **Denial of wallet** — an attacker running up model spend.

---

## Authentication

Supabase Auth issues the session; the browser holds it in **httpOnly, SameSite=Lax
cookies**, so no script can read the refresh token. The browser sends the access
token to the API as a bearer token in an `Authorization` header.

The API verifies tokens **locally** with `jose` (`shared/security/supabase-token.verifier.ts`):

- Signature, issuer (`<SUPABASE_URL>/auth/v1`), audience (`authenticated`) and
  expiry are all checked.
- The algorithm is read from the token header and matched against configured key
  material — HS256 against the project secret for legacy projects, or the
  published JWKS for asymmetric ones. A token is never verified with an
  algorithm the deployment did not configure, which is what closes the
  `alg: none` / algorithm-confusion class.
- `role` must be `authenticated`, and anonymous sessions are refused even though
  they are disabled in config.

Local verification also means the API does not depend on the auth server's
availability for every request.

`SupabaseAuthGuard` is registered **globally**, so a new controller is protected
the moment it is mounted; opting out is an explicit, greppable `@Public()`.

**CSRF is out of scope by construction**: the API authenticates with a bearer
header and is called with `credentials: 'omit'`. There is no ambient credential
for a cross-site request to abuse.

---

## Authorisation — three layers

A request has to pass all three. They are independent, so a bug in one does not
open the door.

### 1. Route policy

Every route carrying `:notebookId` must declare the role it needs with
`@RequiresNotebookRole(...)`. `NotebookAccessGuard` **refuses a route that does
not declare one** rather than allowing it — forgetting to annotate a new endpoint
fails loudly instead of silently exposing data.

### 2. Application check

`NotebookAccessService` resolves the caller's role for the notebook and compares
it against the requirement. The lookup itself runs through the user-scoped
client, so it is subject to RLS too — the application and the database cannot
disagree about who is a member. It also joins `notebooks` to exclude archived
ones, so a kept child id does not outlive its notebook.

A non-member gets **404, not 403**, so the API does not confirm that a notebook
with that id exists. A member who is merely under-privileged does get 403 — they
already know it exists.

### 3. Row level security

Enabled on every table in `public`. Policies are expressed through SECURITY
DEFINER helpers (`is_notebook_member`, `can_edit_notebook`, `is_notebook_owner`)
so that a `notebooks` policy referencing `notebook_members` does not re-enter RLS
and abort with infinite recursion.

Grants are the coarse layer beneath RLS and are explicit
(`20260101000500_grants.sql`) — recent Supabase images grant no DML on new
tables, and stating the verbs next to the policies makes the intent reviewable:

| Table              | `authenticated` may | Why                                                    |
| ------------------ | ------------------- | ------------------------------------------------------ |
| `source_chunks`    | SELECT              | embeddings are written only by the ingestion pipeline  |
| `messages`         | SELECT, INSERT, DELETE | editing a message would invalidate its citations    |
| `studio_artifacts` | SELECT, INSERT, DELETE | artifacts are generated, never hand-edited          |
| `audit_events`     | SELECT              | append-only; owners read, nobody rewrites              |
| `anon`             | nothing             | pre-authentication only                                |

**Service role.** The API holds the service-role key, which bypasses RLS. It is
used in exactly four places, all greppable via `.admin`: the ingestion pipeline
(runs after the response, with no user token in scope), the audit writer (users
must not be able to forge or erase entries), studio generation, and sharing —
which both looks an address up in `profiles` and, when it finds nothing, creates
the invited account through the auth admin API.

**Storage.** Both buckets are private. Object keys are
`{notebookId}/{sourceId}/{filename}`, so a single membership check on the first
path segment authorises the object. Downloads are short-lived signed URLs;
nothing is ever public.

---

## Server-side request forgery

The URL importer is the one place the server fetches an address a user supplies.
`infrastructure/net/safe-http.ts`:

- Only `http:` and `https:`; URLs carrying credentials are refused.
- The hostname is resolved and **every** returned address is checked against
  loopback, RFC1918, carrier-grade NAT, link-local (including
  `169.254.169.254`), multicast, reserved ranges, and their IPv6 equivalents
  including IPv4-mapped forms. One private answer is enough to refuse.
- Redirects are followed manually, at most three hops, and **each hop is
  re-validated** — a public URL that redirects into link-local space is stopped
  at the redirect.
- Response size is capped while streaming, not just by `Content-Length`, which
  can lie or be absent.

**Known residual risk:** a DNS-rebinding window remains between our resolution
and undici's own connect. Closing it needs a custom connector pinned to the
verified IP; that is the right next step before this ever fetches on behalf of
untrusted tenants at scale.

---

## Prompt injection

An uploaded PDF or fetched page is attacker-controlled text, and the model cannot
intrinsically tell it apart from operator instructions. Three mitigations, none
sufficient alone:

1. **Structural separation** — source text is passed as `document` content
   blocks, never interpolated into the system prompt.
2. **An explicit trust boundary** in the system prompt instructing the model to
   treat document content as data and to surface, not obey, embedded
   instructions.
3. **Normalisation** — C0/C1 control characters and Unicode bidi/zero-width
   overrides are stripped from every free-text field before storage or
   prompting. Those invisibles hide text from a human reviewer while remaining
   fully visible to the tokenizer.

**The real containment is capability, not prompting**: the answering model has no
tools, no network access and no write path. The worst a successful injection
achieves is a wrong answer inside a notebook the caller can already read.

---

## Input handling

- Every inbound payload is parsed by an explicit Zod schema from
  `@everlast/contracts`. Zod strips unknown keys, so mass assignment
  (`{"role":"owner"}` smuggled into a profile update) cannot reach a repository.
  This is covered by a smoke-test assertion.
- Uploads are checked for size, MIME type **and leading magic bytes** — a
  browser-supplied `Content-Type` is a hint, not evidence.
- Uploads are held in memory, never written to disk, so there is no window where
  a partially-validated file sits on the filesystem.
- Filenames are sanitised before becoming object keys: path separators, leading
  dots and non-word characters are removed.
- `ilike` search terms have their LIKE metacharacters escaped.

---

## Browser hardening

`Content-Security-Policy` is built **per request with a nonce** in
`apps/web/src/proxy.ts`:

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
connect-src 'self' <api-origin> <supabase-origin>;
frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
```

`connect-src` is the load-bearing directive: the browser may reach exactly two
origins, so injected script has nowhere to exfiltrate to.

> A static `script-src 'self'` was tried first and is a trap worth recording: the
> App Router bootstraps hydration from an inline script, so the policy renders
> the page and then leaves it completely inert — HTML arrives, nothing is
> interactive, and forms silently fall back to native GET submits. It looks like
> a React bug, not a CSP one.

**Known concession:** `style-src 'unsafe-inline'`. React writes inline styles
while streaming and Next does not nonce them. Adding a nonce to `style-src` would
*disable* `'unsafe-inline'` (a nonce beats it in the CSP algorithm) and break
rendering, so the two are not combined.

Also set: `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`X-Frame-Options: DENY`, `Permissions-Policy` (camera/mic/geolocation off), and
HSTS with preload in production.

The API sets its own, stricter policy — it serves no HTML, so
`default-src 'none'` applies, plus a CORS **allowlist** with no wildcard and
`credentials: false`.

---

## Rate limiting and cost

Two budgets, tracked **per authenticated user** rather than per IP — colleagues
behind one office NAT would otherwise share a budget, while an attacker with an
address pool would get a fresh one per address:

| Limiter   | Default    | Applies to                                       |
| --------- | ---------- | ------------------------------------------------ |
| `default` | 120/min    | everything                                       |
| `ai`      | 20/min     | routes marked `@AiRateLimited()` — chat, studio, source ingest, sharing |

Named throttlers otherwise apply to every route, so the `ai` limiter uses a
`skipIf` that opts out unless the handler is marked.

Also bounded: 50 MB per upload, 300 sources per notebook, 10 MB per fetched page,
and a character budget on the studio prompt corpus.

---

## Sharing and invitations

Sharing takes an email address and grants it access whether or not it has an
account. An address with no account gets one created for it — passwordless,
unconfirmed — and Supabase mails it an invitation; the membership row is written
either way, so the notebook is there when the link is opened.

**This removed an account-existence oracle rather than adding one.** Sharing used
to answer "no such account" for an address nobody had signed up with, which let
any notebook owner test addresses one at a time. Both branches now return the
same 201 and the same shape, so the response says nothing about who has an
account. What the caller learns is the same thing anyone learns by sending mail
to an address: nothing.

**What that trades for.** The endpoint can now put this product's name in a
stranger's inbox, so it carries the `ai` limiter (20/min per user) rather than
the default one, Supabase's own `email_sent` cap applies underneath, and every
call is written to `audit_events` as `notebook.invitation_sent` with the actor.
Unsolicited mail is therefore attributable and bounded, not prevented — the same
position every collaboration product is in.

**Redemption.** The link in the mail points at `/auth/invite` on our own domain
carrying a single-use `token_hash`, not at Supabase's `/verify`. That endpoint
hands the session back in a URL *fragment*, which would leave tokens in browser
history and in any `Referer` the landing page emits, and which no server can read
— so the app could not sign the invitee in at all. Exchanging the hash in a Route
Handler keeps the whole handshake server-side and puts the session straight into
httpOnly cookies. It also means an invitation link needs no entry in Supabase's
redirect allowlist, so that list stays as narrow as the deployment checklist
below asks for.

An invitation is single-use and expires in 15 minutes (`otp_expiry`). Until it is
opened the account it created has no password and no confirmed address, so
nobody — including whoever was invited — can sign in to it. The member list marks
those memberships **pending** from `profiles.confirmed_at`, a mirror of
`auth.users.confirmed_at` maintained by trigger.

That column has to be trustworthy, so `20260101000600` narrows the table-wide
`UPDATE` grant on `profiles` to the columns a profile actually owns
(`display_name`, `avatar_url`, `locale`, `theme`). Without that, RLS would
happily let anyone mark their own invitation accepted — and rewrite the mirrored
`email` that sharing looks addresses up by, which was already reachable before
this column existed.

---

## Audit and observability

`audit_events` is append-only from the application's perspective: `authenticated`
holds SELECT and nothing else, and writes go through the service role. Owners can
read their notebook's history; nobody can rewrite it. Recorded actions include
notebook lifecycle, membership changes, source add/delete, chat answers, and
studio generation — each with actor, IP, user agent and request id.

Every response carries `X-Request-Id`, and every log line carries the same id, so
a user-reported failure maps to the server log that has the detail.

**Errors never leak internals.** `DomainExceptionFilter` is the single exit point:
only `DomainError` subclasses and `HttpException` produce a described response,
and anything else becomes a bare 500. Ingestion failures shown to a user are
domain phrases — the vendor's `"voyage responded 401: Provided API key is
invalid"` stays in the log, which is asserted in the smoke test.

Logs redact `authorization`, `cookie`, `x-api-key` and `set-cookie` at the
transport, so a trace-level log cannot spill a session.

---

## Availability

Background work (ingestion, studio generation) runs detached from any request, so
a rejection there has no HTTP handler to catch it. `main.ts` installs process
guards: a rejected promise is logged and the process continues; an uncaught
exception is logged and the process exits for a supervisor to restart cleanly.

> Recorded because it was a live crash: discarding an undici response body with
> `.destroy()` emits an `'error'` event, and an unhandled `'error'` event
> terminates Node. A URL source that returned 404 took the whole API down. Bodies
> are now discarded through a helper that attaches a listener first, with a
> regression test.

---

## Deployment checklist

- [ ] `WEB_ORIGINS` lists only real origins (`https://everlastlm.com`) — no wildcards
- [ ] `ALLOW_PRIVATE_NETWORK_FETCH=false` (it disables the SSRF guard)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only on the API, never on the web app
- [ ] No `NEXT_PUBLIC_*` variable holds a secret — they ship to the browser
- [ ] `NODE_ENV=production` so HSTS is sent and dev CSP allowances are dropped
- [ ] Supabase Auth: email confirmation on, refresh-token rotation on, session
      timebox set, and the site URL/redirect allowlist restricted to your domains
- [ ] Enable MFA for owners and apply `@RequiresMfa()` to the routes you want
      gated behind a second factor
- [ ] Review `supabase db lint` output and re-run the smoke test against staging
