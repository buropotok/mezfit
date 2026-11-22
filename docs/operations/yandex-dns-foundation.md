# MezFit: Yandex Cloud DNS foundation

Status: **preparation only**. This operator does not deploy the SPA, backend,
certificate, API Gateway, media, or change the active Cloudflare installation.

## Scope and ownership

The canonical domain is `mezfit.ru`, registered at REG.RU. The first
infrastructure workflow manages **one resource only**: a public Cloud DNS zone
named `mezfit-ru` with suffix `mezfit.ru.` in `YC_FOLDER_ID`.

The desired zone has deletion protection. No A/AAAA/CNAME records, HTTPS
certificate, NS delegation, existing zone modifications, or production traffic
changes are performed. **Do not delegate REG.RU nameservers yet.** Before
delegation, the SPA/API and all essential DNS records must exist and be verified.

## GitHub authentication and permissions

Workflow: `.github/workflows/setup-yandex-infrastructure.yml`.

It reuses the repository's established GitHub OIDC federation and
`yc-iam-token-fed:1.0.0` token exchange from
`.github/workflows/deploy-yandex-media.yml`. Required existing GitHub
repository variables:

- `YC_DEPLOY_SA_ID` — federated deployment service account.
- `YC_FOLDER_ID` — target Yandex folder.

The federation must authorize this workflow's identity on `main`. The service
account also needs DNS read permissions for Preview, and DNS zone creation
permissions (typically `dns.viewer` / `dns.editor` on the target folder)
for Apply. These grants are **not** created by the workflow. Grant only the
necessary rights through a separately approved IAM operation; do not store
a static IAM token or service-account key in GitHub.

The workflow runs only by manual `workflow_dispatch` on
`buropotok/mezfit` `main`, with both initiator and retry actor required to
be the repository owner. No PR, push, scheduled, or automated Apply is allowed.

## Operation

1. After the workflow is merged to `main`, open **Actions → Prepare Yandex
   Cloud DNS → Run workflow**.
2. Run `mode=preview` first. This reads all pages of the folder's DNS zones
   and reports either the existing exact public zone or a proposed create.
   Preview never sends a create/update/delete request.
3. Inspect the result, folder ID and deployment IAM permissions.
4. To create the zone, run `mode=apply` and supply exact confirmation
   `CREATE_MEZFIT_RU_DNS`. The operator re-reads the DNS list immediately
   before creating anything, waits for the Yandex operation, then re-reads
   the created resource and the list.
5. Run Preview again to verify the zone is present. Keep REG.RU NS unchanged
   until the later dedicated domain cutover step.

A matching public zone is reused without changes. A private zone, same suffix
under another name, same name for another suffix, ambiguous match, malformed
API data, permissions failure, or incomplete creation operation stops the
operator. It never repairs or deletes conflicting zones automatically.

The operator only sees zones inside the selected Yandex folder. Before
delegation, verify there is no competing `mezfit.ru.` zone in another folder
or account.

## Verification

The repository's PR CI invokes the standard-library tests in
`tools/yandex-infrastructure/test_dns_zone.py`. These cover preview
read-only behavior, explicit authorization, create-once idempotence, conflict
rejection, pagination, and failed operations.

The operator and tests use the Python standard library; no extra npm or pip
dependencies are introduced. The actual Yandex API operation has **not** been
run merely by opening this PR.

References:
- https://yandex.cloud/en/docs/dns/api-ref/DnsZone/list
- https://yandex.cloud/en/docs/dns/api-ref/DnsZone/create
- https://yandex.cloud/en/docs/dns/api-ref/DnsZone/get
- https://yandex.cloud/en/docs/iam/operations/wlif/setup-wlif
