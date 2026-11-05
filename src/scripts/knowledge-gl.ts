/**
 * 知识库的 3D 场景：只在 /knowledge 页、且 WebGL 可用时才被动态 import，
 * 所以 three.js 不会进首屏那个包。
 *
 * 考点那张图有 800 多个点、2600 多条边，所以这里画的东西全是合并过的：点装在一个
 * InstancedMesh 里，边按粗细分成三组 LineSegments，标签只给连得最多的四十个词。
 * 一个点一个 mesh、一条边一根圆柱的写法在 150 个点上还跑得动，到 800 个点每帧几千次
 * draw call，软件渲染实测只剩 2 FPS。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type GraphNode = {
	id: number;
	label: string;
	kind: 'concept' | 'project' | 'note' | 'subject';
	count: number;
	posts: string[];
	notes: string[];
	projects: string[];
	url?: string | null;
	subject?: string;
	/** 构建脚本从他自己正文里挑出来的一句原话，不是定义，只是「原文里怎么说它」 */
	gloss?: { text: string; slug: string; title: string; kind: string; url?: string | null };
	desc?: string;
	x: number;
	y: number;
	z: number;
};

export type Graph = {
	/** site = 文章+项目那条线，exam = 408 笔记那条线；文案和跳转规则按它分 */
	scope: 'site' | 'exam';
	posts: { slug: string; title: string }[];
	notes: { slug: string; title: string; subject: string }[];
	subjects: { key: string; name: string; notes: number }[];
	nodes: GraphNode[];
	edges: { a: number; b: number; weight: number }[];
	/** 被「挑不出原话」这道门槛筛掉的词，页面拿它的个数说话，别让文案写死数字 */
	dropped: string[];
};

const INK = 0x2b2823;
const RUST = 0xbf3f26;
const TEAL = 0x2e6b63; // 笔记
const OLIVE = 0x7a6a2f; // 408 科目
const FADED = 0x8f897c;
const PAPER = 0xf6f3ec; // 舞台底色：压淡靠「往底色混」做而不是靠透明度，这样点和光环才能合成一份实例数据
const HUB = 5; // 连接数到这个级别才有资格挂标签，否则几十个标签糊成一片
const LABEL_CAP = 40; // 挂到四十个封顶，再多就认不出词了

const COLOR: Record<GraphNode['kind'], number> = {
	concept: INK,
	project: RUST,
	note: TEAL,
	subject: OLIVE,
};

/** 把 hex 按 k 的比例印到纸上，得到的就是「它只有 k 的不透明度」看着的那个颜色 */
const onPaper = (hex: number, k: number) => new THREE.Color(hex).lerp(new THREE.Color(PAPER), 1 - k);

const FONT = (size: number) =>
	`600 ${size}px ui-monospace, 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', sans-serif`;
const LABEL_PX: Record<GraphNode['kind'], number> = { concept: 24, project: 30, note: 30, subject: 30 };

/** 在一张画布上把字量宽、描出来，返回画布尺寸；调用方决定用新贴图还是重绘旧贴图 */
const drawText = (c: HTMLCanvasElement, text: string, size: number, dpr: number) => {
	const ctx = c.getContext('2d')!;
	ctx.font = FONT(size);
	const w = Math.ceil(ctx.measureText(text).width + 8);
	const h = Math.ceil(size * 1.7);
	c.width = w * dpr;
	c.height = h * dpr;
	ctx.scale(dpr, dpr);
	ctx.font = FONT(size);
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#1d1b18';
	ctx.fillText(text, 4, h / 2);
	return { w, h };
};

export type GlHandle = {
	dispose: () => void;
	select: (id: number) => void;
};

