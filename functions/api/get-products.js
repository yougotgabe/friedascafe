export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products?published=eq.true&order=created_at.desc&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return new Response(
        JSON.stringify({ error: 'Supabase error', detail: err }),
        {
          status: 502,
          headers: corsHeaders,
        }
      );
    }

    const rows = await res.json();

    const products = rows.map((product) => ({
      ...product,
      images: parseJsonArray(product.images),
      variants: parseJsonArray(product.variants),
      price_cents: Number(product.price_cents || 0),
    }));

    return new Response(JSON.stringify({ products }), {
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
