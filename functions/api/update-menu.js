export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
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

    // Password check
    const pw = request.headers.get('x-admin-password');
    if (!pw || pw !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { action, item } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const base = `${env.SUPABASE_URL}/rest/v1/menu_items`;
    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      let res;

      if (action === 'list') {
        res = await fetch(`${base}?order=category.asc,sort_order.asc,name.asc&select=*`, { headers });
        const data = await res.json();
        return new Response(JSON.stringify({ items: data }), {
          status: res.ok ? 200 : 502,
          headers: corsHeaders,
        });
      }

      if (action === 'add') {
        if (!item || !item.category || !item.name || !item.price) {
          return new Response(JSON.stringify({ error: 'Missing required fields: category, name, price' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        res = await fetch(base, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            category: item.category,
            name: item.name,
            description: item.description || '',
            price: item.price,
            sort_order: item.sort_order || 0,
            available: item.available !== undefined ? item.available : true,
          }),
        });
        const data = await res.json();
        return new Response(JSON.stringify({ success: res.ok, item: data[0] || null }), {
          status: res.ok ? 200 : 502,
          headers: corsHeaders,
        });
      }

      if (action === 'update') {
        if (!item || !item.id) {
          return new Response(JSON.stringify({ error: 'Missing item.id' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        const { id, ...fields } = item;
        res = await fetch(`${base}?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(fields),
        });
        const data = await res.json();
        return new Response(JSON.stringify({ success: res.ok, item: data[0] || null }), {
          status: res.ok ? 200 : 502,
          headers: corsHeaders,
        });
      }

      if (action === 'delete') {
        if (!item || !item.id) {
          return new Response(JSON.stringify({ error: 'Missing item.id' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        res = await fetch(`${base}?id=eq.${item.id}`, {
          method: 'DELETE',
          headers,
        });
        return new Response(JSON.stringify({ success: res.ok }), {
          status: res.ok ? 200 : 502,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
