import { verifyAdminToken } from './admin-auth.js';
export async function onRequest(context) {
  const { request, env } = context;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-google-token',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Google token auth
    const authError = await verifyAdminToken(request, env, corsHeaders);
    if (authError) return authError;

    try {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/site_content?select=*`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: 'Supabase error', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      const rows = await res.json();
      const data = {};
      for (const row of rows) {
        data[row.key] = row.value;
      }

      return new Response(JSON.stringify(data), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
}