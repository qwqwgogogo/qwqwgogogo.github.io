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

## 想改的话，东西在哪

- 站名和副标题在 `src/consts.ts`
- 首页（hero + 作品卡片 + 最新文章）在 `src/pages/index.astro`，作品卡片是手写的数据数组，加了新项目要自己补一条
- 文章列表页在 `src/pages/blog/index.astro`，404 页在 `src/pages/404.astro`
- 分享出去时用的预览图还是模板占位图 `src/assets/blog-placeholder-1.jpg`，换成自己的图再改 `src/components/BaseHead.astro`
- 想绑自己的域名的话，先买域名，再在仓库 Settings → Pages 里填，同时改 `astro.config.mjs` 的 `site`

## 动效是怎么挂上去的

没有引任何动画库，就两个文件：`src/styles/motion.css` 定义效果，`src/scripts/motion.ts` 负责触发。想让一个元素进场，给它加属性就行：

| 属性 | 作用 |
| --- | --- |
| `data-reveal` | 进入视口时淡入上移，可选 `="chars" / ="mask" / ="grow"` |
| `data-stagger` | 加在容器上，子元素的进场自动排队，`data-stagger-step="110"` 调间隔 |
| `data-spotlight` | 光斑跟随指针，边框同时发光 |
| `data-tilt="7"` | 卡片随指针 3D 倾斜，数字是最大角度 |
| `data-magnetic="7"` | 按钮被指针吸过去一点 |
| `data-parallax="0.12"` | 滚动视差，数字越大位移越多 |
| `data-scramble="700"` | 拉丁小字进场时乱码解码，数字是毫秒 |

三条约束值得记住：`--rd` 控制单个元素的延时；被 `clip-path` 裁没或被 `scaleX(0)` 压成零面积的元素面积为 0，观察器的 `threshold` 必须是 0，否则永远不会触发；`prefers-reduced-motion` 和禁用 JS 两条退路都要留，内容本身不能依赖动画才可见。

