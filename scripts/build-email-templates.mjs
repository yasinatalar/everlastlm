/**
 * Renders the Supabase auth emails into `supabase/templates/*.html`.
 *
 * Six templates share one layout, so the layout lives here once and the copy
 * lives in `EMAILS` below. Edit either and run `pnpm email:build`; the output
 * files are committed so they can be pasted straight into the Supabase
 * dashboard without anyone needing Node.
 *
 * Everything here is shaped by two constraints that do not apply to the web app:
 *
 * 1. **Mail clients are not browsers.** Outlook renders through Word, which has
 *    no flexbox, no grid and no `border-radius`; Gmail strips anything it does
 *    not recognise. So: tables for layout, styles inlined on every element, and
 *    a VML fallback so the one rounded button survives Outlook. The `<style>`
 *    block carries only the parts that *may* be dropped without hurting —
 *    responsive tweaks and dark mode.
 *
 * 2. **Brand discipline from `globals.css` still holds.** Acid green is never a
 *    surface and never body text. It appears exactly twice in each mail: the
 *    logo square, and the single primary action. That restraint is the whole
 *    reason these read as product mail rather than marketing mail.
 *
 * The `{{ .Thing }}` placeholders are Go templates that Supabase substitutes at
 * send time — leave them exactly as written. `{{ .Token }}` is 8 digits here,
 * not the usual 6, because `otp_length = 8` in config.toml.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'supabase/templates');

/** Straight from `globals.css` — the light theme, plus its dark counterpart. */
const c = {
  bg: '#f7f6f2',
  card: '#fdfdfb',
  sunken: '#eeece6',
  border: '#dedbd3',
  ink: '#16181a',
  body: '#4a5057',
  muted: '#656f79',
  subtle: '#818b94',
  acid: '#c2f050',
  dark: {
    bg: '#101214',
    card: '#1c1f22',
    sunken: '#141719',
    border: '#2c3034',
    ink: '#f2f1ed',
    body: '#abb2b9',
    muted: '#818b94',
    subtle: '#656f79',
  },
};

const FONT =
  "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace";

/**
 * Outlook cannot measure a button, so VML needs the width in pixels up front.
 * Inter at 15px/600 averages a hair over 8px per character; the padding is 56.
 * Only Outlook sees this number — everywhere else the button sizes itself.
 */
const msoWidth = (label) => Math.round(label.length * 8.4 + 56);

/** A 30px acid square with the three-bar mark, drawn in HTML so it can't be blocked like an image. */
const bar = (width) =>
  `<div style="height:2px;width:${width};background-color:${c.ink};border-radius:1px;font-size:0;line-height:2px;mso-line-height-rule:exactly;">&nbsp;</div>`;
const gap = `<div style="height:3px;font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</div>`;

const wordmark = (size) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td width="30" height="30" align="center" valign="middle" bgcolor="${c.acid}" style="width:30px;height:30px;background-color:${c.acid};border-radius:9px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="16" style="width:16px;"><tr><td style="font-size:0;line-height:0;">
                    ${bar('100%')}${gap}${bar('11px')}${gap}${bar('100%')}
                  </td></tr></table>
                </td>
                <td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>
                <td valign="middle" class="t-strong" style="font-family:${FONT};font-size:${size}px;font-weight:600;letter-spacing:-0.02em;color:${c.ink};">Everlast</td>
              </tr></table>`;

/** A bulletproof button: VML for Outlook, a padded anchor for everyone else. */
const button = (label, url) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td align="left">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:${msoWidth(label)}px;" arcsize="21%" stroke="f" fillcolor="${c.acid}">
                  <w:anchorlock/>
                  <center style="color:${c.ink};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-- -->
                <a class="btn" href="${url}" style="display:inline-block;background-color:${c.acid};color:${c.ink};font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:-0.01em;line-height:20px;text-decoration:none;padding:14px 28px;border-radius:10px;mso-hide:all;">${label}</a>
                <!--<![endif]-->
              </td></tr></table>`;

