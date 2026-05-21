/* =========================================================================
   Supabase client bootstrap.
   Fill in SUPABASE_URL and SUPABASE_ANON_KEY from your Supabase project:
     Project Settings -> API -> Project URL & anon public key.
   ========================================================================= */
'use strict';

const SUPABASE_URL = 'YOUR_SUPABASE_URL';        // e.g. https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

window.SUPABASE_CONFIGURED =
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  console.error('[supabase] SDK not loaded. Check the <script> tag in index.html.');
  window.supabaseClient = null;
} else if (!window.SUPABASE_CONFIGURED) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_ANON_KEY not set in js/supabase-client.js. Login will fail until you fill them in.');
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
  );
} else {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
