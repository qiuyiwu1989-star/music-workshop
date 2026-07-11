# 音乐工坊 · Music Workshop

面向少年创造者的音乐创作产品：从「演奏乐器」到「创作一首署名作品」。定位创造者教育（B2B2C 学校 / 教培）。

## 目录结构

```
CubCopCat.src.html          单文件主程序（含全部逻辑/样式；内联音频样本，是唯一「源真相」）
backend/
  extract-samples.mjs       构建脚本：把内联音频外置 + 生成瘦身/懒加载版 HTML
  serve.mjs                 本地静态服务 + /api/compose（AI 作曲代理，密钥仅在服务器侧）
  cubcopcat-backend.js      前端云后端集成（PocketBase：账号/作品云存储）
  setup-pb.mjs              PocketBase 一键建库（collections + 权限规则）
  后端设计.md               轻后端设计文档（PocketBase）
  .env.example              环境变量模板（复制为 .env 填入密钥）
  dist/                     构建产物（多为生成物，被 .gitignore）
    audio-lazyload.js       手写：音频按需加载 shim
    ai-composer.js          手写：AI 共创面板（语义 → 旋律）
```

## 构建 & 运行

```bash
# 1) 生成 dist（音频外置 + 懒加载版 HTML）
node backend/extract-samples.mjs CubCopCat.src.html backend/dist

# 2) 配置密钥（AI 作曲需要）
cp backend/.env.example backend/.env   # 然后填入 MIMO_API_KEY

# 3) 起服务（必须 http，不能 file://）
node backend/serve.mjs                 # → http://127.0.0.1:8080/
```

## 已完成 / 进行中

- ✅ 音频外置 + 按需加载（首屏 6.15MB → 1.68MB，-73%）
- ✅ AI 共创：对话 → 语义匹配的旋律 → 所选乐器试听 → 存进作曲台署名
- ✅ 用户旅程：Guest-first（不再强制注册）
- ✅ 品牌微调：音乐工坊 · Music Workshop + 配色 token 化
- ⏳ 轻后端 PocketBase（账号 / 作品云存储 / 教师侧）— 已设计，待部署

## 安全

- `backend/.env`（含 API 密钥）已被 `.gitignore` 忽略，**绝不提交**。
- AI 作曲的密钥只在 `serve.mjs` 服务器侧使用，不进客户端。
