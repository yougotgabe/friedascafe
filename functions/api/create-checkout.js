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

  try {
    if (!env.STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const body = await request.json();
    const cart = Array.isArray(body?.cart) ? body.cart : [];

    if (!cart.length) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const origin = new URL(request.url).origin;
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${origin}/merch?checkout=success`);
    params.append('cancel_url', `${origin}/merch?checkout=cancel`);

    // Store cart as metadata so the webhook and order view can read it
    const cartSummary = cart.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price_cents: item.price_cents,
      variant_id: item.variant_id || '',
      product_id: item.product_id || '',
    }));
    const cartJson = JSON.stringify(cartSummary);
    if (cartJson.length <= 500) {
      params.append('metadata[cart]', cartJson);
    }

    cart.forEach((item, index) => {
      const name = String(item.name || 'Item');
      const unitAmount = Number(item.price_cents || 0);
      const quantity = Number(item.quantity || 1);
      const imageUrl = item.image_url ? String(item.image_url) : '';

      if (unitAmount <= 0 || quantity <= 0) {
        return;
      }

      params.append(`line_items[${index}][price_data][currency]`, 'usd');
      params.append(`line_items[${index}][price_data][unit_amount]`, String(unitAmount));
      params.append(`line_items[${index}][price_data][product_data][name]`, name);

      if (imageUrl) {
        params.append(`line_items[${index}][price_data][product_data][images][0]`, imageUrl);
      }

      params.append(`line_items[${index}][quantity]`, String(quantity));
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const stripeData = await stripeRes.json();

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({
        error: 'Stripe error',
        detail: stripeData?.error?.message || stripeData,
      }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ url: stripeData.url }), {
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Checkout failed' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
