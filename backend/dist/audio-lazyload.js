/* =====================================================================
   CubCopCat 音频按需加载 shim  ·  路线 A · 懒加载版（v2）
   ---------------------------------------------------------------------
   关键点：
   1) AudioEngine 是脚本级 const，不在 window 上 → 必须用裸标识符 AudioEngine，
      不能写 window.AudioEngine（那是 undefined）。本脚本在主程序【之后】加载，
      共享全局词法环境，可直接引用。
   2) 音高乐器的分发是 `if (this._xxxSamples.length) 采样 else 合成`——
      样本没加载时根本不调用采样播放函数。所以「弹到才加载」的正确挂点是
      把 _xxxSamples 存储字段做成【惰性 getter】：分发器一读它就触发加载，
      本次返回空数组（走合成兜底），加载完成后的下一次按键即出采样音。
   3) 加载时不改原加载器的 root/结构逻辑——只是先把 window.XXX(base64) 补齐，
      再调用原加载器。零音准风险。
   依赖：window.AUDIO_MANIFEST（audio-manifest-loader.js，name→url，仅懒加载样本）。
   ===================================================================== */
(function () {
  'use strict';

  const MF = window.AUDIO_MANIFEST || {};

  // 五个采样家族：存储字段 → { 加载器, 需要的 window 变量, 空值构造 }
  const FAMILIES = {
    _pianoSamples:    { loader: '_loadPianoSamples',    vars: ['PIANO_G4_WAV_B64', 'PIANO_C5_WAV_B64', 'PIANO_G5_WAV_B64'], empty: () => [] },
    _guitarSamples:   { loader: '_loadGuitarSamples',   vars: ['GUITAR_C5_MP3'],    empty: () => [] },
    _musicBoxSamples: { loader: '_loadMusicBoxSamples', vars: ['MUSICBOX_C6_MP3'],  empty: () => [] },
    _stringSamples:   { loader: '_loadStringSamples',   vars: ['STRING_C5_MP3'],    empty: () => [] },
    _melodicSamples:  { loader: '_loadMelodicSamples',  vars: null /* = 其余全部 */, empty: () => ({}) },
  };
  const PITCHED_VARS = [];
  Object.values(FAMILIES).forEach(f => { if (f.vars) PITCHED_VARS.push(...f.vars); });
  const MELODIC_VARS = Object.keys(MF).filter(n => !PITCHED_VARS.includes(n));
  FAMILIES._melodicSamples.vars = MELODIC_VARS;

  const LOADER_FLAGS = ['_pianoSamplesLoaded', '_guitarSamplesLoaded',
    '_musicBoxSamplesLoaded', '_stringSamplesLoaded', '_melodicSamplesLoaded'];

  // ---- 二进制 → base64（分块，避免大数组爆栈）----
  function ab2b64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }

  const _cache = new Map();
  function ensureVar(name) {
    if (window[name] != null) return Promise.resolve();
    if (_cache.has(name)) return _cache.get(name);
    const url = MF[name];
    if (!url) return Promise.resolve();
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(url + ' → ' + r.status); return r.arrayBuffer(); })
      .then(ab => { window[name] = ab2b64(ab); })
      .catch(e => console.warn('[lazyload] 加载失败', name, e.message));
    _cache.set(name, p);
    return p;
  }
  function ensureVars(names) { return Promise.all(names.map(ensureVar)); }

  function patch() {
    if (typeof AudioEngine === 'undefined') return false;
    const AE = AudioEngine;
    if (AE.__lazyPatched) return true;

    // 复位「已加载」标志：若 init 曾在无样本时跑过，需允许重新加载
    LOADER_FLAGS.forEach(f => { AE[f] = false; });

    // 1) 包装 5 个加载器：先补齐 window.XXX，再调原加载器（root 逻辑不变）
    Object.values(FAMILIES).forEach(f => {
      const orig = AE[f.loader];
      if (typeof orig !== 'function' || orig.__lazyWrapped) return;
      const wrapped = function () {
        if (AE._eagerPhase) return;          // init 阶段不下载
        if (wrapped.__running) return;       // 防重入
        wrapped.__running = true;
        ensureVars(f.vars).then(() => { wrapped.__running = false; orig.call(this); });
      };
      wrapped.__lazyWrapped = true;
      AE[f.loader] = wrapped;
    });

    // 2) 包装 init：抑制启动时的一批 eager 加载（鼓组加载器不在 FAMILIES，照常即时）
    if (!AE.init.__lazyWrapped) {
      const origInit = AE.init.bind(AE);
      const wi = function () { AE._eagerPhase = true; try { origInit(); } finally { AE._eagerPhase = false; } };
      wi.__lazyWrapped = true;
      AE.init = wi;
    }

    // 3) 把 5 个样本存储字段做成惰性 getter：分发器一读就触发加载
    Object.keys(FAMILIES).forEach(prop => {
      const f = FAMILIES[prop];
      const backing = '__lz' + prop;
      let triggered = false;
      if (!(backing in AE)) AE[backing] = AE[prop];   // 接管原有值（通常为空）
      try {
        Object.defineProperty(AE, prop, {
          configurable: true,
          get() {
            if (!triggered) { triggered = true; try { this[f.loader](); } catch (e) {} }
            if (this[backing] == null) this[backing] = f.empty();
            return this[backing];
          },
          set(v) { this[backing] = v; },
        });
      } catch (e) { console.warn('[lazyload] defineProperty 失败', prop, e); }
    });

    AE.__lazyPatched = true;
    console.info('[lazyload] AudioEngine 已接管，懒加载音高样本', PITCHED_VARS.length + MELODIC_VARS.length, '个');
    return true;
  }

  function boot() {
    if (patch()) return;
    let n = 0;
    const t = setInterval(() => { if (patch() || ++n > 100) clearInterval(t); }, 50);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
