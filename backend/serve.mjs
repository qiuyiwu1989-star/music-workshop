import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'dist');
const PORT = 8080;

// ---- 读 .env（仅服务器侧持有密钥）----
const ENV = {};
try {
  fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n').forEach(line => {
    if (line.trim().startsWith('#')) return;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) ENV[m[1]] = m[2];
  });
} catch (e) { console.warn('未找到 .env，/api/compose 不可用'); }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.css': 'text/css', '.svg': 'image/svg+xml',
};

// ====================================================================
//  AI 作曲：语义 → 旋律（Medly 音符 JSON）。密钥只在这里用，绝不进客户端。
// ====================================================================
const COMPOSE_SYSTEM = `你是儿童音乐共创助教。规则（创造者教育）：孩子是作者，你只出"草稿"供孩子修改，并用一句温暖易懂的话解释你的选择（顺便教一点乐理）。
把孩子说的情绪/画面变成一段有记忆点的单声部旋律。只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码围栏。
JSON schema：
{"bpm":整数(40-160), "scale":"如 C_major / A_minor", "notes":[{"pitch":MIDI整数(60=中央C4), "start":起始拍(浮点), "duration":时值(拍), "velocity":力度1-100}], "why":"一句给孩子的话"}
要求：
- 长度 8-16 小节，音符 20-40 个，要丰富、别太短。
- 有结构：先出一个小动机(2-4拍)，再重复/模进/变化发展，结尾有收束感；可留 1-2 处呼吸(空拍)。
- 节奏多样：混用长短音（0.25/0.5/1/2 拍等），不要一直等长。
- 单声部（音符不重叠）；所有 pitch 落在所选 scale 内。
- 贴合情绪：用音区高低、velocity 强弱、快慢与走向去表达。
- 适配乐器：写在这件乐器舒服的音区，贴合它的特点（贝斯偏低、长笛高而流动、拨弦乐器多用跳音/琶音、提琴可长音连奏）。`;

function clampNotes(obj) {
  const notes = (Array.isArray(obj.notes) ? obj.notes : [])
    .map(n => ({
      pitch: Math.max(21, Math.min(108, Math.round(+n.pitch))),
      start: Math.max(0, +n.start || 0),
      duration: Math.max(0.1, +n.duration || 0.5),
      velocity: Math.max(1, Math.min(100, Math.round(+n.velocity || 80))),
    }))
    .filter(n => Number.isFinite(n.pitch) && Number.isFinite(n.start))
    .sort((a, b) => a.start - b.start);
  return {
    bpm: Math.max(40, Math.min(140, Math.round(+obj.bpm || 90))),
    scale: typeof obj.scale === 'string' ? obj.scale : 'C_major',
    notes,
    why: typeof obj.why === 'string' ? obj.why.slice(0, 200) : '',
  };
}

async function handleCompose(req, res, body) {
  if (!ENV.MIMO_API_KEY) { res.writeHead(500).end(JSON.stringify({ ok: false, msg: '服务器未配置 MIMO 密钥' })); return; }
  let payload;
  try { payload = JSON.parse(body || '{}'); } catch { res.writeHead(400).end(JSON.stringify({ ok: false, msg: 'bad json' })); return; }

  const intent = String(payload.intent || '').slice(0, 500);
  const instrumentId = String(payload.instrumentId || 'music_box');
  const instrumentName = String(payload.instrumentName || instrumentId).slice(0, 40);
  const history = Array.isArray(payload.history) ? payload.history.slice(-6) : [];

  const messages = [
    ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 1000) })),
    { role: 'user', content: `乐器: ${instrumentName}（id:${instrumentId}）。请把旋律写得适合这件乐器的音区与特点。孩子想表达: ${intent}` },
  ];

  try {
    const r = await fetch(`${ENV.MIMO_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': ENV.MIMO_API_KEY },
      body: JSON.stringify({
        model: ENV.MIMO_MODEL || 'mimo-v2.5',
        max_tokens: 3000,
        thinking: { type: 'disabled' },     // 直接出 JSON，快而省
        system: COMPOSE_SYSTEM,
        messages,
      }),
    });
    const data = await r.json();
    if (data.type === 'error') { res.writeHead(502).end(JSON.stringify({ ok: false, msg: data.error?.message || 'MIMO error' })); return; }
    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) { res.writeHead(502).end(JSON.stringify({ ok: false, msg: 'AI 未返回有效 JSON', raw: txt.slice(0, 200) })); return; }
    const parsed = clampNotes(JSON.parse(m[0]));
    if (!parsed.notes.length) { res.writeHead(502).end(JSON.stringify({ ok: false, msg: 'AI 没生成音符，换个说法试试' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, ...parsed, usage: data.usage }));
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ ok: false, msg: '调用 MIMO 失败: ' + e.message }));
  }
}

// ---- HTTP ----
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/compose') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => handleCompose(req, res, body));
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/CubCopCat.lazy.html';
  const fp = path.join(ROOT, path.normalize(p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving dist + /api/compose on http://127.0.0.1:' + PORT));
