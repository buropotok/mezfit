# MezFit: second domain (mezfit.online) alongside mezfit.ru

**Decision:** Use `https://mezfit.online` as the preferred public address and
preserve `https://mezfit.ru` as an optional parallel address. Both domain
attachments reuse the **same** existing API Gateway `mezfit-web`, public
Object Storage bucket `mezfit-web-<YC_FOLDER_ID>`, SPA artifact, and Dexie
Cloud business database. No second gateway, backend, synchronization engine,
or Dexie database is created.

**Current production boundary:** The Yandex gateway still serves the SPA with
`/api/*` returning HTTP 503 until privileged Worker endpoints move to
Yandex. The new domains do not magically migrate backend or Telegram auth.
Cloudflare hosting and existing resources remain untouched.

## Domains and certificates

| Hostname | Cloud DNS zone | Managed certificate | Purpose |
| --- | --- | --- | --- |
| `mezfit.online` | `mezfit-online` / `mezfit.online.` | `mezfit-online-web` | Preferred new address |
| `mezfit.ru` | `mezfit-ru` / `mezfit.ru.` | `mezfit-ru-web` | Preserve existing domain |

Each certificate covers **one apex domain** and is requested independently.
This is deliberate: `mezfit.ru` government identification issues must not
block `mezfit.online` issuance. Both managed certificates have deletion
protection. Existing `.ru` zone/certificate are reused; no other existing
DNS records are deleted or replaced.

Yandex API Gateway supports multiple domains, distinguished by `Host`. For
apex domains of the form `mezfit.online` and `mezfit.ru`, the registrar
must delegate DNS to Yandex Cloud and the matching Yandex public zone must
contain an `ANAME` at the apex targeting the gateway default hostname.

Official provider documents:

- https://yandex.cloud/en/docs/api-gateway/operations/api-gw-domains
- https://yandex.cloud/en/docs/api-gateway/apigateway/api-ref/ApiGateway/addDomain
- https://yandex.cloud/en/docs/dns/api-ref/DnsZone/updateRecordSets
- https://yandex.cloud/en/docs/certificate-manager/api-ref/Certificate/get

## Manual GitHub Actions — Preview / Apply

Workflow: `.github/workflows/prepare-mezfit-dual-domains.yml`,
**Prepare MezFit Dual Domains**. Owner- and `main`-only workflow uses existing
`YC_DEPLOY_SA_ID`, `YC_FOLDER_ID`, GitHub OIDC and existing folder-scoped
`dns.editor`, `api-gateway.editor`, `certificate-manager.editor` grants.

Two inputs: `action` and `mode` (default `preview`). `apply` requires
exact action-specific confirmation:

| Action | Exact Apply confirmation | Result |
| --- | --- | --- |
| `prepare_online` | `PREPARE_MEZFIT_ONLINE` | Create/reuse protected public online DNS zone and its separately managed certificate request |
| `validate_online` | `VALIDATE_MEZFIT_ONLINE` | Add only the exact managed certificate validation CNAME to online DNS zone |
| `validate_ru` | `VALIDATE_MEZFIT_RU` | Add only the exact managed certificate validation CNAME to existing ru DNS zone |
| `activate_online` | `ACTIVATE_MEZFIT_ONLINE` | Attach an **ISSUED** online certificate to the existing gateway, then add apex ANAME in online zone |
| `activate_ru` | `ACTIVATE_MEZFIT_RU` | Attach an **ISSUED** ru certificate to the existing gateway, then add apex ANAME in ru zone |

Each phase is independent. **Preview makes no modifications**, and Apply
re-reads relevant resources before writing. CNAME/ANAME additions refuse
conflicting DNS types/values; existing identical records are reused. Gateway
attachments must refer to approved domain+certificate pairs; extra domains,
unapproved certificates, altered OpenAPI integrations, or unexpected ownership
fail closed. No auto-deleting, force-replacing, or custom gateway upgrades.

The activation phases **can change real public traffic** once NS is
delegated. Do not use them before testing certificate state and confirming
the intended domain owner and migration window.

## Suggested operator sequence

1. **Check that you own and control `mezfit.online`** at a registrar. The
   workflow cannot purchase or verify registration on your behalf.
2. Merge this PR only after review and successful CI.
3. Run `prepare_online` in Preview, then Apply using
   `PREPARE_MEZFIT_ONLINE`. This stages Yandex DNS and a certificate request.
4. At the `mezfit.online` registrar, delegate NS to
   `ns1.yandexcloud.net` and `ns2.yandexcloud.net`. Do **not** change the
   existing `mezfit.ru` delegation; it was changed previously by the owner.
   Check registrar DNSSEC/DS settings before switching NS. DNS propagation is
   external to GitHub Actions.
5. Run `validate_online` Preview, then Apply. This writes the exact
   `_acme-challenge.mezfit.online.` CNAME from Certificate Manager to the
   online zone. Confirm it is visible through public DNS and the managed
   certificate becomes `ISSUED`.
6. If the current `.ru` certificate is not yet `ISSUED`, run
   `validate_ru` Preview / Apply separately and confirm its challenge.
   Do **not** replace pre-existing conflicting records automatically.
7. Run `activate_online` Preview. Confirm the correct certificate, API
   Gateway and ANAME target, then run its separate Apply after ownership and
   traffic readiness are confirmed. Repeat `activate_ru` only after its
   certificate is ISSUED and the secondary domain is desired.
8. Verify `https://mezfit.online` and `https://mezfit.ru` on actual
   devices and browsers. `/api/*` still requires the future backend PR.
9. **Only later**, update Telegram Mini App URL, login / callback allowlists,
   canonical links and optional `.ru` redirect. Do **not** change these in
   this DNS/TLS foundation PR.

### Browser origin / security

`mezfit.online` and `mezfit.ru` are **distinct browser origins**.
IndexedDB (including Dexie offline cache), cookies and local storage are not
shared between them, even though both eventually use one Dexie Cloud
business database. For production, prefer a single canonical origin
(`mezfit.online`) and optionally a server-side `301` redirect from
`mezfit.ru`. That redirect requires a future deliberate API Gateway policy
change, along with auth/Telegram and external URL validation; it is not
silently introduced here.

In particular, opening the current static Yandex SPA at either domain does
not prove Telegram login, messaging/media, redirects or Worker APIs function
without Cloudflare/VPN.

### Safety and validation

The existing `Prepare Yandex Web Hosting` and
`Publish MezFit SPA to Yandex` operators were updated narrowly so their
API Gateway readback permits **only** `mezfit.online` and `mezfit.ru`
attachments with exactly the expected protected managed certificates. Thus
future static SPA republishing does not fail merely because the approved
domain was attached; unknown bindings remain prohibited.

Existing Python stdlib CI discovery runs the added contract tests. Local
npm/test/typecheck/build are not run before opening the PR, per AGENTS.md.
