---
title: 'ComfyUI Desktop 打不开：壳、后端、数据库各是一个版本'
description: '日志里那句 locate revision identified by 0006_add_loader_path 指向的不是安装坏了，而是两套安装共用了一个已被升级的库。'
pubDate: '2026-11-02'
---

ComfyUI Desktop 突然打不开：窗口闪一下就没，前端连不上后端。日志里翻到关键一行：

```
Error upgrading database: Can't locate revision identified by '0006_add_loader_path'
```

第一反应是数据库坏了，准备重装。重装解决不了——**这套软件有三个独立的东西会各自漂移版本**：

| 东西 | 在哪 |
| --- | --- |
| 桌面壳 | `%APPDATA%\ComfyUI\config.json` 里的 `basePath` 决定它启动哪套后端 |
| 后端安装 | 真正跑推理的 ComfyUI 代码，有自己的版本号 |
| 本地数据库 | `user/comfyui.db`，被哪个版本启动过，就被升到哪个版本 |

## 根因

壳的 `basePath` 指向的是我半年前装的那套老后端，版本 0.22.0。它的 alembic 迁移文件只到 0003：

```
0001_assets.py
0002_merge_to_asset_references.py
0003_add_metadata_job_id.py
```

而 `user/comfyui.db` 这个库，被另一套装过的新版 ComfyUI 打开过，已经升到 0006 往上了。新版安装里的迁移链是这样的：

```
0004_drop_tag_type.py
0005_allow_case_sensitive_tags.py
0006_add_loader_path.py
... 一直到 0009
```

老代码拿着库上写的「我在 0006」去自己的目录里找 0006 这个迁移，找不到 → 后端初始化失败 → 前端连不上。**壳没坏，模型文件没坏，数据库也没坏，只是三者版本对不上。**

## 修法

改一行配置，把壳指向新装（`X:` 换成自己机器上的盘符）：

```json
{ "basePath": "X:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI" }
```

新那套现在已经是 0.40.0，迁移链完整，库能认。

但新装默认去找自己目录下的 `models/`，而权重全在老目录里（十几 GB 起步，重下不划算）。所以在新装根目录放一个 `extra_models_config.yaml`，把 `models` / `input` / `output` 指回老目录，两边共用同一份权重。

改完能正常打开，之前下的模型一个没重下。

## 另一条路，我没走

往老安装里手工拷 0004–0006 三个迁移文件，让它「够得着」库上的版本号。这样也能起来，但：

- `0004_drop_tag_type` 会真的删掉 `tags.tag_type` 列，这是往回退不了的改动；
- 包管理器每次同步依赖都会把版本降回 0.22.0，改了又被覆盖；
- 0.22 的 `comfy_extras` 里根本没有新模型的节点，就算起来了也跑不了那些工作流。

救急可以，长期是给自己埋雷。

## 一般的结论

「桌面壳 + 独立后端 + 带迁移的本地库」这个三件套结构，很多工具都是这样（各种 IDE、本地模型管理器、带 Postgres 的桌面应用）。它们的通病是：

**迁移版本号是单向门，而重装只会换掉三件套里的一个。**

所以遇到「打不开」，先分别把三个版本号抄下来对一遍，再决定动哪个。直接重装往往只是把壳换掉，库还是那个被升过级的库，错误原样复现。
