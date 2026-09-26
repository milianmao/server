'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7788;
const DEFAULT_UPSTREAM = 'http://127.0.0.1:6666';
const UPSTREAM_TIMEOUT_MS = 15000;
const STREAM_TIMEOUT_MS = 30000;
const HEALTH_TIMEOUT_MS = 2000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
};

class UpstreamError extends Error {
	constructor(message, code, snippet) {
		super(message);
		this.name = 'UpstreamError';
		this.code = code;
		this.snippet = snippet;
	}
}

function usage() {
	return [
		'player server - UnblockNeteaseMusic web player backend',
		'',
		'Usage: node player/server.js [options]',
		'',
		'Options:',
		'  -p, --port <n>        listen port (default 7788)',
		'  -H, --host <addr>     bind address (default 127.0.0.1; other values expose the proxy)',
		'  -u, --upstream <url>  UNM upstream base url (default http://127.0.0.1:6666)',
		'  -h, --help            show this help',
		'',
		'See player/README.md for the full endpoint list and troubleshooting.',
	].join('\n');
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

function parseArgv(argv) {
	const options = { port: DEFAULT_PORT, upstream: DEFAULT_UPSTREAM, host: DEFAULT_HOST, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) fail(`missing value for ${arg}`);
			return argv[++i];
		};
		if (arg === '-h' || arg === '--help') {
			options.help = true;
		} else if (arg === '-p' || arg === '--port') {
			const raw = next();
			const port = Number(raw);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				fail(`invalid port: ${raw} (expected an integer in 1..65535)`);
			}
			options.port = port;
		} else if (arg === '-u' || arg === '--upstream') {
			options.upstream = normalizeUpstream(next());
		} else if (arg === '-H' || arg === '--host') {
			const raw = next();
			if (!raw || /\s/.test(raw)) fail(`invalid host: ${raw}`);
			options.host = raw;
		} else if (arg.startsWith('-')) {
			fail(`unknown option: ${arg}\n\n${usage()}`);
		} else {
			fail(`unexpected argument: ${arg}\n\n${usage()}`);
		}
	}
	return options;
}

