/**
 * @typedef {Object} Project
 * @property {string} name
 * @property {string} desc
 * @property {string} tags
 * @property {string} year
 * @property {string} [url]
 * @property {{ label: string, url: string }} [secondary]
 */

/** @type {Project[]} */
// 首页作品行和知识库图谱共用这一份；url 留空则不渲染「仓库」和标题链接
export const projects = [
	{
		// 源码仓库已转私有，只挂公开的演示站
		name: '小豚 · 武汉 SPU 城市 AI 接待员',
		desc: '纯静态、离线可用、句句有出处的城市 AI 接待员。SAIG 数命 SPU 国际 AI 大赛参赛作品。',
		tags: 'TypeScript · 静态站',
		year: '2026',
		secondary: { label: '在线演示', url: 'https://xiaotun-wuhan-fy73vgwpmp3.qoder.zone' },
	},
	{
		name: 'Ollama Model Manager',
		desc: 'Windows 桌面应用：实时显示 GPU / CPU 显存占用，加载模型前先预估资源影响，并按硬件推荐最合适的模型。已打 Windows 可执行文件发 Release。',
		tags: 'Python · 桌面应用',
		year: '2026',
		url: 'https://github.com/qwqwgogogo/Ollama-Model-Manager',
		secondary: { label: '下载 exe', url: 'https://github.com/qwqwgogogo/Ollama-Model-Manager/releases/latest' },
	},
	{
		name: 'SWEF-AT',
		desc: '稳定性加权的集成特征过滤方法：融合六个异构过滤器打分，再用自适应拐点自动确定保留特征数。仓库里是实验代码和结果数据。',
		tags: 'Python · 研究复现',
		year: '2025',
		url: 'https://github.com/qwqwgogogo/SWEF-AT',
	},
];

/** @param {Project} p */
export const shortName = (p) => p.name.split(' · ')[0];
/** @param {Project} p */
export const primaryUrl = (p) => p.secondary?.url ?? p.url;
/** @param {Project} p */
export const titleUrl = (p) => p.url ?? p.secondary?.url;
