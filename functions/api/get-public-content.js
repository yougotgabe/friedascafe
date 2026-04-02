export async function onRequest(context) {
  const { request, env } = context;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Fetch all public-facing keys from site_content
      const publicKeys = [
        'hours_weekday',
        'hours_saturday',
        'hours_sunday',
        'holiday_notice_active',
        'holiday_notice_text',
        'payment_note',
        'hero_photo_url',
        'story_image_url',
        'menu_image_url',
        'staff_image_url',
        ...Array.from({ length: 20 }, (_, i) => `gallery_image_${i + 1}`),
        'review_1',
        'review_2',
        'review_3',
      ];

      const inList = publicKeys.map(k => `"${k}"`).join(',');

      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/site_content?key=in.(${inList})`,
        {
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          },
        }
      );

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: 'Supabase error', detail: err }), {
          status: 502,
          headers: corsHeaders,
        });
      }

      const rows = await res.json();
      // Convert array of {key, value} rows to a flat object.
      // Normalize all values to strings so the frontend gets consistent types
      // regardless of how Supabase coerces column values (e.g. boolean vs text).
      const data = {};
      for (const row of rows) {
        data[row.key] = row.value === null || row.value === undefined
          ? ''
          : String(row.value);
      }

      return new Response(JSON.stringify(data), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
}