function normalizeUpstream(raw) {
	let value = String(raw).trim();
	if (!value) fail('empty --upstream value');
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'http://' + value;
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		fail(`invalid upstream url: ${raw}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		fail(`invalid upstream protocol: ${parsed.protocol} (expected http/https)`);
	}
	parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	value = parsed.toString();
	while (value.endsWith('/')) value = value.slice(0, -1);
	return value;
}

function base64urlEncode(str) {
	const buf = Buffer.from(String(str), 'utf8');
	if (typeof buf.toString === 'function' && Buffer.isEncoding('base64url')) {
		return buf.toString('base64url');
	}
	return buf
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function base64urlDecode(str) {
	const clean = String(str).replace(/-/g, '+').replace(/_/g, '/');
	let buf;
	if (Buffer.isEncoding('base64url')) {
		buf = Buffer.from(String(str), 'base64url');
	} else {
		buf = Buffer.from(clean + '='.repeat((4 - (clean.length % 4)) % 4), 'base64');
	}
	return buf.toString('utf8');
}

const state = { upstream: DEFAULT_UPSTREAM, port: DEFAULT_PORT, host: DEFAULT_HOST };

function upstreamRequest(
	targetPath,
	{ timeoutMs = UPSTREAM_TIMEOUT_MS, method = 'GET', headers = {}, maxBytes = 0, formBody = null } = {}
) {
	const base = new URL(state.upstream);
	const isTls = base.protocol === 'https:';
	const transport = isTls ? https : http;
	const fullPath = base.pathname.replace(/\/+$/, '') + targetPath;
	const reqHeaders = {
		host: 'music.163.com',
		'X-Real-IP': '118.88.88.88',
		referer: 'https://music.163.com/',
		'user-agent': UA,
		cookie: process.env.NETEASE_COOKIE || '',
		connection: 'close',
		...headers,
	};
	let bodyBuffer = null;
	if (formBody !== null) {
		bodyBuffer = Buffer.from(formBody, 'utf8');
		reqHeaders['content-type'] = 'application/x-www-form-urlencoded';
		reqHeaders['content-length'] = bodyBuffer.length;
	}
	return new Promise((resolve, reject) => {
		const req = transport.request(
			{
				hostname: base.hostname,
				port: base.port || (isTls ? 443 : 80),
				path: fullPath,
				method,
				headers: reqHeaders,
			},
			(res) => {
				const chunks = [];
				let received = 0;
				let aborted = false;

				res.on('data', (chunk) => {
					received += chunk.length;
					if (maxBytes && received > maxBytes) {
						aborted = true;
						res.destroy();
						reject(new UpstreamError('upstream body too large', null, 'body exceeded limit'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					if (aborted) return;
					resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
				});
				res.on('error', (err) => {
					if (!aborted) reject(err);
				});
			}
		);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new UpstreamError(`upstream timeout after ${timeoutMs}ms`, null, ''));
		});
		req.on('error', reject);
		req.end(bodyBuffer || undefined);
	});
}

function upstreamGet(targetPath, { timeoutMs = UPSTREAM_TIMEOUT_MS, headers = {}, maxBytes = 0 } = {}) {
	return upstreamRequest(targetPath, { timeoutMs, headers, maxBytes });
}

async function fetchJSON(targetPath, { timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
	let response;
	try {
		response = await upstreamGet(targetPath, { timeoutMs, maxBytes: MAX_JSON_BYTES });
	} catch (err) {
		throw new UpstreamError(
			err && err.name === 'UpstreamError' ? err.message : 'upstream request failed: ' + (err && err.message),
			null,
			''
		);
	}
	const text = response.body.toString('utf8');
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new UpstreamError(
			`upstream returned non-JSON (status ${response.status})`,
			response.status,
			text.slice(0, 120)
		);
	}
	if (response.status < 200 || response.status >= 300) {
		throw new UpstreamError(
			`upstream status ${response.status}`,
			json && json.code ? json.code : response.status,
			text.slice(0, 120)
		);
	}
	return json;
}

async function fetchJSONPost(targetPath, formBody, { timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
	let response;
	try {
		response = await upstreamRequest(targetPath, {
			method: 'POST',
			formBody,
			timeoutMs,
			maxBytes: MAX_JSON_BYTES,
		});
	} catch (err) {
		throw new UpstreamError(
			err && err.name === 'UpstreamError' ? err.message : 'upstream request failed: ' + (err && err.message),
			null,
			''
		);
	}
	const text = response.body.toString('utf8');
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new UpstreamError(
			`upstream returned non-JSON (status ${response.status})`,
			response.status,
			text.slice(0, 120)
		);
	}
	if (response.status < 200 || response.status >= 300) {
		throw new UpstreamError(
			`upstream status ${response.status}`,
			json && json.code ? json.code : response.status,
			text.slice(0, 120)
		);
	}
	return json;
}

function normalizeSong(raw) {
	if (!raw || typeof raw !== 'object') {
		return { id: 0, name: '', artists: [], album: { id: 0, name: '', picUrl: '' }, duration: 0, fee: 0 };
	}
	const artists = Array.isArray(raw.ar)
		? raw.ar.map((a) => (a && a.name) || '').filter(Boolean)
		: Array.isArray(raw.artists)
			? raw.artists.map((a) => (a && a.name) || '').filter(Boolean)
			: [];
	const albumRaw = raw.al || raw.album || {};
	const album = {
		id: Number(albumRaw.id) || 0,
		name: albumRaw.name || '',
		picUrl: albumRaw.picUrl || '',
	};
	return {
		id: Number(raw.id) || 0,
		name: raw.name || '',
		artists,
		album,
		duration: Number(raw.duration || raw.dt) || 0,
		fee: Number(raw.fee) || 0,
	};
}

function normalizeTracks(raw) {
	if (!raw || typeof raw !== 'object') return [];
	const list =
		(raw.playlist && Array.isArray(raw.playlist.tracks) && raw.playlist.tracks) ||
		(raw.result && Array.isArray(raw.result.tracks) && raw.result.tracks) ||
		(Array.isArray(raw.tracks) && raw.tracks) ||
		[];
	return list.map(normalizeSong);
}

function sendJSON(res, status, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(body),
	});
	res.end(body);
}

function sendError(res, status, message) {
	sendJSON(res, status, { code: status, error: message });
}

function queryOf(req) {
	return new URL(req.url, 'http://localhost').searchParams;
}

function firstIntParam(params, key, fallback) {
	const raw = params.get(key);
	if (raw === null) return fallback;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) ? n : fallback;
}

// --- route handlers ---

async function handleSearch(req, res) {
	const params = queryOf(req);
	const keywords = (params.get('keywords') || '').trim();
	if (!keywords) return sendError(res, 400, 'missing keywords');
	// Clamp to sane ranges; upstream misbehaves on limit=0 or huge pages.
	const limit = Math.min(Math.max(firstIntParam(params, 'limit', 30), 1), 100);
	const offset = Math.max(firstIntParam(params, 'offset', 0), 0);
	const enc = encodeURIComponent(keywords);
	const postBody = `s=${enc}&type=1&offset=${offset}&limit=${limit}`;
	// Rich POST shapes carry al.picUrl so the UI gets covers in one call;
	// plain GET /api/search/get does not. First chain entry with songs wins.
	const attempts = [
		() => fetchJSONPost('/api/cloudsearch/pc', `${postBody}&total=true`),
		() => fetchJSONPost('/api/search/pc', postBody),
		() => fetchJSON(`/api/search/get?${postBody}`),
		() => fetchJSON(`/api/search/get/web?${postBody}&total=true`),
	];
	let json = null;
	let fallback = null;
	let lastError = null;
	for (const attempt of attempts) {
		try {
			const candidate = await attempt();
			const result = candidate && candidate.result;
			// Zero-hit responses omit result.songs entirely on this upstream
			// (result = { songCount: 0 }); an array is present when hits exist.
			// Both are valid code-200 answers.
			const hasHits =
				candidate && candidate.code === 200 && result && Array.isArray(result.songs) && result.songs.length > 0;
			const isEmpty =
				candidate && candidate.code === 200 && result;
			if (hasHits) {
				// Prefer the first candidate with actual hits — that is what
				// picks the cover-rich POST branch.
				json = candidate;
				break;
			}
			if (isEmpty && !fallback) fallback = candidate;
			if (!isEmpty) {
				lastError = new UpstreamError(
					`upstream code ${candidate && candidate.code}`,
					candidate && candidate.code,
					''
				);
			}
		} catch (err) {
			lastError = err;
		}
	}
	if (!json) json = fallback;
	if (!json) {
		return sendError(res, 502, describeError(lastError));
	}
	const result = json.result;
	const songs = (Array.isArray(result.songs) ? result.songs : []).map(normalizeSong);
	return sendJSON(res, 200, { code: 200, total: Number(result.songCount) || songs.length, songs });
}

async function handleSong(req, res) {
	const params = queryOf(req);
	const id = parseInt(params.get('id') || '', 10);
	if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, 'missing id');
	const json = await fetchJSON('/api/song/detail?ids=[' + id + ']');
	const rawList = (json && json.songs) || (json && json.data) || [];
	const raw = Array.isArray(rawList) ? rawList[0] : rawList;
	return sendJSON(res, 200, { code: 200, song: raw ? normalizeSong(raw) : null });
}

async function handleUrl(req, res) {
	const params = queryOf(req);
	const id = parseInt(params.get('id') || '', 10);
	if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, 'missing id');
	const br = params.get('br') === '999000' ? 999000 : 320000;
	const json = await fetchJSON(`/api/song/enhance/player/url?id=${id}&ids=[${id}]&br=${br}`);
	const data = json && Array.isArray(json.data) ? json.data[0] : json && json.data;
	if (!data || !data.url) {
		return sendError(res, 404, '该歌曲暂无可用音源');
	}
	const url = String(data.url);
	// Both flags share one predicate on purpose: the resolved host is not a
	// Netease CDN host (*.{music.126.net}). `replaced` means UNM substituted
	// another provider for a gray/VIP song; `proxied` means the browser cannot
	// fetch that host directly (referer/UA checks), so audio must flow through
	// /api/stream. Netease CDN urls are neither replaced nor proxied.
	const notNeteaseCDN = !is126Net(hostOf(url));
	const replaced = notNeteaseCDN;
	const proxied = notNeteaseCDN;
	return sendJSON(res, 200, {
		code: 200,
		data: {
			id: Number(data.id) || id,
			url,
			playUrl: '/api/stream?src=' + base64urlEncode(url),
			br: Number(data.br) || br,
			size: Number(data.size) || 0,
			md5: data.md5 || '',
			type: data.type || 'mp3',
			replaced,
			proxied,
		},
	});
}

async function handleLyric(req, res) {
	const params = queryOf(req);
	const id = parseInt(params.get('id') || '', 10);
	if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, 'missing id');
	const json = await fetchJSON(`/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`);
	const lrc = (json && json.lrc && json.lrc.lyric) || '';
	const tlyric = (json && json.tlyric && json.tlyric.lyric) || '';
	const romalrc = (json && json.romalrc && json.romalrc.lyric) || '';
	return sendJSON(res, 200, { code: 200, lrc, tlyric, romalrc });
}

async function handlePlaylist(req, res) {
	const params = queryOf(req);
	const id = parseInt(params.get('id') || '', 10);
	if (!Number.isFinite(id) || id <= 0) return sendError(res, 400, 'missing id');
	let json;
	try {
		json = await fetchJSON(`/api/v6/playlist/detail?id=${id}&n=1000`);
	} catch {
		json = await fetchJSON(`/api/playlist/detail?id=${id}&n=1000`);
	}
	const playlistRaw =
		(json && json.playlist) ||
		(json && json.result && json.result.playlist) ||
		(json && json.result) ||
		null;
	if (!playlistRaw || !playlistRaw.name) {
		return sendError(res, 502, 'upstream returned no playlist data');
	}
	const tracks = normalizeTracks({ playlist: playlistRaw });
	return sendJSON(res, 200, {
		code: 200,
		playlist: {
			id: Number(playlistRaw.id) || id,
			name: playlistRaw.name || '',
			coverImgUrl: playlistRaw.coverImgUrl || '',
			trackCount: Number(playlistRaw.trackCount) || tracks.length,
			songs: tracks,
		},
	});
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

function is126Net(host) {
	return /(^|\.)music\.126\.net$/.test(host);
}

const PROVIDER_REFERERS = [
	{ test: /kuwo\.cn$/i, origin: 'http://www.kuwo.cn/' },
	{ test: /kugou\.com$/i, origin: 'http://www.kugou.com/' },
	{ test: /qq\.com$/i, origin: 'https://y.qq.com/' },
	{ test: /migu\.cn$/i, origin: 'http://www.migu.cn/' },
];

function refererFor(host) {
	const found = PROVIDER_REFERERS.find((entry) => entry.test.test(host));
	return found ? found.origin : '';
}

const STREAM_PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

function pipeStream(res, upstreamRes, upstreamReq, status) {
	const headers = {};
	for (const key of STREAM_PASSTHROUGH_HEADERS) {
		if (upstreamRes.headers[key] !== undefined) headers[key] = upstreamRes.headers[key];
	}
	if (!headers['content-type']) headers['content-type'] = 'audio/mpeg';
	res.writeHead(status, headers);
	// Upstream death mid-stream must surface as a client-side error, not a hang.
	upstreamRes.on('error', () => {
		if (!res.writableEnded) res.destroy();
	});
	upstreamRes.on('aborted', () => {
		if (!res.writableEnded) res.destroy();
	});
	// A client abort mid-stream must tear down the upstream request, or the
	// proxy keeps downloading the whole file nobody is listening to.
	res.on('close', () => {
		if (!res.writableEnded && !upstreamRes.complete) upstreamReq.destroy();
	});
	upstreamRes.pipe(res);
}

async function streamOnce(req, res, srcUrl, extraHeaders) {
	const target = new URL(srcUrl);
	const isTls = target.protocol === 'https:';
	const transport = isTls ? https : http;
	const headers = {
		'user-agent': UA,
		'accept-encoding': 'identity',
		'connection': 'close',
	};
	if (extraHeaders) Object.assign(headers, extraHeaders);
	return new Promise((resolve, reject) => {
		const reqOpts = {
			hostname: target.hostname,
			port: target.port || (isTls ? 443 : 80),
			path: target.pathname + target.search,
			method: req.method === 'HEAD' ? 'HEAD' : 'GET',
			headers,
		};
		const upstreamReq = transport.request(reqOpts, (upstreamRes) => {
			resolve({ upstreamRes, upstreamReq });
		});
		upstreamReq.setTimeout(STREAM_TIMEOUT_MS, () => {
			upstreamReq.destroy(new UpstreamError('stream upstream timeout', null, ''));
		});
		upstreamReq.on('error', reject);
		upstreamReq.end();
	});
}

async function handleStream(req, res) {
	const params = queryOf(req);
	const src = params.get('src') || '';
	if (!src) return sendError(res, 400, 'missing src');
	let decoded;
	try {
		decoded = base64urlDecode(src);
	} catch {
		return sendError(res, 400, 'invalid src encoding');
	}
	let target;
	try {
		target = new URL(decoded);
	} catch {
		return sendError(res, 400, 'invalid src url');
	}
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		return sendError(res, 400, 'src must be http/https');
	}
	const range = req.headers.range;
	let upstreamRes, upstreamReq;
	try {
		({ upstreamRes, upstreamReq } = await streamOnce(req, res, decoded, range ? { range } : {}));
	} catch (err) {
		return sendError(res, 502, 'stream upstream failed: ' + (err && err.message));
	}
	let status = upstreamRes.statusCode || 502;
	const isKuwoKugouQq = PROVIDER_REFERERS.some((entry) => entry.test.test(target.hostname));
	if (status === 403 && isKuwoKugouQq) {
		upstreamRes.resume();
		try {
			({ upstreamRes, upstreamReq } = await streamOnce(req, res, decoded, {
				referer: refererFor(target.hostname),
			}));
			status = upstreamRes.statusCode || 502;
		} catch (err) {
			return sendError(res, 502, 'stream retry failed: ' + (err && err.message));
		}
	}
	if (status >= 400 && status !== 403) {
		upstreamRes.resume();
		return sendError(res, 502, `stream upstream status ${status}`);
	}
	if (req.method === 'HEAD') {
		upstreamRes.resume();
		const headers = {};
		for (const key of STREAM_PASSTHROUGH_HEADERS) {
			if (upstreamRes.headers[key] !== undefined) headers[key] = upstreamRes.headers[key];
		}
		if (!headers['content-type']) headers['content-type'] = 'audio/mpeg';
		res.writeHead(status, headers);
		return res.end();
	}
	return pipeStream(res, upstreamRes, upstreamReq, status);
}

async function handleHealth(req, res) {
	let reachable = false;
	try {
		const response = await upstreamGet('/', { timeoutMs: HEALTH_TIMEOUT_MS });
		reachable = response.status > 0 && response.status < 500;
	} catch {
		reachable = false;
	}
	return sendJSON(res, 200, { ok: true, upstream: state.upstream, upstreamReachable: reachable });
}

function sendNotFound(res) {
	// Static misses are plain text; JSON 404s are reserved for /api/*.
	res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
	res.end('Not Found');
}

async function serveStatic(reqPath, res) {
	if (reqPath.includes('\0') || reqPath.includes('..')) {
		return sendNotFound(res);
	}
	let clean;
	try {
		clean = decodeURIComponent(reqPath.split('?')[0]);
	} catch {
		// Malformed percent-encoding is a client error, not an upstream one.
		return sendNotFound(res);
	}
	const resolved = path.resolve(PUBLIC_DIR, '.' + (clean === '/' ? '' : clean));
	if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
		return sendNotFound(res);
	}
	let target = resolved;
	if (clean === '/' || clean === '') target = path.join(PUBLIC_DIR, 'index.html');
	let stat;
	try {
		stat = await fs.promises.stat(target);
	} catch {
		return sendNotFound(res);
	}
	if (!stat.isFile()) return sendNotFound(res);
	const ext = path.extname(target).toLowerCase();
	const mime = MIME[ext] || 'application/octet-stream';
	const data = await fs.promises.readFile(target);
	res.writeHead(200, {
		'content-type': mime,
		'content-length': stat.size,
		'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
	});
	res.end(data);
}

function describeError(err) {
	if (err instanceof UpstreamError) {
		const parts = [err.message];
		if (err.code !== null && err.code !== undefined) parts.push(`code=${err.code}`);
		if (err.snippet) parts.push(`body: ${err.snippet}`);
		return parts.join(' | ');
	}
	return 'upstream request failed: ' + ((err && err.message) || String(err));
}

const ROUTES = {
	'/api/search': handleSearch,
	'/api/song': handleSong,
	'/api/url': handleUrl,
	'/api/lyric': handleLyric,
	'/api/playlist': handlePlaylist,
	'/api/stream': handleStream,
	'/api/health': handleHealth,
};

async function route(req, res) {
	const urlPath = new URL(req.url, 'http://localhost').pathname;
	if (urlPath.startsWith('/api/')) {
		const handler = ROUTES[urlPath];
		if (!handler) return sendError(res, 404, 'unknown endpoint');
		return handler(req, res);
	}
	return serveStatic(urlPath, res);
}

function main() {
	const options = parseArgv(process.argv.slice(2));
	if (options.help) {
		console.log(usage());
		process.exit(0);
	}
	state.upstream = options.upstream;
	state.port = options.port;
	state.host = options.host;
	const server = http.createServer((req, res) => {
		const started = Date.now();
		const url = req.url;
		res.on('finish', () => {
			console.log(`${req.method} ${url} -> ${res.statusCode} (${Date.now() - started} ms)`);
		});
		route(req, res).catch((err) => {
			const message = describeError(err);
			if (!res.headersSent) {
				sendError(res, 502, message);
			} else {
				res.end();
			}
		});
	});
	server.on('error', (err) => {
		if (err && err.code === 'EADDRINUSE') {
			fail(`port ${state.port} is already in use; stop the other process or pick another --port`);
		}
		fail('server error: ' + ((err && err.message) || String(err)));
	});
	server.listen(state.port, state.host, () => {
		console.log(
			`player server: http://${state.host}:${state.port} -> upstream ${state.upstream}`
		);
		console.log(
			[
				'endpoints:',
				'  GET /api/search?keywords=<s>&limit=&offset=',
				'  GET /api/song?id=<id>',
				'  GET /api/url?id=<id>&br=<320000|999000>',
				'  GET /api/lyric?id=<id>',
				'  GET /api/playlist?id=<id>',
				'  GET /api/stream?src=<base64url>',
				'  GET /api/health',
			].join('\n')
		);
	});
}

main();
