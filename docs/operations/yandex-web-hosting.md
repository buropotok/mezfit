# MezFit: Yandex Web Hosting Foundation (PR 2)

**Scope:** preparatory Yandex Cloud resources and an optional explicitly approved
SPA build upload. This is **not** a production cutover and does not remove CF.

## Decision and architecture

The long-term public hostname is `https://mezfit.ru` (REG.RU registrar).
Use a single Yandex **API Gateway** as the eventual HTTPS entry for both
React SPA static resources and the backend `/api/*` routing. Object Storage
holds browser files only. Dexie Cloud remains authoritative for workout,
profile, message, relationship and realm data.

The first gateway serves static objects from a bucket named
`mezfit-web-<YC_FOLDER_ID>`. It explicitly returns **503 JSON** for all
`/api` and `/api/*` requests until the Yandex backend is implemented. It
never calls Cloudflare as an upstream and does not use the old Worker token.
Browser routes like `/invite/...` fall back to `index.html`; absent
`/assets/...` files return a missing-file error, not HTML.

The bucket has **public object read only**, because these files are publicly
downloadable application JS/CSS. Public object listing and public bucket
configuration reads remain denied. No uploaded source maps, hidden files,
per-user data, secrets, or media backups belong in this bucket.

A managed Let's Encrypt TLS certificate is **requested** for `mezfit.ru`;
it is not automatically issued, bound to the gateway, or routable from
`mezfit.ru` merely by requesting it. Domain ownership validation requires a
public DNS CNAME. While REG.RU remains authoritative, that record must be
created there; creating it in an undelegated Yandex DNS zone will not validate
the certificate. Only after issuance will a future separate cutover operation
attach `mezfit.ru` to the gateway and configure its Cloud DNS ANAME target.

## Existing and new workflows

1. **Prepare Yandex Cloud DNS** — already merged in PR #881. Its successful
   Apply created the public `mezfit.ru.` DNS zone in Yandex Cloud. The zone
   need not be delegated yet.
2. **Prepare Yandex Web Hosting** — `.github/workflows/prepare-yandex-web.yml`.
   Owner/main/manual only. `preview` calls read-only Yandex Cloud APIs and
   prints an exact plan. `apply` requires literal
   `PREPARE_MEZFIT_WEB`; the operator rechecks resources, creates missing
   resources only, checks each operation, and reads them back. Existing
   resources with conflicting name, public access, certificate domain or
   gateway specification are never silently rewritten.
3. **Publish MezFit SPA to Yandex** — `.github/workflows/publish-yandex-spa.yml`.
   Manual owner/main only, literal `PUBLISH_MEZFIT_WEB`. Uses `npm ci` and
   `npm run build` **inside GitHub Actions**, then obtains a short-lived
   IAM token through existing GitHub OIDC and uploads `dist/`. It never
   deletes bucket objects; uploads `index.html` last and sets conservative
   HTTP caching (immutable only on hashed assets). The deployment operator
   checks that the foundation exists before uploading.

Both workflows use the existing repository variables `YC_DEPLOY_SA_ID` and
`YC_FOLDER_ID`, and the existing pinned
`ghcr.io/yc-actions/yc-iam-token-fed:1.0.0` action. No new key is stored in
GitHub. The deployment principal requires appropriate scoped Yandex IAM:
`storage.admin` to configure/create the static bucket,
`api-gateway.editor` to create/read the gateway, and
`certificate-manager.editor` to request/read the certificate. These roles
are **not automatically granted** by the workflow. Review and approve
role assignments separately; do not grant `editor` for the whole folder
unless narrowly scoped permissions are genuinely insufficient.

Potential billing: Object Storage (objects/requests/egress), API Gateway
(calls) and potentially other applicable service charges. Check current
quotas and costs before Apply. The managed Let's Encrypt request does not
imply that the website is live.

## Recommended operator sequence

1. Merge this PR after code review and GitHub CI. Do not touch REG.RU.
2. Assign explicitly approved minimal IAM roles to the already-federated
   `mezfit-github-deploy` service account.
3. Run **Prepare Yandex Web Hosting** with `mode=preview`.
4. Inspect the target folder, three resource plans and permissions.
5. Run `mode=apply`, `confirm=PREPARE_MEZFIT_WEB`. On a partial failure,
   inspect existing resources and re-run Preview, never blindly force updates.
6. In Certificate Manager, inspect the managed `mezfit-ru-web` request and
   its `DNS_CNAME` validation challenge. If DNS is still at REG.RU, add the
   reported CNAME in REG.RU (the only current authoritative source) without
   changing NS. The certificate can be issued before changing NS.
7. Optionally run **Publish MezFit SPA to Yandex** with its own manual
   confirmation and inspect the gateway's **default** `*.apigw.yandexcloud.net`
   URL. This uploads static files, **not** a working independent backend.
8. Only in later PRs: migrate identity/session/Worker APIs to Yandex, wire
   API Gateway to the Yandex backend, attach the issued certificate and
   custom domain, stage the appropriate Cloud DNS ANAME, verify on real
   Chrome/Safari/Telegram devices **without VPN**, then switch REG.RU NS.

## Explicit non-goals

- Does not make `https://mezfit.ru` live, switch REG.RU NS, attach the
  custom domain, or automatically issue/validate a certificate.
- Does not migrate auth, business APIs, Cloudflare D1/R2/Durable Objects,
  Telegram notifications, media, or Dexie Cloud.
- Does not change existing Cloudflare workflows or production routing.
- Publishing the **current** frontend separately is only a static hosting
  smoke test; `src/App.tsx` still expects Telegram `initData`, and Worker
  APIs are not present on the Yandex gateway yet. Do not call that a complete
  standalone SPA.

## Verification and limits

PR CI runs the new stdlib Python tests for Preview, owner confirmation,
idempotent create/reuse, resource conflicts, missing API backend response,
asset cache/MIME settings and HTML-last upload. Existing application tests are
not modified. Local npm/build/test/typecheck are not run before the PR, in
accordance with the repository CI workflow.

Official Yandex documentation:
- https://yandex.cloud/en/docs/api-gateway/concepts/index
- https://yandex.cloud/en/docs/api-gateway/concepts/extensions/object-storage
- https://yandex.cloud/en/docs/storage/api-ref/Bucket/create
- https://yandex.cloud/en/docs/certificate-manager/operations/managed/cert-create
- https://yandex.cloud/en/docs/storage/s3/s3-api-quickstart
- https://yandex.cloud/en/docs/api-gateway/apigateway/api-ref/ApiGateway/create
