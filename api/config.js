// api/config.js — Vercel serverless function
// Returns public config including Google Maps API key and Supabase credentials.
// These are safe to expose: Maps key is restricted by referrer in Google Cloud Console,
// and Supabase anon key is designed for public use with RLS enforcing security.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    mapsKey:          process.env.GOOGLE_MAPS_API_KEY   ?? '',
    supabaseUrl:      process.env.SUPABASE_URL          ?? '',
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY     ?? '',
  });
}