/** The OTP, big and spaced so it survives being read off a phone. */
const codeBlock = (caption) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                <td class="sunken" align="center" bgcolor="${c.sunken}" style="background-color:${c.sunken};border:1px solid ${c.border};border-radius:12px;padding:22px 16px;">
                  <div class="t-muted" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${c.muted};padding-bottom:10px;">${caption}</div>
                  <div class="t-strong" style="font-family:${MONO};font-size:30px;font-weight:600;letter-spacing:0.16em;line-height:36px;color:${c.ink};mso-line-height-rule:exactly;">{{ .Token }}</div>
                </td>
              </tr></table>`;

/** The copy-me-instead link, for clients that mangle the button. */
const fallback = (url) => `
                  <div style="height:24px;font-size:0;line-height:24px;">&nbsp;</div>
              <div class="t-subtle" style="font-family:${FONT};font-size:12px;line-height:18px;color:${c.subtle};padding-bottom:6px;">Button not working? Paste this into your browser:</div>
              <div style="font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all;"><a class="t-muted" href="${url}" style="color:${c.muted};text-decoration:underline;">${url}</a></div>`;

const paragraph = (html) =>
  `<p class="t-body" style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${c.body};">${html}</p>`;

/**
 * The dark palette, written once and emitted twice: unprefixed inside the
 * `prefers-color-scheme` query, and prefixed with `[data-ogsc]` because
 * Outlook.com strips the query and re-tags the document with that attribute
 * instead. Two syntaxes, one set of colours.
 */
const darkRules = (p) => `      ${p}.bg, ${p}.bg-td { background-color:${c.dark.bg} !important; }
      ${p}.card { background-color:${c.dark.card} !important; border-color:${c.dark.border} !important; }
      ${p}.sunken { background-color:${c.dark.sunken} !important; border-color:${c.dark.border} !important; }
      ${p}.rule { background-color:${c.dark.border} !important; }
      ${p}.t-strong { color:${c.dark.ink} !important; }
      ${p}.t-body { color:${c.dark.body} !important; }
      ${p}.t-muted { color:${c.dark.muted} !important; }
      ${p}.t-subtle { color:${c.dark.subtle} !important; }`;

/**
 * The only stylesheet in the mail. Everything load-bearing is inlined on the
 * elements themselves; this block holds just the two things that cannot be —
 * media queries and dark mode — so a client that drops it still renders the
 * light design intact.
 *
 * The preview passes `colorSchemeQuery: false`: with the query left in, a
 * reviewer on a dark OS would see *both* preview columns go dark and could not
 * check the light design at all.
 */
function emailCss({ colorSchemeQuery }) {
  return `    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
    table { border-collapse:collapse; }
    img { border:0; outline:none; text-decoration:none; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }

    @media only screen and (max-width:600px) {
      .pad { padding-left:26px !important; padding-right:26px !important; }
      .pad-y { padding-top:32px !important; padding-bottom:32px !important; }
      .h1 { font-size:23px !important; line-height:30px !important; }
      .btn { display:block !important; text-align:center !important; }
    }

${
  colorSchemeQuery
    ? `    /* Apple Mail, Outlook for Mac/iOS and the Gmail app honour this; every
       other client keeps the light palette, which is why light is what the
       inline styles say. */
    @media (prefers-color-scheme: dark) {
${darkRules('')}
    }
`
    : ''
}    /* Outlook.com deletes the query above and sets this attribute instead. */
${darkRules('[data-ogsc] ')}
`;
}

/**
 * @param {{preheader:string, eyebrow:string, heading:string, lede:string[],
 *          action?:{label:string,url:string}, code?:string, note:string}} m
 */
