---
title: 'GitHub 慢/挂？用无 SNI 直连方案绕过 GFW 限速'
description: 'GFW 按 SNI 字符串对 github.com 限速，实测扫描 30 个 IP 29 个超时。用本地 MITM 代理 + 无 SNI 后端连接 + 完整请求头，实测稳定 200。'
pubDate: '2026-11-03'
---
> 📅 本文于 2026-11-03 发布到博客，实际产出日期为 2026-08-15。


GFW 对 `github.com` 的 SNI 做 DPI 限速，导致 clone/fetch 经常超时。镜像站能用但数据过第三方，不放心。本文记录一个已验证的方案：**系统钥匙串信任自签 CA + 本地 MITM 代理 + 后端无 SNI 连接**。

## 核心原理

1. **GFW 按 SNI 字符串限速**：`github.com` 的 SNI 在几乎所有 GitHub IP 上都被限速（扫描 30 IP，29 个超时）。而 `api.github.com` / `raw.githubusercontent.com` 的 SNI 不受影响。
2. **无 SNI 能绕开 GFW**：后端连接不传 `server_hostname`，GFW 认不出是 github.com，就不限速。
3. **但请求头必须完整**：早期测试无 SNI 返回 400/403，加上完整 `Host` + `User-Agent` + `Accept` 头后完全 200。

## 实现步骤

1. 自签一个 CA（如 "Local GitHub CA"），装到系统钥匙串（全局信任）
2. 本地 MITM 代理监听 `127.0.0.1:7890`，只解 GitHub 域名，其他域名透明转发
3. 后端连接用无 SNI（不传 `server_hostname`），但请求头要完整
4. git 配置代理：`git config --global http.https://github.com.proxy http://127.0.0.1:7890`

## 踩坑记录

1. **CONNECT 隧道必须先回 `HTTP/1.1 200 Connection Established`**，客户端才会发 TLS ClientHello。代理直接 `wrap_socket` 等握手会卡死（SSLEOFError / 客户端超时）。这是最隐蔽的 bug。
2. 后端真实 SNI 连 github.com → 被 GFW 限速（纯隧道不稳的根源）；后端无 SNI → 绕开但须完整头。
3. Python 3.9 的 f-string 不能含反斜杠；系统 python3 加载 3.11 venv 的 cryptography 报 ABI 错，**MITM 脚本必须用 venv python 跑**。
4. `security add-trusted-cert` 设信任那步会弹 SecurityAgent 授权框，**后台跑无法交互被拒**，必须用户在真实终端跑。

## 实测结果

curl github.com 200、`git ls-remote` 返回 HEAD、git clone 完整成功、连测 3 次稳定（每次 ~11s）。

## 遗留

11s 延迟：后端多候选 IP 里多数被 GFW 干扰（无 SNI 也慢/超时），代理要逐个试到能通的。可优化 IP 池排序/缩短超时。
