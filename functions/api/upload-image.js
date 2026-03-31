export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
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

    // Password check
    const pw = request.headers.get('x-admin-password');
    if (!pw || pw !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const VALID_KEYS = [
      'story_image_url',
      'menu_image_url',
      'staff_image_url',
      ...Array.from({ length: 20 }, (_, i) => `gallery_image_${i + 1}`),
    ];

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { key, filename, contentType, data } = body;
    // data is a base64-encoded string of the image bytes

    if (!key || !VALID_KEYS.includes(key)) {
      return new Response(
        JSON.stringify({ error: `Invalid key. Must be one of: ${VALID_KEYS.join(', ')}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!filename || !contentType || !data) {
      return new Response(JSON.stringify({ error: 'Missing filename, contentType, or data' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    try {
      // Decode base64 → binary
      const binaryStr = atob(data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Build a unique storage path to avoid collisions
      const ext = filename.split('.').pop();
      const storagePath = `${key}-${Date.now()}.${ext}`;
      const bucket = 'site-images';

      // Upload to Supabase Storage
      const uploadRes = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`,
        {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': contentType,
            'Cache-Control': '3600',
            'x-upsert': 'true',
          },
          body: bytes,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return new Response(JSON.stringify({ error: 'Storage upload failed', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      // Build the public URL
      const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;

      // Save URL to site_content
      const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/site_content`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify([{ key, value: publicUrl }]),
      });

      if (!upsertRes.ok) {
        const err = await upsertRes.text();
        return new Response(JSON.stringify({ error: 'DB update failed', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ success: true, url: publicUrl }), {
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
