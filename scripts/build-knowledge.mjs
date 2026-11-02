/**
 * 两张图的数据生成：扫站点已有内容 → 抽词 → 算坐标 → 写两份 JSON。
 * 由 package.json 的 prebuild/predev 调用，产物进仓库，CI 上 npm run build 会重新生成。
 *
 *   src/data/knowledge.json      → /knowledge/       文章正文 + 首页项目条目里的技术词
 *   src/data/knowledge-408.json  → /knowledge/408/   408 学习笔记 + 自己声明的考点
 *
 * 两条线分开是必须的：考点有三百多个，混在一张球面上会把文章里那些真正反复写的词挤没了。
 *
 * 六条硬规矩：
 * 1. 词只能来自已经发布的文字，这里不内置任何词表（STOP 只挡语法词和命令行通用词）；
 * 2. 判定用纯规则（全大写缩写、多个大写的名字、反引号里的标识符、带版本号或点划线的写法、
 *    「只有大写形式出现过」的专有名词），全站只提一次的除全大写缩写和首页项目标签外不进图；
 * 3. 408 那张只认笔记 frontmatter 里声明的考点，而且必须真的出现在正文里，否则脚本警告并丢掉；
 * 4. 概念在他自己的正文里挑不出一句话解释，就不进图（首页项目标签除外——那是他写的标签，不是概念）。
 *    图上存在的每个词都点得开一句原话，空面板不算「还没补」，算这个词本来就不该在图上；
 * 5. 边只表达真实归属：同一篇里共现的词互连（每篇前 5 名互连，其余挂到本篇第一名），
 *    项目连它的标签，笔记连它的考点，科目连它下面的笔记——所以不会有点飘在太空里；
 * 6. 坐标用斐波那契球面在构建时算死，前端不做布局，所以刷新不跳位。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects, shortName, primaryUrl } from '../src/data/projects.mjs';
import { subjects } from '../src/data/subjects.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POST_DIR = join(root, 'src/content/blog');
const NOTE_DIR = join(root, 'src/content/notes');
const OUT_SITE = join(root, 'src/data/knowledge.json');
const OUT_EXAM = join(root, 'src/data/knowledge-408.json');

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

/** Windows 路径整段抹掉：\Users\...\Roaming 里的 Roaming 不是术语 */
const WINPATH = /[A-Za-z]:[\\/][^\s|、，。）)】」]+|\\\\[^\s|、，。）)】」]+/g;

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
			const text = stripLinks(plain).replace(WINPATH, ' ');

			const bag = new Map();
			const code = new Set();
			scan(text, bag, code);

			return {
				slug,
				kind,
				title: data.title ?? slug,
				desc: data.description ?? '',
				subject: typeof data.subject === 'string' ? data.subject : '',
				// 笔记自己声明的考点；文章没有这个字段
				declared: Array.isArray(data.tags) ? data.tags : [],
				// frontmatter 里的 description 是「这篇讲什么」的目录句，不能当术语解释
				prose: stripLinks(body).replace(WINPATH, ' '),
				plain: stripLinks(plain).replace(WINPATH, ' '),
				terms: bag,
				code,
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
// 首页项目条目里的词是他自己写的标签，不要求它在正文里有一句解释
const fromProject = new Set();
projectTerms.forEach((bag) => bag.forEach((_n, t) => fromProject.add(t)));
const fromProjectLower = new Set([...fromProject].map((t) => t.toLowerCase()));

// 项目描述也是他写的正文，可以给只在家园页出现的词当解释；出处直接指仓库
const projectDocs = projects.map((p, i) => ({
	slug: shortName(p),
	kind: 'project',
	title: p.name,
	desc: p.desc,
	subject: '',
	declared: [],
	prose: stripLinks(p.desc),
	plain: stripLinks(`${p.desc}\n${p.tags}`),
	terms: projectTerms[i],
	code: new Set(),
	url: primaryUrl(p) ?? null,
}));

/** 中文考点常写成「B 树」「I/O 接口」（中英之间有空格），比对时把空白抹掉，否则声明和正文对不上 */
const hasCJK = (s) => /[一-鿿]/.test(s);
const nospace = (s) => s.replace(/\s+/g, '');
/** 只有带汉字的词才抹空格：IEEE 754 这种词自己就含空格，抹了反而对不上 */
const hits = (text, word) => (hasCJK(word) ? nospace(text).split(nospace(word)).length - 1 : text.split(word).length - 1);

/** 一个词值不值得当节点 */
function makeKeeper(count, lower, codeSet, owned) {
	return (token) => {
		const low = token.toLowerCase();
		if (STOP.has(low)) return false;
		if (token.includes('/') || token.includes('\\')) return false; // 路径和 URL 残渣不是概念
		if (/^[a-z][+*^-]\d+$/.test(token)) return false; // 反引号里的算式（ack=x+1 里的 x+1）不是术语
		if (/^[x]\d+$/.test(token)) return false; // 0x100 被切剩的 x100 不是术语
		const uppers = (token.match(/[A-Z]/g) ?? []).length;
		const acronym = uppers === token.length && token.length >= 3; // MCP GAP OOM DiT
		// 只提一次就够的条件：全大写缩写（作者自己选的术语）和首页项目条目里的标签（他自己写的）
		if ((count.get(token) ?? 0) < MIN_COUNT && !acronym && !owned.has(low)) return false;
		if (acronym) return true;
		if (codeSet.has(token)) return true; // 出现在反引号里 = 他自己在写术语
		if (uppers >= 2) return true; // ComfyUI GitHub WebGL R3F
		if (/[0-9._+-]/.test(token) && token.length >= 4) return true; // Next.js cu128 v1.13
		// 专有名词：始终大写出现、从没小写过、至少提过两次
		if (
			uppers === 1 &&
			token[0] === token[0].toUpperCase() &&
			(count.get(token) ?? 0) >= 2 &&
			(lower.get(low) ?? 0) === (count.get(token) ?? 0)
		)
			return true;
		return owned.has(low); // 首页项目条目里的标签是他自己写的，单独提一次也认
	};
}

/* ---------- 术语解释：只从他自己的正文里挑句子，脚本不生成任何文字 ---------- */
const SENTENCE = /[^。！？\n]+[。！？]?/g;
// 像下定义的写法。命中只是加分，不是门槛——门槛是这句话里真的有这个词
const DEF_MARK = /是指|指的是|就是|称为|叫做|用于|用来|负责|表示|意味着|可以理解为|简单说|所谓|分成|分为|包括/;
const BS = String.fromCharCode(92);
const SPECIAL = '.+*?^$()[]{}|';

function sentencePool(text) {
	const clean = text.replace(/`{3}[\s\S]*?`{3}/g, ' ').replace(/`([^`\n]+)`/g, '$1');
	return (clean.match(SENTENCE) ?? [])
		.map((x) =>
			x
				.replace(/^[>\-*+\s]+/, '')
				.replace(/[*`]/g, '')
				.replace(/\s+/g, ' ')
				// 引出下文的收尾标点不是解释的一部分，留着面板上像半句话
				.replace(/[：:，,；;、]+$/, '')
				.trim(),
		)
		// 以连接词收尾的是被截断的半句，读起来像话没说完
		.filter((x) => !/(所以|因为|并且|而且|然后|或者|但是)$/.test(x))
		.filter((x) => x.length > 0 && !x.includes('|') && !x.startsWith('#'));
}

