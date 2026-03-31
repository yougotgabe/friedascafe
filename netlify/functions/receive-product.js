// netlify/functions/receive-product.js
const https = require('https');
function supabaseRequest(path, method, body, serviceRoleKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(supabaseUrl + path);
    const data = body ? JSON.stringify(body) : null;
    const options = { hostname: url.hostname, path: url.pathname + url.search, method: method, headers: { 'Content-Type': 'application/json', 'apikey': serviceRoleKey, 'Authorization': 'Bearer ' + serviceRoleKey, 'Prefer': 'resolution=merge-duplicates' } };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  let payload;
  try { payload = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const eventType = payload.type;
  const product = payload.resource && payload.resource.data ? payload.resource.data : payload;
  if (eventType === 'product:deleted') {
    const productId = payload.resource && payload.resource.id ? payload.resource.id : null;
    if (productId) await supabaseRequest('/rest/v1/products?id=eq.' + productId, 'DELETE', null, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }
  if (!product || !product.id) return { statusCode: 400, body: JSON.stringify({ error: 'No product data in payload' }) };
  let priceCents = 0;
  if (product.variants && product.variants.length > 0) {
    const enabled = product.variants.filter(function(v) { return v.is_enabled; });
    priceCents = enabled.length > 0 ? Math.min.apply(null, enabled.map(function(v) { return v.price; })) : product.variants[0].price || 0;
  }
  const images = product.images ? product.images.map(function(img) { return { src: img.src, is_default: img.is_default || false }; }) : [];
  const variants = product.variants ? product.variants.filter(function(v) { return v.is_enabled; }).map(function(v) { return { id: v.id, title: v.title, price: v.price, sku: v.sku || null }; }) : [];
  const productRow = { id: String(product.id), name: product.title || 'Unnamed Product', description: product.description || '', price_cents: priceCents, images: images, variants: variants, published: true };
  const result = await supabaseRequest('/rest/v1/products', 'POST', productRow, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL);
  if (result.status >= 400) return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save product', details: result.body }) };
  return { statusCode: 200, body: JSON.stringify({ received: true, product: productRow.name }) };
};
