// ============================================================
//  Team Hub config — fill these in after creating your Supabase project.
//  Everything here is safe to be public (the publishable key is
//  designed to live in the browser; real security is the RLS + RPCs).
// ============================================================
window.CONFIG = {
  // From Supabase → Project Settings → API
  SUPABASE_URL: 'https://ufiapnbyregbofyjxpdr.supabase.co',
  SUPABASE_KEY: 'sb_publishable_SPqstY8k2Wv1N0suV9bgLg_GRHCPxcc',   // the "publishable" / anon key

  // Branding (cosmetic only — the real team name comes from the database)
  APP_NAME: 'Team Hub',

  // Default location prefilled when the coach adds an event (optional)
  DEFAULT_LOCATION: 'Northwood Youth FC, Chestnut Avenue, Northwood, HA6 1HR',

  // Push notifications: your VAPID PUBLIC key (safe to be public).
  // The matching private key goes ONLY in the Edge Function secrets.
  VAPID_PUBLIC: 'BLZB0yA4mnOUQfuVtgoRRuBxths_oXd7Bg-Z-ZDQBxo19iiBiTlOU-eL4AsAZ2LvORa_MOX8QLqZRRoHM_0-kTc',
};
