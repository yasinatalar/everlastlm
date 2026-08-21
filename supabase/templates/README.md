# Auth email templates

The six messages Supabase sends on Everlast's behalf, in Everlast's colours
rather than Supabase's defaults.

| Supabase key       | File                    | Sent when                                          |
| ------------------ | ----------------------- | -------------------------------------------------- |
| `confirmation`     | `confirmation.html`     | Someone signs up                                   |
| `invite`           | `invite.html`           | A notebook is shared with a new address            |
| `magic_link`       | `magic-link.html`       | Passwordless sign-in                               |
| `recovery`         | `recovery.html`         | Password reset                                     |
| `email_change`     | `email-change.html`     | Account email changes (goes to **both** addresses) |
| `reauthentication` | `reauthentication.html` | A sensitive change needs a code                    |

## Don't edit these files

They are generated. Copy and subject lines live in
[`scripts/build-email-templates.mjs`](../../scripts/build-email-templates.mjs),
which holds one layout and six pieces of content. Edit there, then:

```bash
pnpm email:build                # rewrite the six templates
pnpm email:build --preview      # …and a gallery at supabase/templates/preview.html
```

`preview.html` renders all six light and dark from the real HTML, with sample
values filled in for the `{{ .Token }}`-style placeholders. It is gitignored —
regenerate it whenever you want to look. Open it over `file://`; no server
needed.

## Getting them into Supabase

**Locally** nothing to do — `config.toml` already points `content_path` at these
files, so `supabase start` picks them up and mail lands in Mailpit at
http://127.0.0.1:54324.

**In production** `content_path` is not read at all — a deployed project has
never seen this repository. Two ways to get the templates there.

### `pnpm email:push` (repeatable)

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...        # supabase.com/dashboard/account/tokens
pnpm email:push --ref <project-ref>         # prints a diff, sends nothing
pnpm email:push --ref <project-ref> --yes   # applies it
```

It sends the six subjects and six bodies over the Management API and reads them
back to confirm they took. Nothing else on the project is touched.

> **Not `supabase config push`.** That command would also work, but it applies
> the whole `[auth]` block — and ours is written for local development, with
> `site_url = "http://localhost:3000"`. Pushing it at production would point
> every confirmation link on the live site at somebody's laptop.

The access token has full control of every project on the account. Keep it out
of the repository and out of shell history.

### The dashboard (once, by hand)

**Authentication → Emails**, one tab per template. For each, paste the file into
the message body and copy the subject from `config.toml`, matching the key in
the table above. Repeat after every change — which is the reason the script
exists.

> Custom SMTP has to be configured first, or the mail only reaches addresses on
> your Supabase team and stops after two per hour. See
> [docs/deployment.md](../../docs/deployment.md).

## What the design assumes

- **Acid green appears exactly twice** — the logo square and the one primary
  action. That is the rule from `globals.css`, and it is what keeps these
  reading as product mail rather than marketing mail.
- **Everything load-bearing is an inline style.** The single `<style>` block
  carries only the responsive tweaks and dark mode; a client that strips it
  still renders the light design intact.
- **Dark mode is written twice** — once under `prefers-color-scheme`, once under
  `[data-ogsc]`, because Outlook.com deletes the first and applies the second.
- **The logo is HTML, not an image**, so it survives the image blocking that is
  on by default in most clients.
- **Outlook gets VML** for the one rounded button, since the Word rendering
  engine has no `border-radius`.
- `{{ .Token }}` is **8 digits**, not the usual 6 — `otp_length = 8` in
  `config.toml`. Change one and change the other.
