/**
 * CubCopCat 音频样本外置脚本  ·  路线 A
 * ------------------------------------------------------------------
 * 把内联在 HTML 里的 41 个 base64 音频样本（~5MB，占全文件 78%）解码成
 * 独立音频文件，并产出一个「瘦身版 HTML」（6.4MB → ~1.4MB）。
 *
 * 产出（默认写到 ./dist/）：
 *   dist/assets/audio/<slug>.<mp3|wav>       —— 单样本
 *   dist/assets/audio/<kit>/<part>.<mp3>     —— 鼓组套件（kick/snare/...）
 *   dist/audio-manifest.json                 —— 变量名 → 文件路径 映射（供 lazyload 用）
 *   dist/CubCopCat.slim.html                 —— 去掉 base64、注入 lazyload 脚本的瘦身版
 *
 * 用法：
 *   node extract-samples.mjs "/Users/qiu/Downloads/CubCopCat_virtual_instruments(1).html"
 *
 * 注意：瘦身版通过 fetch 加载外部音频，**需 http(s) 配信**（nginx/后端）。
 *      file:// 直接打开的离线单文件场景，请继续用原始整包 HTML。
 * ------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || '/Users/qiu/Downloads/CubCopCat_virtual_instruments(1).html';
const OUT = process.argv[3] || path.join(process.cwd(), 'dist');
const AUDIO_DIR = path.join(OUT, 'assets', 'audio');

// 「按需加载」的样本：音高类采样（piano/guitar/musicbox/string + 25 个旋律采样）。
// 这些体积大、且弹到才需要 → 懒加载。其余（鼓组/打击）归入即时 core，保证稳。
// 注意：即使某个名字漏归类到这里，也只是变成 core 提前加载，不会出错。
const LAZY_VARS = new Set([
  'PIANO_G4_WAV_B64', 'PIANO_C5_WAV_B64', 'PIANO_G5_WAV_B64',
  'GUITAR_C5_MP3', 'MUSICBOX_C6_MP3', 'STRING_C5_MP3',
  'TRUMPET_MP3', 'FRENCH_HORN_MP3', 'ELEC_GUITAR_MP3', 'HARP_MP3', 'AST_BASS_MP3',
  'SLAPPICK_BASS_MP3', 'CHOIR_OOOH_MP3', 'FLUTE_MP3', 'HONKY_TONK_MP3', 'XYLOPHONE_MP3',
  'BANJO_MP3', 'DIZI_MP3', 'STRING_ENSEMBLE_MP3', 'TUBULAR_BELL_MP3', 'HARMONICA_MP3',
  'SOFT_BELL_MP3', 'FM_BELL_MP3', 'CELESTA_MP3', 'CLARINET_MP3', 'OBOE_MP3', 'BASSOON_MP3',
  'GLOCKENSPIEL_MP3', 'SAXOPHONE_MP3', 'ORCHESTRAL_HIT_MP3', 'SUPER_GUITAR_MP3',
]);

// slug：变量名 → 文件名主体（去掉格式后缀）
function slug(name) {
  return name.toLowerCase().replace(/_(mp3|wav_b64|wav|b64)$/i, '');
}
// 按魔数判断音频格式
function extOf(buf) {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'RIFF') return 'wav';
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return 'mp3';
}

function main() {
  const html = fs.readFileSync(SRC, 'utf8');
  const lines = html.split('\n');

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const manifest = {};      // NAME -> "assets/audio/xxx.mp3" | {part: "..."}（全量，素材）
  const lazyManifest = {};  // NAME -> url（仅懒加载的音高样本，供 lazyload shim）
  const removeIdx = new Set();
  const emitted = [];       // 供 samples.js（安全版：全部 base64）
  const coreEmitted = [];   // 供 samples-core.js（懒加载版：仅鼓组/打击，本体前即时加载）
  let firstRemoved = -1;
  let totalBytes = 0, count = 0;

  const reAssign = /^\s*window\.([A-Z0-9_]+)\s*=\s*("|\{)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(reAssign);
    if (!m) continue;
    const name = m[1];
    // 取出等号右边的值（到行尾，去掉结尾分号）
    const rhs = lines[i].replace(/^\s*window\.[A-Z0-9_]+\s*=\s*/, '').replace(/;\s*$/, '');
    if (rhs.length < 500) continue;   // 太短，不是样本，跳过（保护普通 window 赋值）

    try {
      if (m[2] === '"') {
        // ---- 单样本：字符串 base64 ----
        const b64 = JSON.parse(rhs);
        const buf = Buffer.from(b64, 'base64');
        const ext = extOf(buf);
        const rel = path.join('assets', 'audio', `${slug(name)}.${ext}`);
        fs.writeFileSync(path.join(OUT, rel), buf);
        manifest[name] = rel.split(path.sep).join('/');
        totalBytes += buf.length; count++;
      } else {
        // ---- 鼓组套件：对象 {part: base64} ----
        const obj = JSON.parse(rhs);
        const kitDir = path.join(AUDIO_DIR, slug(name));
        fs.mkdirSync(kitDir, { recursive: true });
        const parts = {};
        for (const part in obj) {
          const buf = Buffer.from(obj[part], 'base64');
          const ext = extOf(buf);
          const rel = path.join('assets', 'audio', slug(name), `${part}.${ext}`);
          fs.writeFileSync(path.join(OUT, rel), buf);
          parts[part] = rel.split(path.sep).join('/');
          totalBytes += buf.length; count++;
        }
        manifest[name] = parts;
      }
    } catch (e) {
      console.warn(`跳过 ${name}：解析失败 ${e.message}`);
      continue;
    }

    // 安全版：全部进 samples.js
    emitted.push(`window.${name}=${rhs};`);
    // 懒加载版：音高样本进 manifest（按需 fetch）；其余（鼓组/打击）进 core（即时）
    if (LAZY_VARS.has(name)) lazyManifest[name] = manifest[name];
    else coreEmitted.push(`window.${name}=${rhs};`);

    // 标记这一行 + 其外层 <script>/</script> 一并删除
    if (firstRemoved === -1) firstRemoved = i;
    removeIdx.add(i);
    if (lines[i - 1] && lines[i - 1].trim() === '<script>') { removeIdx.add(i - 1); if (i - 1 < firstRemoved) firstRemoved = i - 1; }
    if (lines[i + 1] && lines[i + 1].trim() === '</script>') removeIdx.add(i + 1);
  }

  // 安全版外置文件：所有 base64 样本集中到一个外部脚本
  fs.writeFileSync(path.join(OUT, 'samples.js'), emitted.join('\n') + '\n');

  // 懒加载版素材：samples-core.js（鼓组即时）+ manifest（音高样本按需）
  fs.writeFileSync(path.join(OUT, 'samples-core.js'), coreEmitted.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'audio-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT, 'audio-manifest-loader.js'),
    'window.AUDIO_MANIFEST=' + JSON.stringify(lazyManifest) + ';\n');

  // ---- 安全版 slim.html：注入单个 samples.js（全部 base64，逻辑零改）----
  const slimOut = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === firstRemoved) slimOut.push('<script src="./samples.js"></script>');
    if (removeIdx.has(i)) continue;
    slimOut.push(lines[i]);
  }
  const slimHtml = slimOut.join('\n');
  fs.writeFileSync(path.join(OUT, 'CubCopCat.slim.html'), slimHtml);

  // ---- 懒加载版 lazy.html ----
  // 主程序【前】注入：manifest-loader + samples-core（鼓组就绪，非懒加载器照常工作）
  // 主程序【后】注入：audio-lazyload（此时 AudioEngine 已定义，立即打补丁）
  const lazyOut = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === firstRemoved) {
      lazyOut.push('<script src="./audio-manifest-loader.js"></script>');
      lazyOut.push('<script src="./samples-core.js"></script>');
    }
    if (removeIdx.has(i)) continue;
    lazyOut.push(lines[i]);
  }
  let lazyHtml = lazyOut.join('\n');
  const lazyInject = '<script src="./audio-lazyload.js"></script>\n<script src="./ai-composer.js"></script>';
  lazyHtml = lazyHtml.includes('</body>')
    ? lazyHtml.replace(/<\/body>/i, lazyInject + '\n</body>')
    : lazyHtml + '\n' + lazyInject;
  fs.writeFileSync(path.join(OUT, 'CubCopCat.lazy.html'), lazyHtml);

  // ---- 复制 XP 主题静态素材（开机/关机图 + 音效）到 dist 根 ----
  const xpDir = path.join(path.dirname(path.resolve(SRC)), 'assets-xp');
  let xpCopied = 0;
  if (fs.existsSync(xpDir)) {
    for (const f of fs.readdirSync(xpDir)) {
      fs.copyFileSync(path.join(xpDir, f), path.join(OUT, f));
      xpCopied++;
    }
    console.log(`✓ 复制 XP 素材 ${xpCopied} 个到 dist 根`);
  } else {
    console.warn('  (未找到 assets-xp，跳过 XP 素材复制)');
  }

  const srcSize = Buffer.byteLength(html);
  const slimSize = Buffer.byteLength(slimHtml);
  console.log('─'.repeat(56));
  console.log(`✓ 导出 ${count} 个音频文件，合计 ${(totalBytes / 1048576).toFixed(2)} MB（二进制）`);
  console.log(`  原 HTML : ${(srcSize / 1048576).toFixed(2)} MB`);
  console.log(`  瘦身 HTML: ${(slimSize / 1048576).toFixed(2)} MB   (↓ ${((1 - slimSize / srcSize) * 100).toFixed(0)}%)`);
  console.log(`  产物目录 : ${OUT}`);
  console.log('─'.repeat(56));
  console.log('安全版已就绪：用 http 服务器打开 dist/CubCopCat.slim.html 即可（samples.js 会随之加载）。');
  console.log('（assets/audio + audio-manifest.json 是「二进制+按需」进阶方案的现成素材，见 dist/README.md）');
}

main();
