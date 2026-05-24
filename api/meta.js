const https = require('https');
const requireApiKey = require('./_auth');

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
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;

  res.setHeader('Access-Control-Allow-Origin', '*');

  const TOKEN    = process.env.META_USER_TOKEN;
  const ACCOUNT  = process.env.META_AD_ACCOUNT_ID;

  if (!TOKEN || !ACCOUNT) {
    return res.status(503).json({ error: 'META_USER_TOKEN or META_AD_ACCOUNT_ID not configured' });
  }

  const qs = s => `${s}${s.includes('?') ? '&' : '?'}access_token=${TOKEN}`;

  if (req.method === 'GET') {
    const { resource, campaign_id, since, until } = req.query || {};

    if (resource === 'campaigns') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'insights' && campaign_id) {
      const range = since && until ? `&time_range={"since":"${since}","until":"${until}"}` : '';
      const r = await graphRequest('GET', qs(`${campaign_id}/insights?fields=impressions,clicks,spend,reach,cpc,cpm,ctr,actions${range}`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'adsets' && campaign_id) {
      const r = await graphRequest('GET', qs(`${campaign_id}/adsets?fields=id,name,status,daily_budget,targeting`));
      return res.status(r.status).json(r.body);
    }

    if (resource === 'account') {
      const r = await graphRequest('GET', qs(`${ACCOUNT}?fields=id,name,account_status,currency,spend_cap,amount_spent`));
      return res.status(r.status).json(r.body);
    }

    return res.status(400).json({ error: 'resource param required: campaigns | insights | adsets | account' });
  }

  if (req.method === 'POST') {
    const { action, payload } = req.body || {};

    if (action === 'update_campaign_budget') {
      const { campaign_id, daily_budget } = payload;
      const r = await graphRequest('POST', qs(`${campaign_id}`), { daily_budget: String(daily_budget * 100) });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_campaign_status') {
      const { campaign_id, status } = payload;
      const r = await graphRequest('POST', qs(`${campaign_id}`), { status });
      return res.status(r.status).json(r.body);
    }

    if (action === 'update_adset_budget') {
      const { adset_id, daily_budget } = payload;
      const r = await graphRequest('POST', qs(`${adset_id}`), { daily_budget: String(daily_budget * 100) });
      return res.status(r.status).json(r.body);
    }

    if (action === 'create_campaign') {
      const { name, objective, daily_budget, status = 'PAUSED' } = payload;
      const r = await graphRequest('POST', qs(`${ACCOUNT}/campaigns`), {
        name, objective, daily_budget: String(daily_budget * 100), status,
        special_ad_categories: []
      });
      return res.status(r.status).json(r.body);
    }

    return res.status(400).json({ error: 'action requerido: update_campaign_budget | update_campaign_status | update_adset_budget | create_campaign' });
  }

  res.status(405).end();
};
