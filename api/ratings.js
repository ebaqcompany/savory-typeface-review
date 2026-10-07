// Vercel serverless function: shared ratings for the SAVORY typeface review.
// Storage: Upstash Redis (Vercel Marketplace). Reads the REST URL/token Vercel injects when the store is
// connected to the project (KV_REST_API_* or UPSTASH_REDIS_REST_*). One hash, one field per reviewer.
//   GET  /api/ratings            -> { reviewers: [{ name, fonts, updated }] }
//   POST /api/ratings {name,fonts} -> saves that reviewer's ratings, returns { ok, updated }

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'savory:typeface-review:ratings';

async function redis(command) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`Storage error ${r.status}`);
  return (await r.json()).result;
}

const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function clean(fonts) {
  const out = {};
  if (!fonts || typeof fonts !== 'object') return out;
  for (const [k, v] of Object.entries(fonts).slice(0, 100)) {
    if (!/^[a-z0-9-]{1,60}$/.test(k) || !v || typeof v !== 'object') continue;
    const stars = Math.max(0, Math.min(5, Math.round(Number(v.stars) || 0)));
    const note = typeof v.note === 'string' ? v.note.slice(0, 500) : '';
    const weight = typeof v.weight === 'string' ? v.weight.slice(0, 40) : '';
    if (stars || note) out[k] = { stars, note, weight };
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'Ratings storage is not connected yet.' });
  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', KEY])) || [];
      const reviewers = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { reviewers.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip a corrupt row */ }
      }
      return res.status(200).json({ reviewers });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name || !slug(name)) return res.status(400).json({ error: 'Add your name first.' });
      const row = { name, fonts: clean(body.fonts), updated: Date.now() };
      await redis(['HSET', KEY, slug(name), JSON.stringify(row)]);
      return res.status(200).json({ ok: true, updated: row.updated });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Could not reach ratings storage. Try again in a moment.' });
  }
}
