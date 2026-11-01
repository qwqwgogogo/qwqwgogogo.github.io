/**
 * 知识库图谱的数据生成：扫站点已有内容 → 抽术语 → 算坐标 → 写 src/data/knowledge.json。
 * 由 package.json 的 prebuild/predev 调用，产物进仓库，CI 上 npm run build 会重新生成。
 *
 * 四条硬规矩：
 * 1. 术语只能来自已经发布的文字（文章正文/标题/摘要 + 首页项目条目），这里不内置任何词表；
 * 2. 判定用纯规则（代码片段里的、多个大写的、全大写的、带数字或点划线的、以及"只有大写形式出现过"的专有名词），
 *    再加两道门槛：带斜杠的路径一律不当概念、全站只提一次的除全大写缩写和项目标签外不进图；
 * 3. 边只表达"同一篇文章里共现"：每篇前 5 名互连，其余挂到本篇第一名，所以不会有点飘在太空里；
 * 4. 坐标用斐波那契球面在构建时算死，前端不做布局，所以刷新不跳位。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects, shortName } from '../src/data/projects.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POST_DIR = join(root, 'src/content/blog');
const OUT = join(root, 'src/data/knowledge.json');

const CLIQUE = 5; // 每篇排前 CLIQUE 的词互相连线（真实共现），其余只连本篇的头号词（保证没有孤点）
const MIN_COUNT = 2; // 全站只提一次的词不进图：一个点的图谱只会在太空里飘着
const RADIUS = 120;

// 只挡纯语法词、命令行里的通用动词/参数和 URL 残渣，不挡任何工具名
const STOP = new Set(
	('the and for with this that from have will your not but are was were been being ' +
		'http https www com org cn edu node nodes url uri etc eg ie vs via per one two ' +
		'more most them they there here when what which while because should would could ' +
		'than then too also only same such very much many each other none both ' +
		'default install exit code site module named result input output models assets dev ' +
		'scripts chars mask grow threshold ano flag flags line lines file files desktop release').split(' '),
);

const TOKEN = /[A-Za-z][A-Za-z0-9+#._/-]{2,}/g;

/** 去掉链接目标和裸 URL，避免把 github / releases / latest 当成术语 */
function stripLinks(text) {
	return text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/`{3}[\s\S]*?`{3}/g, (f) => f); // 围栏代码保留，里面的标识符算代码片段
}

function parseFrontmatter(raw) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	const data = {};
	if (m) {
		for (const line of m[1].split(/\r?\n/)) {
			const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
			if (kv) data[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
		}
	}
	return { data, body: raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '') };
}

/** 统计一个文本里的 token，并标出哪些出现在反引号里 */
function scan(text, bag, codeBag) {
	const codeSpans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
	const codeTokens = new Set();
	for (const span of codeSpans) for (const t of span.match(TOKEN) ?? []) codeTokens.add(t);

	for (const raw of text.match(TOKEN) ?? []) {
		const t = raw.replace(/[._/-]+$/, ''); // 尾随标点不算进词里
		if (t.length < 2) continue;
		bag.set(t, (bag.get(t) ?? 0) + 1);
		if (codeTokens.has(raw)) codeBag.add(t);
	}
}

const posts = [];
const global = new Map(); // token -> count
const globalLower = new Map(); // lower -> count（用来判断"只有大写形式出现过"）
const codeOnly = new Set(); // 至少一次出现在代码片段里的 token

for (const file of readdirSync(POST_DIR).filter((f) => /\.(md|mdx)$/.test(f))) {
	const raw = readFileSync(join(POST_DIR, file), 'utf8');
	const { data, body } = parseFrontmatter(raw);
	const slug = file.replace(/\.(md|mdx)$/, '');
	const text = stripLinks([data.title, data.description, body].filter(Boolean).join('\n'));

	const bag = new Map();
	const cb = new Set();
	scan(text, bag, cb);
	cb.forEach((t) => codeOnly.add(t));

	bag.forEach((n, t) => {
		global.set(t, (global.get(t) ?? 0) + n);
		globalLower.set(t.toLowerCase(), (globalLower.get(t.toLowerCase()) ?? 0) + n);
	});

	posts.push({ slug, title: data.title ?? slug, terms: bag });
}

// 项目条目也进图：项目本身是节点，描述/标签里的术语连到它
const nameTokensOf = (p) => new Set((stripLinks(p.name).match(TOKEN) ?? []).map((t) => t.toLowerCase()));
const projectText = projects.map((p) => stripLinks(`${p.desc}\n${p.tags}`));
const projectTerms = projectText.map((t) => {
	const bag = new Map();
	scan(t, bag, new Set());
	return bag;
});
// 项目名自己的词不另立节点：「Ollama Model Manager」不该再拆出 Model、Manager 两个概念
const nameTokens = new Set(projects.flatMap((p) => [...nameTokensOf(p)]));
projectTerms.forEach((bag) =>
	[...bag.keys()].forEach((t) => {
		if (nameTokens.has(t.toLowerCase())) bag.delete(t);
	}),
);
projectTerms.forEach((bag) =>
	bag.forEach((n, t) => global.set(t, (global.get(t) ?? 0) + n)),
);
const fromProject = new Set();
projectTerms.forEach((bag) => bag.forEach((_n, t) => fromProject.add(t)));

