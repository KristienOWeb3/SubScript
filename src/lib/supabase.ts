import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create Supabase client only if credentials are configured
export const supabase: SupabaseClient | null =
    supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://')
        ? createClient(supabaseUrl, supabaseAnonKey)
        : null;

export const isSupabaseConfigured = !!supabase;
