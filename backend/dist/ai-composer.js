/* =====================================================================
   AI 共创面板  ·  语义 → 旋律（原型）
   ---------------------------------------------------------------------
   孩子说出想表达的东西 → 后端调 MIMO 生成 Medly 音符 → 用所选乐器试听
   → 可「存进作曲台」变成一个 track，孩子自己改、署名。
   创造者教育：AI 只出草稿并解释思路，作者永远是孩子。
   密钥在后端，本文件不含任何密钥。挂在主程序之后加载。
   ===================================================================== */
(function () {
  'use strict';

  const state = { history: [], last: null, playTimers: [], open: false, playing: false, playBtn: null, sounding: new Set() };

  function instOf(id) {
    return (typeof INSTRUMENTS !== 'undefined' && INSTRUMENTS.find(i => i.id === id)) || null;
  }
  function currentInstId() {
    if (typeof currentInstrument !== 'undefined' && currentInstrument) return currentInstrument.id;
    return 'music_box';
  }

  // ---- 键盘弹奏动效：复用 app 原生高亮（data-semi + .active + 粒子）----
  const _litEls = new Set();
  function keyElOf(pitch) {
    const oct = (typeof currentOctave !== 'undefined') ? currentOctave : 4;
    const semi = pitch - (oct + 1) * 12;               // 与 app 内 MIDI→键 的换算一致
    return document.querySelector(`.key-white[data-semi="${semi}"], .key-black[data-semi="${semi}"]`);
  }
  function lightKey(pitch, on) {
    const ci = (typeof currentInstrument !== 'undefined' && currentInstrument) ? currentInstrument.controller : null;
    if (ci === 'guitar') {                              // 真吉他：起音时对应的弦闪一下
      if (!on) return;
      const hit = document.querySelector(`#gf-guitar .ghit[data-midi="${pitch}"]`);
      if (hit) {
        const s = document.getElementById('gs' + hit.dataset.str);
        if (s) { s.classList.add('gs-lit'); setTimeout(() => s.classList.remove('gs-lit'), 220); }
        try { if (typeof burstParticles === 'function') burstParticles(hit, 8); } catch (e) {}
      }
      return;
    }
    if (ci === 'bowed') {                               // 提琴指板：按住时对应格持续亮
      const cell = document.querySelector(`#gf-board .gf-cell[data-midi="${pitch}"]`);
      if (!cell) return;
      if (on) { cell.classList.add('gf-lit'); _litEls.add(cell); }
      else { cell.classList.remove('gf-lit'); _litEls.delete(cell); }
      return;
    }
    const el = keyElOf(pitch);                          // 钢琴键（默认）
    if (!el) return;
    if (on) {
      el.classList.add('active'); _litEls.add(el);
      try { if (typeof burstParticles === 'function') burstParticles(el, 8); } catch (e) {}
    } else {
      el.classList.remove('active'); _litEls.delete(el);
    }
  }
  function clearLit() { _litEls.forEach(el => el.classList.remove('active', 'gf-lit')); _litEls.clear(); }

  // ---- 用所选乐器播放一段音符（声音 + 左侧键盘动效同步）----
  function stopPlay() {
    state.playTimers.forEach(clearTimeout); state.playTimers = [];
    clearLit();
    // 释放此刻正在发声的音，避免长音停不下来
    if (typeof AudioEngine !== 'undefined') state.sounding.forEach(p => { try { AudioEngine.release(p); } catch (e) {} });
    state.sounding.clear();
    state.playing = false;
    if (state.playBtn) { state.playBtn.textContent = '▶ 再听一次'; state.playBtn = null; }
  }
  function makePlayBtn(notes, bpm, instId) {
    const b = document.createElement('button'); b.className = 'aic-btn'; b.textContent = '▶ 播放';
    b.onclick = () => { (state.playing && state.playBtn === b) ? stopPlay() : playMelody(notes, bpm, instId, b); };
    return b;
  }
  function playMelody(notes, bpm, instId, btn) {
    stopPlay();
    const inst = instOf(instId); if (!inst || typeof AudioEngine === 'undefined') return;
    try { AudioEngine.init(); } catch (e) {}
    state.playing = true;
    state.playBtn = btn || null;
    if (btn) btn.textContent = '⏹ 停止';
    const spb = 60 / (bpm || 90);
    let endMs = 0;
    notes.forEach(n => {
      const onMs = n.start * spb * 1000;
      const offMs = (n.start + n.duration) * spb * 1000;
      if (offMs > endMs) endMs = offMs;
      state.playTimers.push(setTimeout(() => {
        try { AudioEngine[inst.play](n.pitch); } catch (e) {}
        state.sounding.add(n.pitch);
        lightKey(n.pitch, true);                        // 按下：亮
      }, onMs));
      if (inst.type !== 'drums') {
        state.playTimers.push(setTimeout(() => {
          try { AudioEngine.release(n.pitch); } catch (e) {}
          state.sounding.delete(n.pitch);
          lightKey(n.pitch, false);                     // 抬起：灭
        }, offMs));
      } else {
        state.playTimers.push(setTimeout(() => lightKey(n.pitch, false), onMs + 120));
      }
    });
    // 播完自动复位按钮
    state.playTimers.push(setTimeout(() => {
      state.playing = false; state.sounding.clear();
      if (state.playBtn) { state.playBtn.textContent = '▶ 再听一次'; state.playBtn = null; }
    }, endMs + 160));
  }

  // ---- 存进作曲台（Medly）：新建一个 track，孩子接手编辑 ----
  function saveToMedly(res, instId) {
    const inst = instOf(instId); if (!inst) return;
    try {
      if (typeof openMedly === 'function') openMedly();
      if (typeof Medly === 'undefined') return;
      Medly.bpm = res.bpm || Medly.bpm;
      const colors = (window.TRACK_COLORS) || ['#ff6ec4'];
      const track = {
        id: 'track_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: 'AI 草稿 · ' + (res.scale || ''),
        instrumentId: instId,
        instrument: inst,
        notes: res.notes.map(n => ({ ...n })),
        muted: false, solo: false,
        color: colors[(Medly.tracks ? Medly.tracks.length : 0) % colors.length],
      };
      Medly.tracks = Medly.tracks || [];
      Medly.tracks.push(track);
      Medly.selectedTrackIdx = Medly.tracks.length - 1;
      const bpmD = document.getElementById('medly-bpm-display'); if (bpmD) bpmD.textContent = Medly.bpm;
      Medly._resizeCanvas && Medly._resizeCanvas();
      Medly._renderTrackList && Medly._renderTrackList();
      Medly._drawGrid && Medly._drawGrid();
      Medly._updateTransportUI && Medly._updateTransportUI();
      toast('已放进作曲台 · 现在你来改，署上你的名字 ✍️');
    } catch (e) { console.warn('[ai-composer] saveToMedly', e); toast('放入作曲台失败'); }
  }

  // ---- 导出 MIDI：把音符 + bpm 编成标准 MIDI 文件（可下载、可导入任何音乐软件）----
  function _varLen(arr, v) {
    let buf = v & 0x7F;
    while ((v >>= 7)) { buf <<= 8; buf |= ((v & 0x7F) | 0x80); }
    for (;;) { arr.push(buf & 0xFF); if (buf & 0x80) buf >>= 8; else break; }
  }
  function notesToMidi(notes, bpm) {
    const TPQN = 480;
    const evs = [];
    (notes || []).forEach(n => {
      const on = Math.max(0, Math.round(n.start * TPQN));
      const off = Math.max(on + 1, Math.round((n.start + n.duration) * TPQN));
      const pitch = Math.max(0, Math.min(127, n.pitch | 0));
      const vel = Math.max(1, Math.min(127, Math.round((n.velocity || 80) * 1.27)));
      evs.push({ tick: on, order: 1, bytes: [0x90, pitch, vel] });   // note on
      evs.push({ tick: off, order: 0, bytes: [0x80, pitch, 0] });    // note off
    });
    evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const track = [];
    const mpqn = Math.round(60000000 / (bpm || 120));
    _varLen(track, 0); track.push(0xFF, 0x51, 0x03, (mpqn >> 16) & 0xFF, (mpqn >> 8) & 0xFF, mpqn & 0xFF); // tempo
    let last = 0;
    evs.forEach(e => { _varLen(track, e.tick - last); e.bytes.forEach(b => track.push(b)); last = e.tick; });
    _varLen(track, 0); track.push(0xFF, 0x2F, 0x00); // end of track
    const L = track.length;
    const head = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (TPQN >> 8) & 0xFF, TPQN & 0xFF];
    const trk = [0x4D, 0x54, 0x72, 0x6B, (L >>> 24) & 0xFF, (L >>> 16) & 0xFF, (L >>> 8) & 0xFF, L & 0xFF];
    return new Uint8Array([...head, ...trk, ...track]);
  }
  function downloadMidi(notes, bpm, name) {
    try {
      const bytes = notesToMidi(notes, bpm);
      const blob = new Blob([bytes], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ((name || '音乐工坊作品').replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '音乐工坊作品') + '.mid';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('已下载 MIDI · 可导入任何音乐软件 🎼');
    } catch (e) { console.warn('[ai-composer] downloadMidi', e); toast('下载失败'); }
  }

  // ---- 深度共创：先理解+构思(展示) → 再照构思谱写整首 ----
  async function compose(intent) {
    const sel = document.getElementById('aic-inst');
    const instId = (sel && sel.value) || currentInstId();     // 面板选中的音色（默认跟随当前乐器）
    const inst = instOf(instId);
    const instName = inst ? inst.name : instId;
    addMsg('user', intent);
    state.history.push({ role: 'user', content: intent });

    // ① 深度理解 + 作曲构思
    const thinkEl = addMsg('ai', '🤔 正在深度理解你想表达的…');
    let plan = null;
    try {
      const pr = await fetch('/api/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, instrumentId: instId, instrumentName: instName }),
      });
      const pd = await pr.json();
      if (pd.ok && pd.plan) {
        plan = pd.plan;
        thinkEl.innerHTML = '';
        const u = document.createElement('div');
        const ub = document.createElement('b'); ub.textContent = '💡 我懂了：';
        u.append(ub, document.createTextNode(plan.understanding || ''));
        const brief = document.createElement('div'); brief.className = 'aic-meta';
        brief.textContent = `🎯 ${[plan.genre, plan.scale, (plan.bpm ? plan.bpm + 'BPM' : ''), plan.structure].filter(Boolean).join(' · ')}`;
        thinkEl.append(u, brief);
        if ((plan.devices || []).length) { const d = document.createElement('div'); d.className = 'aic-meta'; d.textContent = '🎛️ 手法：' + plan.devices.join('、'); thinkEl.append(d); }
        if (plan.plan) { const pl = document.createElement('div'); pl.style.marginTop = '6px'; pl.textContent = plan.plan; thinkEl.append(pl); }
        state.history.push({ role: 'assistant', content: '构思：' + JSON.stringify({ scale: plan.scale, bpm: plan.bpm, structure: plan.structure }) });
      } else {
        thinkEl.textContent = '（先直接谱写）';
      }
    } catch (e) { thinkEl.textContent = '（理解阶段跳过，直接谱写）'; }

    // ② 按构思谱写整首
    const outEl = addMsg('ai', '🎼 按这个构思谱写整首中…（长一点，请稍等几秒）');
    try {
      const r = await fetch('/api/compose', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, instrumentId: instId, instrumentName: instName, plan, history: state.history }),
      });
      const data = await r.json();
      if (!data.ok) { outEl.textContent = '没成功：' + (data.msg || '再试一次'); return; }
      state.last = data;
      state.history.push({ role: 'assistant', content: JSON.stringify({ scale: data.scale, why: data.why }) });
      outEl.innerHTML = '';
      const who = document.createElement('div'); who.textContent = data.why || '这是一版草稿，你可以让我改。';
      const meta = document.createElement('div'); meta.className = 'aic-meta';
      meta.textContent = `${instName} · ${data.scale} · ${data.bpm}BPM · ${data.notes.length}个音`;
      const row = document.createElement('div'); row.className = 'aic-actions';
      const playB = makePlayBtn(data.notes, data.bpm, instId);
      row.appendChild(playB);
      row.appendChild(btn('⬇️ 下载 MIDI', () => downloadMidi(data.notes, data.bpm, intent)));
      row.appendChild(btn('🎹 存进作曲台 · 我来改', () => saveToMedly(data, instId)));
      outEl.append(who, meta, row);
      playMelody(data.notes, data.bpm, instId, playB);   // 自动试听，按钮显示“⏹ 停止”
    } catch (e) { outEl.textContent = '网络出错了：' + e.message; }
  }

  // ---- UI ----
  function btn(label, on) { const b = document.createElement('button'); b.className = 'aic-btn'; b.textContent = label; b.onclick = on; return b; }
  function toast(t) {
    let el = document.getElementById('cc-toast');
    if (!el) { el = document.createElement('div'); el.id = 'cc-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:rgba(20,20,30,.92);color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;z-index:100001;transition:opacity .25s'; document.body.appendChild(el); }
    el.textContent = t; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => el.style.opacity = '0', 1800);
  }
  function addMsg(role, text) {
    const wrap = document.getElementById('aic-log');
    const m = document.createElement('div'); m.className = 'aic-msg aic-' + role;
    m.textContent = text; wrap.appendChild(m); wrap.scrollTop = wrap.scrollHeight; return m;
  }

  function mount() {
    const css = document.createElement('style');
    css.textContent = `
    #aic-fab{position:fixed;right:20px;bottom:20px;z-index:100000;border:none;border-radius:999px;padding:12px 18px;
      background:linear-gradient(135deg,#7873f5,#ff6ec4);color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(120,115,245,.5)}
    #aic-panel{position:fixed;right:20px;bottom:78px;z-index:100000;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:70vh;
      display:none;flex-direction:column;background:rgba(24,22,38,.97);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);
      border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.5);color:#eee;font-size:14px}
    #aic-panel.open{display:flex}
    #aic-panel.big{width:min(760px,94vw);height:min(88vh,940px);max-height:88vh}
    .aic-head{position:relative;padding:12px 44px 12px 14px;background:linear-gradient(135deg,rgba(120,115,245,.35),rgba(255,110,196,.25));font-weight:700}
    .aic-max{position:absolute;top:10px;right:12px;width:26px;height:26px;border:none;border-radius:7px;background:rgba(255,255,255,.14);color:#fff;font-size:14px;line-height:1;cursor:pointer}
    .aic-max:hover{background:rgba(255,255,255,.28)}
    .aic-head small{display:block;font-weight:400;opacity:.8;font-size:12px;margin-top:2px}
    .aic-inst-row{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;opacity:.9;border-bottom:1px solid rgba(255,255,255,.08)}
    .aic-inst-row select{flex:1;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit}
    #aic-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
    .aic-msg{padding:9px 12px;border-radius:12px;line-height:1.5;white-space:pre-wrap;max-width:90%}
    .aic-user{align-self:flex-end;background:linear-gradient(135deg,#7873f5,#8f7bff);color:#fff}
    .aic-ai{align-self:flex-start;background:rgba(255,255,255,.08)}
    .aic-meta{font-size:12px;opacity:.7;margin-top:6px}
    .aic-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .aic-btn{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#fff;border-radius:8px;padding:6px 10px;font-size:13px;cursor:pointer}
    .aic-btn:hover{background:rgba(255,255,255,.16)}
    .aic-input{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.1)}
    .aic-input textarea{flex:1;resize:none;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;padding:8px 10px;font-size:14px;font-family:inherit}
    .aic-input button{border:none;border-radius:10px;padding:0 16px;background:linear-gradient(135deg,#7873f5,#ff6ec4);color:#fff;font-weight:600;cursor:pointer}`;
    document.head.appendChild(css);

    const fab = document.createElement('button');
    fab.id = 'aic-fab'; fab.textContent = '🎼 AI 共创';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'aic-panel';
    panel.innerHTML = `
      <div class="aic-head"><button id="aic-max" class="aic-max" title="放大 / 还原">⤢</button>🎼 AI 共创 · 说出你想表达的
        <small>你是作者，我只帮你起草。听完可以让我改，满意就放进作曲台署上你的名字。</small></div>
      <div class="aic-inst-row">🎹 用这个乐器弹 <select id="aic-inst" title="生成的旋律会用这个乐器的音色演奏"></select></div>
      <div id="aic-log"></div>
      <div class="aic-input">
        <textarea id="aic-text" placeholder="例：孤独但慢慢升起希望，像清晨…（回车发送）"></textarea>
        <button id="aic-send">生成</button>
      </div>`;
    document.body.appendChild(panel);

    // 音色下拉：只列旋律类乐器（排除鼓/氛围），生成的旋律用选中乐器发声
    const selEl = panel.querySelector('#aic-inst');
    if (typeof INSTRUMENTS !== 'undefined') {
      INSTRUMENTS.filter(i => i.type !== 'drums' && i.type !== 'ambient')
        .forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; selEl.appendChild(o); });
    }
    const syncInst = () => { const id = currentInstId(); if (selEl.querySelector(`option[value="${id}"]`)) selEl.value = id; };
    syncInst();

    fab.onclick = () => { state.open = !state.open; panel.classList.toggle('open', state.open); if (state.open) { syncInst(); document.getElementById('aic-text').focus(); } };
    // 放大 / 还原
    const maxBtn = panel.querySelector('#aic-max');
    maxBtn.onclick = () => { const big = panel.classList.toggle('big'); maxBtn.textContent = big ? '⤡' : '⤢'; maxBtn.title = big ? '还原' : '放大'; };
    const ta = panel.querySelector('#aic-text');
    const send = () => { const v = ta.value.trim(); if (!v) return; ta.value = ''; compose(v); };
    panel.querySelector('#aic-send').onclick = send;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    addMsg('ai', '想让乐器替你说什么？用一句话描述心情或画面，我先给你一版草稿 🎵');
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
