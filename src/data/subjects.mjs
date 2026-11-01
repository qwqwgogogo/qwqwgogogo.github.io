/**
 * 考研 408 的四门科目。学习笔记目录页按这个顺序分栏，知识图谱也只给「有笔记的科目」建节点。
 * key 用在笔记 frontmatter 的 subject 字段上，name 是人看的写法。
 */
export const subjects = [
	{ key: 'ds', name: '数据结构' },
	{ key: 'co', name: '计算机组成原理' },
	{ key: 'os', name: '操作系统' },
	{ key: 'net', name: '计算机网络' },
];

export const subjectName = (key) => subjects.find((s) => s.key === key)?.name ?? key;
