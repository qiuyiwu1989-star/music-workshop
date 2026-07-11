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

  const state = { history: [], last: null, playTimers: [], open: false };

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
    const el = keyElOf(pitch);
    if (!el) return;                                    // 音在当前可见键盘之外则跳过（声音照常）
    if (on) {
      el.classList.add('active'); _litEls.add(el);
      try { if (typeof burstParticles === 'function') burstParticles(el, 8); } catch (e) {}
    } else {
      el.classList.remove('active'); _litEls.delete(el);
    }
  }
  function clearLit() { _litEls.forEach(el => el.classList.remove('active')); _litEls.clear(); }

  // ---- 用所选乐器播放一段音符（声音 + 左侧键盘动效同步）----
  function stopPlay() { state.playTimers.forEach(clearTimeout); state.playTimers = []; clearLit(); }
  function playMelody(notes, bpm, instId) {
    stopPlay();
    const inst = instOf(instId); if (!inst || typeof AudioEngine === 'undefined') return;
    try { AudioEngine.init(); } catch (e) {}
    const spb = 60 / (bpm || 90);
    notes.forEach(n => {
      const onMs = n.start * spb * 1000;
      const offMs = (n.start + n.duration) * spb * 1000;
      state.playTimers.push(setTimeout(() => {
        try { AudioEngine[inst.play](n.pitch); } catch (e) {}
        lightKey(n.pitch, true);                        // 按下：亮
      }, onMs));
      if (inst.type !== 'drums') {
        state.playTimers.push(setTimeout(() => {
          try { AudioEngine.release(n.pitch); } catch (e) {}
          lightKey(n.pitch, false);                     // 抬起：灭
        }, offMs));
      } else {
        state.playTimers.push(setTimeout(() => lightKey(n.pitch, false), onMs + 120));
      }
    });
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

  // ---- 调后端生成 ----
  async function compose(intent) {
    const instId = currentInstId();
    addMsg('user', intent);
    const thinkingEl = addMsg('ai', '🎼 正在把你的话变成旋律…');
    state.history.push({ role: 'user', content: intent });
    try {
      const r = await fetch('/api/compose', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, instrumentId: instId, history: state.history }),
      });
      const data = await r.json();
      if (!data.ok) { thinkingEl.textContent = '没成功：' + (data.msg || '再试一次'); return; }
      state.last = data;
      state.history.push({ role: 'assistant', content: JSON.stringify({ scale: data.scale, why: data.why }) });
      thinkingEl.innerHTML = '';
      const who = document.createElement('div');
      who.textContent = data.why || '这是一版草稿，你可以让我改。';
      const meta = document.createElement('div');
      meta.className = 'aic-meta';
      meta.textContent = `${instOf(instId)?.name || instId} · ${data.scale} · ${data.bpm}BPM · ${data.notes.length}个音`;
      const row = document.createElement('div'); row.className = 'aic-actions';
      row.appendChild(btn('▶ 再听一次', () => playMelody(data.notes, data.bpm, instId)));
      row.appendChild(btn('🎹 存进作曲台 · 我来改', () => saveToMedly(data, instId)));
      thinkingEl.append(who, meta, row);
      playMelody(data.notes, data.bpm, instId);   // 生成即试听
    } catch (e) {
      thinkingEl.textContent = '网络出错了：' + e.message;
    }
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
    .aic-head{padding:12px 14px;background:linear-gradient(135deg,rgba(120,115,245,.35),rgba(255,110,196,.25));font-weight:700}
    .aic-head small{display:block;font-weight:400;opacity:.8;font-size:12px;margin-top:2px}
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
      <div class="aic-head">🎼 AI 共创 · 说出你想表达的
        <small>你是作者，我只帮你起草。听完可以让我改，满意就放进作曲台署上你的名字。</small></div>
      <div id="aic-log"></div>
      <div class="aic-input">
        <textarea id="aic-text" placeholder="例：孤独但慢慢升起希望，像清晨…（回车发送）"></textarea>
        <button id="aic-send">生成</button>
      </div>`;
    document.body.appendChild(panel);

    fab.onclick = () => { state.open = !state.open; panel.classList.toggle('open', state.open); if (state.open) document.getElementById('aic-text').focus(); };
    const ta = panel.querySelector('#aic-text');
    const send = () => { const v = ta.value.trim(); if (!v) return; ta.value = ''; compose(v); };
    panel.querySelector('#aic-send').onclick = send;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    addMsg('ai', '想让乐器替你说什么？用一句话描述心情或画面，我先给你一版草稿 🎵');
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
