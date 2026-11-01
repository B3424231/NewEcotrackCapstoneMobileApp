# Backend cutover and cross-system integration

## Shared aircon state, 2026-10-04

Migration `202610030005_aircon_control_snapshots.sql` is applied to project `ynopdmfhngooknybyahq`. Mobile and desktop controls use the same desired mode, fan speed, command ID and delivery status. Current telemetry cards subscribe to these changes; each new telemetry row captures the settings for its exact, unambiguous controller binding. Existing rows are not backfilled or rewritten. A live verification transaction confirmed COOL with QUIET fan, transmitted status, and unchanged historical snapshots, then rolled back its verification data.

Commanded settings are shown as requests until newer device feedback confirms operation. QUIET affects fan speed, not operating mode. Ambient room temperature no longer determines aircon state. Trusted server ingestion can call `ecotrack_report_aircon_state`; ACTIVE COOLING requires reported compressor feedback. This rollout does not add that feedback to the firmware. Restart the desktop backend and reload its pages to use the changes; the mobile source changes require a new native build.

## Cross-system rollout, 2026-10-03

Project `ynopdmfhngooknybyahq` now has the desktop RPC migration `202609300006`, the access/push migrations `202610020001` and `202610020002`, and the worker authorization/Auth commit/report edit migrations `202610030001` through `202610030003`. `account-login`, `provision-staff`, `provision-admin`, and `deliver-mobile-push` are deployed. The push setup in `push-delivery-setup.sql` wakes the worker on enqueue and retries every minute, using private, expiring, single-use wake tokens.

The follow-up migration `202610030004_push_worker_role_guard.sql` is also applied: both worker RPCs reject missing JWT roles. Push dispatch reads the project-specific URL from Vault under `ecotrack_push_worker_url`; the existing project's URL is retained. Before using `push-delivery-setup.sql` in another project, create that Vault entry with its `/functions/v1/deliver-mobile-push` URL as shown in the script. Setup refuses a missing/invalid URL and preserves existing configuration on retries. No persistent worker credential is stored in this entry.

Disposable live checks verified desktop staff provisioning, mobile name/phone/email login, private staff-uploaded photos signed by the desktop helper, shared Auth password updates, and denied anonymous credential-column reads. Local regression suites cover version conflicts, preserved worker evidence, device command acknowledgments, push preferences/receipts/retries, and authorization. The original staging checklist below remains relevant to legacy account migration and firmware ingestion; it is not a statement that the above rollout is still undeployed.

Android phone push still requires the existing Firebase `google-services.json`, matching EAS FCM credentials, and a rebuilt native app. No Firebase configuration file was found locally. Physical IR operation also requires the correct controller firmware and an actual connected device; these app/backend checks do not certify IR frames or AC response. No firmware or historical password data was changed by this integration request.

The app now requires Supabase Auth and the ordered migrations listed above. It intentionally fails closed when the Edge function or RPCs are absent. Do not release this mobile build against the legacy backend.

## Verified locally

Run `npm run test:backend`, `npm run test:database`, and `npm run typecheck`.
The database tests use disposable embedded PostgreSQL with a synthetic legacy schema. They exercise actual SQL transactions, RLS, grants, registration triggers and storage policies. They do not establish compatibility with the unidentified deployed desktop schema or Supabase Auth/Storage runtime.

## Required staging rollout

