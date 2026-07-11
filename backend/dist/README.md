# dist — 音频外置产物（已在浏览器验证 ✓）

由 `../extract-samples.mjs` 生成。把 6.15MB 单文件里 78% 的内联 base64 音频拆出来。
两种成品，都**需 http 配信**（不能 file:// 双击，见文末）。

## 📊 实测体积
| | 大小 |
|---|---|
| 原始单文件 | 6.15 MB |
| 瘦身 HTML | **1.37 MB**（↓78%） |
| samples-core.js（鼓组，即时） | 0.31 MB |
| **懒加载版首屏**（html + core） | **1.68 MB**（↓73%） |
| 音高样本（31 个，按需下载） | 弹到才下 |

---

## 方案二（懒加载版，推荐）✅ 已验证
- `CubCopCat.lazy.html` — 主程序前加载 `audio-manifest-loader.js` + `samples-core.js`，主程序后加载 `audio-lazyload.js`。
- `audio-lazyload.js` — 把钢琴/吉他/八音盒/弦乐 + 25 个旋律采样做成**惰性加载**：弹到某乐器才 fetch 它的样本；鼓组随 core 即时就绪。**不改原加载器的音准/结构逻辑，零跑调风险。**

**浏览器实测结论**（本地 http 起服，Claude 已跑过）：
- 页面正常渲染，控制台**无报错**。
- 首屏只下 html + core + manifest + lazyload；**音高样本一个没下**。
- 点钢琴 → 只 fetch `piano_g4/c5/g5.mp3` 三个，其余乐器**零下载**。
- 点小号（旋律采样）→ 加载旋律采样批次（原加载器一次解 25 个，故为「旋律家族级」懒加载）。
- 采样正确解码进原有结构（钢琴 3 个 buffer、旋律 25 个 key）。

**怎么用**（必须 http）：
```bash
node ../serve.mjs                 # 起在 http://127.0.0.1:8080/CubCopCat.lazy.html
# 或部署到 nginx / 后端静态目录（html/js/assets 同级）
```

> 已知可优化点：旋律采样是「弹到任一旋律乐器就整批下 25 个」（因原 `_loadMelodicSamples` 一次性解全部）。
> 若要精确到「单个乐器单个样本」，需把该加载器改成按 key 拆分——属锦上添花，非必须。

## 方案一（安全版，纯即时）
- `CubCopCat.slim.html` + `samples.js`（全部 base64，4.8MB，主程序前一次性加载）。
- 逻辑零改动、全样本覆盖，但不懒加载。作为「最保守回退」保留。

## 素材文件
- `assets/audio/*.mp3|wav` — 53 个二进制音频（3.58MB）。
- `audio-manifest.json` — 全量 变量名→文件 映射。
- `audio-manifest-loader.js` — 仅懒加载样本（31 个）的 `window.AUDIO_MANIFEST`。

## ⚠️ 离线单文件场景
两版都靠 http 加载外部文件，`file://` 直接双击会因浏览器安全策略取不到音频。
教室 U 盘 / 离线分发请继续用**原始整包 HTML**，或用 Vite + vite-plugin-singlefile 出「离线整包」版。两种分发并存。

## 人工复测清单（换设备时过一遍）
- [ ] http 打开 lazy.html，界面正常、无红色报错
- [ ] 弹钢琴 / 原声吉他 / 八音盒 / 小提琴 → 有采样音色
- [ ] 打开鼓机、Rock/Hi-Tech 鼓组、电子鼓 → 每个 pad 出声（core 即时）
- [ ] 管乐/旋律采样（小号、长笛、萨克斯…）逐个点一下
- [ ] Network 面板确认：只下载点过的乐器样本
