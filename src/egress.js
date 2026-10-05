const parse = require('url').parse;

/**
 * 音源出口代理规则。
 *
 * 命中的域名，两条链路都会走该音源对应的上游代理：
 *   1. provider 的解析请求（如 kuwo 的 search / convert）；
 *   2. /package/ 音频回源（客户端拿到的音频由本服务回源，见 hook.js 的 package 分支）。
 *
 * env 指向的代理应使用 proxy-panel 的「池端口」而不是单个节点，
 * 这样节点刷新 / 下线由面板的池策略与健康检查兜底，无需改这里的配置。
 */
const RULES = [{ pattern: /(^|\.)kuwo\.cn$/i, env: 'KUWO_PROXY' }];

const parsed = new Map();

/** 读取并缓存环境变量里的代理地址；未设置返回 undefined */
const proxyByEnv = (name) => {
	if (!parsed.has(name)) {
		parsed.set(name, process.env[name] ? parse(process.env[name]) : null);
	}
	return parsed.get(name) || undefined;
};

/** url 命中规则时返回该规则的代理，未命中返回 undefined（保持直连 / 全局默认） */
const proxyForUrl = (href) => {
	const host = ((parse(href).hostname) || '').toLowerCase();
	const rule = RULES.find((item) => item.pattern.test(host));
	return rule ? proxyByEnv(rule.env) : undefined;
};

module.exports = { RULES, proxyByEnv, proxyForUrl };
