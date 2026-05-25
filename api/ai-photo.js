const https = require('https');

const PROMPT = 'Transform this shoe photo into a professional e-commerce product photo. Pure white background, clean studio lighting, sharp focus on all shoe details, no shadows, shoe perfectly centered. Preserve ALL original details: colors, textures, logos, sole pattern, laces. Remove any background, floor, furniture, hands or distractions. Result must look like a professional product photographer took it for an online store.';

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 requerido' });

  const GEMINI_KEY  = process.env.GEMINI_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SVC = process.env.SUPABASE_SERVICE_KEY;

  if (!GEMINI_KEY)   return res.status(500).json({ error: 'GEMINI_API_KEY no configurada' });
  if (!SUPABASE_SVC) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY no configurada' });

  // Limpiar prefijo data-URL si viene del browser
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  // Detectar mime type del prefijo o asumir jpeg
  const mimeMatch  = imageBase64.match(/^data:(image\/\w+);base64,/);
  const mimeType   = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  // Llamar Gemini 2.0 Flash Image
  const geminiBody = Buffer.from(JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: PROMPT }
      ]
    }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  }));

  const geminiRes = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${GEMINI_KEY}`,
    { 'Content-Type': 'application/json', 'Content-Length': geminiBody.length },
    geminiBody
  );

  if (geminiRes.status !== 200) {
    const detail = geminiRes.body.toString('utf8').slice(0, 400);
    return res.status(502).json({ error: 'Gemini error', detail });
  }

  const geminiJson = JSON.parse(geminiRes.body.toString('utf8'));
  // Buscar la parte con imagen en la respuesta
  const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inline_data?.mime_type?.startsWith('image/'));
  if (!imgPart) return res.status(502).json({ error: 'Gemini no devolvió imagen', raw: geminiJson?.candidates?.[0]?.content });

  const resultBuffer = Buffer.from(imgPart.inline_data.data, 'base64');
  const resultMime   = imgPart.inline_data.mime_type; // usualmente image/png o image/jpeg
  const ext          = resultMime.includes('png') ? 'png' : 'jpg';
  const filename     = `ai_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  // Subir a Supabase Storage
  const supaHost = new URL(SUPABASE_URL).hostname;
  const uploadRes = await httpsPost(
    supaHost,
    `/storage/v1/object/product-images/${filename}`,
    {
      'Authorization': `Bearer ${SUPABASE_SVC}`,
      'Content-Type': resultMime,
      'Content-Length': resultBuffer.length,
      'x-upsert': 'false'
    },
    resultBuffer
  );

  if (uploadRes.status >= 300) {
    const detail = uploadRes.body.toString('utf8').slice(0, 200);
    return res.status(502).json({ error: 'Supabase upload fallido', detail });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${filename}`;
  res.json({ url: publicUrl });
};
