# delete-account Edge Function

Lets a signed-in user permanently delete their own Cursed Realm account (GDPR "right to
erasure"). It verifies the caller's JWT, so a user can only ever delete **themselves**, then
uses the service role to remove their data across `decks`, `collections`, `deck_likes`,
`deck_comments`, `profiles`, the `avatars` storage bucket, and finally the `auth.users` row.

## Deploy

From a machine with the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and
logged in (`supabase login`):

```bash
# from the repo root
supabase functions deploy delete-account --project-ref nuizkjkcephopnbcmtlz
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically by the platform — you do NOT need to set any secrets.

The function keeps the default `verify_jwt = true`, so the gateway rejects unauthenticated
calls before the function even runs; the function then independently re-checks the token.

## Frontend

The "Delete Account" button in the profile menu (see `cr-auth.js` → `CR.openDeleteAccount`)
POSTs to `https://<project>.supabase.co/functions/v1/delete-account` with the user's access
token, then signs out and redirects home.

## Test

```bash
# Should be rejected (no token):
curl -i -X POST https://nuizkjkcephopnbcmtlz.supabase.co/functions/v1/delete-account
# -> 401
```
