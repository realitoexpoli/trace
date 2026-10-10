// Public settings for the web app. These values are safe to publish:
// the Supabase key here is the public "anon" (or "publishable") key, protected by the
// database rules in supabase/migrations/001_init.sql, and the Paddle token is a client-side token.
// NEVER put the Supabase service role key or the Paddle API key in this file.
window.TRACE_CONFIG = {
  supabaseUrl: 'https://hlzkdphhbnmwdixpuvwk.supabase.co/',          // e.g. 'https://abcdefghijk.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsemtkcGhoYm5td2RpeHB1dndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjM2MTksImV4cCI6MjEwNzEzOTYxOX0.z_bXy-KWrClO4BLWZYXLmUefK4A_g3l1rOo8KCzqGDU',      // Project Settings → API → anon / publishable key
  signInWith: { google: false, github: false },      // true once Google is enabled in Supabase → Authentication → Providers

  supportEmail: 'support@traceanim.com',

  paddleEnv: 'sandbox',
  paddleClientToken: 'test_0df27dc26d9163a2457a556f359',
  prices: {
    monthly: 'pri_01m4k3mh2xq60mjz76mdr84x4m',
    yearly: 'pri_01m4k3np8r3ws83b8qr2w1q0bc',
  },
  priceLabels: { monthly: '$8 a month', yearly: '$72 a year (save 25%)' },

  // Free plan limits, shown in the app. The real limits live in the database (plan_limits).
  freeDecks: 3,
};
