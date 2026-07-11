/* =====================================================================
   CubCopCat 云后端集成模块  ·  Phase 1
   ---------------------------------------------------------------------
   作用：把「账号 + 作品」从 localStorage 升级到 PocketBase 云端，
        同时保持前端单文件、离线可用、调用方零改动。

   放置位置（在主 HTML 里，</body> 之前，顺序很重要）：
     <script> ...(内联 pocketbase.umd.js) </script>   ← 提供全局 PocketBase
     <script> ...(主程序，已含 Auth / Medly / INSTRUMENTS) </script>
     <script> ...(本文件内容) </script>                ← 最后加载

   配置：把下面 Backend.URL 改成你的【已备案子域名】。
        留空则自动降级为「纯本地」模式（老逻辑不变）。

   4 处接入（详见 后端设计.md 第 5 节）：
     1) 本文件内联在最后 —— 自动完成 Auth 载入 + Medly 云能力挂载。
     2) 在 Medly 工具条（约 4076 行 💾 Save 附近）加两个按钮：
          <button onclick="Medly.saveToCloud()">☁️ 云端保存</button>
          <button onclick="Medly.showCloudDialog()">☁️ 我的作品</button>
     3)（可选）Medly.saveProject 成功后追加一行本地→云同步，见文末说明。
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- Backend：PocketBase 薄封装 ---------------- */
  const Backend = {
    URL: '',            // ← 改成 'https://api.你的已备案域名'；留空 = 关闭云功能
    pb: null,
    enabled: false,

    init() {
      if (!this.URL || typeof PocketBase === 'undefined') {
        console.info('[Backend] 未配置 URL 或 SDK 未加载 → 纯本地模式');
        return;
      }
      this.pb = new PocketBase(this.URL);
      this.pb.autoCancellation(false);   // 避免快速切换时请求被自动取消
      this.enabled = true;
      console.info('[Backend] 已连接', this.URL);
    },

    online()   { return this.enabled && navigator.onLine; },
    loggedIn() { return this.enabled && this.pb.authStore.isValid; },
    me()       { const s = this.pb && this.pb.authStore; return s ? (s.record || s.model || null) : null; },

    async register(name, pw) {
      await this.pb.collection('users').create({
        username: name, password: pw, passwordConfirm: pw, name, role: 'student',
      });
      return this.login(name, pw);
    },
    async login(name, pw) {
      return this.pb.collection('users').authWithPassword(name, pw);
    },
    logout() { if (this.pb) this.pb.authStore.clear(); },

    // ---- 作品 ----
    async saveWork(project, { id = null, status = 'draft' } = {}) {
      const me = this.me(); if (!me) throw new Error('未登录');
      const body = { student: me.id, title: project.name || 'Untitled', data: project, status };
      if (me.klass) body.klass = me.klass;
      return id ? this.pb.collection('works').update(id, body)
                : this.pb.collection('works').create(body);
    },
    async listMyWorks() {
      const me = this.me(); if (!me) return [];
      return this.pb.collection('works').getFullList({ filter: `student="${me.id}"`, sort: '-updated' });
    },
    async deleteWork(id) { return this.pb.collection('works').delete(id); },
  };
  window.Backend = Backend;

  /* ---------------- 错误信息 → 友好中文 ---------------- */
  function pbErr(e, fallback) {
    const d = (e && e.response && e.response.data) || (e && e.data) || null;
    if (d) {
      if (d.username) return '该用户名已被占用';
      if (d.identity || d.password) return '用户名或密码错误';
    }
    if (!navigator.onLine || (e && e.status === 0)) return '网络连接失败，请检查网络';
    return fallback;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function toast(text) {
    let el = document.getElementById('cc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cc-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);' +
        'background:rgba(20,20,30,.92);color:#fff;padding:10px 18px;border-radius:999px;' +
        'font-size:14px;z-index:99999;opacity:0;transition:opacity .25s;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1600);
  }

  /* ---------------- CloudAuth：覆盖 Auth，签名保持不变 ---------------- */
  const CloudAuth = {
    attach() {
      if (!Backend.enabled || typeof Auth === 'undefined') return;

      Auth.init = function () {
        const m = Backend.me();
        this.user = (Backend.loggedIn() && m) ? (m.username || m.name) : null;
      };
      Auth.isLoggedIn = function () { return Backend.loggedIn(); };
      Auth.displayName = function () { return this.user || '游客'; };

      Auth.register = async function (name, pw, confirm) {
        name = (name || '').trim();
        if (name.length < 2 || name.length > 20) return { ok: false, msg: '用户名需 2-20 个字符' };
        if (pw.length < 4) return { ok: false, msg: '密码至少 4 位' };
        if (pw !== confirm) return { ok: false, msg: '两次密码不一致' };
        if (!Backend.online()) return { ok: false, msg: '离线状态无法注册，请联网后重试' };
        try { await Backend.register(name, pw); this.user = name; return { ok: true }; }
        catch (e) { return { ok: false, msg: pbErr(e, '注册失败，请重试') }; }
      };

      Auth.login = async function (name, pw) {
        name = (name || '').trim();
        if (!Backend.online()) return { ok: false, msg: '离线状态无法登录，请联网后重试' };
        try {
          await Backend.login(name, pw);
          const m = Backend.me(); this.user = (m && (m.username || m.name)) || name;
          return { ok: true };
        } catch (e) { return { ok: false, msg: pbErr(e, '用户名或密码错误') }; }
      };

      const localLogout = Auth.logout.bind(Auth);   // 复用原有 UI 刷新流程
      Auth.logout = function () { Backend.logout(); localLogout(); };

      // 用云端会话重建登录态并刷新一次 UI
      Auth.init();
      if (typeof updateAccountUI === 'function') updateAccountUI();
      if (typeof updateGreeting === 'function') updateGreeting();
      if (typeof renderMenu === 'function') renderMenu();
    },
  };
  window.CloudAuth = CloudAuth;

  /* ---------------- Medly 云能力 ---------------- */
  function attachMedlyCloud() {
    if (typeof Medly === 'undefined') return;

    // 从当前编辑器状态构建工程对象（对齐现有 saveProject 的结构）
    Medly._buildCurrentProject = function () {
      const nameEl = document.getElementById('medly-song-name');
      this.songName = (nameEl && nameEl.value) || this.songName;
      return {
        name: this.songName, bpm: this.bpm, bars: this.bars,
        beatsPerBar: this.beatsPerBar, snap: this.snap,
        tracks: this.tracks.map(t => ({
          name: t.name, instrumentId: t.instrumentId, color: t.color,
          muted: t.muted, solo: t.solo, notes: t.notes.map(n => ({ ...n })),
        })),
      };
    };

    Medly.saveToCloud = async function () {
      if (!Backend.loggedIn()) {
        toast('请先登录再云端保存');
        if (typeof openAuth === 'function') openAuth('login');
        return;
      }
      const project = this._buildCurrentProject();
      try { this.saveProject(); } catch (e) {}   // 顺手存一份本地草稿
      try {
        const rec = await Backend.saveWork(project, { id: this._cloudId || null, status: 'draft' });
        this._cloudId = rec.id;
        toast('☁️ 已云端保存');
      } catch (e) { alert('云端保存失败：' + pbErr(e, '请稍后重试')); }
    };

    Medly.showCloudDialog = async function () {
      if (!Backend.loggedIn()) {
        toast('请先登录');
        if (typeof openAuth === 'function') openAuth('login');
        return;
      }
      let works = [];
      try { works = await Backend.listMyWorks(); }
      catch (e) { alert('读取云端作品失败：' + pbErr(e, '请稍后重试')); return; }
      renderCloudDialog(works);
    };

    // 载入云端作品到编辑器（对齐现有 _loadProject 的赋值 + UI 刷新）
    Medly._loadCloudWork = function (rec) {
      const p = rec.data || {};
      this._cloudId = rec.id;
      this.songName = p.name || 'Untitled';
      this.bpm = p.bpm || 120;
      this.bars = p.bars || 8;
      this.beatsPerBar = p.beatsPerBar || 4;
      this.snap = p.snap || 0.25;
      this.totalBeats = this.bars * this.beatsPerBar;
      const palette = (window.TRACK_COLORS) || ['#ff6ec4'];
      this.tracks = (p.tracks || []).map(t => {
        const inst = INSTRUMENTS.find(i => i.id === t.instrumentId) || INSTRUMENTS[0];
        return {
          id: 'track_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: t.name || 'Track', instrumentId: t.instrumentId || 'piano', instrument: inst,
          notes: (t.notes || []).map(n => ({ ...n })),
          muted: !!t.muted, solo: !!t.solo, color: t.color || palette[0],
        };
      });
      if (this.tracks.length === 0 && typeof this.addTrack === 'function') this.addTrack();
      this.selectedTrackIdx = 0;

      const nameInput = document.getElementById('medly-song-name'); if (nameInput) nameInput.value = this.songName;
      const bpmD = document.getElementById('medly-bpm-display'); if (bpmD) bpmD.textContent = this.bpm;
      const snapSel = document.getElementById('medly-snap'); if (snapSel) snapSel.value = this.snap;
      const barsSel = document.getElementById('medly-bars'); if (barsSel) barsSel.value = this.bars;
      this._resizeCanvas && this._resizeCanvas();
      this._renderPitchLabels && this._renderPitchLabels();
      this._renderTrackList && this._renderTrackList();
      this._drawGrid && this._drawGrid();
      this._updateTransportUI && this._updateTransportUI();
      toast('已载入：' + this.songName);
    };

    // 复用现有 medly-save-modal 容器渲染云端作品列表
    function renderCloudDialog(works) {
      const list = document.getElementById('medly-projects-list');
      const modal = document.getElementById('medly-save-modal');
      if (!list || !modal) { alert('作品列表容器缺失'); return; }
      if (!works.length) {
        list.innerHTML = '<div class="medly-empty-msg">还没有云端作品，先「☁️ 云端保存」一个吧。</div>';
      } else {
        list.innerHTML = '';
        works.forEach(w => {
          const p = w.data || {};
          const tc = p.tracks ? p.tracks.length : 0;
          const nc = p.tracks ? p.tracks.reduce((s, t) => s + (t.notes ? t.notes.length : 0), 0) : 0;
          const item = document.createElement('div');
          item.className = 'medly-project-item';
          item.innerHTML =
            '<div><div class="medly-project-name">☁️ ' + escapeHtml(w.title || p.name || 'Untitled') + '</div>' +
            '<div class="medly-project-meta">' + tc + ' tracks · ' + nc + ' notes · ' + (p.bpm || '') + ' BPM</div></div>' +
            '<button class="medly-project-del" title="删除">🗑</button>';
          item.querySelector('.medly-project-del').onclick = async (e) => {
            e.stopPropagation();
            if (!confirm('删除这个云端作品？不可恢复。')) return;
            try { await Backend.deleteWork(w.id); Medly.showCloudDialog(); }
            catch (err) { alert('删除失败：' + pbErr(err, '请稍后')); }
          };
          item.onclick = () => { Medly._loadCloudWork(w); Medly._closeLoadDialog && Medly._closeLoadDialog(); };
          list.appendChild(item);
        });
      }
      modal.classList.add('active');
    }
    window.renderCloudDialog = renderCloudDialog;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    Backend.init();
    CloudAuth.attach();
    attachMedlyCloud();
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* =====================================================================
   （可选）让现有「💾 Save」也顺带同步云端：
   在主程序 Medly.saveProject() 末尾、保存成功后追加一行——
       if (window.Backend && Backend.loggedIn()) Medly.saveToCloud();
   即可实现「一次保存，本地+云端双写」。不加则本地/云端各自独立。
   ===================================================================== */
