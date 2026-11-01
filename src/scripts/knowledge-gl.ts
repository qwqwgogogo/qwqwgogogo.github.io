/**
 * 知识库的 3D 场景：只在 /knowledge 页、且 WebGL 可用时才被动态 import，
 * 所以 three.js 不会进首屏那个包。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type GraphNode = {
	id: number;
	label: string;
	kind: 'concept' | 'project';
	count: number;
	posts: string[];
	projects: string[];
	url?: string | null;
	x: number;
	y: number;
	z: number;
};

export type Graph = {
	posts: { slug: string; title: string }[];
	nodes: GraphNode[];
	edges: { a: number; b: number; weight: number }[];
};

const INK = 0x2b2823;
const RUST = 0xbf3f26;
const FADED = 0xa9a294;
const HUB = 5; // 连接数到这个级别的才一直挂标签，否则 44 个标签糊成一片

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
	const degree = new Map<number, number>();
	graph.edges.forEach((e) => {
		degree.set(e.a, (degree.get(e.a) ?? 0) + e.weight);
		degree.set(e.b, (degree.get(e.b) ?? 0) + e.weight);
	});
	const linked = new Map<number, number[]>();
	graph.edges.forEach((e) => {
		(linked.get(e.a) ?? linked.set(e.a, []).get(e.a)!).push(e.b);
		(linked.get(e.b) ?? linked.set(e.b, []).get(e.b)!).push(e.a);
	});

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	const canvas = renderer.domElement;
	canvas.className = 'kb-gl';
	stage.append(canvas);
	stage.classList.add('is-3d');
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
	// 球壳半径 120；机位 285 是量出来的——近处（z 接近 +120）的点被透视放大到 1.5 倍以上，
	// 再近一点顶上一排标签就被舞台边缘切掉了
	camera.position.set(0, 0, 285);

	scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c3, 2.1));
	const key = new THREE.DirectionalLight(0xfff6e8, 2.4);
	key.position.set(180, 260, 300);
	scene.add(key);

	const sphere = new THREE.SphereGeometry(1, 22, 16);
	const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 6);
	const upAxis = new THREE.Vector3(0, 1, 0);

	type View = {
		node: GraphNode;
		radius: number;
		mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
		halo?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
		label?: THREE.Sprite<THREE.SpriteMaterial>;
	};
	const views: View[] = [];
	const byId = new Map<number, View>();
	const textures: THREE.CanvasTexture[] = [];

	const makeLabel = (text: string, size: number) => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const c = document.createElement('canvas');
		const ctx = c.getContext('2d')!;
		const font = `600 ${size}px ui-monospace, 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace`;
		ctx.font = font;
		const w = Math.ceil(ctx.measureText(text).width + 8);
		const h = Math.ceil(size * 1.7);
		c.width = w * dpr;
		c.height = h * dpr;
		ctx.scale(dpr, dpr);
		ctx.font = font;
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#1d1b18';
		ctx.fillText(text, 4, h / 2);
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		textures.push(tex);
		return { tex, aspect: w / h, height: size };
	};

	for (const node of graph.nodes) {
		const d = degree.get(node.id) ?? 0;
		const radius = 2.4 + Math.sqrt(d) * 1.5;
		const color = node.kind === 'project' ? RUST : INK;
		const material = new THREE.MeshStandardMaterial({
			color,
			roughness: 0.55,
			metalness: 0,
			emissive: color,
			emissiveIntensity: node.kind === 'project' ? 0.22 : 0.1,
			transparent: true,
		});
		const mesh = new THREE.Mesh(sphere, material);
		mesh.scale.setScalar(radius);
		mesh.position.set(node.x, node.y, node.z);
		mesh.userData.id = node.id;
		scene.add(mesh);

		const view: View = { node, radius, mesh };
		if (d >= HUB) {
			const halo = new THREE.Mesh(
				sphere,
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.085,
					depthWrite: false,
				}),
			);
			halo.scale.setScalar(radius * 1.62);
			halo.position.copy(mesh.position);
			scene.add(halo);
			view.halo = halo;
		}
		const size = node.kind === 'project' ? 30 : 24;
		const { tex, aspect, height } = makeLabel(node.label, size);
		const label = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }),
		);
		const world = height * 0.3;
		label.scale.set(world * aspect, world, 1);
		label.position.copy(mesh.position).add(new THREE.Vector3(0, radius + world * 0.75, 0));
		label.center.set(0.5, 0);
		scene.add(label);
		view.label = label;

		views.push(view);
		byId.set(node.id, view);
	}

	type EdgeView = {
		mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
		base: number;
		touches: number[];
	};
	const edgeViews: EdgeView[] = [];
	for (const e of graph.edges) {
		const a = byId.get(e.a);
		const b = byId.get(e.b);
		if (!a || !b) continue;
		const from = a.mesh.position;
		const to = b.mesh.position;
		const dir = new THREE.Vector3().subVectors(to, from);
		const len = dir.length();
		const base = e.weight >= 2 ? 0.34 : 0.16;
		const mesh = new THREE.Mesh(
			unitCylinder,
			new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: base }),
		);
		const r = e.weight >= 2 ? 0.62 : 0.3;
		mesh.scale.set(r, len, r);
		mesh.position.copy(from).addScaledVector(dir, 0.5);
		mesh.quaternion.setFromUnitVectors(upAxis, dir.normalize());
		scene.add(mesh);
		edgeViews.push({ mesh, base, touches: [e.a, e.b] });
	}

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

	const paint = (time: number) => {
		const near = new Set(linked.get(selectedId) ?? []);
		for (const v of views) {
			const isSel = v.node.id === selectedId;
			const isHot = v.node.id === hoveredId;
			const inSet = isSel || isHot || near.has(v.node.id);
			const target = inSet ? (v.node.kind === 'project' ? RUST : INK) : FADED;
			v.mesh.material.color.setHex(target);
			v.mesh.material.emissive.setHex(target);
			v.mesh.material.opacity = inSet ? 1 : 0.42;
			v.mesh.material.emissiveIntensity = isSel ? 0.4 : inSet ? 0.16 : 0.04;
			if (v.halo) v.halo.material.opacity = inSet ? 0.075 : 0;
			const pulse = animate && isSel ? 1 + Math.sin(time * 0.0024) * 0.07 : 1;
			v.mesh.scale.setScalar(v.radius * pulse * (isHot ? 1.14 : 1));
			if (v.label) {
				const isHub = (degree.get(v.node.id) ?? 0) >= HUB;
				// 被压暗的词标签也跟着压暗，不然「浅灰点 + 黑字」看着像没选中却又最显眼
				v.label.material.opacity = inSet ? 0.95 : isHub ? 0.3 : 0;
			}
		}
		for (const ev of edgeViews) {
			const on = ev.touches.includes(selectedId);
			ev.mesh.material.opacity = on ? Math.max(ev.base, 0.42) : ev.base * 0.45;
			ev.mesh.material.color.setHex(on ? RUST : INK);
		}
	};

	const ray = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const meshes = views.map((v) => v.mesh);
	let down: { x: number; y: number } | null = null;

	const pick = (event: PointerEvent) => {
		const rect = canvas.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		ray.setFromCamera(pointer, camera);
		const hit = ray.intersectObjects(meshes, false)[0];
		return (hit?.object.userData.id as number) ?? null;
	};

	const onMove = (event: PointerEvent) => {
		const id = pick(event);
		if (id === hoveredId) return;
		hoveredId = id;
		canvas.style.cursor = id === null ? 'grab' : 'pointer';
		invalidate();
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

	let dirty = true;
	let inView = true;
	let visible = !document.hidden;
	let raf = 0;
	const invalidate = () => {
		dirty = true;
	};
	controls.addEventListener('change', invalidate);

	const loop = (time: number) => {
		raf = requestAnimationFrame(loop);
		if (!inView || !visible) return;
		// 只在「还在动」的时候画一帧：离屏、标签页隐藏、或用户没在拖且关了动效，都不占 GPU
		const moved = controls.update() === true;
		const pulsing = animate;
		if (!dirty && !moved && !pulsing) return;
		dirty = false;
		paint(time);
		renderer.render(scene, camera);
	};

	const resize = () => {
		const w = stage.clientWidth;
		const h = stage.clientHeight;
		if (!w || !h) return;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h, false);
		invalidate();
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
		invalidate();
	};
	document.addEventListener('visibilitychange', onVisibility);

	raf = requestAnimationFrame(loop);

	return {
		select: (id: number) => {
			selectedId = id;
			invalidate();
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
			sphere.dispose();
			unitCylinder.dispose();
			views.forEach((v) => {
				v.mesh.material.dispose();
				v.halo?.material.dispose();
				v.label?.material.dispose();
			});
			edgeViews.forEach((e) => e.mesh.material.dispose());
			renderer.dispose();
			stage.classList.remove('is-3d');
			canvas.remove();
		},
	};
}