1. Rotate the previously exposed privileged key in Supabase, inspect its use, and replace server credentials. Deleting source text does not revoke it. Never put server keys in Expo environment variables or distributed firmware. Identify a disposable project and obtain its full schema, grants, policies, triggers, functions, publications and storage configuration.
2. Back up the existing database and copy its schema into staging. Review all conflicts before applying migrations. Existing duplicate normalized staff email/phone or administrator email causes an explicit migration failure; no records are deleted. Resolve report assignments lacking an unambiguous immutable staff ID and validate `maintenance_reports_staff_id_fkey`. Review canonical `aircons.controller_node_id` links. Staff access currently requires an explicit room ID; broad textual assignments need explicit relational grants before release.
3. During a coordinated maintenance window, apply `202609300001` through `202609300005` in order. These are upgrades for an existing schema, not a full blank-project bootstrap. Anonymous access is removed. Direct maintenance and device writes are replaced by RPCs; desktop clients must adopt the same contracts before production. Firmware requires a separately authenticated ingestion service. The retired root setup scripts are preserved as comments and raise an error instead of restoring public policies.
4. Configure Auth email confirmation, SMTP, appropriate rate limits and the recovery template at `templates/recovery.html`. It must contain `{{ .Token }}` because the mobile form verifies an emailed code. Configure the signup/email-change redirect destinations as well. Test expired/incorrect codes, account enumeration behavior, delivery, signup confirmation and email-change confirmation using test inboxes.
5. Provision existing profiles with `node scripts/provision-auth-users.cjs` in an operator environment containing `ECOTRACK_OPERATOR_URL` and `ECOTRACK_OPERATOR_SECRET`. It defaults to read-only counts, does not load `.env`, and never reads legacy passwords. After reviewing conflicts, explicit `--apply --project-ref <staging-ref>` creates mapped Auth users with random undisclosed passwords and unconfirmed emails. It sends no email. Test recovery on an unconfirmed provisioned account before approving this workflow. Existing Auth subjects are never automatically reassigned by email; review and map them explicitly. Public signup metadata cannot claim existing profiles or administrator roles.
6. Deploy `account-login` with the matching config (`verify_jwt=false` allows the initial password challenge). Server runtime secrets are used only inside that function. The endpoint resolves username/phone/email to a mapped Auth subject, applies attempt throttling, and verifies the password through Auth. Test the deployed function independently, including ambiguous identifiers, disabled accounts, throttling and large requests. Set gateway limits; the handler's payload limit is not a streaming body limit.
7. Migrate existing images into owner Auth-ID folders and replace stored URLs with `storage://bucket/subject-id/file`. Do not infer owner from a filename. Buckets become private; existing public links will stop working. Signed display URLs last one hour and refresh on data reload. New uploads require ownership, bucket MIME/size limits and client signature checks; a server image decoder/scanner is still required for robust content validation. Test native URI uploads and long-lived screens.
8. Test administrator + two staff accounts via the actual API: cross-user reads/writes, broadcast read/snooze/archive isolation, stale screens, retry after dropped responses, parent/repair approval/rejection, failure rollback, node/AC synchronization, private images, archive and logout. Auth confirmation, recovery, Storage API checks and realtime delivery need real Supabase tests; PGlite cannot replace them.
9. After all clients migrate, remove legacy plaintext password columns/data in a separately reviewed migration and revoke prior sessions. The current grants prevent app access to those columns but do not erase historical copies/backups. Forced logout and archival now record a server cutoff; authorization checks the JWT session ID against `auth.sessions.created_at`, so refreshing an older session cannot restore access after a later login. Test this with real Auth sessions and verify the deployed Auth schema.

## RPC contracts

| Area | Contract |
| --- | --- |
| Identity/profile | `ecotrack_my_profile`, `ecotrack_update_profile`, `ecotrack_set_presence`; JWT subject is authoritative, role and assignments are not editable profile inputs. |
| Maintenance | `ecotrack_update_maintenance_report`, `ecotrack_submit_repair`, `ecotrack_verify_maintenance`; original `updated` timestamp and a reusable operation ID are required. Only administrators approve/reject. |
| Devices | `ecotrack_device_mutation`; node and AC changes commit or roll back together. Hardware state cannot be fabricated by metadata writes. |
| Notifications | `ecotrack_list_notifications`, `ecotrack_set_notification_state`, `ecotrack_mark_all_notifications_read`, `ecotrack_create_notification`; immutable event key and per-recipient state, keyset pagination. |

## Earlier cutover audit context

The earlier cutover implementation did not deploy migrations or provision accounts, and its schema export returned HTTP 401. The cross-system rollout above supersedes that deployment limitation. Key rotation, migrating historical plaintext credentials, and firmware ingestion remain separately reviewed work.

The remote push outbox/worker and mobile probe-then-POST `/ir/intent` transport are implemented in this rollout. Scheduled reminder generation and BLE provisioning remain outside these changes. Do not treat a database status or an HTTP 200 as proof an AC changed state; the mobile transport requires a matching node identity and a successful command result. Also audit tables/functions absent from the supplied schema before claiming complete authorization coverage.

Reference: [Supabase recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [server-only account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser).
