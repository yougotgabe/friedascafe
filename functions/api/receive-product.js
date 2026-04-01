export async function onRequest(context) {
  const { request, env } = context;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Printify sends a webhook payload. We expect a product object.
    // The exact shape depends on Printify's webhook format.
    // We'll upsert into the products table.
    const product = body.resource || body;

    if (!product || !product.id) {
      return new Response(JSON.stringify({ error: 'No product data in payload' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    try {
      const row = {
        id: String(product.id),
        name: product.title || product.name || '',
        description: product.description || '',
        price_cents: product.variants && product.variants[0]
          ? Math.round(Number(product.variants[0].price))
          : 0,
        images: JSON.stringify(product.images || []),
        variants: JSON.stringify(product.variants || []),
        published: product.visible !== false,
      };

      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/products`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify([row]),
      });

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: 'DB upsert failed', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
}