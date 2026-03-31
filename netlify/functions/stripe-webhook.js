// netlify/functions/stripe-webhook.js
// Listens for Stripe payment confirmations
// On successful payment: fires a Printify order for each cart item
// CRITICAL: Must verify Stripe webhook signature to prevent fake events

const https = require('https');
const crypto = require('crypto');

// Verify Stripe webhook signature
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',');
  let timestamp = null;
  const signatures = [];

  parts.forEach(function(part) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  });

  if (!timestamp || signatures.length === 0) return false;

  // Reject events older than 5 minutes
  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) {
    console.error('Webhook timestamp too old');
    return false;
  }

  const signedPayload = timestamp + '.' + payload;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return signatures.some(function(sig) {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  });
}

function printifyRequest(path, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.printify.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'DreadPirateStudio/1.0'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseData) }); }
        catch (e) { resolve({ status: res.statusCode, body: responseData }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const PRINTIFY_API_KEY = process.env.PRINTIFY_API_KEY; // Set when client shares it
  const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID; // Set when client shares it

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  // Verify the webhook signature
  const sigHeader = event.headers['stripe-signature'];
  if (!sigHeader) {
    console.error('Missing stripe-signature header');
    return { statusCode: 400, body: 'Missing signature' };
  }

  const isValid = verifyStripeSignature(event.body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error('Invalid Stripe signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  // Only handle successful checkouts
  if (stripeEvent.type !== 'checkout.session.completed') {
    console.log('Ignoring event type:', stripeEvent.type);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = stripeEvent.data.object;
  console.log('Payment completed, session:', session.id);

  // Extract cart from metadata
  let cartItems;
  try {
    cartItems = JSON.parse(session.metadata && session.metadata.cart);
  } catch (e) {
    console.error('Could not parse cart metadata:', e);
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: 'Could not parse cart' }) };
  }

  if (!cartItems || cartItems.length === 0) {
    console.error('Empty cart in metadata');
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // If no Printify keys, log and return (manual fulfillment mode)
  if (!PRINTIFY_API_KEY || !PRINTIFY_SHOP_ID) {
    console.log('Printify not configured — manual fulfillment needed for session:', session.id);
    console.log('Cart items:', JSON.stringify(cartItems));
    return { statusCode: 200, body: JSON.stringify({ received: true, note: 'Manual fulfillment needed' }) };
  }

  // Build Printify order
  const shippingDetails = session.shipping_details || {};
  const address = shippingDetails.address || {};

  const printifyOrder = {
    external_id: session.id,
    label: 'Order from Frieda\'s Cafe Shop',
    line_items: cartItems.map(function(item) {
      return {
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity || 1
      };
    }),
    shipping_method: 1, // Standard shipping
    send_shipping_notification: true,
    address_to: {
      first_name: (shippingDetails.name || 'Customer').split(' ')[0],
      last_name: (shippingDetails.name || '').split(' ').slice(1).join(' ') || 'Customer',
      email: session.customer_details && session.customer_details.email || '',
      phone: '',
      country: address.country || 'US',
      region: address.state || '',
      address1: address.line1 || '',
      address2: address.line2 || '',
      city: address.city || '',
      zip: address.postal_code || ''
    }
  };

  console.log('Submitting Printify order:', JSON.stringify(printifyOrder));

  const result = await printifyRequest(
    '/v1/shops/' + PRINTIFY_SHOP_ID + '/orders.json',
    'POST',
    printifyOrder,
    PRINTIFY_API_KEY
  );

  if (result.status >= 400) {
    console.error('Printify order failed:', result.body);
    // Still return 200 to Stripe — we don't want retries, we'll handle manually
    return { statusCode: 200, body: JSON.stringify({ received: true, error: 'Printify order failed', details: result.body }) };
  }

  console.log('Printify order created:', result.body.id);
  return { statusCode: 200, body: JSON.stringify({ received: true, printify_order: result.body.id }) };
};
