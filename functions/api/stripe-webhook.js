// Cloudflare Workers implementation of Stripe webhook verification.
// Stripe uses HMAC-SHA256 with the raw request body — we must NOT parse the body
// before verifying the signature.

export async function onRequest(context) {
  const { request, env } = context;
    const corsHeaders = {
      'Content-Type': 'application/json',
    };

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    const sig = request.headers.get('stripe-signature');
    if (!sig) {
      return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Read raw body as text for signature verification
    const rawBody = await request.text();

    // Verify Stripe webhook signature
    let event;
    try {
      event = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: `Signature verification failed: ${err.message}` }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Only handle checkout.session.completed
    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true, action: 'ignored' }), {
        headers: corsHeaders,
      });
    }

    const session = event.data.object;

    // Parse cart from session metadata
    let cart = [];
    try {
      cart = JSON.parse(session.metadata?.cart || '[]');
    } catch {
      cart = [];
    }

    // Get shipping details from session
    const shipping = session.shipping_details || {};
    const customer = session.customer_details || {};

    if (cart.length === 0) {
      // No cart metadata — nothing to fulfill
      return new Response(JSON.stringify({ received: true, action: 'no_cart' }), {
        headers: corsHeaders,
      });
    }

    // Fire Printify order
    try {
      const printifyOrder = {
        external_id: session.id,
        label: `Frieda's Cafe — ${session.id.substring(0, 8)}`,
        line_items: cart.map(item => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity || 1,
        })),
        shipping_method: 1,
        send_shipping_notification: true,
        address_to: {
          first_name: customer.name ? customer.name.split(' ')[0] : '',
          last_name: customer.name ? customer.name.split(' ').slice(1).join(' ') : '',
          email: customer.email || '',
          phone: customer.phone || '',
          country: shipping.address?.country || 'US',
          region: shipping.address?.state || '',
          address1: shipping.address?.line1 || '',
          address2: shipping.address?.line2 || '',
          city: shipping.address?.city || '',
          zip: shipping.address?.postal_code || '',
        },
      };

      const printifyRes = await fetch(
        `https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/orders.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(printifyOrder),
        }
      );

      if (!printifyRes.ok) {
        const err = await printifyRes.text();
        console.error('Printify order failed:', err);
        // Still return 200 to Stripe — we don't want retries for fulfillment errors
        return new Response(JSON.stringify({ received: true, fulfillment: 'failed', detail: err }), {
          headers: corsHeaders,
        });
      }

      const orderResult = await printifyRes.json();
      return new Response(JSON.stringify({ received: true, fulfillment: 'success', orderId: orderResult.id }), {
        headers: corsHeaders,
      });
    } catch (err) {
      console.error('Fulfillment error:', err);
      return new Response(JSON.stringify({ received: true, fulfillment: 'error', detail: err.message }), {
        headers: corsHeaders,
      });
    }
}

/**
 * Verify a Stripe webhook signature using the Web Crypto API.
 * Stripe signature format: t=<timestamp>,v1=<hmac>,...
 */
async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',');
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1') signatures.push(v);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid signature format');
  }

  // Reject if timestamp is older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) {
    throw new Error('Timestamp too old');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const isValid = signatures.some(s => s === expectedSig);
  if (!isValid) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(payload);
}