export function mountGraph(
	stage: HTMLElement,
	graph: Graph,
	onSelect: (id: number) => void,
	initialId: number,
): GlHandle {
	const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const degree = new Map<number, number>();
	const touching = new Map<number, number[]>();
	graph.edges.forEach((e, i) => {
		degree.set(e.a, (degree.get(e.a) ?? 0) + e.weight);
		degree.set(e.b, (degree.get(e.b) ?? 0) + e.weight);
		(touching.get(e.a) ?? touching.set(e.a, []).get(e.a)!).push(i);
		(touching.get(e.b) ?? touching.set(e.b, []).get(e.b)!).push(i);
	});

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	const canvas = renderer.domElement;
	canvas.className = 'kb-gl';
	stage.append(canvas);
	stage.classList.add('is-3d');
	renderer.setPixelRatio(dpr);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
	// 球壳半径 120；机位 285 是量出来的——近处（z 接近 +120）的点被透视放大到 1.5 倍以上，
	// 再近一点顶上一排标签就被舞台边缘切掉了
	camera.position.set(0, 0, 285);

	scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c3, 1.35));
	const key = new THREE.DirectionalLight(0xfff6e8, 1.7);
	key.position.set(180, 260, 300);
	scene.add(key);

	// 点密的时候球不必做得很圆：段数减半省的是顶点，看不出差别
	const dense = graph.nodes.length > 300;
	const seg = dense ? 12 : 22;
	const sphere = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.72)));
	// 八百个点按原来的半径会把整个球壳糊满（前半球覆盖率算下来接近一半），半径统一缩到七成才有缝
	const sizeK = dense ? 0.7 : 1;

	type View = { node: GraphNode; index: number; radius: number; pos: THREE.Vector3 };
	const views: View[] = graph.nodes.map((node, index) => ({
		node,
		index,
		radius: (2.4 + Math.sqrt(degree.get(node.id) ?? 0) * 1.5) * sizeK,
		pos: new THREE.Vector3(node.x, node.y, node.z),
	}));
	const byId = new Map<number, View>(views.map((v) => [v.node.id, v]));

	// —— 点：全部装进一个实例网格 —— //
	const nodeMesh = new THREE.InstancedMesh(
		sphere,
		new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }),
		views.length,
	);
	const mat4 = new THREE.Matrix4();
	views.forEach((v) => {
		mat4.makeScale(v.radius, v.radius, v.radius).setPosition(v.pos);
		nodeMesh.setMatrixAt(v.index, mat4);
		nodeMesh.setColorAt(v.index, new THREE.Color(COLOR[v.node.kind]));
	});
	nodeMesh.instanceMatrix.needsUpdate = true;
	nodeMesh.instanceColor!.needsUpdate = true;
	scene.add(nodeMesh);

	// —— 挂标签的那批：连得最多的前 LABEL_CAP 个 —— //
	const labelViews = views
		.filter((v) => (degree.get(v.node.id) ?? 0) >= HUB)
		.sort((a, b) => (degree.get(b.node.id) ?? 0) - (degree.get(a.node.id) ?? 0))
		.slice(0, LABEL_CAP);
	const labelled = new Set(labelViews.map((v) => v.node.id));

	// 它们各带一圈淡淡的光环；选中点自己的光环排在最后，只有它跟着呼吸缩放
	const haloMesh = new THREE.InstancedMesh(
		sphere,
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.085, depthWrite: false }),
		labelViews.length + 1,
	);
	const haloR = (v: View) => v.radius * 1.62;
	labelViews.forEach((v, i) => {
		const r = haloR(v);
		mat4.makeScale(r, r, r).setPosition(v.pos);
		haloMesh.setMatrixAt(i, mat4);
	});
	const selHalo = labelViews.length;
	mat4.makeScale(1, 1, 1).setPosition(0, 1e6, 0);
	haloMesh.setMatrixAt(selHalo, mat4);
	haloMesh.instanceMatrix.needsUpdate = true;
	scene.add(haloMesh);

	const textures: THREE.Texture[] = [];
	const sprites = labelViews.map((v) => {
		const size = LABEL_PX[v.node.kind];
		const c = document.createElement('canvas');
		const { w, h } = drawText(c, v.node.label, size, dpr);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		textures.push(tex);
		const world = size * 0.3;
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.3 }),
		);
		sprite.scale.set(world * (w / h), world, 1);
		sprite.center.set(0.5, 0);
		sprite.position.copy(v.pos).add(new THREE.Vector3(0, v.radius + world * 0.75, 0));
		scene.add(sprite);
		return { v, sprite };
	});

	// 选中的词不一定在挂标签的那四十个里，所以再留一张会重绘的：一张画布一个贴图，换词只改内容
	const selCanvas = document.createElement('canvas');
	const selTex = new THREE.CanvasTexture(selCanvas);
	selTex.colorSpace = THREE.SRGBColorSpace;
	textures.push(selTex);
	const selSprite = new THREE.Sprite(
		new THREE.SpriteMaterial({ map: selTex, transparent: true, depthWrite: false, opacity: 0 }),
	);
	selSprite.center.set(0.5, 0);
	scene.add(selSprite);
	const drawSel = (v: View | undefined) => {
		if (!v || labelled.has(v.node.id)) {
			selSprite.material.opacity = 0;
			return;
		}
		const size = LABEL_PX[v.node.kind];
		const { w, h } = drawText(selCanvas, v.node.label, size, dpr);
		selTex.needsUpdate = true;
		const world = size * 0.3;
		selSprite.scale.set(world * (w / h), world, 1);
		selSprite.position.copy(v.pos).add(new THREE.Vector3(0, v.radius + world * 0.75, 0));
		selSprite.material.opacity = 0.95;
	};

	// —— 边：三组线段。淡的、粗的、跟选中那个点相关的；重画只搬顶点和改画到第几个 —— //
	const xyz = new Float32Array(graph.edges.length * 6);
	graph.edges.forEach((e, i) => {
		const a = byId.get(e.a)?.pos;
		const b = byId.get(e.b)?.pos;
		if (a && b) xyz.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
	});
	const lightSet: number[] = [];
	const strongSet: number[] = [];
	graph.edges.forEach((e, i) => (e.weight >= 2 ? strongSet : lightSet).push(i));
	const maxTouch = Math.max(1, ...[...touching.values()].map((list) => list.length));
	const line = (n: number, color: number, opacity: number) => {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
		const mesh = new THREE.LineSegments(
			geo,
			new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
		);
		// 顶点是一批批重填的，包围盒还停在旧数据上，所以不做视锥剔除
		mesh.frustumCulled = false;
		scene.add(mesh);
		return mesh;
	};
	const lightMesh = line(lightSet.length, INK, 0.2);
	const strongMesh = line(strongSet.length, INK, 0.46);
	const hotMesh = line(maxTouch, RUST, 0.55);
	const hot = new Uint8Array(graph.edges.length);
	const fill = (mesh: THREE.LineSegments, list: number[], skipHot: boolean) => {
		const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
		const arr = attr.array as Float32Array;
		let n = 0;
		for (const i of list) {
			if (skipHot && hot[i]) continue;
			arr.set(xyz.subarray(i * 6, i * 6 + 6), n * 6);
			n++;
		}
		mesh.geometry.setDrawRange(0, n * 2);
		attr.needsUpdate = true;
	};

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.075;
	controls.enablePan = false;
	controls.minDistance = 140;
	controls.maxDistance = 520;
	controls.rotateSpeed = 0.6;
	controls.zoomSpeed = 0.7;
	controls.autoRotate = animate;
	controls.autoRotateSpeed = 0.42;

	let selectedId = initialId;
	let hoveredId: number | null = null;
	let idleTimer = 0;
	let dirty = true;
	let needsRender = true;
	let inView = true;
	let visible = !document.hidden;
	let raf = 0;

	/** 选中或悬停变了才跑：搬颜色、搬顶点，一帧之内不重复 */
	const repaint = () => {
		const hotEdges = touching.get(selectedId) ?? [];
		hot.fill(0);
		const nearIds = new Set<number>();
		for (const i of hotEdges) {
			hot[i] = 1;
			const e = graph.edges[i];
			nearIds.add(e.a === selectedId ? e.b : e.a);
		}

		for (const v of views) {
			const inSet = v.node.id === selectedId || v.node.id === hoveredId || nearIds.has(v.node.id);
			nodeMesh.setColorAt(v.index, onPaper(inSet ? COLOR[v.node.kind] : FADED, inSet ? 1 : 0.8));
		}
		nodeMesh.instanceColor!.needsUpdate = true;

		labelViews.forEach((v, i) => {
			const inSet = v.node.id === selectedId || nearIds.has(v.node.id);
			// 不亮的时候把光环染成纸色：它没有逐实例的透明度，混到纸上就是不显眼
			haloMesh.setColorAt(i, new THREE.Color(inSet ? COLOR[v.node.kind] : PAPER));
		});
		haloMesh.instanceColor!.needsUpdate = true;

		for (const { v, sprite } of sprites) {
			const inSet = v.node.id === selectedId || nearIds.has(v.node.id);
			// 被压暗的词也跟着压暗，不然「浅灰点 + 黑字」看着像没选中却又最显眼
			sprite.material.opacity = inSet ? 0.95 : 0.42;
		}

		fill(lightMesh, lightSet, true);
		fill(strongMesh, strongSet, true);
		fill(hotMesh, hotEdges, false);
		drawSel(byId.get(selectedId));
	};

	const ray = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	let down: { x: number; y: number } | null = null;

	const pick = (event: PointerEvent) => {
		const rect = canvas.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		ray.setFromCamera(pointer, camera);
		const index = ray.intersectObject(nodeMesh, false)[0]?.instanceId;
		return index === undefined ? null : (views[index]?.node.id ?? null);
	};

	const onMove = (event: PointerEvent) => {
		const id = pick(event);
		if (id === hoveredId) return;
		hoveredId = id;
		canvas.style.cursor = id === null ? 'grab' : 'pointer';
		dirty = true;
	};
	const onDown = (event: PointerEvent) => {
		down = { x: event.clientX, y: event.clientY };
		if (animate) {
			controls.autoRotate = false;
			window.clearTimeout(idleTimer);
		}
	};
	const onUp = (event: PointerEvent) => {
		if (animate) idleTimer = window.setTimeout(() => (controls.autoRotate = true), 7000);
		if (!down) return;
		const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
		down = null;
		if (moved > 6) return; // 拖动过的不算点选
		const id = pick(event);
		if (id !== null) onSelect(id);
	};
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);
	controls.addEventListener('change', () => {
		needsRender = true;
	});

	const loop = (time: number) => {
		raf = requestAnimationFrame(loop);
		if (!inView || !visible) return;
		if (dirty) {
			dirty = false;
			repaint();
			needsRender = true;
		}
		// 只有选中的那一个点在呼吸，所以每帧只改它一个矩阵，不碰整份实例数据
		const sel = byId.get(selectedId);
		if (sel && animate) {
			const pulse = 1 + Math.sin(time * 0.0024) * 0.07;
			const r = haloR(sel) * pulse;
			mat4.makeScale(r, r, r).setPosition(sel.pos);
			haloMesh.setMatrixAt(selHalo, mat4);
			haloMesh.instanceMatrix.needsUpdate = true;
			needsRender = true;
		}
		// 机位没动、也没要重画的東西，这一帧就不占 GPU
		if (!needsRender && controls.update() !== true) return;
		needsRender = false;
		controls.update();
		renderer.render(scene, camera);
	};

	const resize = () => {
		const w = stage.clientWidth;
		const h = stage.clientHeight;
		if (!w || !h) return;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h, false);
		dirty = true;
	};
	const ro = new ResizeObserver(resize);
	ro.observe(stage);
	resize();

	const vio = new IntersectionObserver((entries) => (inView = entries[0].isIntersecting), {
		threshold: 0.01,
	});
	vio.observe(stage);
	const onVisibility = () => {
		visible = !document.hidden;
		needsRender = true;
	};
	document.addEventListener('visibilitychange', onVisibility);

	raf = requestAnimationFrame(loop);

	return {
		select: (id: number) => {
			selectedId = id;
			dirty = true;
		},
		dispose: () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(idleTimer);
			document.removeEventListener('visibilitychange', onVisibility);
			vio.disconnect();
			ro.disconnect();
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			controls.dispose();
			textures.forEach((t) => t.dispose());
			sprites.forEach(({ sprite }) => sprite.material.dispose());
			selSprite.material.dispose();
			nodeMesh.material.dispose();
			haloMesh.material.dispose();
			[lightMesh, strongMesh, hotMesh].forEach((m) => {
				m.material.dispose();
				m.geometry.dispose();
			});
			sphere.dispose();
			renderer.dispose();
			stage.classList.remove('is-3d');
			canvas.remove();
		},
	};
}
