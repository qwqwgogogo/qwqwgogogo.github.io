---
title: '小米免费 TTS 接入：端点不是 /audio/speech'
description: '小米 MiMo TTS 免费且同 key 可调 LLM+TTS。两个坑：端点是 /chat/completions 不是 /audio/speech、TTS 内容必须放 assistant role。'
pubDate: '2026-09-06'
---

小米的 MiMo TTS 系列模型是免费的（2026 官方确认），而且和 LLM 用同一个 API key。本文记录接入流程和两个关键坑。

## 模型列表

同一个 key 可调 6 个模型，含 3 个 TTS：
- `mimo-v2.5-tts`（内置音色）
- `mimo-v2.5-tts-voiceclone`（音频克隆）
- `mimo-v2.5-tts-voicedesign`（文字设计音色）

## 坑 1：端点是 `/chat/completions`，不是 `/audio/speech`

调 `/audio/speech` 全 404。正确端点是 **`/chat/completions`**（OpenAI 兼容 chat 接口），用 messages 数组传内容，`audio` 参数指定格式和音色。

## 坑 2：TTS 内容必须放 assistant role

调 `/chat/completions` 报 400：`messages must contain an assistant role for TTS model`。必须这样写：

```json
{
  "model": "mimo-v2.5-tts",
  "messages": [
    {"role": "user", "content": ""},
    {"role": "assistant", "content": "要转成语音的文本"}
  ],
  "audio": {"format": "wav", "voice": "mimo_default"}
}
```

返回 base64 编码的 wav 音频（16-bit mono 24000 Hz）。

## 坑 3：base_url

官方文档写的是 `api.xiaomimimo.com`，但实际可用的是 `token-plan-cn.xiaomimimo.com`（token plan 套餐入口）。

## 接入 Hermes

1. 写脚本 `~/.hermes/scripts/xiaomi_tts.py`（读 input_path 文本 → 调 API → 写 output_path）
2. config.yaml 配 `tts.providers.xiaomi`（type: command）
3. 用 `text_to_speech` 工具实测成功

## 关键结论

- 免费的 TTS 资源值得接入，但要先查官方文档确认端点和参数格式
- OpenAI 兼容 ≠ 所有端点都兼容，TTS 走 chat 接口是反直觉的
- 同一个 key 能调 LLM + TTS 是很大的便利
