# 我的博客

源码仓库，公开访问地址：<https://qwqwgogogo.github.io>

基于 [Astro 官方 blog 模板](https://github.com/withastro/astro/tree/main/examples/blog)，静态托管在 GitHub Pages。推送 `main` 分支后由 GitHub Actions 构建并部署，本地不需要手动构建。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 产物在 dist/
```

## 写文章

在 `src/content/blog/` 里新建 `.md` 或 `.mdx` 文件，文件名即网址路径。frontmatter 至少要有 `title`、`description`、`pubDate`：

```markdown
---
title: '文章标题'
description: '摘要。'
pubDate: '2026-11-01'
---
```

## 目录说明

| 路径 | 作用 |
| --- | --- |
| `src/consts.ts` | 站点标题和副标题 |
| `src/pages/` | 首页、关于页、文章列表 |
| `src/components/` | 页头页脚等 |
| `src/content/blog/` | 文章 |
| `src/assets/` | 图片与字体，图片构建时自动转 webp |
| `.github/workflows/deploy.yml` | Pages 部署流程 |

RSS 在 `/rss.xml`，站点地图在 `/sitemap-index.xml`。
