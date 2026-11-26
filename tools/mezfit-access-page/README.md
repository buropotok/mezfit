# Mezfit access check (static GitHub Pages test)

Independent, dependency-free landing page for checking whether the visitor's
browser can reach both `https://mezfit.online/` and the Telegram Login SDK at
`https://oauth.telegram.org/js/telegram-login.js?6`.

The page is deliberately standalone: no React, Konsta/UIkit runtime, Dexie,
service-worker, app bundle, external stylesheet or font CDN is loaded.
This is necessary to keep the troubleshooting entry point separate from the
site it diagnoses. Its typography follows Mezfit's documented semantic sizes
where appropriate, while its visual language is clean, light and Google-like.

## Deployment without changing production hosting

The existing `deploy-gif-review-pages.yml` job already owns this repository's
GitHub Pages publication. The job now copies these three static files into
`access-test/` alongside the existing review site. It does **not** overwrite
the review root, create a second competing Pages deployment or change DNS.

After this change is merged to `main` and that Pages deployment succeeds,
open:

`https://buropotok.github.io/mezfit/access-test/`

This is a test location only. Do **not** point `mezfit.ru` at this repository
Pages site yet: the root path currently belongs to the GIF review tool. For a
public `mezfit.ru` entry point, move the same three static files into an
isolated Pages repository or another separately hosted static site first.

## What it checks

- Runs two **credentialless** browser `GET` requests with `mode: no-cors`.
- A completed opaque response counts as **network connectivity only**.
  The browser cannot read cross-origin HTTP status without appropriate CORS;
  an opaque response can mask an HTTP error, so the check is not proof that
  the application, SDK execution or the Telegram OAuth flow works.
- A network error or 6.5-second timeout shows a contextual warning.
  A restrictive proxy/CORP policy can cause a false negative.
- Both checks start on page load. A manual retry is provided; returning to the
  tab after changing VPN may trigger another check after 30 seconds.
- VPN advice appears **only** if the app connectivity check fails. A foreign
  IP is not used as an indicator of VPN.
- The Telegram entry option is visible only when both connectivity checks
  succeed. It links to the current app, where Telegram login actually occurs.
  A direct attempt to open Mezfit stays available even after a failed check.
- The page never accepts credentials, creates a session, stores test results,
  loads the Telegram SDK for execution or claims to replace the current login.
  Username/password login is a separate **not yet implemented** backend feature.
- There are no tracking or analytics scripts. Remote HTTP providers may still
  receive normal connection metadata such as visitor IP addresses.

## Pre-release manual browser checklist

Check the actual GitHub Pages URL (not a local file) with and without VPN,
including BlackTemple and BlancVPN. Confirm the two service states, the
timeout message, the manual retry, direct navigation, and recheck after
switching VPN. Verify mobile Chrome and desktop browser layout, keyboard
navigation and that no passwords are requested.

The optional source-only contract check is
`node --test tools/mezfit-access-page/check-access.mjs`, executed in CI
for the PR. Per repository rules, no local tests or npm commands are run by
the author before PR creation.
