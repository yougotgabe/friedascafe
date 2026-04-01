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

    const { cart } = body;
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return new Response(JSON.stringify({ error: 'Cart is empty or missing' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Build Stripe line_items from cart
    // Each cart item: { name, price_cents, quantity, variant_label, image_url }
    const lineItems = cart.map(item => {
      const params = new URLSearchParams();
      params.append('price_data[currency]', 'usd');
      params.append('price_data[unit_amount]', String(item.price_cents));
      params.append('price_data[product_data][name]', item.name + (item.variant_label ? ` — ${item.variant_label}` : ''));
      if (item.image_url) {
        params.append('price_data[product_data][images][]', item.image_url);
      }
      params.append('quantity', String(item.quantity || 1));
      return params;
    });

    // Build the full request body for Stripe
    const stripeParams = new URLSearchParams();
    stripeParams.append('mode', 'payment');
    stripeParams.append('success_url', `${new URL(request.url).origin}/merch.html?checkout=success`);
    stripeParams.append('cancel_url', `${new URL(request.url).origin}/merch.html?checkout=cancelled`);

    // Append each line item
    cart.forEach((item, i) => {
      stripeParams.append(`line_items[${i}][price_data][currency]`, 'usd');
      stripeParams.append(`line_items[${i}][price_data][unit_amount]`, String(item.price_cents));
      stripeParams.append(`line_items[${i}][price_data][product_data][name]`, item.name + (item.variant_label ? ` — ${item.variant_label}` : ''));
      if (item.image_url) {
        stripeParams.append(`line_items[${i}][price_data][product_data][images][]`, item.image_url);
      }
      stripeParams.append(`line_items[${i}][quantity]`, String(item.quantity || 1));
    });

    // Store cart data in metadata for webhook use
    stripeParams.append('metadata[cart]', JSON.stringify(cart).substring(0, 500));

    try {
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Stripe Connect: charge on behalf of the connected account
          'Stripe-Account': env.STRIPE_CONNECTED_ACCOUNT_FRIEDAS,
        },
        body: stripeParams.toString(),
      });

      const session = await stripeRes.json();

      if (!stripeRes.ok) {
        return new Response(JSON.stringify({ error: 'Stripe error', detail: session.error?.message }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ url: session.url }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
}