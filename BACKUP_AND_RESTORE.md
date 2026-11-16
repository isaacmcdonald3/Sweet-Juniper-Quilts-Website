# Database backup and restore

This guide covers the automated Supabase PostgreSQL backup in
`.github/workflows/database-backup.yml`. It stores unique, age-encrypted
archives in a private Cloudflare R2 bucket; it does not put database exports
or GitHub Actions artifacts in this application repository.

## What is backed up

Each successful run exports PostgreSQL roles, the application schema and data,
Supabase migration history, `supabase/config.toml`, the checked-in SQL migration
files, and a Cloudinary media inventory. The archive manifest records each
file's byte count and SHA-256 digest. The media inventory includes product and
homepage media IDs, URLs, product association, type, primary-image status,
poster references, and cleanup metadata.

The database contains Cloudinary references only. The actual image and video
files are not in PostgreSQL or these backups; keep the separate media drive
available for recovery and re-upload.

Supabase-managed information is not a complete project backup. In particular,
the standard database export does not recover Auth users/passwords, Auth
providers and policies, MFA/SSO configuration, JWT signing keys, project API
keys, project settings, Edge Functions, Storage objects/buckets, Vault secrets,
or Cloudinary/PayPal/Resend/Render settings. The roles export and migration
history are supplemental database material; they do not recreate those
services. `admin_audit_logs` event rows are included, but
`actor_user_id` is deliberately set to SQL `NULL` because the referenced Auth
users are not included. Other audit fields are retained; actor identity links
are not.

## Storage limits and costs

