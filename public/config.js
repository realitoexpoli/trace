// Public settings for the web app. These values are safe to publish:
// the Supabase key here is the public "anon" (or "publishable") key, protected by the
// database rules in supabase/migrations/001_init.sql, and the Paddle token is a client-side token.
// NEVER put the Supabase service role key or the Paddle API key in this file.
window.TRACE_CONFIG = {
  supabaseUrl: 'https://hlzkdphhbnmwdixpuvwk.supabase.co/',          // e.g. 'https://abcdefghijk.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsemtkcGhoYm5td2RpeHB1dndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjM2MTksImV4cCI6MjEwNzEzOTYxOX0.z_bXy-KWrClO4BLWZYXLmUefK4A_g3l1rOo8KCzqGDU',      // Project Settings → API → anon / publishable key
  googleSignIn: false,      // true once Google is enabled in Supabase → Authentication → Providers

  paddleEnv: 'sandbox',     // 'sandbox' while testing, 'production' when live
  paddleClientToken: '',    // Paddle → Developer tools → Authentication → client-side token
  prices: {                 // Paddle → Catalog → Products → Tracé Pro → price ids
    monthly: '',            // e.g. 'pri_01h...'
    yearly: '',
  },
  priceLabels: { monthly: '$8 a month', yearly: '$72 a year (save 25%)' },

  // Free plan limits, shown in the app. The real limits live in the database (plan_limits).
  freeDecks: 3,
};
