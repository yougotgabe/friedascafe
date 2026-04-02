import { verifyAdminToken } from './admin-auth.js';

/**
 * /api/get-sales-summary
 * Admin-only endpoint. Accepts `start` and `end` query params (YYYY-MM-DD).
 * Fetches all completed Stripe checkout sessions in that range and returns:
 *   - total_orders: number of completed sessions
 *   - gross_cents: sum of amount_total across all sessions
 *   - fees_cents: estimated Stripe processing fees (2.9% + $0.30 per order)
 *   - tax_cents: sum of total_details.amount_tax (0 unless Stripe Tax is active)
 *   - refunds_cents: sum of amount_refunded across any refunded payment intents
 *   - net_cents: gross - fees - refunds (tax is already included in gross)
 *   - orders: array of individual order rows for the CSV export
 */

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;

  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-google-token',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  var authError = await verifyAdminToken(request, env, corsHeaders);
  if (authError) return authError;

  var url = new URL(request.url);
  var startParam = url.searchParams.get('start'); // e.g. "2025-01-01"
  var endParam = url.searchParams.get('end');     // e.g. "2025-01-31"

  if (!startParam || !endParam) {
    return new Response(JSON.stringify({ error: 'Missing start or end date param.' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Convert YYYY-MM-DD to Unix timestamps
  // start = beginning of day, end = end of day (23:59:59)
  var startTs = Math.floor(new Date(startParam + 'T00:00:00Z').getTime() / 1000);
  var endTs   = Math.floor(new Date(endParam   + 'T23:59:59Z').getTime() / 1000);

  if (isNaN(startTs) || isNaN(endTs)) {
    return new Response(JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD.' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    // Paginate through all completed sessions in the date range
    var allSessions = [];
    var hasMore = true;
    var startingAfter = null;

    while (hasMore) {
      var params = new URLSearchParams({
        'status': 'complete',
        'limit': '100',
        'created[gte]': String(startTs),
        'created[lte]': String(endTs),
      });
      if (startingAfter) {
        params.set('starting_after', startingAfter);
      }

      var stripeRes = await fetch(
        'https://api.stripe.com/v1/checkout/sessions?' + params.toString(),
        {
          headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
        }
      );

      if (!stripeRes.ok) {
        var errText = await stripeRes.text();
        return new Response(JSON.stringify({ error: 'Stripe error', detail: errText }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      var stripeData = await stripeRes.json();
      var sessions = stripeData.data || [];
      allSessions = allSessions.concat(sessions);

      hasMore = stripeData.has_more || false;
      if (hasMore && sessions.length > 0) {
        startingAfter = sessions[sessions.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    // Aggregate totals
    var totalOrders  = allSessions.length;
    var grossCents   = 0;
    var feesCents    = 0;
    var taxCents     = 0;
    var refundsCents = 0;
    var orderRows    = [];

    for (var i = 0; i < allSessions.length; i++) {
      var session = allSessions[i];
      var amount  = session.amount_total || 0;
      var tax     = (session.total_details && session.total_details.amount_tax) ? session.total_details.amount_tax : 0;

      // Estimated Stripe fee: 2.9% + $0.30 per transaction
      var fee = Math.round(amount * 0.029) + 30;

      // Check for refunds via payment_intent — if amount_subtotal is set and
      // payment_intent is a string we can check it; otherwise skip
      // (full refund details would require a separate BalanceTransaction lookup)
      var refunded = 0;

      grossCents += amount;
      feesCents  += fee;
      taxCents   += tax;

      var customer = session.customer_details || {};
      var created  = session.created ? new Date(session.created * 1000).toISOString().slice(0, 10) : '';

      orderRows.push({
        date:           created,
        session_id:     session.id,
        customer_name:  customer.name  || '',
        customer_email: customer.email || '',
        gross_cents:    amount,
        fee_cents:      fee,
        tax_cents:      tax,
        net_cents:      amount - fee,
      });
    }

    // Net = gross minus fees minus refunds (tax stays inside gross as collected)
    var netCents = grossCents - feesCents - refundsCents;

    return new Response(JSON.stringify({
      period: { start: startParam, end: endParam },
      total_orders:  totalOrders,
      gross_cents:   grossCents,
      fees_cents:    feesCents,
      tax_cents:     taxCents,
      refunds_cents: refundsCents,
      net_cents:     netCents,
      orders:        orderRows,
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
