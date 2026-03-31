export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Password check
    const pw = request.headers.get('x-admin-password');
    if (!pw || pw !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

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
  },
};
