import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Caller = { userId: string; isOwner: boolean };

/**
 * Every JARVIS endpoint calls this. Verifies the signed-in user's token and
 * looks up whether they are the owner (the only account allowed to use the
 * owner's connected Gmail/Calendar).
 */
export async function getCaller(request: Request): Promise<Caller | Response> {
  const deny = (msg: string) => Response.json({ error: msg, code: "signed_out" }, { status: 401 });
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.split(".").length !== 3) return deny("Please sign in to JARVIS.");
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return Response.json({ error: "Accounts are not configured." }, { status: 500 });
  const supabase = createClient<Database>(url, key, {
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return deny("Your session expired. Please sign in again.");
  const { data: owner } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return { userId, isOwner: owner === true };
}
