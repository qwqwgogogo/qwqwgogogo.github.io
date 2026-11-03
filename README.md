# qwqwgogogo.github.io

个人站点源码。线上地址：<https://qwqwgogogo.github.io>，静态托管在 GitHub Pages。

Astro 7 站点，`npm run build` 全量预渲染成纯静态 HTML，推 `main` 后由 GitHub Actions 构建部署，本地不需要手动构建。
3D 部分用 three.js，但只在浏览器确认支持 WebGL 时才动态导入，首屏包里不含 three。

## 常用命令

```bash
npm install          # Node 需要 >= 22.23.4
npm run dev          # http://localhost:4321，predev 会先重跑图谱脚本
npm run build        # 产物在 dist/，prebuild 同样先重跑图谱脚本
npm run knowledge    # 只重跑图谱脚本，不构建
npm run preview      # 预览 dist/，改动 src/content 后要先 build
```

## 页面

| 路由 | 内容 |
| --- | --- |
| `/` | 视觉主页：简介、项目条目、少量文章与笔记入口 |
| `/blog/`、`/blog/:slug/` | 技术文章 |
| `/notes/`、`/notes/:slug/` | 408 复习笔记，按科目分栏 |
| `/knowledge/` | 文章正文 + 首页项目条目里长出来的技术词，一张 3D 图 |
| `/knowledge/408/` | 笔记里声明的考点，另一张 3D 图，和上面不混 |
| `/effects/` | 前端效果样式鉴：按进场/指针/滚动/材质/过渡五族分，每条有中英文名、实现说明、在本站的采用状态和用在哪 |
| `/about/` | 关于页 |

RSS 在 `/rss.xml`，站点地图在 `/sitemap-index.xml`。

## 内容从哪来

两篇内容集合，都靠文件名当 URL 路径。

文章 `src/content/blog/*.md|mdx`：

```markdown
---
title: '文章标题'
description: '摘要。'
pubDate: '2026-11-01'
updatedDate: '2026-11-02'   # 可选
heroImage: '../assets/x.jpg' # 可选
---
```

笔记 `src/content/notes/*.md|mdx`：

```markdown
---
title: '考点标题'
description: '一句话说明这篇讲什么。'
subject: 'ds'      # 只认 src/data/subjects.mjs 里的 key：ds / co / os / net，写错构建直接报错
tags:              # 这里写的就是考点，会被图谱脚本读进去
  - '哈希函数'
pubDate: '2026-11-01'
---
```

## 两张图谱是怎么生成的

`scripts/build-knowledge.mjs` 在每次 dev/build 前先跑一遍，扫已经发布的文字，产出两份 JSON：

- `src/data/knowledge.json` → `/knowledge/`
- `src/data/knowledge-408.json` → `/knowledge/408/`

同一个 `assemble()` 跑两遍，差别只在四件事：语料（文章+首页项目条目 / 只有笔记）、抽词方式（按写法形状自己长 / 只认 frontmatter 声明的 tags）、找原话的范围、连线开关。规则细节写在脚本开头的注释里，也写在 [把博客正文抽成两张能转的 3D 图](https://qwqwgogogo.github.io/blog/knowledge-graph-3d-build/) 这篇里。要点：

- 脚本不内置任何词表，词只来自已发布的文字；全站只提一次的普通词扔掉。
- 声明过的考点还要**真的出现在正文里**，否则脚本警告并丢掉——防止 frontmatter 和正文各说各话。
- 一个词如果在他的正文里挑不出一句 12–120 字、真的讲到它的原话，就不进图。所以点图上任何一个概念都有话可看，不存在「点开是空的」。
- 边只表达真实归属（同一篇里共现、项目连标签、笔记连考点、科目连笔记），坐标用斐波那契球面在构建时算死，前端不做布局，刷新不跳位。

**别手改 `src/data/knowledge*.json`**，那是产物；要改图就改规则或改正文，然后 `npm run knowledge` 重跑。

改文章时要留意：上面那篇讲图谱的文章本身也是语料，正文里的词和数字一变，节点数、边数、被筛掉的词都会跟着变。所以改完正文跑一次脚本，把控制台打出的统计同步回文章里的数字，再跑一次确认数字对得上。页面上的计数走 JSON 里的 `dropped` 数组，不写死。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/consts.ts` | 站点标题、副标题、联系方式常量（解码逻辑在 `src/scripts/contacts.ts`） |
| `src/pages/` | 路由，一文件一路径 |
| `src/content/blog/`、`src/content/notes/` | 文章与笔记原文 |
| `src/content.config.ts` | 两个集合的 frontmatter 校验 |
| `src/data/projects.mjs` | 首页项目条目，同时是图谱的项目节点来源 |
| `src/data/subjects.mjs` | 408 科目 key 与中文名 |
| `src/data/knowledge*.json` | 图谱产物，勿手改 |
| `src/components/ConceptGraph.astro` | 两张图共用的版式：3D 舞台 + 左列表 + 右侧详情 + 无 WebGL 时的平面 SVG |
| `src/scripts/knowledge-gl.ts` | three.js 场景，被动态导入 |
| `src/scripts/knowledge.ts` | 客户端装配：按路径选 JSON、绑定点击、`astro:page-load` 重启、`astro:before-swap` 释放 GPU |
| `src/scripts/kb-copy.ts` | 同一节点在两张图里的标签/说明文案差异 |
| `src/scripts/motion.ts`、`src/styles/motion.css` | 进场与滚动动效基座 |
| `src/assets/fonts/` | 本地字体（Atkinson），不外链 CDN |
| `.github/workflows/deploy.yml` | Pages 部署流程 |

## 改这个站之前要知道的 Astro 坑

- `<script>` 里不插值：Astro 把脚本内容当模块源码，`{expression}` 会原样发到浏览器。要给客户端传构建期数据，就用 JSON import。
- 装了 `<ClientRouter />`，页面的模块脚本**每个文档只执行一次**，不是每次访问。只在模块顶层 boot 的页面，用户跳走再回来就退回无 JS 状态——要在 `astro:page-load` 里再 boot 一次，并用容器上的 `dataset` 标记防重复。
- scoped `<style>` 管不到脚本动态创建的节点，那些规则要写成 `.parent :global(.child)`。
