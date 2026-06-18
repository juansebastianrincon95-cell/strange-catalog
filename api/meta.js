const https = require('https');
const requireApiKey = require('./_auth');
const { rateLimit } = require('./_rate_limit');

const GRAPH = 'graph.facebook.com';
const VER   = 'v21.0';

function graphRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request(
      { hostname: GRAPH, path: `/${VER}/${path}`, method, headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }},
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    // Timeout: las llamadas Graph (insights/campañas) son lentas; abortar a los 8s → 'error' → reject (lo captura el try/catch del handler)
    req.setTimeout(8000, () => req.destroy(new Error('graph-timeout')));
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  try {
  if (!requireApiKey(req, res)) return;
  if (!(await rateLimit(req, res, { scope: 'meta', max: 60, windowMs: 60_000 }))) return;

  res.setHeader('Access-Control-Allow-Origin', '*');

  const TOKEN    = (process.env.META_USER_TOKEN || '').trim();
  const ACCOUNT  = (process.env.META_AD_ACCOUNT_ID || '').trim();

  if (!TOKEN || !ACCOUNT) {
    return res.status(503).json({ error: 'META_USER_TOKEN or META_AD_ACCOUNT_ID not configured' });
  }

  const qs = s => `${s}${s.includes('?') ? '&' : '?'}access_token=${TOKEN}`;
  const copToMinor = v => String(Math.round(Number(v) * 100));

  if (req.method === 'GET') {
    const { resource, campaign_id, since, until } = req.query || {};

    if (resource === 'campaigns') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'insights' && campaign_id) {
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const safeSince = since && dateRe.test(since) ? since : null;
      const safeUntil = until && dateRe.test(until) ? until : null;
      const range = safeSince && safeUntil ? `&time_range={"since":"${safeSince}","until":"${safeUntil}"}` : '';
      const r = await graphRequest('GET', qs(`${campaign_id}/insights?fields=impressions,clicks,spend,reach,cpc,cpm,ctr,actions${range}`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'adsets' && campaign_id) {
      const r = await graphRequest('GET', qs(`${campaign_id}/adsets?fields=id,name,status,daily_budget,targeting`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'account') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}?fields=id,name,account_status,currency,spend_cap,amount_spent,balance,min_daily_budget,funding_source_details{id,type,display_string,coupon},disable_reason`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'pages') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}/promote_pages?fields=id,name`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'pixels') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}/adspixels?fields=id,name`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'audiences') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'ads') {
      const { adset_id } = req.query || {};
      if (!adset_id) return res.status(400).json({ error: 'adset_id requerido para resource=ads' });
      const r = await graphRequest('GET', qs(`${adset_id}/ads?fields=id,name,status,creative`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'page_posts') {
      const { page_id } = req.query || {};
      if (!page_id) return res.status(400).json({ error: 'page_id requerido para resource=page_posts' });
      const r = await graphRequest('GET', qs(`${page_id}/posts?fields=id,message,full_picture,created_time&limit=20`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'ig_media') {
      const { ig_user_id } = req.query || {};
      if (!ig_user_id) return res.status(400).json({ error: 'ig_user_id requerido para resource=ig_media' });
      const r = await graphRequest('GET', qs(`${ig_user_id}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=20`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'catalogs') {
      const BUSINESS = (process.env.META_BUSINESS_ID || '').trim();
      if (!BUSINESS) return res.status(503).json({ error: 'META_BUSINESS_ID not configured' });
      const r = await graphRequest('GET', qs(`${BUSINESS}/owned_product_catalogs?fields=id,name`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'product_sets') {
      const { catalog_id } = req.query || {};
      if (!catalog_id) return res.status(400).json({ error: 'catalog_id requerido para resource=product_sets' });
      const r = await graphRequest('GET', qs(`${catalog_id}/product_sets?fields=id,name,filter`));
      return res.status(r.status).json(r.body);
    }

    return res.status(400).json({ error: 'resource param required: campaigns | insights | adsets | account | pages | pixels | audiences | ads | page_posts | ig_media | catalogs | product_sets' });
  }

  if (req.method === 'POST') {
    const { action, payload } = req.body || {};

    if (action === 'update_campaign_budget') {
      const { campaign_id, daily_budget } = payload;
      const r = await graphRequest('POST', qs(`${campaign_id}`), { daily_budget: copToMinor(daily_budget) });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_campaign_status') {
      const { campaign_id, status } = payload;
      const r = await graphRequest('POST', qs(`${campaign_id}`), { status });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_adset_budget') {
      const { adset_id, daily_budget } = payload;
      const r = await graphRequest('POST', qs(`${adset_id}`), { daily_budget: copToMinor(daily_budget) });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_campaign') {
      const { name, objective, daily_budget, status = 'PAUSED' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/campaigns`), {
        name, objective, daily_budget: copToMinor(daily_budget), status,
        special_ad_categories: []
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_adset') {
      const { campaign_id, name, daily_budget, optimization_goal, billing_event, targeting, promoted_object, status = 'PAUSED' } = payload;
      const body = {
        campaign_id, name,
        optimization_goal: optimization_goal || 'OFFSITE_CONVERSIONS',
        billing_event: billing_event || 'IMPRESSIONS',
        targeting: targeting || { geo_locations: { countries: ['CO'] } },
        status,
        special_ad_categories: []
      };
      if (daily_budget) body.daily_budget = copToMinor(daily_budget);
      if (promoted_object) body.promoted_object = promoted_object;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adsets`), body);
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_adcreative') {
      const { page_id, name, image_url, message, headline, link, call_to_action = 'SHOP_NOW' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adcreatives`), {
        name,
        object_story_spec: {
          page_id,
          link_data: {
            image_url,
            link,
            message,
            name: headline,
            call_to_action: { type: call_to_action, value: { link } }
          }
        }
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_ad') {
      const { name, adset_id, creative_id, status = 'PAUSED' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/ads`), {
        name, adset_id, creative: { creative_id }, status
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_adset_status') {
      const { adset_id, status } = payload;
      const r = await graphRequest('POST', qs(`${adset_id}`), { status });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_ad_status') {
      const { ad_id, status } = payload;
      const r = await graphRequest('POST', qs(`${ad_id}`), { status });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_ad_from_post') {
      const { page_id, post_id, name } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adcreatives`), {
        name,
        object_story_id: `${page_id}_${post_id}`
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_ig_ad') {
      const { ig_user_id, ig_media_id, name } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adcreatives`), {
        name,
        instagram_user_id: ig_user_id,
        source_instagram_media_id: ig_media_id
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_dpa_adcreative') {
      const { page_id, name, product_set_id, link, message, call_to_action = 'SHOP_NOW' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adcreatives`), {
        name,
        object_story_spec: {
          page_id,
          template_data: {
            link,
            message,
            name: '{{product.name}}',
            description: '{{product.description}} — {{product.current_price}}',
            call_to_action: { type: call_to_action }
          }
        },
        product_set_id
      });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_dpa_adset') {
      const { campaign_id, name, product_set_id, pixel_id, daily_budget, status = 'PAUSED' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/adsets`), {
        campaign_id, name, status,
        optimization_goal: 'OFFSITE_CONVERSIONS',
        billing_event: 'IMPRESSIONS',
        daily_budget: copToMinor(daily_budget),
        promoted_object: {
          product_set_id,
          custom_event_type: 'PURCHASE'
        },
        targeting: {
          geo_locations: { countries: ['CO'] },
          dynamic_audience_targeting: 'REMARKETING_ONLY',
          pixel_id
        },
        special_ad_categories: []
      });
      return res.status(r.status).json(r.body);
    }

    return res.status(400).json({ error: 'action requerido: update_campaign_budget | update_campaign_status | update_adset_budget | create_campaign | create_adset | create_adcreative | create_ad | update_adset_status | update_ad_status | create_ad_from_post | create_ig_ad | create_dpa_adcreative | create_dpa_adset' });
  }

  res.status(405).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
