#!/usr/bin/env bash
# 音乐工坊 一键部署/更新脚本 —— 在服务器 /opt/music-workshop 里执行
# 首次部署见 部署说明.md；此脚本用于"拉取最新代码 → 重新构建 dist → 重启服务"
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/music-workshop}"
cd "$APP_DIR"

echo "▶ 拉取最新代码"
git pull --ff-only

echo "▶ 依赖(仅后端用到 fetch，Node 18+ 自带；若无 package 依赖可跳过)"
# 如果以后加了 npm 依赖，这里 npm ci

echo "▶ 由单文件源重建 dist（音频外置 + 懒加载 + 注入脚本）"
node backend/extract-samples.mjs CubCopCat.src.html backend/dist

echo "▶ 校验密钥文件存在（不打印内容）"
test -f backend/.env && echo "  backend/.env ✓" || { echo "  ❌ 缺 backend/.env（含 MIMO 密钥），见 部署说明.md"; exit 1; }

echo "▶ 重启服务"
sudo systemctl restart music-workshop
sleep 1
sudo systemctl --no-pager --lines=5 status music-workshop || true

echo "▶ 自检"
PORT="$(cat "$APP_DIR/.port" 2>/dev/null || echo 8080)"
curl -s -o /dev/null -w "  本地 $PORT → %{http_code}\n" "http://127.0.0.1:$PORT/" || true
echo "✅ 完成（外网：https://music.yongle.school）"
