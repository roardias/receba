import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Em build (ex.: Vercel sem env ainda), evita "supabaseUrl is required". Em runtime as variáveis devem estar definidas.
export const supabase: SupabaseClient = url && key ? createClient(url, key) : (createClient("https://placeholder.supabase.co", "placeholder") as SupabaseClient);
