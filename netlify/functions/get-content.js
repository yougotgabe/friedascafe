// netlify/functions/get-content.js
// Returns current site_content rows for the admin panel
// Protected by the same ADMIN_PASSWORD as update-content.js

const https = require('https');

function supabaseRequest(path, serviceRoleKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(supabaseUrl + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': 'Bearer ' + serviceRoleKey
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
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

  const result = await supabaseRequest('/rest/v1/site_content?select=key,value', SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL);

  if (result.status >= 400) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch content' }) };
  }

  // Convert array of {key, value} into a plain object for easy use
  var content = {};
  result.body.forEach(function(row) { content[row.key] = row.value; });

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, content: content }) };
};
