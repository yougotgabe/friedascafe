// netlify/functions/create-checkout.js
// Creates a Stripe Checkout session for merch orders
// Uses Stripe Connect — payment goes to the connected client account
// DPS takes a platform fee on each transaction

const https = require('https');

function stripeRequest(path, method, body, secretKey) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : null;
    const options = {
      hostname: 'api.stripe.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded'
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

function flattenForStripe(obj, prefix, result) {
  result = result || {};
  for (var key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    var newKey = prefix ? prefix + '[' + key + ']' : key;
    if (Array.isArray(obj[key])) {
      obj[key].forEach(function(item, i) {
        flattenForStripe(item, newKey + '[' + i + ']', result);
      });
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      flattenForStripe(obj[key], newKey, result);
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_CONNECTED_ACCOUNT = process.env.STRIPE_CONNECTED_ACCOUNT_FRIEDAS;
  const SITE_URL = process.env.URL || 'https://chimerical-gingersnap-f01a5c.netlify.app';

  if (!STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { cart } = payload;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  const lineItems = cart.map(function(item) {
    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          images: item.image_url ? [item.image_url] : []
        },
        unit_amount: item.price_cents
      },
      quantity: item.quantity || 1
    };
  });

  const cartMeta = JSON.stringify(cart.map(function(item) {
    return {
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity || 1
    };
  }));

  const sessionBody = flattenForStripe({
    mode: 'payment',
    line_items: lineItems,
    success_url: SITE_URL + '/merch.html?checkout=success',
    cancel_url: SITE_URL + '/merch.html?checkout=cancelled',
    shipping_address_collection: { allowed_countries: ['US'] },
    metadata: { cart: cartMeta }
  });

  if (STRIPE_CONNECTED_ACCOUNT) {
    sessionBody['payment_intent_data[application_fee_amount]'] = 100;
    sessionBody['payment_intent_data[on_behalf_of]'] = STRIPE_CONNECTED_ACCOUNT;
  }

  const result = await stripeRequest('/v1/checkout/sessions', 'POST', sessionBody, STRIPE_SECRET_KEY);

  if (result.status >= 400) {
    console.error('Stripe error:', result.body);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create checkout session', details: result.body.error && result.body.error.message }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ url: result.body.url })
  };
};