function render(m) {
  const blocks = [];

  if (m.action) blocks.push(button(m.action.label, m.action.url));
  if (m.code) blocks.push(codeBlock(m.code));

  return `<!doctype html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${m.eyebrow} — Everlast</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
${emailCss({ colorSchemeQuery: true })}  </style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${c.bg};">
  <!-- Preview text: what the inbox list shows. The spacer stops the body copy
       from bleeding in after it. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.bg};opacity:0;">${m.preheader}&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;</div>

  <table role="presentation" class="bg-td" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${c.bg}" style="background-color:${c.bg};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- 100% + max-width, never width="560": a fixed width cannot shrink,
             and a phone would scroll sideways for the last 100px of every line.
             Outlook ignores max-width, which is why the wrapper below it is
             capped for MSO separately. -->
        <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"><tr><td><![endif]-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:560px;">

          <!-- Logo, outside the card so the card can start with the message. -->
          <tr><td style="padding:0 4px 22px;">${wordmark(16)}</td></tr>

          <tr>
            <td class="card" bgcolor="${c.card}" style="background-color:${c.card};border:1px solid ${c.border};border-radius:14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td class="pad pad-y" style="padding:40px;">

                  <div class="t-muted" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${c.muted};padding-bottom:12px;">${m.eyebrow}</div>

                  <h1 class="h1 t-strong" style="margin:0 0 16px;font-family:${FONT};font-size:27px;font-weight:600;letter-spacing:-0.025em;line-height:34px;color:${c.ink};mso-line-height-rule:exactly;">${m.heading}</h1>

                  ${m.lede.map(paragraph).join('\n                  ')}

                  <div style="height:10px;font-size:0;line-height:10px;">&nbsp;</div>
${blocks.join('\n                  <div style="height:20px;font-size:0;line-height:20px;">&nbsp;</div>\n')}

                  <div class="rule" style="height:1px;background-color:${c.border};font-size:0;line-height:1px;margin:32px 0 20px;">&nbsp;</div>

                  <div class="t-subtle" style="font-family:${FONT};font-size:13px;line-height:20px;color:${c.subtle};">${m.note}</div>

                </td></tr>
              </table>
            </td>
          </tr>

          <tr><td class="pad" style="padding:24px 4px 0;">
            <div class="t-subtle" style="font-family:${FONT};font-size:12px;line-height:19px;color:${c.subtle};">
              <a class="t-muted" href="{{ .SiteURL }}" style="color:${c.muted};text-decoration:none;font-weight:600;">Everlast</a>
              &nbsp;·&nbsp; Your sources, your questions, answers you can trace back.
              <br>${m.footerNote ?? 'Sent to {{ .Email }} — an automated message about your account, never marketing.'}
            </div>
          </td></tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Subject lines live here so the preview can show them, but Supabase reads them
 * from `config.toml` (locally) or the dashboard (in production). Keep the three
 * in step — `--check` compares this map against config.toml and complains.
 */
const SUBJECTS = {
  confirmation: 'Confirm your email for Everlast',
  invite: 'You have been invited to a notebook on Everlast',
  magic_link: 'Your Everlast sign-in link',
  recovery: 'Reset your Everlast password',
  email_change: 'Confirm your new email address for Everlast',
  reauthentication: 'Your Everlast confirmation code',
};

/** One entry per Supabase template key. */
const EMAILS = {
  confirmation: {
    file: 'confirmation.html',
    preheader: 'Confirm your address and your first notebook is ready.',
    eyebrow: 'Confirm your email',
    heading: 'Welcome to Everlast.',
    lede: [
      'You are one click from your first notebook. Confirm this address and you can start dropping in sources — PDFs, pages, notes — and asking questions that get answered from them, with citations back to the exact passage.',
    ],
    action: { label: 'Confirm email address', url: '{{ .ConfirmationURL }}' },
    code: 'Or enter this code',
    note: 'This link and code expire in 15 minutes and work once. If you did not sign up for Everlast, nothing was created — you can ignore this email.',
    fallbackUrl: '{{ .ConfirmationURL }}',
  },

  invite: {
    file: 'invite.html',
    preheader: 'A notebook on Everlast has been shared with you.',
    eyebrow: 'Notebook invitation',
    heading: "You've been invited to a notebook.",
    lede: [
      'Someone shared an Everlast notebook with you — their sources, and every answer grounded in them. Accept below to set up your account and open it.',
      'You will only ever see the notebook you were invited to.',
    ],
    action: { label: 'Accept invitation', url: '{{ .ConfirmationURL }}' },
    note: 'This invitation expires in 15 minutes. If you were not expecting it, you can ignore this email and no account will be created.',
    fallbackUrl: '{{ .ConfirmationURL }}',
  },

  magic_link: {
    file: 'magic-link.html',
    preheader: 'Your sign-in link for Everlast.',
    eyebrow: 'Sign in',
    heading: "Here's your sign-in link.",
    lede: ['Open Everlast on this device — no password needed.'],
    action: { label: 'Sign in to Everlast', url: '{{ .ConfirmationURL }}' },
    code: 'Or enter this code',
    note: 'Valid for 15 minutes, single use. If you did not ask to sign in, ignore this email — the link does nothing until someone opens it, and only you have it.',
    fallbackUrl: '{{ .ConfirmationURL }}',
  },

  recovery: {
    file: 'recovery.html',
    preheader: 'Reset the password on your Everlast account.',
    eyebrow: 'Password reset',
    heading: "Let's get you back in.",
    lede: [
      'We received a request to reset the password for <span class="t-strong" style="color:#16181a;font-weight:600;">{{ .Email }}</span>. Choose a new one below.',
    ],
    action: { label: 'Choose a new password', url: '{{ .ConfirmationURL }}' },
    code: 'Or enter this code',
    note: 'This link expires in 15 minutes. If you did not request a reset, your password has not changed and there is nothing to do — but it is worth signing in to check nobody else knows it.',
    fallbackUrl: '{{ .ConfirmationURL }}',
  },

  email_change: {
    file: 'email-change.html',
    preheader: 'Confirm the new email address on your Everlast account.',
    eyebrow: 'Email change',
    heading: 'Confirm this change.',
    lede: [
      'A request was made to move your Everlast account from <span class="t-strong" style="color:#16181a;font-weight:600;">{{ .Email }}</span> to <span class="t-strong" style="color:#16181a;font-weight:600;">{{ .NewEmail }}</span>.',
      // double_confirm_changes = true, so this mail lands in both inboxes and
      // both have to act. Saying so prevents a support ticket.
      'For safety this has to be confirmed from <em>both</em> addresses, so you will find this message in each inbox. The change takes effect once both are confirmed.',
    ],
    action: { label: 'Confirm email change', url: '{{ .ConfirmationURL }}' },
    code: 'Or enter this code',
    note: 'This link expires in 15 minutes. If you did not request this change, do not confirm it — the change cannot complete without you, and your account stays on its current address.',
    fallbackUrl: '{{ .ConfirmationURL }}',
    // This mail goes to the old *and* the new address, so `.Email` would name
    // the wrong one in half the copies. Say nothing rather than something wrong.
    footerNote: 'An automated message about your account, never marketing.',
  },

  // No ConfirmationURL exists for this one; the code is the whole message.
  reauthentication: {
    file: 'reauthentication.html',
    preheader: 'Your Everlast confirmation code.',
    eyebrow: 'Security check',
    heading: "Confirm it's you.",
    lede: ['Enter this code in Everlast to confirm the change you just started.'],
    code: 'Confirmation code',
    note: 'This code expires in 15 minutes. If you did not just do something in Everlast, someone else may have your password — change it now.',
    // Reauthentication runs on an already-signed-in session, and Supabase does
    // not document `.Email` as being in scope for it. Don't risk a blank.
    footerNote: 'An automated message about your account, never marketing.',
  },
};

mkdirSync(outDir, { recursive: true });

const built = [];

for (const [key, m] of Object.entries(EMAILS)) {
  let html = render(m);
  // The fallback link is appended inside the card, under the action block.
  if (m.fallbackUrl) {
    html = html.replace(
      '<div class="rule"',
      `${fallback(m.fallbackUrl)}\n\n                  <div class="rule"`,
    );
  }
  writeFileSync(join(outDir, m.file), html, 'utf8');
  built.push({ key, m, html });
  console.log(`  ${key.padEnd(17)} → supabase/templates/${m.file}`);
}

console.log(`\n${built.length} templates written.`);

/* -------------------------------------------------------------- config drift */

/**
 * `config.toml` is what the local CLI actually reads, and it is edited by hand,
 * so it drifts. Compare it against this file and say so. Only `--check` fails
 * the build — a plain build just warns, because a mismatch does not make the
 * HTML wrong.
 */
{
  const toml = readFileSync(join(repo, 'supabase/config.toml'), 'utf8');
  const problems = [];

  for (const [key, m] of Object.entries(EMAILS)) {
    const section = toml.match(new RegExp(`\\[auth\\.email\\.template\\.${key}\\]([^[]*)`))?.[1];
    if (!section) {
      problems.push(`config.toml has no [auth.email.template.${key}] section`);
      continue;
    }
    const subject = section.match(/subject\s*=\s*"([^"]*)"/)?.[1];
    const path = section.match(/content_path\s*=\s*"([^"]*)"/)?.[1];
    if (subject !== SUBJECTS[key]) {
      problems.push(`${key}: subject is "${subject}", expected "${SUBJECTS[key]}"`);
    }
    if (path !== `./supabase/templates/${m.file}`) {
      problems.push(`${key}: content_path is "${path}", expected "./supabase/templates/${m.file}"`);
    }
  }

  if (problems.length) {
    console.error(`\nconfig.toml is out of step:`);
    for (const p of problems) console.error(`  · ${p}`);
    if (process.argv.includes('--check')) process.exit(1);
  }
}

/* ------------------------------------------------------------------ preview */

/**
 * `--preview` writes a browsable gallery of all six, light and dark, next to
 * the templates. It is generated rather than committed because it inlines every
 * template twice over; regenerate it whenever you want to look.
 *
 * Each mail is mounted in a shadow root rather than an iframe: shadow DOM scopes
 * the `<style>` block exactly the way a mail client's own document would, but
 * the content still flows to its natural height, so there is no frame to
 * measure. The dark column works by setting `data-ogsc` on a wrapper — the same
 * attribute Outlook.com sets, so the preview exercises the real dark-mode rules
 * instead of an approximation of them.
 */
if (process.argv.includes('--preview')) {
  const SAMPLE = {
    '{{ .ConfirmationURL }}':
      'https://everlastlm.com/auth/callback?token_hash=pkce_c7d41f9ab2e58&type=signup&next=%2F',
    '{{ .Token }}': '48210673',
    '{{ .NewEmail }}': 'ada@newdomain.com',
    '{{ .Email }}': 'ada@example.com',
    '{{ .SiteURL }}': 'https://everlastlm.com',
  };

  const fill = (s) => Object.entries(SAMPLE).reduce((acc, [k, v]) => acc.split(k).join(v), s);

  const css = emailCss({ colorSchemeQuery: false });
  const data = built.map(({ key, m, html }) => ({
    key,
    file: m.file,
    subject: SUBJECTS[key],
    preheader: fill(m.preheader),
    css,
    body: fill(html).match(/<body[^>]*>([\s\S]*?)<\/body>/)[1],
  }));

  const payload = JSON.stringify(data).replace(/<\//g, '<\\/');
  writeFileSync(
    join(outDir, 'preview.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>Everlast auth emails</title>',
      previewStyles(),
      '</head>',
      '<body>',
      previewMarkup(payload),
      '</body>',
      '</html>',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log('  preview           → supabase/templates/preview.html');
}

/**
 * Chrome for the preview page. Nothing here ships in an email — the mails
 * themselves are rendered untouched inside shadow roots.
 *
 * Inter is loaded for real here, which the mails cannot do: a client renders
 * them in whatever the fallback stack resolves to. Close enough on Apple
 * platforms (SF), a little wider elsewhere.
 */
function previewStyles() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>
  :root {
    --p-bg:${c.bg}; --p-surface:${c.card}; --p-sunken:${c.sunken};
    --p-border:${c.border}; --p-ink:${c.ink}; --p-muted:${c.muted};
    --p-subtle:${c.subtle}; --p-acid:${c.acid}; --p-acid-text:#5c7d0f;
  }
  :root:not([data-theme="light"]) {
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --p-bg:#16181a; --p-surface:#24272b; --p-sunken:#101214;
      --p-border:#2c3034; --p-ink:#f2f1ed; --p-muted:#818b94;
      --p-subtle:#656f79; --p-acid-text:${c.acid};
    }
  }
  :root[data-theme="dark"] {
    --p-bg:#16181a; --p-surface:#24272b; --p-sunken:#101214;
    --p-border:#2c3034; --p-ink:#f2f1ed; --p-muted:#818b94;
    --p-subtle:#656f79; --p-acid-text:${c.acid};
  }

  * { box-sizing: border-box; }
  body {
    margin:0; background:var(--p-bg); color:var(--p-ink);
    font-family:${FONT}; -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1360px; margin:0 auto; padding:56px 24px 96px; }

  .mark { display:inline-grid; place-items:center; width:26px; height:26px;
          border-radius:8px; background:var(--p-acid); }
  .mark span { display:block; height:2px; border-radius:1px; background:${c.ink}; }
  .mark div { width:14px; display:grid; gap:3px; }
  .lockup { display:flex; align-items:center; gap:9px; font-weight:600;
            font-size:15px; letter-spacing:-0.02em; }

  h1 { font-size:38px; line-height:1.1; letter-spacing:-0.035em; font-weight:600;
       margin:28px 0 12px; text-wrap:balance; }
  a:focus-visible, .mount:focus-visible { outline:2px solid ${c.acid}; outline-offset:3px;
                                          border-radius:4px; }
  .lede { max-width:56ch; margin:0; color:var(--p-muted); font-size:15px; line-height:1.65; }
  .lede code { font-family:${MONO}; font-size:13px; background:var(--p-sunken);
               border:1px solid var(--p-border); border-radius:5px; padding:1px 5px; }

  .rule { height:1px; background:var(--p-border); margin:48px 0; }

  .mail { margin:0 0 72px; }
  .inbox {
    display:flex; gap:12px; align-items:flex-start; padding:14px 16px;
    background:var(--p-surface); border:1px solid var(--p-border);
    border-radius:12px; max-width:640px; margin-bottom:10px;
  }
  .avatar { flex:none; width:30px; height:30px; border-radius:9px;
            background:var(--p-acid); display:grid; place-items:center; }
  .avatar div { width:16px; display:grid; gap:3px; }
  .avatar span { display:block; height:2px; border-radius:1px; background:${c.ink}; }
  .inbox .from { font-size:13px; font-weight:600; letter-spacing:-0.01em; }
  .inbox .subj { font-size:14px; font-weight:600; letter-spacing:-0.015em; margin-top:2px; }
  .inbox .pre { font-size:13px; color:var(--p-subtle); margin-top:2px; line-height:1.4; }

  .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:18px; }
  .tag { font-family:${MONO}; font-size:11.5px; padding:3px 8px; border-radius:999px;
         border:1px solid var(--p-border); background:var(--p-sunken); color:var(--p-muted); }
  .tag.key { color:var(--p-acid-text); border-color:currentColor; background:transparent; }

  .cols { display:grid; gap:20px; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
  figure { margin:0; }
  figcaption { font-size:11px; font-weight:600; letter-spacing:0.08em;
               text-transform:uppercase; color:var(--p-subtle); padding:0 0 8px 2px; }
  .mount { border:1px solid var(--p-border); border-radius:14px; overflow:auto; }

  footer { color:var(--p-subtle); font-size:13px; line-height:1.7; max-width:60ch; }
  footer a { color:var(--p-acid-text); }
</style>`;
}

function previewMarkup(payload) {
  const bars = '<div><span></span><span style="width:11px"></span><span></span></div>';
  return `<div class="wrap">
  <header>
    <div class="lockup"><span class="mark">${bars}</span>Everlast</div>
    <h1>Auth emails.</h1>
    <p class="lede">The six messages Supabase sends on your behalf, rendered light and
      dark from the exact HTML in <code>supabase/templates/</code>. Sample values stand
      in for the <code>{{ .Token }}</code>-style placeholders; the dark column is driven
      by the same rules Outlook.com and Apple Mail apply.</p>
  </header>
  <div class="rule"></div>
  <main id="gallery"></main>
  <div class="rule"></div>
  <footer>
    Regenerate with <code>pnpm email:build --preview</code>. Local mail lands in
    Mailpit at <a href="http://127.0.0.1:54324">127.0.0.1:54324</a>.
  </footer>
</div>
<script>
  const MAILS = ${payload};
  const BARS = ${JSON.stringify(bars)};

  /* Shadow roots, not iframes: the mail's own <style> is scoped exactly as a
     client would scope it, but the content still flows to its natural height,
     so there is nothing to measure and nothing to scroll inside. */
  function mount(host, mail, dark) {
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>:host{display:block}' + mail.css + '</style>' +
      '<div' + (dark ? ' data-ogsc' : '') + '>' + mail.body + '</div>';
  }

  document.getElementById('gallery').innerHTML = MAILS.map(function (mail) {
    return '<section class="mail">' +
      '<div class="inbox">' +
        '<span class="avatar">' + BARS + '</span>' +
        '<div><div class="from">Everlast</div>' +
        '<div class="subj">' + mail.subject + '</div>' +
        '<div class="pre">' + mail.preheader + '</div></div>' +
      '</div>' +
      '<div class="meta">' +
        '<span class="tag key">' + mail.key + '</span>' +
        '<span class="tag">' + mail.file + '</span>' +
      '</div>' +
      '<div class="cols">' +
        '<figure><figcaption>Light</figcaption><div class="mount" data-key="' + mail.key + '" data-dark="0"></div></figure>' +
        '<figure><figcaption>Dark</figcaption><div class="mount" data-key="' + mail.key + '" data-dark="1"></div></figure>' +
      '</div>' +
    '</section>';
  }).join('');

  document.querySelectorAll('.mount').forEach(function (host) {
    const mail = MAILS.find(function (m) { return m.key === host.dataset.key; });
    mount(host, mail, host.dataset.dark === '1');
  });
</script>`;
}