The destination is a private Cloudflare R2 Standard bucket, not GitHub
Artifacts. At implementation time, R2's listed free tier included 10 GB-month
of storage, 1 million Class A operations, 10 million Class B operations, and
free internet egress. This is not a promise of unlimited or permanently free
storage: check [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
before enabling it. Overages or plan changes can be billed. Estimate storage
as roughly 30 times the compressed database archive size; if that exceeds the
free allowance, reduce retained backups or budget for storage before enabling
the workflow.

GitHub Actions is scheduled once per day, but GitHub may delay scheduled runs.
Scheduled workflows must exist on the repository's default branch. Public
repositories and private repositories have different Actions allowances; check
the [current GitHub Actions plan and usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
No Actions artifact retention is used. The Supabase Free plan has had a 500 MB
database limit, two active projects, and project pausing after inactivity;
verify [current Supabase plan limits](https://supabase.com/pricing). A backup
connection should not be treated as a guarantee that Supabase will keep a
free project active.

## One-time setup

### 1. Create a private R2 bucket and scoped token

1. In Cloudflare, enable R2 and create a **private** bucket in the default
   jurisdiction using the Standard storage class. Do not enable public access;
   a non-default jurisdiction needs a matching R2 endpoint in the workflow.
2. Create an R2 API token scoped to this bucket with **Object Read & Write**
   permissions, including list and delete access for this bucket. Delete is
   needed only for retention cleanup. Do not use an account-wide token.
3. Keep the token ID and secret in a password manager until adding them to
   GitHub. Do not put either in this repository.
4. Record the Cloudflare account ID and exact bucket name.

### 2. Create and protect the age decryption identity

Install the `age` command-line tools from the official age release source on a
trusted computer, then create the identity locally in a secure directory
outside the repository:

```powershell
age-keygen.exe -o .\backup-identity.txt
age-keygen.exe -y .\backup-identity.txt
```

The second command prints an `age1...` **public recipient**. Add that recipient
as the GitHub secret below. Keep `backup-identity.txt` offline or in a secure
password manager, with a second protected recovery copy. It is the private
decryption key: losing it makes all encrypted backups unrecoverable. Never
commit or upload it to GitHub. The workflow's encryption self-test uses a
temporary identity and does not expose or test the real private identity.

### 3. Add repository Actions secrets and variables

In **Repository Settings → Secrets and variables → Actions**, add these
repository **secrets**:

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | The production database connection URI, kept private. Prefer the Supabase **Session pooler** connection URI if the GitHub runner cannot reach the direct database over IPv4. Do not use the transaction pooler. Preserve the required SSL mode and URL-encode special characters in the password. |
| `BACKUP_AGE_RECIPIENT` | The `age1...` public recipient from `age-keygen -y`; store it as a secret even though the recipient itself is public. |
| `R2_ACCESS_KEY_ID` | The bucket-scoped R2 token/access-key ID. |
| `R2_SECRET_ACCESS_KEY` | The matching R2 secret access key. |

Add these **variables**:

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | The Cloudflare account ID (not a credential). |
| `R2_BUCKET` | The private bucket name. |

Do not add the `age` private identity to GitHub. The workflow does not need a
Supabase personal access token or a separately-created `GITHUB_TOKEN` secret.
GitHub supplies its own short-lived token; the notification job requests only
the repository permissions it needs.

### 4. Enable owner failure notifications

The failure job creates one issue assigned to the repository owner, then adds a
comment for later failures. Enable Issues for the repository, allow Actions to
write issues (and ensure any organization policy permits it), and ensure the
owner receives GitHub issue notifications. This notification does not depend on
Resend. If issue creation is blocked, the Actions run itself will still be
failed and visible in the Actions tab; configure GitHub's own workflow
notifications as an additional alert.

## Run and inspect backups

### Manual run

1. Open **GitHub → Actions → Encrypted database backup**.
2. Select **Run workflow**, choose the default branch, and start it.
3. Wait for the `backup` job to finish successfully. A failed or incomplete
   export is not a successful backup.
4. Open the run's summary. It records the completion time, unique R2 object
   name, encrypted byte count, SHA-256 checksum, and count of old backups
   removed after verification.

The workflow also runs daily at approximately 06:17 UTC. GitHub scheduled
events can be delayed. Confirm that at least one successful run appears each
day; do not infer success from the schedule alone.

### Find the latest successful backup

1. In the Actions tab, open the most recent green `Encrypted database backup`
   run and note the exact `s3://bucket/key` shown in its summary.
2. In Cloudflare **R2 → bucket → `sweet-juniper/daily/`**, locate the exact
   object key from that summary. The key contains its UTC date and GitHub run
   identifiers.
3. Use the latest **successful** run, not simply the newest object: a run can
   fail after upload while validating or cleaning up. Uploads always use unique
   keys, so a failed run does not overwrite an earlier object.

Retention cleanup runs only after a new upload's size and downloaded SHA-256
have been checked. It keeps the 30 newest listed backup objects where possible.
If the listing or deletion fails, the workflow reports failure; do not manually
delete the last known-good object to make room.

### Download and decrypt

In the R2 console, download the exact object key selected above. Alternatively,
use the AWS CLI with a bucket-scoped R2 token stored in a secure local
credential profile (do not put token values in commands, scripts, or chat):

```powershell
aws s3 cp "s3://<bucket>/sweet-juniper/daily/<exact-object-key>" `
  .\sweet-juniper-backup.tar.gz.age `
  --endpoint-url "https://<account-id>.r2.cloudflarestorage.com" --region auto
```

Compare the downloaded file's SHA-256 to the successful Actions run summary:

```powershell
Get-FileHash .\sweet-juniper-backup.tar.gz.age -Algorithm SHA256
```

Then decrypt using the offline identity:

```powershell
age.exe --decrypt --identity .\backup-identity.txt `
  --output .\sweet-juniper-backup.tar.gz .\sweet-juniper-backup.tar.gz.age
```

Do not upload the decrypted archive to GitHub, a public file share, or the
application repository. It contains customer, order, and shipping data. Check
the tar/gzip and every manifest file before restoring:

```powershell
tar -tzf .\sweet-juniper-backup.tar.gz
mkdir .\sweet-juniper-restore
tar -xzf .\sweet-juniper-backup.tar.gz -C .\sweet-juniper-restore
python .\sweet-juniper-restore\project\scripts\backup\verify_backup.py `
  .\sweet-juniper-backup.tar.gz
```

The verifier checks the archive against the embedded manifest without running
or extracting SQL. If any checksum, size, or archive check fails, stop and use
another successful backup.

## Safe restore test (separate Supabase project only)

Perform a restore drill periodically (at least quarterly, and after material
database or workflow changes). This procedure is for a newly-created,
**separate test Supabase project**. It is not authorization to restore over the
live store.

1. Create a disposable Supabase project from the dashboard. Confirm its project
   reference and database host are different from production. Use PostgreSQL
   15 when available to match `supabase/config.toml`. Do not pause, delete, or
   modify the production project to make room for a test.
2. Keep the test project's database password and connection URI local and
   private. Set `RESTORE_DB_URL` in the current terminal from a password
   manager; do not save it in the repository or paste it into a workflow log.
3. Before any SQL is run, independently verify in the Supabase dashboard that
   `RESTORE_DB_URL` points to the test project. Never substitute the live
   database URL. Do not run these commands against production without explicit
   authorization and a separately confirmed recovery plan.
4. Open the extracted backup directory. Review `roles.sql` for project-specific
   roles. A fresh Supabase project already has managed roles; stop if the role
   export attempts to alter managed credentials or produces a conflict. Never
   copy passwords or role secrets from an export into chat.
5. In PowerShell, run the SQL in order, stopping immediately on any error:

   ```powershell
   Set-Location .\sweet-juniper-restore
   psql $env:RESTORE_DB_URL --no-psqlrc --set ON_ERROR_STOP=on --file .\roles.sql
   psql $env:RESTORE_DB_URL --no-psqlrc --set ON_ERROR_STOP=on --file .\schema.sql
   psql $env:RESTORE_DB_URL --no-psqlrc --set ON_ERROR_STOP=on --file .\data.sql
   psql $env:RESTORE_DB_URL --no-psqlrc --set ON_ERROR_STOP=on --file .\admin-audit-logs.sql
   ```

   The export also contains `migration-history-schema.sql` and
   `migration-history-data.sql`. These describe Supabase's internal
   `supabase_migrations` history and are retained for reference; do **not**
   import them over a new project's managed migration tracking by default.
   The checked-in migration files in `project/supabase/migrations/` document
   the application schema. Reconcile migration tracking for the replacement
   project using the Supabase CLI's migration-repair workflow before applying
   future migrations; do not blindly replay migrations over the restored
   schema.
6. If a statement fails because it references an Auth user absent from the new
   project, stop. The backup does not recreate Auth users or passwords. Audit
   actor links are already redacted in `admin-audit-logs.sql`; do not disable
   other foreign-key checks or silently alter the test data.
7. Check the restored data using the Supabase SQL editor or a read-only
   database client: compare category/product counts, inspect published and
   archived products, verify prices and inventory, check media references,
   and confirm order numbers, customer/shipping fields, order items, payment
   statuses, fulfillment/tracking fields, and email-log rows. Never expose
   customer details in screenshots, issues, or logs.
8. Use the inventory CSV and an authorized Cloudinary account to confirm asset
   IDs and URLs. Since media binaries are not backed up here, recover missing
   assets from the separate media drive: re-upload through the Owner
   Dashboard, associate each upload with the correct product, restore media
   type/order/primary selection, and confirm the resulting URLs and asset IDs.
   Homepage library assets must also be re-uploaded if they are missing.
9. After validation, delete the disposable test project only when you have
   confirmed it is not production and no longer need the drill. Record the
   restore-test date and outcome without storing any customer data in the
   record.

## Disaster recovery and returning to service

Recovery requires a replacement Supabase project and manual service
configuration; a SQL restore alone is not a complete service restore.

1. Create the replacement project, set the database password, choose a
   compatible region/PostgreSQL version, and restore the roles, application
   schema, and data following the safe process above. Never restore over
   production without explicit authorization and confirmation.
2. Recreate owner access in the replacement project's Supabase Auth dashboard.
   Keep public sign-ups disabled and create/invite the owner through the Auth
   user-management screen. Set that user's **app metadata** (not user metadata)
   to `{"is_owner": true}` using Supabase's supported admin interface or
   server-side tooling, set the matching new Auth UUID as Render's
   `OWNER_USER_ID`, then sign out and back in to refresh the token. See the
   owner setup in [README.md](./README.md). Do not put a service-role key in the
   browser or a `VITE_` variable. Auth users, password hashes, provider
   configuration, and JWT keys are not restored by this workflow.
3. Restore missing Cloudinary files from the separate media drive as described
   above. Verify products, homepage media, and primary images in the Owner
   Dashboard.
4. Update the Render **Web Service** environment with the replacement
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_USER_ID`, plus the
   existing `CLIENT_ORIGIN` and `NODE_ENV=production` values. Restore the
   server-side `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
   `CLOUDINARY_API_SECRET`. Keep all service-role and provider secrets on the
   Web Service only.
5. Update the Render **Static Site** build environment with `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY`, and set `VITE_API_BASE_URL` to the restored
   Web Service's HTTPS API origin. Never put server credentials in Static Site
   variables.
6. Reconfigure PayPal credentials and webhook on the replacement deployment:
   `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
   `PAYPAL_MODE`, and `PAYPAL_LIVE_PAYMENTS_ENABLED`. Start in PayPal Sandbox
   (`PAYPAL_MODE=sandbox`, live payments disabled) and verify checkout and
   webhook handling before switching to live payments. Restore
   `CHECKOUT_SHIPPING_AMOUNT` to the approved store setting.
7. Reconfigure Resend (`RESEND_API_KEY`, `EMAIL_FROM`,
   `OWNER_NOTIFICATION_EMAIL`, `APPLICATION_BASE_URL`, and, if used,
   `RESEND_WEBHOOK_SECRET`), re-verify the sending domain, and test email delivery
   before reopening checkout. Backup failure alerts do not use Resend.
8. Review all current Render variables and the deployment instructions in
   `README.md`; restore any additional project-specific settings that are not
   listed above. Update the application's `VITE_` settings only with public
   values. Trigger a deployment after updating variables.
9. On the test project first, verify products, inventory, product details,
   cart/checkout behavior, orders, payment state, owner access, fulfillment,
   customer email, owner notifications, and Cloudinary media. Use PayPal
   Sandbox and a test Resend recipient. Do not send test messages to customers
   or process a live payment.
10. Only after the owner confirms the recovered services and checks pass,
    point the production Render services at the replacement project, perform a
    final smoke test, and announce the store is back in service.

Keep Supabase, Cloudinary, PayPal, Resend, Render, and GitHub recovery
credentials in their respective secure account/password managers. Recreate
project-level Auth, API keys, provider/webhook settings, storage, and secrets
manually as applicable. A replacement project's keys and Auth configuration
will differ from the old project's values.

## What has and has not been tested

The repository tests cover export validation, archive hashing, retention
selection safeguards, and the GitHub issue notification helper. The workflow
also self-tests `age` encryption/decryption, validates required schema and data
exports, verifies the archive manifest, checks the uploaded object's size and
downloaded checksum, and only then considers retention cleanup.

No Supabase, Cloudflare, or GitHub account credentials or separate test project
are available in this development environment. Therefore, a real manual
workflow run, scheduled run, R2 upload/retention operation, GitHub owner alert,
and restore into a separate Supabase project remain unverified until the
one-time setup above is completed. Do the first end-to-end backup and test
restore before relying on this system for disaster recovery.
