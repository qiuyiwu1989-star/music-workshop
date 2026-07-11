# CubCopCat 轻后端 · 上手清单

独立产品，**不碰中台库**。技术栈：PocketBase（单二进制 + SQLite）。

## 文件
| 文件 | 作用 |
|---|---|
| `后端设计.md` | 完整设计：数据模型、权限规则、部署、合规、落地顺序 |
| `setup-pb.mjs` | 一键建库脚本（collections + 权限规则），Phase 0 |
| `cubcopcat-backend.js` | 前端集成模块，内联进主 HTML，Phase 1 |

## 从零到跑起来（约 30 分钟）

### ① 起 PocketBase
```bash
mkdir -p /opt/cubcopcat && cd /opt/cubcopcat
# 下载对应架构的 pocketbase 二进制放这里： https://github.com/pocketbase/pocketbase/releases
./pocketbase superuser create admin@你的邮箱 <强密码>
./pocketbase serve --http=127.0.0.1:8090     # 只听本地回环
```

### ② 建库（collections + 权限规则）
```bash
npm i pocketbase
PB_URL=http://127.0.0.1:8090 PB_ADMIN=admin@你的邮箱 PB_PASS=<强密码> node setup-pb.mjs
# 打开 http://127.0.0.1:8090/_/ 核对 orgs / classes / works / progress 已建好
```
> users collection 记得在 Admin UI 里把 **email 设为非必填**、启用 **username** 作为登录标识（学生用用户名登录，不收邮箱）。

### ③ 公网 + 国内可访问
- nginx 反代（模板见 `后端设计.md` 第 7 节）→ certbot 对**已备案子域名**签证书。
- **必须用已备案、且备案绑这台服务器的域名**，如 `api.<已备案域名>`，否则国内被 ICP 墙拦截。
- 验证（**从国内网络**）：`curl -s -o /dev/null -w "%{http_code}\n" https://api.<已备案域名>/api/health` → `200`。

### ④ 前端接入（Phase 1）
1. 下载 `pocketbase.umd.js`（SDK），像 THREE.js 一样**内联**进主 HTML 的一个 `<script>`。
2. 把 `cubcopcat-backend.js` 内容内联进**最后一个** `<script>`（主程序之后）。
3. 改一行：`Backend.URL = 'https://api.<已备案域名>'`。
4. 在 Medly 工具条（约 4076 行 `💾 Save` 附近）加两个按钮：
   ```html
   <button onclick="Medly.saveToCloud()">☁️ 云端保存</button>
   <button onclick="Medly.showCloudDialog()">☁️ 我的作品</button>
   ```
5. 完成。登录/注册自动走云端，作品可跨设备。`Backend.URL` 留空则自动退回纯本地模式。

## 验收（Phase 1 算完成）
- [ ] 注册新账号 → 换一台设备/浏览器能用同账号登录
- [ ] Medly 做一首曲子 → ☁️ 云端保存 → 换设备登录 → ☁️ 我的作品能载入
- [ ] 用另一个账号登录，看不到别人的作品（权限规则生效）
- [ ] 断网时演奏/创作照常，联网后能保存

## 下一步（Phase 2 预告）
- `orgs`/`classes` 落地 + 批量建学生账号脚本
- 老师后台：先直接用 PocketBase Admin UI 顶，再做定制页
