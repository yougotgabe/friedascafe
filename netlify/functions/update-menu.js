// netlify/functions/update-menu.js
// Add, edit, or delete menu items — password protected

const https = require('https');

function supabaseRequest(path, method, body, serviceRoleKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(supabaseUrl + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': 'Bearer ' + serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: responseData ? JSON.parse(responseData) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: responseData }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!payload.password || payload.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { action, item } = payload;

  // action: 'add' | 'update' | 'delete' | 'list'
  if (action === 'list') {
    const result = await supabaseRequest(
      '/rest/v1/menu_items?order=category,sort_order',
      'GET', null, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    );
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, items: result.body }) };
  }

  if (action === 'add') {
    const row = {
      category: item.category,
      name: item.name,
      description: item.description || '',
      price: item.price,
      sort_order: item.sort_order || 0,
      available: item.available !== false
    };
    const result = await supabaseRequest('/rest/v1/menu_items', 'POST', row, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL);
    if (result.status >= 400) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to add item', details: result.body }) };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, item: result.body }) };
  }

  if (action === 'update') {
    if (!item.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing item id' }) };
    const row = {};
    if (item.name !== undefined) row.name = item.name;
    if (item.description !== undefined) row.description = item.description;
    if (item.price !== undefined) row.price = item.price;
    if (item.category !== undefined) row.category = item.category;
    if (item.sort_order !== undefined) row.sort_order = item.sort_order;
    if (item.available !== undefined) row.available = item.available;

    const result = await supabaseRequest(
      `/rest/v1/menu_items?id=eq.${item.id}`,
      'PATCH', row, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    );
    if (result.status >= 400) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update item' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  if (action === 'delete') {
    if (!item.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing item id' }) };
    const result = await supabaseRequest(
      `/rest/v1/menu_items?id=eq.${item.id}`,
      'DELETE', null, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
    );
    if (result.status >= 400) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to delete item' }) };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};
