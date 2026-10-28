# GitHub token storage

The API requires `TOKEN_ENCRYPTION_KEY`: a random 32-byte key represented as 64
hexadecimal characters. Supply it through the deployment's secret manager as an
environment variable. Generate it with `openssl rand -hex 32`; never commit it.
All API instances and migration processes must use the same key. Keep a secure
backup: losing or replacing the key makes stored tokens unreadable.

Both tokens use versioned AES-256-GCM envelopes with random nonces and field-bound
authentication. Mongoose setters encrypt document and update writes; request auth
explicitly decrypts. Raw collection writes bypass these setters and are reserved
for the migration. Missing/invalid keys and unauthenticated ciphertext fail closed.

## Deploying existing databases

1. Back up MongoDB and stop all old API instances that can write plaintext tokens.
2. Configure `MONGODB_URL` and `TOKEN_ENCRYPTION_KEY` securely.
3. Run `npm run migrate:tokens`. It converts plaintext tokens, authenticates existing
   envelopes, and uses conditional updates to avoid overwriting concurrent changes.
   It is safe to rerun after interruption. A failed run exits nonzero without
   printing credentials.
4. Start the new API instances with the same key. Startup also runs the migration
   before listening, so an instance cannot serve legacy plaintext credentials.

Do not roll back to a version that stores plaintext or change the encryption key
without a separate key rotation migration. Existing production records are only
migrated when this command or the new API startup runs against that database.

Refreshes share one promise through persistence and lock release within a process.
A MongoDB lease coordinates instances; each holder reads current credentials under
the lock before calling GitHub. The HTTP request times out after 10 seconds; the
lease expires after 60 seconds to recover from crashes. Conditional writes fence
out holders whose lease was taken over or invalidated by a fresh login. Requests
waiting longer than 15 seconds fail and can be retried.
