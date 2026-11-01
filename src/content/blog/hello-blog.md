---
title: '博客上线了'
description: '站点从本地到 GitHub Pages 的完整链路，以及以后怎么写文章。'
pubDate: '2026-11-01'
---

这个博客是 Astro 官方 blog 模板改的，静态文件由 GitHub Actions 构建后推到 Pages。代码在 [github.com/qwqwgogogo/qwqwgogogo.github.io](https://github.com/qwqwgogogo/qwqwgogogo.github.io)。

## 以后怎么发一篇文章

在 `src/content/blog/` 下新建一个 `.md` 文件，文件名就是网址（`hello-world.md` 对应 `/blog/hello-world/`）。开头必须有这几行：

```markdown
---
title: '文章标题'
description: '摘要，会出现在列表页和 RSS 里。'
pubDate: '2026-11-01'
heroImage: '../../assets/图片名.jpg'
---
```

`heroImage` 可以不要。图片放在 `src/assets/`，构建时会自动转 webp 并压缩。

写完直接推上去：

```bash
git add -A && git commit -m "post: 文章标题" && git push
```

大概一分钟后线上更新，不用本地构建。

## 本地先看看效果

```bash
npm install   # 只有第一次需要
npm run dev   # 打开 http://localhost:4321
```

## 还没做的事

- 站名和副标题在 `src/consts.ts`
- 首页（大字 hero + 作品卡片 + 最新文章）在 `src/pages/index.astro`，作品卡片是手写的数据数组，加了新项目要自己补一条
- 文章列表页在 `src/pages/blog/index.astro`
- 分享出去时用的预览图还是模板占位图 `src/assets/blog-placeholder-1.jpg`，换成自己的图再改 `src/components/BaseHead.astro`
- 想绑自己的域名的话，先买域名，再在仓库 Settings → Pages 里填，同时改 `astro.config.mjs` 的 `site`
