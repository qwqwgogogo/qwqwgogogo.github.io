/**
 * 全站动效基座：零依赖，只动 transform / opacity。
 * 每个效果都是 opt-in 的 data-* 属性，缺省时页面完全静态可用。
 */

type El = HTMLElement;

const reducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const finePointer = () =>
	window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const num = (value: string | null, fallback: number) => {
	const parsed = Number.parseFloat(value ?? '');
	return Number.isFinite(parsed) ? parsed : fallback;
};

/** 进入视口时揭示；组内子元素自动排队延时。 */
function setupReveal() {
	const targets = [...document.querySelectorAll<El>('[data-reveal]')];
	if (!targets.length) return;

	const groups = new Map<El, El[]>();
	for (const el of targets) {
		const group = el.closest<El>('[data-stagger]');
		if (!group) continue;
		const list = groups.get(group) ?? [];
		list.push(el);
		groups.set(group, list);
	}
	for (const [group, list] of groups) {
		const step = num(group.dataset.staggerStep, 80);
		list.forEach((el, i) => {
			if (!el.style.getPropertyValue('--rd')) {
				el.style.setProperty('--rd', `${Math.round(i * step)}ms`);
			}
		});
	}

	if (reducedMotion()) {
		targets.forEach((el) => el.classList.add('is-in'));
		return;
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				entry.target.classList.add('is-in');
				io.unobserve(entry.target);
			}
		},
		// threshold 必须是 0：被 clip-path 收成一条缝、或被 scaleX(0) 压成零面积的元素
		// 面积为 0，任何大于 0 的阈值都永远不会命中。
		{ rootMargin: '0px 0px -8% 0px', threshold: 0 },
	);
	targets.forEach((el) => io.observe(el));
}

/**
 * 指针驱动：--mx/--my 供光斑与发光边框使用，可选 tilt 与 magnetic。
 * 一个 rAF 闸门，指针事件只记录不重排。
 */
function setupPointer() {
	if (!finePointer()) return;
	const tracked = [...document.querySelectorAll<El>('[data-spotlight],[data-tilt],[data-magnetic]')];
	if (!tracked.length) return;

	const pending = new Map<El, PointerEvent>();
	let raf = 0;

	const flush = () => {
		raf = 0;
		for (const [el, event] of pending) {
			pending.delete(el);
			paint(el, event);
		}
	};

	const paint = (el: El, event: PointerEvent) => {
		const rect = el.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		el.style.setProperty('--mx', `${x.toFixed(1)}px`);
		el.style.setProperty('--my', `${y.toFixed(1)}px`);
		el.style.setProperty('--mp', `${Math.min(1, Math.max(0, x / rect.width)).toFixed(3)}`);

		if (el.hasAttribute('data-tilt') && !reducedMotion()) {
			const max = num(el.dataset.tilt, 6);
			el.style.setProperty(
				'--rx',
				`${(-((y / rect.height) - 0.5) * max * 2).toFixed(2)}deg`,
			);
			el.style.setProperty(
				'--ry',
				`${(((x / rect.width) - 0.5) * max * 2).toFixed(2)}deg`,
			);
		}

		if (el.hasAttribute('data-magnetic') && !reducedMotion()) {
			const pull = num(el.dataset.magnetic, 6);
			el.style.setProperty('--tx', `${(((x / rect.width) - 0.5) * pull * 2).toFixed(2)}px`);
			el.style.setProperty('--ty', `${(((y / rect.height) - 0.5) * pull * 2).toFixed(2)}px`);
		}
	};

	const release = (el: El) => {
		pending.delete(el);
		el.classList.remove('is-hot');
		for (const v of ['--rx', '--ry', '--tx', '--ty']) el.style.removeProperty(v);
	};

	for (const el of tracked) {
		el.addEventListener('pointerenter', () => el.classList.add('is-hot'));
		el.addEventListener('pointermove', (event) => {
			pending.set(el, event as PointerEvent);
			if (!raf) raf = requestAnimationFrame(flush);
		});
		el.addEventListener('pointerleave', () => release(el));
	}
}

/** hero 内的整块光斑，跟随指针但比卡片更慢、更散。 */
function setupGlow() {
	const host = document.querySelector<El>('[data-glow]');
	if (!host || !finePointer() || reducedMotion()) return;
	let raf = 0;
	let last: PointerEvent | null = null;
	host.addEventListener('pointermove', (event) => {
		last = event as PointerEvent;
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			if (!last) return;
			const rect = host.getBoundingClientRect();
			host.style.setProperty('--gx', `${last.clientX - rect.left}px`);
			host.style.setProperty('--gy', `${last.clientY - rect.top}px`);
		});
	});
	host.addEventListener('pointerleave', () => {
		host.style.setProperty('--go', '0');
	});
	host.addEventListener('pointerenter', () => {
		host.style.setProperty('--go', '1');
	});
}

const GLYPHS = '!<>-_\\/[]{}=+*^?#0123456789qwklmnvxz';

/** 乱码解码：只用于拉丁文小字，中文不做这个效果。 */
function setupScramble() {
	const targets = [...document.querySelectorAll<El>('[data-scramble]')];
	if (!targets.length) return;
	if (reducedMotion()) return;

	const run = (el: El) => {
		const final = el.dataset.scrambleText ?? el.textContent ?? '';
		const duration = num(el.dataset.scramble, 620);
		const chars = [...final];
		const starts = chars.map(() => Math.random() * duration * 0.45);
		const begin = performance.now();
		el.setAttribute('aria-live', 'off');
		const tick = (now: number) => {
			const t = now - begin;
			let done = 0;
			const out = chars
				.map((ch, i) => {
					if (ch === ' ') {
						done += 1;
						return ' ';
					}
					if (t > starts[i] + duration * 0.55) {
						done += 1;
						return ch;
					}
					if (t < starts[i]) return ' ';
					return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
				})
				.join('');
			el.textContent = out;
			if (done < chars.length) requestAnimationFrame(tick);
			else el.textContent = final;
		};
		requestAnimationFrame(tick);
	};

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				run(entry.target as El);
				io.unobserve(entry.target);
			}
		},
		{ threshold: 0.4 },
	);
	targets.forEach((el) => {
		el.dataset.scrambleText = el.textContent ?? '';
		io.observe(el);
	});
}

/** 唯一的滚动循环：--scroll 进度、页眉压实、视差层。 */
function setupScroll() {
	const root = document.documentElement;
	const layers = [...document.querySelectorAll<El>('[data-parallax]')];
	const cue = document.querySelector<El>('[data-scroll-cue]');
	let ticking = true;

	const update = () => {
		ticking = false;
		const y = window.scrollY || root.scrollTop || 0;
		const span = root.scrollHeight - root.clientHeight;
		root.style.setProperty('--scroll', span > 0 ? (y / span).toFixed(4) : '0');

		document.querySelectorAll<El>('header').forEach((h) => {
			h.classList.toggle('is-scrolled', y > 12);
		});

		if (!reducedMotion()) {
			for (const el of layers) {
				el.style.setProperty('--py', `${(y * num(el.dataset.parallax, 0.1)).toFixed(2)}px`);
			}
		}
		if (cue) cue.classList.toggle('is-gone', y > 40);
	};

	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(update);
	};

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onScroll, { passive: true });
	update();
}

export function initMotion() {
	document.documentElement.classList.add('js');
	setupReveal();
	setupPointer();
	setupGlow();
	setupScramble();
	setupScroll();
}

/** 首屏与每次页间过渡结束后都要重跑：新 DOM 上没有观察器。 */
initMotion();
document.addEventListener('astro:page-load', initMotion);
