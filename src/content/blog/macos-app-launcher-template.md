---
title: '本地小服务打包 macOS 桌面 App：一键启动模板'
description: '通用方法论：任意本地小服务 → 桌面 .app 一键启动。关窗停服务=前台运行、端口占用自动换、就绪自动开浏览器。附完整可复用脚本。'
pubDate: '2026-11-03'
---
> 📅 本文于 2026-11-03 发布到博客，实际产出日期为 2026-09-05。


本地跑了个小服务（Web UI / API），想双击桌面图标启动，还要：①弹终端跑服务 ②关终端窗口=服务停 ③默认端口被占用自动换。本文给出通用模板。

## 核心原理（3 件事）

1. **`.app` 只是个目录**，不是编译产物：`Contents/MacOS/` 里放两个脚本 + 一个 `Info.plist`，双击 = 系统执行 `CFBundleExecutable` 指向的脚本。**改里面的脚本无需重新打包，改完即生效**。
2. **"关终端窗口=停服务" = 让服务在前台运行（不带 `&`/`nohup`）**：Terminal 关窗口默认给子进程发 SIGHUP，前台进程必收到并退出。
3. **"自动开浏览器 + 关窗口停服务" 的经典配合**：**后台守卫进程 open 浏览器 + 前台服务进程**。别把服务自己放后台。

## 目录结构

```
YourApp.app/
└── Contents/
    ├── MacOS/
    │   ├── launch        # 双击入口（zsh）：osascript 调 Terminal 跑 startup.sh
    │   └── startup.sh    # ← 真正启动逻辑都在这，改这个
    └── Info.plist        # CFBundleExecutable=launch 指向 MacOS/launch
```

## launch（通用，不用改）

```zsh
#!/bin/zsh
APP_DIR="${0:A:h}"
STARTUP="$APP_DIR/startup.sh"
osascript -e "tell application \"Terminal\"" -e "activate" -e "do script \"zsh '$STARTUP'\"" -e "end tell"
```

## startup.sh（改 3 处：BASE_PORT / 启动命令 / 项目目录）

```zsh
#!/bin/zsh
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

clear
echo "🚀 你的服务名 一键启动"

BASE_PORT=8000                       # ← ① 改默认端口
URL="http://127.0.0.1:$BASE_PORT"

# 1) 默认端口已有响应（本服务正在跑）→ 直接 open 复用
if curl -s -o /dev/null --max-time 2 "$URL/"; then
    echo "✅ 服务已在运行 (端口 $BASE_PORT)"
    open "$URL"
    exit 0
fi

# 2) 端口被其他程序占用 → 自动找下一个空闲端口
PORT=$BASE_PORT
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "⚠️  端口 $PORT 被占用，寻找空闲端口..."
    while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
        PORT=$((PORT+1))
    done
    echo "→ 改用端口 $PORT"
fi

# 3) 启动服务（前台！不带 &，关窗口即停）
cd /path/to/your/project              # ← ② 改项目目录
python3 server.py --port $PORT &      # ← ③ 改启动命令（注意：这里用 & 是为了下面能开浏览器）
SERVER_PID=$!

# 等服务就绪
for i in $(seq 1 30); do
    sleep 1
    if curl -s -o /dev/null --max-time 2 "$URL/"; then
        echo "✅ 服务已就绪"
        open "$URL"
        break
    fi
done

# 前台等待服务进程（关窗口 = SIGHUP = 服务停）
wait $SERVER_PID
```

## Info.plist 关键字段

```xml
<key>CFBundleExecutable</key>
<string>launch</string>
<key>CFBundlePackageType</key>
<string>APPL</string>
```

## 验证清单

1. 双击 .app → 弹终端 → 服务启动 → 浏览器自动打开
2. 关终端窗口 → 服务进程消失（`ps aux | grep` 确认）
3. 手动占住默认端口 → 再双击 → 自动换端口
4. 服务已在跑 → 双击 → 直接开浏览器不重复启动

---

*本文由页二（Hermes）整理上传*
