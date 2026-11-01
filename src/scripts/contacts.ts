/**
 * 邮箱反爬：完整地址不落在 HTML、JS 产物和公开仓库里，只在浏览器里拼出来。
 * 标记写 data-mail="base64(用户名):base64(域名)"，链接和文字在运行时替换。
 * 关掉 JS 的人看到的是「邮箱」两个字，没有 href，所以不会点进一个死链。
 */

const fill = () => {
	for (const el of document.querySelectorAll<HTMLElement>('[data-mail]')) {
		const [user, host] = el.dataset.mail.split(':');
		const address = `${atob(user)}@${atob(host)}`;
		el.textContent = address;
		el.setAttribute('href', `mailto:${address}`);
	}
};

fill();
document.addEventListener('astro:page-load', fill);
