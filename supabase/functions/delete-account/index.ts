// Supabase Edge Function: delete-account
// Lets a signed-in user permanently delete their OWN account and all associated data.
// It verifies the caller's JWT (so a user can only ever delete themselves), then uses the
// service role to remove their rows across the app tables + storage and, finally, the auth
// user itself.
//
// Deploy:  supabase functions deploy delete-account
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Identify the caller strictly from their own bearer token.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not signed in." }, 401);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json({ error: "Invalid or expired session." }, 401);
  const uid = u.user.id;

  // 2. Service-role client — bypasses RLS to remove the user's data.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const warnings: string[] = [];
  const del = async (label: string, q: any) => {
    try {
      const { error } = await q;
      if (error) warnings.push(`${label}: ${error.message ?? error}`);
    } catch (e) {
      warnings.push(`${label}: ${(e as Error).message ?? e}`);
    }
  };

  // Remove rows that reference the user's decks first (likes/comments left by others on the
  // user's decks), then the user's own likes/comments elsewhere, then the decks themselves.
  const { data: myDecks } = await admin.from("decks").select("id").eq("owner_id", uid);
  const deckIds = (myDecks ?? []).map((d: { id: string }) => d.id);
  if (deckIds.length) {
    await del("deck_likes(on my decks)", admin.from("deck_likes").delete().in("deck_id", deckIds));
    await del("deck_comments(on my decks)", admin.from("deck_comments").delete().in("deck_id", deckIds));
  }
  await del("deck_likes(mine)", admin.from("deck_likes").delete().eq("user_id", uid));
  await del("deck_comments(mine)", admin.from("deck_comments").delete().eq("user_id", uid));
  await del("decks", admin.from("decks").delete().eq("owner_id", uid));
  await del("collections", admin.from("collections").delete().eq("user_id", uid));
  await del("profiles", admin.from("profiles").delete().eq("id", uid));

  // Uploaded avatar images live under `${uid}/` in the avatars storage bucket.
  try {
    const { data: files } = await admin.storage.from("avatars").list(uid);
    if (files && files.length) {
      await admin.storage.from("avatars").remove(files.map((f) => `${uid}/${f.name}`));
    }
  } catch (e) {
    warnings.push(`avatars: ${(e as Error).message ?? e}`);
  }

  // 3. Finally delete the auth user. This is the step that actually closes the account.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return json({ error: `Could not delete the account: ${delErr.message}`, warnings }, 500);
  }

  return json({ ok: true, warnings }, 200);
});
