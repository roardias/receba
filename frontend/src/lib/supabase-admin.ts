import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!serviceRoleKey) {
  console.warn("SUPABASE_SERVICE_ROLE_KEY não definida. APIs de admin não funcionarão.");
}

export const supabaseAdmin = serviceRoleKey
  ? createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
