/**
 * 两张图共用的文案：同一批节点在 /knowledge/ 和 /knowledge/408/ 上的叫法不一样。
 * 服务端渲染降级平面图和客户端交互都从这里取，省得两边各写一遍再写歪。
 */
import type { GraphNode } from './knowledge-gl';

export type Scope = 'site' | 'exam';

const LABEL: Record<GraphNode['kind'], string> = {
	concept: '概念',
	project: '项目',
	note: '学习笔记',
	subject: '408 科目',
};

export const kindLabel = (kind: GraphNode['kind'], scope: Scope) =>
	kind === 'concept' && scope === 'exam' ? '考点' : LABEL[kind];

/** 面板上那行小字：概念说它被提到几次，笔记说它有几个考点，科目说它下面有几篇 */
export function metaFor(node: GraphNode, scope: Scope, related: number, subject?: string) {
	switch (node.kind) {
		case 'project':
			return '首页挂着的项目条目';
		case 'note':
			return `${subject ?? '笔记'} · ${node.count} 个考点`;
		case 'subject':
			return `408 科目 · 下面 ${node.notes.length} 篇笔记`;
		default:
			return `${scope === 'exam' ? '这一科的正文里出现' : '全站提到'} ${node.count} 次 · 连着 ${related} 个词`;
	}
}

/** 解释的出处怎么跳：项目描述指仓库，笔记和文章指站内 */
export function glossHref(gloss: NonNullable<GraphNode['gloss']>) {
	if (gloss.kind === 'project') return gloss.url ?? '/';
	return `${gloss.kind === 'note' ? '/notes/' : '/blog/'}${gloss.slug}/`;
}
