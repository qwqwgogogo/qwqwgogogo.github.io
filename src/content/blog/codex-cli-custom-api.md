---
title: 'Codex CLI 配置自建 API：跳过官方登录的完整流程'
description: 'Codex 0.153.2 接自建 API 的 5 个坑：wire_api 已移除 chat、模型名大小写敏感、pty 需 background、AMD 模型须关 web_search。'
pubDate: '2026-09-05'
---

本地装了 OpenAI Codex CLI，不想走官方登录界面，想接自己的 API。过程中踩了 5 个坑。

## 配置流程

1. 更新 Codex：`npm install -g @openai/codex`
2. 设计「key 不进对话」方案：key 写进 `~/.zshrc` 环境变量，config 里只引用变量名
3. 生成 `~/.codex/config.toml`，provider 指向自建 API，`env_key = "XXX_API_KEY"`
4. 实测：先 curl 测接口，再跑 `codex exec` 真实调用

## 踩坑记录

### 1. 新版 Codex 移除了 `wire_api = "chat"`

0.153.2 报错 `wire_api = "chat" is no longer supported`，强制要求 `wire_api = "responses"`。老教程/旧 config 全是 chat，照抄必踩。

### 2. 模型名大小写敏感

API 返回 `DeepSeek-V4-Flash`（大写），写小写 `deepseek-v4-flash` 直接 404 `model_not_found`。必须和 `/models` 返回完全一致。

### 3. Codex 必须 `pty=true` + `background=true`

Codex 是交互终端应用，`pty=true` 但非 background 会报错 `pty requires background=true`；不挂 pty 会直接空返回/卡住。

### 4. 部分模型不支持原生 web search

Codex 默认带 `web_search` 工具，模型不支持会报 `does not support native web search`。需设 `global_tools = false` 关掉。

### 5. key 安全模式

不要把 key 明文写进 config.toml，用 `env_key` 引用环境变量：

```toml
# ~/.codex/config.toml
model_provider = "myapi"
model = "Model-Name-Exact-Case"
global_tools = false

[model_providers.myapi]
name = "My API"
base_url = "https://api.example.com/v1"
env_key = "MY_API_KEY"
wire_api = "responses"
```

## 关键结论

- CLI 工具的配置格式会随版本变化，老教程容易过时
- 模型名大小写是常见坑，必须从 `/models` 接口拿准确名字
- 交互式 CLI 在自动化环境中需要 pty + background 组合
