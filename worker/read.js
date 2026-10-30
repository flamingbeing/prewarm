// Reading handwriting crops (prewarm/NOTES.md, phone-direct scan): the phone cuts de-identified cells (numbers, times) out of
// a tidied page and posts them here; the Worker asks Claude Haiku to read each crop twice (two prompts) and sends the readings
// back. Nothing is stored or logged: no image and no text.
//   POST /scan-api/read   JSON {page: 1-14, crops: [{id, png: <base64 PNG>}]}   (at most 40 crops, each at most 40 KB)
//     -> [{id, a: {text, legible}, b: {text, legible}}]
// Only fields in worker/fields.js of type num or time are read: any other id is refused (400), so a buggy or tampered phone
// cannot send a name, ID, date or free text to the model. Same Access check as worker/scan.js.
// Set in Cloudflare (never in this repo): ACCESS_TEAM and SCAN_ACCESS_AUD (as for scan.js) and ANTHROPIC_API_KEY.
import { verifyAccess } from './access.js';
import { FIELDS } from './fields.js';
import { SCAN_HOST } from './scan.js';
export { READ_PATH } from './routes.js';

export const MAX_CROP = 40 * 1024, MAX_CROPS = 40;
const MAX_BODY = MAX_CROPS * (Math.ceil(MAX_CROP / 3) * 4 + 200) + 1024;
const READABLE = new Set(['num', 'time']);
const MODEL = 'claude-haiku-5-5';
const API = 'https://api.anthropic.com/v1/messages';
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// copied in spirit from prewarm/tools/scan/readers.py (PROMPT_A, PROMPT_B)
const PROMPT_A = 'This is a cropped cell from a printed anaesthesia study data sheet, photographed with a phone. ' +
  'Field: "{label}"{unit}. Expected: {expect}. Printed text (labels, units, lines, tick boxes) may be visible: ' +
  'read ONLY the handwritten entry. Reply with JSON only: {"text": "<what is written>", "legible": true|false}. ' +
  'Read the entry in the middle of the image; digits cut off at the edges belong to a neighbouring cell. Use digits, and "." or ":" if written, and a leading minus sign if there is one. A cell with no handwriting is {"text": "", "legible": true}. If the cell holds only an arrow, a long vertical line or a ditto mark ("same as above"), reply {"text": "ARROW", "legible": true}. If a number is struck through and rewritten, read the rewritten one and set legible to false. ' +
  'If you are not certain of every digit set legible to false and still give your best reading. Do not guess from context.';
const PROMPT_B = 'Transcribe the handwriting in this image digit by digit. It is one entry for "{label}"{unit} ({expect}); ' +
  'ignore anything printed. Return JSON only: {"text": "...", "legible": true|false}. Empty if nothing is written. ' +
  'legible=false if any character could be read two ways.';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

function expectOf(f) {
  if (f.opts && f.opts.length) return 'one of ' + f.opts.map(o => Array.isArray(o) ? o[1] : o).join(', ') + ' (often just the first letter, or the number)';
  return f.type === 'time' ? 'a 24-hour clock time such as 07:05' : 'a decimal number';
}
const promptFor = (tpl, f) => tpl.replace('{label}', () => f.label).replace('{unit}', () => f.unit ? ` (${f.unit})` : '').replace('{expect}', () => expectOf(f));

// same parse as AnthropicReader.read: the first {...} in the reply; anything else is "not legible"
export function parseReading(raw) {
  const m = /\{[\s\S]*\}/.exec(raw || '');
  try {
    const j = JSON.parse(m[0]);
    return { text: String(j.text ?? ''), legible: j.legible === true };
  } catch (e) { return { text: '', legible: false }; }
}

async function ask(fetchImpl, env, png, prompt) {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 100, thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
        { type: 'text', text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error('upstream ' + res.status);
  const out = await res.json();
  return parseReading((out.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
}

export async function handleRead(request, env, fetchImpl = fetch) {
  const missing = ['ACCESS_TEAM', 'SCAN_ACCESS_AUD', 'ANTHROPIC_API_KEY'].filter(k => !env[k]);
  if (missing.length) return json({ error: `Reading is not set up yet: the Worker has no ${missing.join(', ')}.` }, 503);
  const email = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'), { ACCESS_TEAM: env.ACCESS_TEAM, ACCESS_AUD: env.SCAN_ACCESS_AUD }, fetchImpl);
  if (!email) return json({ error: 'Sign in first.' }, 401);
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== `https://${SCAN_HOST}`) return json({ error: 'Wrong origin.' }, 403);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'JSON only.' }, 415);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data in one request.' }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || !Number.isInteger(body.page) || body.page < 1 || body.page > 14) return json({ error: 'page must be 1 to 14.' }, 400);
  const crops = body.crops;
  if (!Array.isArray(crops) || !crops.length) return json({ error: 'No crops.' }, 400);
  if (crops.length > MAX_CROPS) return json({ error: `At most ${MAX_CROPS} crops per request.` }, 400);
  const seen = new Set();
  for (const c of crops) {
    if (!c || typeof c.id !== 'string' || typeof c.png !== 'string') return json({ error: 'Each crop needs an id and a png.' }, 400);
    const f = Object.hasOwn(FIELDS, c.id) ? FIELDS[c.id] : null;
    if (!f) return json({ error: `Unknown field: ${c.id.slice(0, 40)}` }, 400);
    if (!READABLE.has(f.type)) return json({ error: `Field ${c.id} is not read by the model.` }, 400);
    if (seen.has(c.id)) return json({ error: `Field ${c.id} is repeated.` }, 400);
    seen.add(c.id);
    if (!c.png || c.png.length % 4 || !B64.test(c.png)) return json({ error: `Crop ${c.id} is not base64.` }, 400);
    const bytes = c.png.length / 4 * 3 - (c.png.endsWith('==') ? 2 : c.png.endsWith('=') ? 1 : 0);
    if (bytes > MAX_CROP) return json({ error: `Crop ${c.id} is too big (40 KB at most).` }, 400);
    if (!c.png.startsWith('iVBORw0KGgo')) return json({ error: `Crop ${c.id} is not a PNG.` }, 400);
  }
  try {
    const out = await Promise.all(crops.map(async c => {
      const f = FIELDS[c.id];
      const [a, b] = await Promise.all([ask(fetchImpl, env, c.png, promptFor(PROMPT_A, f)), ask(fetchImpl, env, c.png, promptFor(PROMPT_B, f))]);
      return { id: c.id, a, b };
    }));
    return json(out);
  } catch (e) { return json({ error: 'The reading service did not answer.' }, 502); }
}
