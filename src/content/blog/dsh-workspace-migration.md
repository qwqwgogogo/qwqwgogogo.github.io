---
title: 'DeepSeek Harness 工作空间迁移：会话记录为什么会消失'
description: 'DSH 会话归属靠 realpath(session.cwd)===workspace.path，cwd 存在 .zstd header 里改不了。重命名目录会崩溃，正确做法是符号链接。'
pubDate: '2026-11-03'
---
> 📅 本文于 2026-11-03 发布到博客，实际产出日期为 2026-09-05。


把 DeepSeek Harness（DSH）的工作空间从一个路径迁到另一个路径后，打开发现**会话记录全部消失**。读源码搞清了机制。

## DSH 会话归属的唯一判据（源码确认）

```
workspace 的 sessionIds = record.sessionIds.filter(id => sessionPath(id) === record.path)
其中 sessionPath(id) = realpath(session 的 cwd)
```

**一个会话只有 `realpath(它的 cwd)` 精确等于某工作空间的 path，才属于/显示在该工作空间。**

关键：`session.cwd` 存死在 `.zstd` 压缩文件的 header 里，是创建时的工作目录，**无法直接改**。

## 踩坑记录（按顺序）

1. **直接改 workspace.json 的 path 后会话全消失** —— 因为 session.cwd 还是旧路径，realpath 不匹配
2. **重命名 `~/.dsh/sessions/` 下的路径编码目录 → 整个 DSH 启动崩溃** —— 报错 `corrupt session log: header id ... and cwd identify ...`。DSH 校验目录名编码的路径必须等于 `.zstd` 文件里 `header.cwd`，两者不一致就判文件损坏
3. **只重命名 1 个目录就足以让 DSH 崩溃**
4. 改 `session_projcache.json` 的 cwd 没用 —— session 真实 cwd 在压缩的 `.zstd` 里，缓存文件不影响归属

## 正确迁移步骤

1. `workspace.json` 的 `path` 改成新路径
2. **在家目录建符号链接**，让旧路径解析到新路径（realpath 后两边相等）：
   ```bash
   ln -s "/新路径/Workspace" "/旧路径/Workspace"
   ```
   → `realpath(session.cwd 旧路径)` = 新路径 = `workspace.path` → 匹配，会话归位
3. **绝不重命名 `~/.dsh/sessions/` 下的目录**
4. 若 sessionIds 账本缺失（孤儿会话），按 cwd 的 realpath 重新归属重建

## 关键结论

- 迁移任何"按路径归属"的工具，先搞清它的归属判据（读源码）
- 符号链接是让旧路径透明解析到新路径的标准做法
- 压缩文件里的元数据（header）改不了，只能绕
