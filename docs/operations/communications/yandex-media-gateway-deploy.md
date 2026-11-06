# Mezfit Yandex media gateway: deployment bootstrap

Status: **private, fail-closed deployment POC**, not a media authorization gateway. This is a narrowly scoped prerequisite to [COMM-09 #644](https://github.com/buropotok/mezfit/issues/644), and does not satisfy its authorization or production criteria.

## Existing resources

- Folder: `mezfit-media`, private bucket: `mezfit-comm-poc-20261106`.
- Existing function: `mezfit-media-gateway` (reuse by identity; never create a second function).
- OIDC: `mezfit-github-federation` with GitHub subject `repo:buropotok/mezfit:ref:refs/heads/main`.
- Deploy service account: `mezfit-github-deploy` with `functions.editor` **on the function only**, plus `iam.serviceAccounts.user` **on** `mezfit-media-poc`.
- Runtime service account: `mezfit-media-poc` with `storage.uploader` on the private test bucket only.
- Billing alert: `mezfit-test-budget`; alert is NOT a spending cap. Manual deployment may incur logging/compute costs.

## GitHub Actions variables

Set these repository *Variables* under Settings → Secrets and variables → Actions:

| Variable | Purpose |
| --- | --- |
| `YC_DEPLOY_SA_ID` | Service account federated with GitHub OIDC |
| `YC_RUNTIME_SA_ID` | Service account attached to the function version |
| `YC_FUNCTION_ID` | Exact existing function ID, used for preflight identity check |
| `YC_FOLDER_ID` | Folder containing the existing function |
| `YC_FEDERATION_ID` | Federation reference for operational use; not needed by the deploy action |

No S3 static keys, IAM tokens, Telegram initData or Dexie credentials belong in repository variables, logs, workflows or frontend code.

## Publication

1. Merge the reviewed deployment PR to `main` only after CI and the project's review process.
2. On the repository Actions tab, select **Deploy Yandex media gateway** → **Run workflow**; choose `main`.
3. Enter `DEPLOY_YANDEX_MEDIA` in the confirmation input. No push or PR automatically publishes a function version.
4. The workflow checks non-empty IDs, exchanges GitHub OIDC for a temporary Yandex IAM token, and retrieves `YC_FUNCTION_ID` via the Yandex Function.Get API.
5. Before publishing, it verifies the exact function name (`mezfit-media-gateway`), folder and status. Missing or mismatched resources fail without attempting to create a replacement.
6. The action publishes a Node.js 22 / 128-MiB / 5-second version, attaching only the designated runtime service account.

**OIDC caveat:** This workflow must not set `environment:` on the deployment job. The configured federation matches `repo:buropotok/mezfit:ref:refs/heads/main`; a GitHub Environment would change the token subject. GitHub main-branch protections and workflow-review controls are required to protect the deploy role.

**No public access:** The deployment action has no public-invocation grant. Do not grant `allUsers`, create a public API Gateway, or expose signed media URLs from this bootstrap. Runtime access is separate from CI permissions.

## Current function behavior

The checked-in `index.handler` always returns HTTP `503` with the fixed code `MEDIA_GATEWAY_NOT_CONFIGURED` and `Cache-Control: no-store`. It does not inspect the caller, access Object Storage, generate presigned links, or log credentials. This preserves a fail-closed boundary until a separate security-reviewed change implements verified Telegram identity, coach-client/realm and anchor authorization, scoped upload/read permissions, content validation and IAM-based signing.

PR2 diagnostics remain independently usable with their existing short-lived signed test tickets. The Android foreground uploads confirmed previously are evidence about the media *transport*, not authorization in this gateway.

## Validation and rollback

- Validate by checking the Action result and new version in Yandex Cloud Functions, without enabling public invocation. CI tests are separate from real Yandex deployment.
- On an unexpected deployment, stop issuing further versions and restore a known-good function version/tag through the Yandex console. No cloud settings, bucket ACL or other function is modified by this workflow.
- Revoke any leftover temporary COMM-02 S3 static access key and delete temporary JSON ticket objects/files from storage and devices; the OIDC deploy path does not need them.
- Monitor budget, Cloud Functions execution and logs before expanding testing.

Authoritative references: [Yandex GitHub CI/CD with OIDC](https://yandex.cloud/ru/docs/iam/tutorials/ci-cd-github-functions), [Function.Get REST](https://yandex.cloud/ru/docs/functions/functions/api-ref/Function/get), [Function version management](https://yandex.cloud/ru/docs/functions/operations/function/version-manage).
