import { verifyAdminToken } from './admin-auth.js';
export async function onRequest(context) {
  const { request, env } = context;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-google-token',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Google token auth
    const authError = await verifyAdminToken(request, env, corsHeaders);
    if (authError) return authError;

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // body should be an object of key:value pairs to upsert
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Body must be a key/value object' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const rows = Object.entries(body).map(([key, value]) => ({ key, value: String(value) }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), { headers: corsHeaders });
    }

    try {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/site_content`,
        {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(rows),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: 'Supabase error', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ success: true, updated: rows.length }), {
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
}