/** ASCII 词要整词匹配：连字符算词内字符，否则 PATH 会命中 clip-path */
const termRe = new Map();
function reOf(label) {
	if (!termRe.has(label)) {
		const esc = [...label].map((c) => (SPECIAL.includes(c) ? BS + c : c)).join('');
		// 带汉字的标签（I/O接口、B树）走「抹掉空格再比」这条路：正文里习惯写成「I/O 接口」「B 树」
		termRe.set(label, /^[A-Za-z0-9]/.test(label) && !hasCJK(label) ? new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`, 'i') : null);
	}
	return termRe.get(label);
}
function hasTerm(text, label) {
	const re = reOf(label);
	return re ? re.test(text) : nospace(text).includes(nospace(label));
}

// 括号和书名号里的词不算数：「报错（None、missing required field、got object）」这句讲的不是 got。
// 但短括号往往是译名对照（写回（write-back）），不能一起砍掉——所以只屏蔽带顿号的列举和长插入语。
const PAREN = /（[^）]*）|\([^)]*\)|「[^」]*」/g;
const stripAside = (text) => text.replace(PAREN, (m) => (/[、，,]/.test(m) || [...m].length > 24 ? '（）' : m));
const mentionOutsideParen = (text, label) => hasTerm(stripAside(text), label);

function scoreSentence(x) {
	const len = [...x].length;
	if (len < 12 || len > 120) return null; // 太短撑不起一句解释，太长是在讲故事
	let score = 0;
	if (DEF_MARK.test(x)) score += 4;
	if (x.includes('——') || x.includes(':') || x.includes('：')) score += 1;
	// 长度只做同分时的微调：不能因为它把整句否掉，否则一个词只有一句像样的话时就空着
	return score + Math.max(0, 1 - Math.abs(len - 44) / 76);
}

function pickFrom(pool, label) {
	let best = null;
	for (const { doc, sentences } of pool) {
		if (!hasTerm(doc.plain, label)) continue;
		for (const x of sentences) {
			if (!mentionOutsideParen(x, label)) continue;
			const score = scoreSentence(x);
			if (score === null) continue;
			if (!best || score > best.score) {
				best = { score, text: x, slug: doc.slug, title: doc.title, kind: doc.kind, url: doc.url ?? null };
			}
		}
	}
	return best;
}

/**
 * 挑一句原话当解释。顺序是三件事：
 * ① 有文档把这个词声明成考点，只从那些文档里挑——否则文章里「顺带提到这个词」的那句会抢走解释
 *    （我写过一句「移码这批词全空着」，它就差点变成移码的定义）；
 * ② 没有考点声明时，文章优先于首页项目描述，项目那句话是兜底；
 * ③ 声明了它却没在正文里留下一句可挑的话（只写进表格），就退回整个池子再找一遍：
 *    面板上有一句带出处的真话，好过空着——出处照样指回那句原话所在的文档。
 */
function makeGlossFor(pools) {
	const ownersOf = (label) => pools.filter(({ doc }) => doc.declared.includes(label));
	const articles = pools.filter(({ doc }) => doc.kind !== 'project');
	return (label) => {
		const owners = ownersOf(label);
		const preferred = owners.length ? owners : articles;
		const best = pickFrom(preferred, label) ?? pickFrom(pools, label);
		return best && { text: best.text, slug: best.slug, title: best.title, kind: best.kind, url: best.url };
	};
}

/**
 * 一张图：contentDocs 决定词从哪来，seed 决定认哪些词。
 * seed='shape'    → 纯规则抽的技术词（文章线）
 * seed='declared' → 只认笔记 frontmatter 里声明、且正文真写过的考点（408 线）
 */
function assemble({ key, file, contentDocs, glossDocs, seed, linkProjects, linkNotes }) {
	const count = new Map();
	const lower = new Map();
	const codeSet = new Set();
	for (const d of contentDocs) {
		d.terms.forEach((n, t) => {
			count.set(t, (count.get(t) ?? 0) + n);
			lower.set(t.toLowerCase(), (lower.get(t.toLowerCase()) ?? 0) + n);
		});
		d.code.forEach((t) => codeSet.add(t));
	}
	if (linkProjects) projectTerms.forEach((bag) => bag.forEach((n, t) => count.set(t, (count.get(t) ?? 0) + n)));
	const owned = linkProjects ? fromProjectLower : new Set();
	const keep = makeKeeper(count, lower, codeSet, owned);

	const nodes = [];
	const idOf = new Map(); // lower -> node id

	/** 同一个小写键下的概念节点，没有就建一个 */
	function conceptNode(label, cnt) {
		const k = label.toLowerCase();
		const existing = idOf.get(k);
		if (existing !== undefined) return existing;
		const id = nodes.length;
		idOf.set(k, id);
		nodes.push({ id, label, kind: 'concept', count: cnt, posts: [], notes: [], projects: [] });
		return id;
	}

	/** 一个词（含中文考点）在本图正文里出现几次 */
	const mentions = (word) => contentDocs.reduce((sum, d) => sum + hits(d.plain, word), 0);

	if (seed === 'declared') {
		// 笔记声明的考点：本图正文里找不到就不进图，宁可少一条边也不要一条假边
		for (const n of contentDocs) {
			n.tagIds = [];
			for (const raw of n.declared) {
				const tag = raw.trim();
				if (!tag) continue;
				const m = mentions(tag);
				if (m <= 0) {
					console.warn(`  ! ${n.slug} 的考点「${tag}」在正文里找不到，这条不进图`);
					continue;
				}
				n.tagIds.push(conceptNode(tag, m));
			}
		}
	} else {
		// 同一个词的大小写变体合并，标签取出现最多的那个写法
		const byLower = new Map();
		count.forEach((n, t) => {
			if (!keep(t)) return;
			const k = t.toLowerCase();
			const cur = byLower.get(k);
			if (!cur || n > cur.count) byLower.set(k, { label: t, count: n });
			else cur.count += n;
		});
		byLower.forEach(({ label, count: cnt }, k) => {
			idOf.set(k, nodes.length);
			nodes.push({ id: nodes.length, label, kind: 'concept', count: cnt, posts: [], notes: [], projects: [] });
		});
		contentDocs.forEach((d) => (d.tagIds = []));
	}

	// 反查：这篇里出现过的词，把这篇记到词节点上
	contentDocs.forEach((d) => {
		const target = d.kind === 'note' ? 'notes' : 'posts';
		[...d.terms.keys()].forEach((t) => {
			const idx = idOf.get(t.toLowerCase());
			if (idx !== undefined && !nodes[idx][target].includes(d.slug)) nodes[idx][target].push(d.slug);
		});
		d.tagIds.forEach((idx) => {
			if (!nodes[idx][target].includes(d.slug)) nodes[idx][target].push(d.slug);
		});
	});

	// 项目节点：项目本身是点，它的标签连过来
	let projectNodes = [];
	if (linkProjects) {
		projectNodes = projects.map((p, i) => {
			const node = {
				id: nodes.length,
				label: shortName(p),
				kind: 'project',
				count: 0,
				posts: [],
				notes: [],
				projects: [],
				url: primaryUrl(p) ?? null,
			};
			nodes.push(node);
			projectTerms[i].forEach((_n, t) => {
				const idx = idOf.get(t.toLowerCase());
				if (idx !== undefined && idx !== node.id) nodes[idx].projects.push(node.label);
			});
			return node;
		});
	}

	// 笔记节点（冒号前那半截当图上标签，整标题只在详情里用）和科目节点（只有真的有笔记的科目才建点）
	let noteNodes = [];
	let subjectNodes = [];
	if (linkNotes) {
		noteNodes = contentDocs.map((n) => {
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
		subjectNodes = subjects
			.filter((s) => contentDocs.some((n) => n.subject === s.key))
			.map((s) => {
				const own = contentDocs.filter((n) => n.subject === s.key);
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
	}

	const edgeWeight = new Map();
	const addEdge = (a, b) => {
		if (a === undefined || b === undefined || a === b) return;
		const k = a < b ? `${a}|${b}` : `${b}|${a}`;
		edgeWeight.set(k, (edgeWeight.get(k) ?? 0) + 1);
	};

	/** 这个词在这篇正文里出现几次（考点是按名字声明的，只能回正文里数） */
	const countIn = (doc, label) => hits(doc.plain, label);

	/** 一篇文档里的词按本篇频次排好，供共现连线用 */
	const rankedOf = (doc) => {
		const w = new Map();
		[...doc.terms.entries()].forEach(([t, n]) => {
			const idx = idOf.get(t.toLowerCase());
			if (idx !== undefined) w.set(idx, Math.max(w.get(idx) ?? 0, n));
		});
		// 中文考点不会被 TOKEN 扫到，只能拿名字回正文里数一遍
		(doc.tagIds ?? []).forEach((idx) => {
			if (!w.has(idx)) w.set(idx, countIn(doc, nodes[idx].label));
		});
		return [...w.entries()].sort((a, b) => b[1] - a[1]).map(([idx]) => idx);
	};

	for (const doc of contentDocs) {
		const ranked = rankedOf(doc);
		const core = ranked.slice(0, CLIQUE);
		if (!core.length) continue;
		for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) addEdge(core[i], core[j]);
		// 其余术语只连本篇的头号词：它们是这篇里的次要术语，不该跟谁都扯上关系，但也不能没有归属
		for (const idx of ranked.slice(CLIQUE)) addEdge(idx, core[0]);
	}

	if (linkProjects) {
		for (let i = 0; i < projects.length; i++) {
			const pn = projectNodes[i];
			projectTerms[i].forEach((_n, t) => {
				const idx = idOf.get(t.toLowerCase());
				if (idx !== undefined) addEdge(pn.id, idx);
			});
		}
	}
	if (linkNotes) {
		contentDocs.forEach((n, i) => n.tagIds.forEach((idx) => addEdge(noteNodes[i].id, idx)));
		// 科目只连自己名下的笔记，读者从科目点进去就是这一科的笔记列表
		subjectNodes.forEach((sn) => {
			contentDocs.forEach((n, i) => {
				if (n.subject === sn.subject) addEdge(sn.id, noteNodes[i].id);
			});
		});
	}

	const glossFor = makeGlossFor(glossDocs.map((d) => ({ doc: d, sentences: sentencePool(d.prose) })));
	for (const n of nodes) {
		if (n.kind !== 'concept') continue;
		const g = glossFor(n.label);
		if (g) n.gloss = g;
	}

	// 没有一句原话可指的概念不进图：点得开一句真话，比多一个空面板有价值
	const dropped = nodes.filter((n) => n.kind === 'concept' && !n.gloss && !owned.has(n.label.toLowerCase()));
	const dropIds = new Set(dropped.map((n) => n.id));
	const kept = nodes.filter((n) => !dropIds.has(n.id));
	const reindex = new Map(kept.map((n, i) => [n.id, i]));
	kept.forEach((n, i) => (n.id = i));

	const edges = [...edgeWeight.entries()]
		.filter(([k]) => {
			const [a, b] = k.split('|').map(Number);
			return reindex.has(a) && reindex.has(b);
		})
		.map(([k, weight]) => {
			const [a, b] = k.split('|').map(Number);
			return { a: reindex.get(a), b: reindex.get(b), weight };
		});

	// 斐波那契球面（黄金角均布）：N 个点均匀撒在球壳上，纯数学，不表达层级
	const golden = Math.PI * (3 - Math.sqrt(5));
	kept.forEach((n, i) => {
		const y = 1 - (i / Math.max(kept.length - 1, 1)) * 2;
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
	for (const n of kept) {
		n.posts = [...new Set(n.posts)];
		n.notes = [...new Set(n.notes)];
		n.projects = [...new Set(n.projects)];
	}

	const iso = kept.filter((n) => !degree.get(n.id)).map((n) => `${n.label}(${n.kind})`);
	const out = {
		scope: key,
		generatedAt: new Date().toISOString().slice(0, 10),
		nodeCount: kept.length,
		edgeCount: edges.length,
		posts: linkNotes ? [] : posts.map((p) => ({ slug: p.slug, title: p.title })),
		notes: linkNotes ? contentDocs.map((n) => ({ slug: n.slug, title: n.title, subject: n.subject })) : [],
		subjects: linkNotes
			? subjects.map((s) => ({ key: s.key, name: s.name, notes: contentDocs.filter((n) => n.subject === s.key).length }))
			: [],
		nodes: kept,
		edges,
		// 被「挑不出原话」筛掉的词：页面上的说明要引用这个数，别让文案里写死的数字腐烂
		dropped: dropped.map((n) => n.label),
	};
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(out), 'utf8');

	const concepts = kept.filter((n) => n.kind === 'concept');
	const g = (k) => kept.filter((n) => n.kind === k).length;
	console.log(
		`${key}: ${kept.length} 节点 / ${edges.length} 边（weight>=2 的 ${edges.filter((e) => e.weight >= 2).length} 条）` +
			` · 孤点 ${iso.length} · 最大度 ${Math.max(0, ...degree.values())}` +
			` · 概念 ${concepts.length}（筛掉 ${dropped.length} 个没有原话的）· 解释 ${concepts.filter((n) => n.gloss).length}/${concepts.length}`,
	);
	console.log(
		'  节点类别:',
		['concept', 'project', 'note', 'subject'].map((k) => `${k} ${g(k)}`).join(' / '),
	);
	if (iso.length) console.log(`  ! ${key} 有孤点: ${iso.join(' ')}`);
	return { out, dropped };
}

const site = assemble({
	key: 'site',
	file: OUT_SITE,
	contentDocs: posts,
	glossDocs: [...posts, ...projectDocs],
	seed: 'shape',
	linkProjects: true,
	linkNotes: false,
});
const exam = assemble({
	key: 'exam',
	file: OUT_EXAM,
	contentDocs: notes,
	glossDocs: notes,
	seed: 'declared',
	linkProjects: false,
	linkNotes: true,
});

console.log('  筛掉的词（正文里挑不出一句解释）:');
console.log('    文章线:', site.dropped.map((n) => n.label).join(' ') || '无');
console.log('    408 线:', exam.dropped.map((n) => n.label).join(' ') || '无');
