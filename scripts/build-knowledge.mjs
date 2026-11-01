/**
 * 知识库图谱的数据生成：扫站点已有内容 → 抽术语 → 算坐标 → 写 src/data/knowledge.json。
 * 由 package.json 的 prebuild/predev 调用，产物进仓库，CI 上 npm run build 会重新生成。
 *
 * 五条硬规矩：
 * 1. 术语只能来自已经发布的文字（文章正文/标题/摘要 + 首页项目条目 + 笔记正文），这里不内置任何词表；
 *    笔记 frontmatter 里的「考点」是例外，但它必须真的出现在正文里，否则脚本会警告并丢掉；
 * 2. 判定用纯规则（代码片段里的、多个大写的、全大写的、带数字或点划线的、以及"只有大写形式出现过"的专有名词），
 *    再加两道门槛：带斜杠的路径一律不当概念、全站只提一次的除全大写缩写和项目标签外不进图；
 * 3. 边只表达真实归属：同一篇文章里共现的词互连（每篇前 5 名互连，其余挂到本篇第一名），
 *    项目连它的标签，笔记连它的考点，科目连它下面的笔记——所以不会有点飘在太空里；
 * 4. 一个科目下面还没有笔记就不给它建节点，图谱里不放「待补」这种状态；
 * 5. 坐标用斐波那契球面在构建时算死，前端不做布局，所以刷新不跳位。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects, shortName } from '../src/data/projects.mjs';
import { subjects, subjectName } from '../src/data/subjects.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POST_DIR = join(root, 'src/content/blog');
const NOTE_DIR = join(root, 'src/content/notes');
const OUT = join(root, 'src/data/knowledge.json');

const CLIQUE = 5; // 每篇排前 CLIQUE 的词互相连线（真实共现），其余只连本篇第一名（保证没有孤点）
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

/** frontmatter：认 `key: value`，也认 tags 那种两横杠开头的列表 */
function parseFrontmatter(raw) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	const data = {};
	if (m) {
		let listKey = null;
		for (const line of m[1].split(/\r?\n/)) {
			const item = /^\s+-\s+(.*)$/.exec(line);
			if (item && listKey) {
				data[listKey].push(item[1].replace(/^['"]|['"]$/g, ''));
				continue;
			}
			const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
			if (!kv) {
				listKey = null;
				continue;
			}
			if (kv[2] === '') {
				listKey = kv[1];
				data[listKey] = [];
			} else {
				listKey = null;
				data[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
			}
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

const global = new Map(); // token -> count
const globalLower = new Map(); // lower -> count（用来判断"只有大写形式出现过"）
const codeOnly = new Set(); // 至少一次出现在代码片段里的 token

/** 读一个内容目录，文章和笔记走同一套抽取规则 */
function readDocs(dir, kind) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /\.(md|mdx)$/.test(f))
		.map((file) => {
			const raw = readFileSync(join(dir, file), 'utf8');
			const { data, body } = parseFrontmatter(raw);
			const slug = file.replace(/\.(md|mdx)$/, '');
			const plain = [data.title, data.description, body].filter(Boolean).join('\n');
			const text = stripLinks(plain);

			const bag = new Map();
			const cb = new Set();
			scan(text, bag, cb);
			cb.forEach((t) => codeOnly.add(t));
			bag.forEach((n, t) => {
				global.set(t, (global.get(t) ?? 0) + n);
				globalLower.set(t.toLowerCase(), (globalLower.get(t.toLowerCase()) ?? 0) + n);
			});

			return {
				slug,
				kind,
				title: data.title ?? slug,
				desc: data.description ?? '',
				subject: typeof data.subject === 'string' ? data.subject : '',
				// 笔记自己声明的考点；文章没有这个字段
				declared: Array.isArray(data.tags) ? data.tags : [],
				plain: stripLinks(plain),
				terms: bag,
			};
		});
}

const docs = [...readDocs(POST_DIR, 'post'), ...readDocs(NOTE_DIR, 'note')];
const posts = docs.filter((d) => d.kind === 'post');
const notes = docs.filter((d) => d.kind === 'note');

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
projectTerms.forEach((bag) => bag.forEach((n, t) => global.set(t, (global.get(t) ?? 0) + n)));
const fromProject = new Set();
projectTerms.forEach((bag) => bag.forEach((_n, t) => fromProject.add(t)));

/** 一个 token 值不值得当节点 */
function keep(token) {
	const lower = token.toLowerCase();
	if (STOP.has(lower)) return false;
	if (token.includes('/') || token.includes('\\')) return false; // 路径和 URL 残渣不是概念
	if (/^[a-z][+*^-]\d+$/.test(token)) return false; // 反引号里的算式（ack=x+1 里的 x+1）不是术语
	if (/^[x]\d+$/.test(token)) return false; // 0x100 被切剩的 x100 不是术语
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

const nodes = [];
const idOf = new Map(); // lower -> node id

/** 同一个小写键下的概念节点，没有就建一个 */
function conceptNode(label, count) {
	const key = label.toLowerCase();
	const existing = idOf.get(key);
	if (existing !== undefined) return existing;
	const id = nodes.length;
	idOf.set(key, id);
	nodes.push({ id, label, kind: 'concept', count, posts: [], notes: [], projects: [] });
	return id;
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
byLower.forEach(({ label, count }, key) => {
	idOf.set(key, nodes.length);
	nodes.push({ id: nodes.length, label, kind: 'concept', count, posts: [], notes: [], projects: [] });
});

/** 一个词（含中文考点）在全站正文里出现几次 */
const mentions = (word) => docs.reduce((sum, d) => sum + (d.plain.split(word).length - 1), 0);

// 笔记声明的考点：正文里找不到就不进图，宁可少一条边也不要一条假边
for (const n of notes) {
	n.tagIds = [];
	for (const raw of n.declared) {
		const tag = raw.trim();
		if (!tag) continue;
		if (mentions(tag) <= 0) {
			console.warn(`  ! ${n.slug} 的考点「${tag}」在正文里找不到，这条不进图`);
			continue;
		}
		n.tagIds.push(conceptNode(tag, mentions(tag)));
	}
}

posts.forEach((p) =>
	[...p.terms.keys()].forEach((t) => {
		const idx = idOf.get(t.toLowerCase());
		if (idx !== undefined) nodes[idx].posts.push(p.slug);
	}),
);
notes.forEach((n) => {
	[...n.terms.keys()].forEach((t) => {
		const idx = idOf.get(t.toLowerCase());
		if (idx !== undefined && !nodes[idx].notes.includes(n.slug)) nodes[idx].notes.push(n.slug);
	});
	n.tagIds.forEach((idx) => {
		if (!nodes[idx].notes.includes(n.slug)) nodes[idx].notes.push(n.slug);
	});
});

const projectNodes = projects.map((p, i) => {
	const node = {
		id: nodes.length,
		label: shortName(p),
		kind: 'project',
		count: 0,
		posts: [],
		notes: [],
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

// 笔记节点：冒号前的那半截当图上标签，整标题只在详情里用
const noteNodes = notes.map((n) => {
	const node = {
		id: nodes.length,
		label: n.title.split('：')[0].trim(),
		kind: 'note',
		desc: n.desc,
		count: n.tagIds.length,
		posts: [],
		notes: [n.slug],
		projects: [],
		subject: n.subject,
	};
	nodes.push(node);
	return node;
});

// 科目节点：只有真的有笔记的科目才进图
const subjectNodes = subjects
	.filter((s) => notes.some((n) => n.subject === s.key))
	.map((s) => {
		const own = notes.filter((n) => n.subject === s.key);
		const node = {
			id: nodes.length,
			label: s.name,
			kind: 'subject',
			count: own.length,
			posts: [],
			notes: own.map((n) => n.slug),
			projects: [],
			subject: s.key,
		};
		nodes.push(node);
		return node;
	});

const edgeWeight = new Map();
const addEdge = (a, b) => {
	if (a === undefined || b === undefined || a === b) return;
	const key = a < b ? `${a}|${b}` : `${b}|${a}`;
	edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
};

/** 一篇文章/笔记里的词按频次排好，供共现连线用 */
const rankedOf = (doc) => {
	const fromBody = [...doc.terms.entries()]
		.map(([t, n]) => [idOf.get(t.toLowerCase()), n])
		.filter(([idx]) => idx !== undefined);
	const fromTags = (doc.tagIds ?? []).map((idx) => [idx, 0]);
	return [...fromBody, ...fromTags]
		.sort((a, b) => b[1] - a[1])
		.map(([idx]) => idx);
};

for (const doc of docs) {
	const ranked = rankedOf(doc);
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

notes.forEach((n, i) => {
	n.tagIds.forEach((idx) => addEdge(noteNodes[i].id, idx));
});
// 科目只连自己名下的笔记，读者从科目点进去就是这一科的笔记列表
subjectNodes.forEach((sn) => {
	notes.forEach((n, i) => {
		if (n.subject === sn.subject) addEdge(sn.id, noteNodes[i].id);
	});
});

/* ---------- 术语解释：只从他自己的正文里挑句子，脚本不生成任何文字 ---------- */
const SENTENCE = /[^。！？\n]+[。！？]?/g;
// 像下定义的写法。命中只是加分，不是门槛——门槛是这句话里真的有这个词
const DEF_MARK = /是指|指的是|就是|称为|叫做|用于|用来|负责|表示|意味着|可以理解为|简单说|所谓|分成|分为|包括/;
const BS = String.fromCharCode(92);
const SPECIAL = '.+*?^$()[]{}|';

function sentencePool(text) {
	const clean = text.replace(/`{3}[\s\S]*?`{3}/g, ' ').replace(/`([^`\n]+)`/g, '$1');
	return (clean.match(SENTENCE) ?? [])
		.map((x) => x.replace(/^[>\-*+\s]+/, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim())
		.filter((x) => x.length > 0 && !x.includes('|') && !x.startsWith('#'));
}

const pools = docs.map((d) => ({ doc: d, sentences: sentencePool(d.plain) }));

/** ASCII 词要整词匹配：连字符算词内字符，否则 PATH 会命中 clip-path */
const termRe = new Map();
function reOf(label) {
	if (!termRe.has(label)) {
		const esc = [...label].map((c) => (SPECIAL.includes(c) ? BS + c : c)).join('');
		termRe.set(label, /^[A-Za-z0-9]/.test(label) ? new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`, 'i') : null);
	}
	return termRe.get(label);
}
function hasTerm(text, label) {
	const re = reOf(label);
	return re ? re.test(text) : text.includes(label);
}

function scoreSentence(x) {
	const len = [...x].length;
	if (len < 12 || len > 120) return -1;
	let score = 0;
	if (DEF_MARK.test(x)) score += 4;
	if (x.includes('——') || x.includes(':') || x.includes('：')) score += 1;
	return score - Math.abs(len - 44) / 22; // 太短说不清，太长是在讲故事
}

function glossFor(label) {
	let best = null;
	for (const { doc, sentences } of pools) {
		if (!hasTerm(doc.plain, label)) continue;
		for (const x of sentences) {
			if (!hasTerm(x, label)) continue;
			const score = scoreSentence(x);
			if (score < 0) continue;
			if (!best || score > best.score) best = { score, text: x, slug: doc.slug, title: doc.title, kind: doc.kind };
		}
	}
	return best && { text: best.text, slug: best.slug, title: best.title, kind: best.kind };
}

for (const n of nodes) {
	if (n.kind !== 'concept') continue;
	const g = glossFor(n.label);
	if (g) n.gloss = g;
}
const glossed = nodes.filter((n) => n.kind === 'concept' && n.gloss).length;
const conceptCount = nodes.filter((n) => n.kind === 'concept').length;

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
	n.notes = [...new Set(n.notes)];
	n.projects = [...new Set(n.projects)];
}

const out = {
	generatedAt: new Date().toISOString().slice(0, 10),
	nodeCount: nodes.length,
	edgeCount: edges.length,
	posts: posts.map((p) => ({ slug: p.slug, title: p.title })),
	notes: notes.map((n) => ({ slug: n.slug, title: n.title, subject: n.subject })),
	subjects: subjects.map((s) => ({ key: s.key, name: s.name, notes: notes.filter((n) => n.subject === s.key).length })),
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
		` · 孤点 ${iso} · 最大度 ${maxDeg} · 术语解释 ${glossed}/${conceptCount}`,
);
console.log(
	'  节点类别:',
	['concept', 'project', 'note', 'subject']
		.map((k) => `${k} ${nodes.filter((n) => n.kind === k).length}`)
		.join(' / '),
);
for (const p of posts) {
	const members = nodes.filter((n) => n.kind === 'concept' && n.posts.includes(p.slug));
	if (members.length) console.log(`  · ${p.slug}: ${members.map((n) => n.label).join(' ')}`);
}
for (const n of notes) {
	console.log(`  · 笔记 ${n.slug}（${subjectName(n.subject)}）: ${n.tagIds.map((i) => nodes[i].label).join(' ')}`);
}
for (const pn of projectNodes) {
	console.log(`  · 项目 ${pn.label}: ${nodes.filter((n) => n.projects.includes(pn.label)).map((n) => n.label).join(' ')}`);
}
