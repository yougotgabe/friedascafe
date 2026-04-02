/**
 * /api/get-orders
 * Admin-only endpoint. Fetches recent completed Stripe checkout sessions,
 * then looks up each order in Printify to get fulfillment/shipping status.
 * Nothing is stored — data is fetched live from both APIs on every request.
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Admin password check
  const pw = request.headers.get('x-admin-password');
  if (!pw || pw !== env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    // ── STEP 1: Fetch recent completed Stripe checkout sessions ──
    const stripeParams = new URLSearchParams({
      'status': 'complete',
      'limit': '25',
      'expand[]': 'data.line_items',
    });

    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions?${stripeParams}`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        },
      }
    );

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      return new Response(JSON.stringify({ error: 'Stripe error', detail: err }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const stripeData = await stripeRes.json();
    const sessions = stripeData.data || [];

    // ── STEP 2: Fetch all Printify orders (one call, then match by external_id) ──
    let printifyOrders = [];
    if (env.PRINTIFY_API_KEY && env.PRINTIFY_SHOP_ID) {
      try {
        const printifyRes = await fetch(
          `https://api.printify.com/v1/shops/${env.PRINTIFY_SHOP_ID}/orders.json?limit=25`,
          {
            headers: {
              Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
            },
          }
        );
        if (printifyRes.ok) {
          const pd = await printifyRes.json();
          printifyOrders = pd.data || [];
        }
      } catch {
        // Printify is optional — don't fail the whole request
        printifyOrders = [];
      }
    }

    // Build a lookup map: Stripe session ID → Printify order
    const printifyMap = {};
    for (const po of printifyOrders) {
      if (po.external_id) {
        printifyMap[po.external_id] = po;
      }
    }

    // ── STEP 3: Merge and shape the response ──
    const orders = sessions.map(session => {
      const customer = session.customer_details || {};
      const shipping = session.shipping_details || {};
      const printifyOrder = printifyMap[session.id] || null;

      // Parse cart metadata (set by create-checkout.js)
      let cartItems = [];
      try {
        cartItems = JSON.parse(session.metadata?.cart || '[]');
      } catch {
        cartItems = [];
      }

      // Fall back to Stripe line items if no metadata cart
      if (cartItems.length === 0 && session.line_items?.data) {
        cartItems = session.line_items.data.map(li => ({
          name: li.description || li.price?.product?.name || 'Item',
          quantity: li.quantity,
          price_cents: li.amount_total,
        }));
      }

      // Determine fulfillment status
      let fulfillmentStatus = 'pending';
      let trackingUrl = null;
      let trackingNumber = null;

      if (printifyOrder) {
        const s = printifyOrder.status;
        if (s === 'fulfilled' || s === 'shipped') {
          fulfillmentStatus = 'shipped';
        } else if (s === 'in-production' || s === 'sending-to-production') {
          fulfillmentStatus = 'in-production';
        } else if (s === 'cancelled') {
          fulfillmentStatus = 'cancelled';
        } else {
          fulfillmentStatus = 'pending';
        }

        // Get tracking from first shipment if available
        const shipments = printifyOrder.shipments || [];
        if (shipments.length > 0) {
          trackingUrl = shipments[0].url || null;
          trackingNumber = shipments[0].number || null;
        }
      }

      return {
        id: session.id,
        created: session.created, // Unix timestamp
        customer: {
          name: customer.name || 'Unknown',
          email: customer.email || '',
          address: shipping.address ? [
            shipping.address.line1,
            shipping.address.city,
            shipping.address.state,
            shipping.address.postal_code,
          ].filter(Boolean).join(', ') : '',
        },
        total_cents: session.amount_total || 0,
        items: cartItems,
        fulfillment: {
          status: fulfillmentStatus,
          printify_id: printifyOrder?.id || null,
          tracking_url: trackingUrl,
          tracking_number: trackingNumber,
        },
      };
    });

    return new Response(JSON.stringify({ orders }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