/** 一个 token 值不值得当节点 */
function keep(token) {
	const lower = token.toLowerCase();
	if (STOP.has(lower)) return false;
	if (token.includes('/') || token.includes('\\')) return false; // 路径和 URL 残渣不是概念
	const uppers = (token.match(/[A-Z]/g) ?? []).length;
	const acronym = uppers === token.length && token.length >= 3; // MCP GAP OOM DiT
	// 只提一次就够的条件：全大写缩写（作者自己选的术语）和首页项目条目里的标签（他自己写的）
	if ((global.get(token) ?? 0) < MIN_COUNT && !acronym && !fromProject.has(token)) return false;
	if (acronym) return true;
	if (codeOnly.has(token)) return true; // 出现在反引号里 = 他自己在写术语
	if (uppers >= 2) return true; // ComfyUI GitHub WebGL R3F
	if (/[0-9._+-]/.test(token) && token.length >= 4) return true; // Next.js cu128 v1.13
	// 专有名词：始终大写出现、从没小写过、至少提过两次
	if (
		uppers === 1 &&
		token[0] === token[0].toUpperCase() &&
		(global.get(token) ?? 0) >= 2 &&
		(globalLower.get(lower) ?? 0) === (global.get(token) ?? 0)
	)
		return true;
	return fromProject.has(token); // 首页项目条目里的标签是他自己写的，单独提一次也认
}

// 同一个词的大小写变体合并，标签取出现最多的那个写法
const byLower = new Map();
global.forEach((n, t) => {
	if (!keep(t)) return;
	const key = t.toLowerCase();
	const cur = byLower.get(key);
	if (!cur || n > cur.count) byLower.set(key, { label: t, count: n });
	else cur.count += n;
});

const nodes = [];
const idOf = new Map();
byLower.forEach(({ label, count }, key) => {
	idOf.set(key, nodes.length);
	nodes.push({ id: nodes.length, label, kind: 'concept', count, posts: [], projects: [] });
});

posts.forEach((p) =>
	[...p.terms.keys()].forEach((t) => {
		const idx = idOf.get(t.toLowerCase());
		if (idx !== undefined) nodes[idx].posts.push(p.slug);
	}),
);

const projectNodes = projects.map((p, i) => {
	const node = {
		id: nodes.length,
		label: shortName(p),
		kind: 'project',
		count: 0,
		posts: [],
		projects: [],
		url: p.url ?? p.secondary?.url ?? null,
	};
	nodes.push(node);
	projectTerms[i].forEach((_n, t) => {
		const idx = idOf.get(t.toLowerCase());
		if (idx !== undefined && idx !== node.id) nodes[idx].projects.push(node.label);
	});
	return node;
});

// 边：同一篇里共现的概念对（每篇只连它自己的前 TOP_PER_POST 高频词）+ 项目到它的术语
const edgeWeight = new Map();
const addEdge = (a, b) => {
	if (a === b) return;
	const key = a < b ? `${a}|${b}` : `${b}|${a}`;
	edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
};

for (const p of posts) {
	const ranked = [...p.terms.entries()]
		.map(([t, n]) => [idOf.get(t.toLowerCase()), n])
		.filter(([idx]) => idx !== undefined)
		.sort((a, b) => b[1] - a[1])
		.map(([idx]) => idx);
	const core = ranked.slice(0, CLIQUE);
	for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) addEdge(core[i], core[j]);
	// 其余术语只连本篇的头号词：它们是这篇里的次要术语，不该跟谁都扯上关系，但也不能没有归属
	for (const idx of ranked.slice(CLIQUE)) addEdge(idx, core[0]);
}
for (let i = 0; i < projects.length; i++) {
	const pn = projectNodes[i];
	projectTerms[i].forEach((_n, t) => {
		const idx = idOf.get(t.toLowerCase());
		if (idx !== undefined) addEdge(pn.id, idx);
	});
}

const edges = [...edgeWeight.entries()].map(([key, weight]) => {
	const [a, b] = key.split('|').map(Number);
	return { a, b, weight };
});

// 斐波那契球面（黄金角均布）：N 个点均匀撒在球壳上，纯数学，不表达层级
const golden = Math.PI * (3 - Math.sqrt(5));
nodes.forEach((n, i) => {
	const y = 1 - (i / Math.max(nodes.length - 1, 1)) * 2;
	const r = Math.sqrt(Math.max(0, 1 - y * y));
	const theta = golden * i;
	n.x = +(Math.cos(theta) * r * RADIUS).toFixed(2);
	n.y = +(y * RADIUS).toFixed(2);
	n.z = +(Math.sin(theta) * r * RADIUS).toFixed(2);
});

const degree = new Map();
edges.forEach((e) => {
	degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
	degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
});
for (const n of nodes) {
	n.posts = [...new Set(n.posts)];
	n.projects = [...new Set(n.projects)];
}
const label = (i) => nodes[i].label;

const out = {
	generatedAt: new Date().toISOString().slice(0, 10),
	nodeCount: nodes.length,
	edgeCount: edges.length,
	posts: posts.map((p) => ({ slug: p.slug, title: p.title })),
	nodes,
	edges,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out), 'utf8');

const iso = nodes.filter((n) => !degree.get(n.id)).length;
const maxDeg = Math.max(0, ...degree.values());
console.log(
	`knowledge.json: ${nodes.length} 节点 / ${edges.length} 边` +
		`（weight>=2 的 ${edges.filter((e) => e.weight >= 2).length} 条）` +
		` · 孤点 ${iso} · 最大度 ${maxDeg}`,
);
console.log('  术语表:', nodes.filter((n) => n.kind === 'concept').map((n) => `${n.label}(${n.count})`).join(' '));
for (const p of posts) {
	const members = nodes.filter((n) => n.kind === 'concept' && n.posts.includes(p.slug));
	if (members.length) console.log(`  · ${p.slug}: ${members.map((n) => n.label).join(' ')}`);
}
for (const pn of projectNodes) {
	console.log(`  · 项目 ${pn.label}: ${nodes.filter((n) => n.projects.includes(pn.label)).map((n) => n.label).join(' ')}`);
}
