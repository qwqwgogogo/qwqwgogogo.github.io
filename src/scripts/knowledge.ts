/**
 * 知识库页的入口：先把「点一个词 → 更新右边说明」这条线接通（没有 WebGL 也照样能用），
 * WebGL 可用时才动态 import 3D 场景，three.js 因此不会进首屏那个包。
 *
 * 这个模块在文档存活期只执行一次，页间过渡不会重跑它，所以装配 DOM 的部分都放在 boot() 里，
 * 由 astro:page-load 每次过渡后重新调用；上一个 WebGL 上下文在换页前 dispose，不然白占浏览器的上下文名额。
 */
import type { GlHandle, Graph, GraphNode } from './knowledge-gl';
import knowledge from '../data/knowledge.json';

// 构建脚本产出的那份 JSON：服务端用它画降级的平面图，客户端用它画 3D，同一来源不会各说各话
const graph = knowledge as unknown as Graph;
const nodes = new Map<number, GraphNode>(graph.nodes.map((n) => [n.id, n]));
const titles = new Map<string, string>(
	[...graph.posts, ...graph.notes].map((d) => [d.slug, d.title] as [string, string]),
);
const subjectName = new Map<string, string>(graph.subjects.map((s) => [s.key, s.name] as [string, string]));

const KIND_LABEL: Record<GraphNode['kind'], string> = {
	concept: '概念',
	project: '项目',
	note: '学习笔记',
	subject: '408 科目',
};
const degreeOf = new Map<number, number>();
graph.edges.forEach((e) => {
	degreeOf.set(e.a, (degreeOf.get(e.a) ?? 0) + e.weight);
	degreeOf.set(e.b, (degreeOf.get(e.b) ?? 0) + e.weight);
});
const hubId = graph.nodes.reduce((a, b) =>
	(degreeOf.get(b.id) ?? 0) > (degreeOf.get(a.id) ?? 0) ? b : a,
).id;

const el = (tag: string, cls: string, value: string) => {
	const node = document.createElement(tag);
	node.className = cls;
	node.textContent = value;
	return node;
};

const linkedIds = (id: number) => [
	...new Set(graph.edges.filter((e) => e.a === id || e.b === id).map((e) => (e.a === id ? e.b : e.a))),
];

const webglWorks = () => {
	try {
		const c = document.createElement('canvas');
		return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
	} catch {
		return false;
	}
};

let gl: GlHandle | null = null;

function boot() {
	const stage = document.querySelector<HTMLElement>('[data-stage]');
	const detail = document.querySelector<HTMLElement>('[data-detail]');
	if (!stage || !detail) return;
	if (stage.dataset.kbBooted) return;
	stage.dataset.kbBooted = '1';

	const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-node-id]')];
	let selectedId = -1;

	const linkList = (slugs: string[], base: string) => {
		const list = document.createElement('ul');
		for (const slug of slugs) {
			const li = document.createElement('li');
			const a = document.createElement('a');
			a.href = `${base}${slug}/`;
			a.textContent = titles.get(slug) ?? slug;
			li.append(a);
			list.append(li);
		}
		return list;
	};

	const render = (node: GraphNode, related: GraphNode[]) => {
		detail.replaceChildren();
		detail.append(el('p', 'kind', KIND_LABEL[node.kind]));
		detail.append(
			el(
				'p',
				'name',
				node.kind === 'note' ? (titles.get(node.notes[0] ?? '') ?? node.label) : node.label,
			),
		);
		detail.append(
			el(
				'p',
				'meta',
				node.kind === 'project'
					? '首页挂着的项目条目'
					: node.kind === 'note'
						? `${subjectName.get(node.subject ?? '') ?? '笔记'} · ${node.count} 个考点`
						: node.kind === 'subject'
							? `408 科目 · 下面 ${node.notes.length} 篇笔记`
							: `全站提到 ${node.count} 次 · 连着 ${related.length} 个词`,
			),
		);

		if (node.posts.length) detail.append(linkList(node.posts, '/blog/'));
		if (node.kind !== 'note' && node.notes.length) detail.append(linkList(node.notes, '/notes/'));
		if (node.projects.length) {
			detail.append(el('p', 'meta', `出现在项目：${node.projects.join('、')}`));
		}
		if (node.url) {
			const a = document.createElement('a');
			a.href = node.url;
			a.target = '_blank';
			a.rel = 'noreferrer';
			a.textContent = '仓库 / 演示 ↗';
			detail.append(a);
		}
		if (related.length) {
			const list = document.createElement('ul');
			list.className = 'chips';
			for (const other of related) {
				const li = document.createElement('li');
				const b = document.createElement('button');
				b.type = 'button';
				b.dataset.nodeId = String(other.id);
				b.textContent = other.label;
				li.append(b);
				list.append(li);
			}
			detail.append(
				el('p', 'related-label', node.kind === 'concept' ? '连着这些词' : '连着这些节点'),
				list,
			);
		}
	};

	const select = (id: number) => {
		const node = nodes.get(id);
		if (!node) return;
		selectedId = id;
		render(
			node,
			linkedIds(id)
				.map((other) => nodes.get(other))
				.filter((n): n is GraphNode => Boolean(n)),
		);
		for (const b of buttons) b.setAttribute('aria-current', String(Number(b.dataset.nodeId) === id));
		gl?.select(id);
	};

	const showFallback = () => {
		if (stage.querySelector('.notice')) return;
		stage.append(
			el('p', 'notice', '这台机器开不了 WebGL：下面是同一张图的平面版，构建时算好的坐标，点得动。'),
		);
	};

	// 委托在 main 上而不是 document 上：过渡后旧的 main 会被换掉，监听器跟着一起消失，不会攒
	const main = stage.closest('main') ?? stage;
	main.addEventListener('click', (event) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
		if (!target) return;
		select(Number(target.dataset.nodeId));
	});
	// 降级平面图里可聚焦的是 SVG 的 <g>，它没有原生按钮行为，键盘得自己接
	main.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const target = (event.target as Element).closest<HTMLElement>('[data-node-id]');
		if (!target) return;
		event.preventDefault();
		select(Number(target.dataset.nodeId));
	});

	// 学习笔记页的考点标签用 ?label= 跳过来：按标签找点，因为 id 是构建时按顺序发的，正文一改就会挪位
	const wanted = new URLSearchParams(location.search).get('label');
	const initial = wanted ? graph.nodes.find((n) => n.label === wanted) : undefined;
	select(initial?.id ?? hubId);

	if (webglWorks()) {
		// 动态 import：three.js 落在这个单独的 chunk 里，首屏 HTML 和首屏 JS 都不含它
		import('./knowledge-gl')
			.then(({ mountGraph }) => {
				gl = mountGraph(stage, graph, select, selectedId);
			})
			.catch(showFallback);
	} else {
		showFallback();
	}
}

boot();
document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', () => {
	gl?.dispose();
	gl = null;
});
