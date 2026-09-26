'use strict';
/* ═══════════════════════════════════════════════════════════
   液氷黑胶 · UNM Player — vanilla ES module frontend
   Talks to the local player server over the frozen contract.
   ═══════════════════════════════════════════════════════════ */

/* ── utils ──────────────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = (sec) => {
	const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
	return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const fmtMs = (ms) => fmtTime((Number(ms) || 0) / 1000);

const hostOf = (u) => {
	try { return new URL(u).host; } catch { return ''; }
};

const svg = (id, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#${id}"/></svg>`;

/* ── dom ────────────────────────────────────────────────── */
const dom = {
	app: $('#app'),
	searchForm: $('#searchForm'),
	searchInput: $('#searchInput'),
	searchHint: $('#searchHint'),
	playlistForm: $('#playlistForm'),
	playlistInput: $('#playlistInput'),
	viewTitle: $('#viewTitle'),
	viewSub: $('#viewSub'),
	viewCount: $('#viewCount'),
	resultList: $('#resultList'),
	queuePane: $('#queuePane'),
	queueList: $('#queueList'),
	queueCount: $('#queueCount'),
	queuePlayAll: $('#queuePlayAll'),
	queueClear: $('#queueClear'),
	queueScrim: $('#queueScrim'),
	recentList: $('#recentList'),
	audio: $('#audio'),
	seek: $('#seek'),
	seekFill: $('#seekFill'),
	seekKnob: $('#seekKnob'),
	seekTip: $('#seekTip'),
	timeCur: $('#timeCur'),
	timeTot: $('#timeTot'),
	vol: $('#vol'),
	volFill: $('#volFill'),
	volUse: $('#volUse'),
	btnMute: $('#btnMute'),
	btnMode: $('#btnMode'),
	modeUse: $('#modeUse'),
	btnPrev: $('#btnPrev'),
	btnPlay: $('#btnPlay'),
	playUse: $('#playUse'),
	btnNext: $('#btnNext'),
	btnShuffle: $('#btnShuffle'),
	btnLyric: $('#btnLyric'),
	btnQueue: $('#btnQueue'),
	btnExpand: $('#btnExpand'),
	nowArt: $('#nowArt'),
	nowTitle: $('#nowTitle'),
	nowSub: $('#nowSub'),
	nowReplaced: $('#nowReplaced'),
	immersive: $('#immersive'),
	immersiveBg: $('#immersiveBg'),
	immersiveSrc: $('#immersiveSrc'),
	immersiveTitle: $('#immersiveTitle'),
	immersiveArtist: $('#immersiveArtist'),
	immersiveAlbum: $('#immersiveAlbum'),
	immersiveReplaced: $('#immersiveReplaced'),
	discArt: $('#discArt'),
	lyrics: $('#lyrics'),
	toasts: $('#toasts'),
	live: $('#live'),
};

/* ── state ──────────────────────────────────────────────── */
const LS_KEY = 'unm.player.v1';
const LS_RECENT = 'unm.player.recent.v1';
const PAGE = 30;

const state = {
	view: 'search', // 'search' | 'playlist'
	keywords: '',
	results: [],
	total: 0,
	loading: false,
	queue: [],
	index: -1,
	mode: 'list', // 'list' | 'single' | 'random'
	volume: 1,
	muted: false,
	recent: [],
	lyricLines: [],
	activeLyric: -1,
	errorStreak: 0,
	halted: false,
	restored: false,
	pendingSrc: null,
};

const MODES = ['list', 'single', 'random'];
const MODE_LABEL = { list: '列表循环', single: '单曲循环', random: '随机' };
const MODE_ICON = { list: 'i-repeat', single: 'i-repeat-one', random: 'i-shuffle' };

let lastVolume = 1;

/* ── persistence ────────────────────────────────────────── */
function saveState() {
	try {
		localStorage.setItem(
			LS_KEY,
			JSON.stringify({
				volume: state.volume,
				muted: state.muted,
				mode: state.mode,
				queue: state.queue,
				index: state.index,
			}),
		);
	} catch { /* storage unavailable — non-fatal */ }
}

function loadState() {
	let raw = null;
	try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { raw = null; }
	if (raw && typeof raw === 'object') {
		state.volume = clamp(Number(raw.volume ?? 1), 0, 1);
		state.muted = !!raw.muted;
		state.mode = MODES.includes(raw.mode) ? raw.mode : 'list';
		state.queue = Array.isArray(raw.queue) ? raw.queue.filter((s) => s && s.id) : [];
		state.index = Number.isInteger(raw.index) ? raw.index : -1;
		if (state.index >= state.queue.length) state.index = state.queue.length ? 0 : -1;
	}
	try {
		const r = JSON.parse(localStorage.getItem(LS_RECENT) || '[]');
		state.recent = Array.isArray(r) ? r.filter((s) => s && s.id).slice(0, 12) : [];
	} catch { state.recent = []; }
	lastVolume = state.volume > 0 ? state.volume : 1;
}

/* ── toasts ─────────────────────────────────────────────── */
function toast(title, message = '', kind = 'info') {
	/* identical message already on screen? refresh nothing, just skip — a burst
	   of the same failure must not stack into a wall of toasts */
	const last = dom.toasts.lastElementChild;
	if (last && !last.classList.contains('is-out') && $('.toast__t', last).textContent === title) return;
	const el = document.createElement('div');
	el.className = `toast${kind === 'error' ? ' toast--error' : ''}`;
	el.innerHTML = `<span class="toast__body"><b class="toast__t">${esc(title)}</b>${
		message ? `<span class="toast__m">${esc(message)}</span>` : ''
	}</span>`;
	dom.toasts.appendChild(el);
	const kill = () => {
		el.classList.add('is-out');
		el.addEventListener('animationend', () => el.remove(), { once: true });
	};
	const timer = setTimeout(kill, 6000);
	el.addEventListener('click', () => { clearTimeout(timer); kill(); });
}

function announce(text) { dom.live.textContent = text; }

/* ── artwork ────────────────────────────────────────────── */
function swapPlaceholder(img) {
	if (img.dataset.broken) return;
	img.dataset.broken = '1';
	const parent = img.parentElement;
	if (!parent) return;
	const ph = document.createElement('span');
	ph.className = parent.classList.contains('row__thumb')
		? 'thumb-ph'
		: parent.classList.contains('disc__art')
			? 'disc__ph'
			: 'now__art-ph';
	ph.innerHTML = svg('i-note');
	img.replaceWith(ph);
}

document.addEventListener(
	'error',
	(e) => { if (e.target instanceof HTMLImageElement) swapPlaceholder(e.target); },
	true,
);

const artImg = (url, alt = '') =>
	url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '';

/* ── http ───────────────────────────────────────────────── */
async function api(path) {
	let res;
	try {
		res = await fetch(path, { headers: { accept: 'application/json' } });
	} catch (err) {
		throw new Error('播放器服务不可达');
	}
	let body = null;
	try { body = await res.json(); } catch { body = null; }
	return { status: res.status, ok: res.ok, body };
}

const qs = (obj) => {
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
	return p.toString();
};

/* ── song model ─────────────────────────────────────────── */
const songName = (s) => s?.name || '未知曲目';
const songArtists = (s) => (Array.isArray(s?.artists) && s.artists.length ? s.artists.join(' / ') : '未知歌手');
const songAlbum = (s) => s?.album?.name || '';
const songCover = (s) => s?.album?.picUrl || '';

/* every artwork slot renders the note placeholder when there is no usable URL */
const artBlock = (song, phClass) => {
	const cover = songArt(song);
	return cover ? artImg(cover, songName(song)) : `<span class="${phClass}">${svg('i-note')}</span>`;
};

/* Search results come back from the upstream search API without album art
   (`album.picUrl` is ""), while /api/song?id= does carry it. Fill the gaps in
   the background so the list isn't a wall of placeholders: bounded pool,
   cached per album, abandoned the moment the view changes. */
const coverCache = new Map();
let coverToken = 0;

function songArt(song) {
	const direct = songCover(song);
	if (direct) return direct;
	const albumId = song?.album?.id;
	if (albumId && coverCache.has(albumId)) return coverCache.get(albumId);
	return '';
}

function applyCover(song, pic) {
	const swap = (container, selector) => {
		const node = $(selector, container);
		if (node && $('.thumb-ph', node)) node.innerHTML = artImg(pic, songName(song));
	};
	const ri = state.results.indexOf(song);
	if (ri >= 0) swap(dom.resultList, `.row[data-idx="${ri}"] .row__thumb`);
	const qi = state.queue.indexOf(song);
	if (qi >= 0) swap(dom.queueList, `.row[data-qidx="${qi}"] .row__thumb`);
	const rec = state.recent.find((s) => s.id === song.id);
	if (rec) {
		rec.album = rec.album || {};
		rec.album.picUrl = pic;
		try { localStorage.setItem(LS_RECENT, JSON.stringify(state.recent)); } catch { /* non-fatal */ }
		swap(dom.recentList, `.recent__item[data-id="${song.id}"] .row__thumb`);
	}
	if (song === currentSong()) updateNowPlaying();
}

/* Only a *view* change (new search / playlist) starts a new generation; the queue
   pane asks for a backfill without bumping it, so the two never cancel each other. */
async function backfillCovers(songs, limit = 8, { newGeneration = false } = {}) {
	if (newGeneration) coverToken += 1;
	const token = coverToken;
	const queue = songs
		.filter((s) => s && s.album && s.album.id && !songArt(s) && !coverCache.has(s.album.id))
		.slice(0, limit);
	if (!queue.length) return;
	let cursor = 0;
	const worker = async () => {
		while (cursor < queue.length) {
			if (token !== coverToken) return;
			const song = queue[cursor++];
			try {
				const r = await api(`api/song?${qs({ id: song.id })}`);
				const pic = (r.body && r.body.song && r.body.song.album && r.body.song.album.picUrl) || '';
				coverCache.set(song.album.id, pic);
				if (!pic || token !== coverToken) continue;
				song.album.picUrl = pic;
				applyCover(song, pic);
			} catch { /* keep the placeholder */ }
		}
	};
	await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

const rowHtml = (song, i) => `<div class="row" role="listitem" tabindex="0" data-idx="${i}"
	aria-label="播放 ${esc(songName(song))} - ${esc(songArtists(song))}">
	<span class="row__thumb">${artBlock(song, 'thumb-ph')}</span>
	<span class="row__meta">
		<b class="row__title">${esc(songName(song))}</b>
		<span class="row__sub">${esc(songArtists(song))}${songAlbum(song) ? ` <em>·</em> ${esc(songAlbum(song))}` : ''}</span>
	</span>
	<span class="row__pill">${song._replaced ? '<span class="pill pill--replaced">已换源</span>' : ''}</span>
	<span class="row__tail">
		<span class="row__dur">${fmtMs(song.duration)}</span>
		<span class="row__hint">${svg('i-play')}</span>
	</span>
</div>`;

/* the row is already on screen when its URL resolves, so patch the pill in place
   instead of re-rendering the whole list */
function applyReplaced(song) {
	const i = state.results.indexOf(song);
	if (i < 0) return;
	const slot = $('.row__pill', $(`.row[data-idx="${i}"]`, dom.resultList) || document.createElement('div'));
	if (slot) slot.innerHTML = '<span class="pill pill--replaced">已换源</span>';
}

const skeletonHtml = () =>
	Array.from({ length: 8 }, () =>
		`<div class="sk"><span class="sk__b sk__b--t"></span><span class="sk__col"><span class="sk__b sk__b--l"></span><span class="sk__b sk__b--l2"></span></span><span class="sk__b sk__b--l"></span></div>`,
	).join('');

function emptyHtml(title, hint) {
	return `<div class="empty">
		<span class="empty__mark">${svg('i-brand')}</span>
		<b class="empty__t">${esc(title)}</b>
		<span class="empty__h">${esc(hint)}</span>
	</div>`;
}

/* ── search ─────────────────────────────────────────────── */
function setLoading() {
	dom.resultList.innerHTML = skeletonHtml();
	dom.viewTitle.textContent = '搜索中';
	dom.viewSub.textContent = `“${state.keywords}”`;
	dom.viewCount.hidden = true;
}

function renderResults() {
	const list = dom.resultList;
	if (!state.results.length) {
		list.innerHTML = emptyHtml('什么都没找到', '换个关键词试试，或者直接粘贴一个歌单链接到左侧。');
		return;
	}
	const rows = state.results.map(rowHtml).join('');
	const more =
		state.results.length < state.total
			? `<div class="row row--load" role="listitem" tabindex="0" data-load="1">
					<span class="row__title">加载更多</span><span class="row__sub">已显示 ${state.results.length} / ${state.total}</span>
				</div>`
			: '';
	list.innerHTML = rows + (more ? `<div class="list__more">${more}</div>` : '');
	dom.viewCount.hidden = false;
	dom.viewCount.textContent = `共 ${state.total} 首`;
	backfillCovers(state.results, 8, { newGeneration: true });
}

async function doSearch(keywords, { append = false } = {}) {
	const kw = String(keywords || '').trim();
	if (!kw) { toast('请输入关键词', '搜索歌曲、歌手或专辑'); return; }
	state.view = 'search';
	state.keywords = kw;
	if (!append) {
		state.results = [];
		state.total = 0;
		setLoading();
	} else {
		const load = $('[data-load]', dom.resultList);
		if (load) load.innerHTML = `<span class="row__title">加载中…</span>`;
	}
	state.loading = true;
	try {
		const r = await api(`api/search?${qs({ keywords: kw, limit: PAGE, offset: state.results.length })}`);
		if (!r.ok || !r.body || r.body.code !== 200) {
			throw new Error((r.body && r.body.error) || `搜索失败 (${r.status})`);
		}
		const songs = Array.isArray(r.body.songs) ? r.body.songs : [];
		state.results = append ? state.results.concat(songs) : songs;
		state.total = Number(r.body.total) || state.results.length;
		dom.viewTitle.textContent = '搜索结果';
		dom.viewSub.textContent = `“${kw}”`;
		renderResults();
	} catch (err) {
		dom.viewTitle.textContent = '搜索失败';
		dom.viewSub.textContent = err.message;
		dom.resultList.innerHTML = emptyHtml('搜索失败了', `${err.message}。确认播放器服务仍在运行，然后重试。`);
		toast('搜索失败', err.message, 'error');
	} finally {
		state.loading = false;
	}
}

/* ── playlist ───────────────────────────────────────────── */
function extractPlaylistId(input) {
	const raw = String(input || '').trim();
	if (!raw) return '';
	const byParam = raw.match(/[?&#]id=(\d+)/);
	if (byParam) return byParam[1];
	const byPath = raw.match(/playlist\/(\d+)/);
	if (byPath) return byPath[1];
	const bare = raw.match(/^(\d+)$/);
	return bare ? bare[1] : '';
}

async function loadPlaylist(input) {
	const id = extractPlaylistId(input);
	if (!id) { toast('链接无法识别', '粘贴歌单链接，或直接填数字歌单 ID'); return; }
	state.view = 'playlist';
	setLoading();
	dom.viewTitle.textContent = '读取歌单';
	dom.viewSub.textContent = `ID ${id}`;
	try {
		const r = await api(`api/playlist?${qs({ id })}`);
		if (!r.ok || !r.body || r.body.code !== 200 || !r.body.playlist) {
			throw new Error((r.body && r.body.error) || `歌单读取失败 (${r.status})`);
		}
		const pl = r.body.playlist;
		state.results = Array.isArray(pl.songs) ? pl.songs : [];
		state.total = state.results.length;
		dom.viewTitle.textContent = pl.name || '歌单';
		dom.viewSub.textContent = `歌单 · ${pl.trackCount || state.results.length} 首`;
		renderResults();
	} catch (err) {
		dom.viewTitle.textContent = '歌单读取失败';
		dom.viewSub.textContent = err.message;
		dom.resultList.innerHTML = emptyHtml('这个歌单打不开', `${err.message}。检查 ID 是否正确，或者歌单是不是私密的。`);
		toast('歌单读取失败', err.message, 'error');
	}
}

/* ── queue ──────────────────────────────────────────────── */
function renderQueue() {
	dom.queueCount.textContent = String(state.queue.length);
	if (!state.queue.length) {
		dom.queueList.innerHTML = emptyHtml('队列是空的', '点搜索结果里的任意一首，它就会排到这里。');
		return;
	}
	dom.queueList.innerHTML = state.queue
		.map(
			(song, i) => `<div class="row${i === state.index ? ' is-active' : ''}" role="listitem" data-qidx="${i}">
				<button class="q-play" type="button" aria-label="播放 ${esc(songName(song))}">
					<span class="row__thumb">${artBlock(song, 'thumb-ph')}</span>
					<span class="row__meta">
						<b class="row__title">${esc(songName(song))}</b>
						<span class="row__sub">${esc(songArtists(song))}${song._replaced ? ' <em>· 已换源</em>' : ''}</span>
					</span>
				</button>
				<button class="q-remove" type="button" data-remove="${i}" aria-label="从队列移除 ${esc(songName(song))}">${svg('i-close')}</button>
			</div>`,
		)
		.join('');
	backfillCovers(state.queue, 8);
}

function highlightRow() {
	$$('#queueList .row').forEach((row) => {
		row.classList.toggle('is-active', Number(row.dataset.qidx) === state.index);
	});
	$$('#recentList .recent__item').forEach((row) => {
		row.classList.toggle('is-active', Number(row.dataset.id) === currentSong()?.id);
	});
}

function addToQueue(song) {
	const existing = state.queue.findIndex((s) => s.id === song.id);
	if (existing >= 0) return existing;
	state.queue.push(song);
	return state.queue.length - 1;
}

function removeFromQueue(i) {
	if (i < 0 || i >= state.queue.length) return;
	const wasCurrent = i === state.index;
	state.queue.splice(i, 1);
	if (wasCurrent) {
		if (!state.queue.length) {
			state.index = -1;
			stopPlayback();
			dom.queueList.innerHTML = emptyHtml('队列是空的', '点搜索结果里的任意一首，它就会排到这里。');
			dom.queueCount.textContent = '0';
			saveState();
			return;
		}
		state.index = Math.min(i, state.queue.length - 1);
		renderQueue();
		loadTrack(state.index, { autoplay: !dom.audio.paused });
		return;
	}
	if (i < state.index) state.index -= 1;
	renderQueue();
}

function clearQueue() {
	state.queue = [];
	state.index = -1;
	stopPlayback();
	renderQueue();
	saveState();
}

function currentSong() { return state.index >= 0 ? state.queue[state.index] || null : null; }

function stopPlayback() {
	haltAudio();
	updateNowPlaying();
	announce('播放已停止');
	renderRecent();
	highlightRow();
}

/* ── recent ─────────────────────────────────────────────── */
function pushRecent(song) {
	if (!song?.id) return;
	state.recent = [{ id: song.id, name: song.name, artists: song.artists, album: song.album, duration: song.duration }]
		.concat(state.recent.filter((s) => s.id !== song.id))
		.slice(0, 12);
	try { localStorage.setItem(LS_RECENT, JSON.stringify(state.recent)); } catch { /* non-fatal */ }
	renderRecent();
}

function renderRecent() {
	if (!state.recent.length) {
		dom.recentList.innerHTML = `<p class="rail__hint">听过的歌会留在这里</p>`;
		return;
	}
	const cur = currentSong();
	dom.recentList.innerHTML = state.recent
		.map(
			(s) => `<button class="recent__item${cur && cur.id === s.id ? ' is-active' : ''}" type="button" role="listitem"
				data-id="${s.id}" aria-label="播放 ${esc(songName(s))}">
				<span class="row__thumb recent__thumb">${artBlock(s, 'thumb-ph')}</span>
				<span>
					<span class="recent__t">${esc(songName(s))}</span>
					<span class="recent__s">${esc(songArtists(s))}</span>
				</span>
			</button>`,
		)
		.join('');
}

/* ── lyrics ─────────────────────────────────────────────── */
function parseLrc(text) {
	const out = [];
	if (!text) return out;
	const tag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
	for (const raw of String(text).split('\n')) {
		const times = [];
		let m;
		tag.lastIndex = 0;
		while ((m = tag.exec(raw))) {
			const frac = m[3] ? Number(`0.${m[3].padEnd(3, '0')}`) : 0;
			times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
		}
		const body = raw.replace(tag, '').trim();
		if (!times.length || !body) continue;
		for (const t of times) out.push({ t, text: body });
	}
	return out.sort((a, b) => a.t - b.t);
}

function mergeTranslation(lines, trText) {
	const tr = parseLrc(trText);
	if (!tr.length) return lines;
	let j = 0;
	for (const line of lines) {
		while (j + 1 < tr.length && Math.abs(tr[j + 1].t - line.t) <= Math.abs(tr[j].t - line.t)) j += 1;
		if (Math.abs(tr[j].t - line.t) < 0.6 && tr[j].text !== line.text) line.tr = tr[j].text;
	}
	return lines;
}

function renderLyrics() {
	if (!state.lyricLines.length) {
		dom.lyrics.innerHTML = `<p class="lyrics__empty">这首歌还没有歌词</p>`;
		return;
	}
	dom.lyrics.innerHTML = state.lyricLines
		.map(
			(line, i) => `<button class="lyr" type="button" data-lt="${line.t}" data-li="${i}">
				${esc(line.text)}${line.tr ? `<span class="lyr__tr">${esc(line.tr)}</span>` : ''}
			</button>`,
		)
		.join('');
	state.activeLyric = -1;
}

function syncLyrics(time, { force = false } = {}) {
	const lines = state.lyricLines;
	if (!lines.length) return;
	let lo = 0, hi = lines.length - 1, idx = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (lines[mid].t <= time + 0.08) { idx = mid; lo = mid + 1; } else hi = mid - 1;
	}
	if (idx === state.activeLyric && !force) return;
	state.activeLyric = idx;
	const nodes = $$('.lyr', dom.lyrics);
	nodes.forEach((n, i) => n.classList.toggle('is-active', i === idx));
	const active = nodes[idx];
	if (!active) return;
	if (Date.now() - lastUserScroll < 3500) return;
	const top = active.offsetTop - dom.lyrics.clientHeight / 2 + active.offsetHeight / 2;
	dom.lyrics.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

let lastUserScroll = 0;
for (const ev of ['wheel', 'touchmove', 'pointerdown']) {
	dom.lyrics.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true });
}

/* ── transport ──────────────────────────────────────────── */
function setPlaying(on) {
	document.body.classList.toggle('is-playing', on);
	dom.playUse.setAttribute('href', on ? '#i-pause' : '#i-play');
	dom.btnPlay.setAttribute('aria-label', on ? '暂停' : '播放');
}

async function resolveUrl(song) {
	const r = await api(`api/url?${qs({ id: song.id, br: 320000 })}`);
	if (!r.ok || !r.body || r.body.code !== 200 || !r.body.data || !r.body.data.url) {
		throw new Error((r.body && r.body.error) || `无法获取播放地址 (${r.status})`);
	}
	return r.body.data;
}

let loadToken = 0;
/* absolute URL of the source we currently expect to be loading — used to
   discard `error` events raised by a source that has already been replaced */
let expectedSrc = '';

function haltAudio() {
	loadToken += 1; /* invalidate any load still in flight */
	expectedSrc = '';
	dom.audio.pause();
	dom.audio.removeAttribute('src');
	dom.audio.load();
	setPlaying(false);
}

async function loadTrack(idx, { autoplay = true } = {}) {
	const song = state.queue[idx];
	if (!song) return;
	const token = ++loadToken;
	state.index = idx;

	updateNowPlaying();
	renderQueue();
	pushRecent(song);
	highlightRow();
	saveState();
	announce(`正在播放 ${songName(song)} - ${songArtists(song)}`);

	/* lyrics in parallel — never blocking playback */
	state.lyricLines = [];
	renderLyrics();
	api(`api/lyric?${qs({ id: song.id })}`)
		.then((r) => {
			if (token !== loadToken) return;
			const b = r.body || {};
			state.lyricLines = mergeTranslation(parseLrc(b.lrc), b.tlyric);
			renderLyrics();
			if (!dom.audio.paused) syncLyrics(dom.audio.currentTime, { force: true });
		})
		.catch(() => { if (token === loadToken) renderLyrics(); });

	let data;
	try {
		data = await resolveUrl(song);
	} catch (err) {
		if (token !== loadToken) return;
		toast('这首歌暂时放不了', `${songName(song)} · ${err.message}`, 'error');
		return false;
	}
	if (token !== loadToken) return false;

	song._srcHost = hostOf(data.url);
	if (data.replaced) {
		song._replaced = true;
		saveState();
		renderQueue();
		applyReplaced(song);
	}
	updateNowPlaying();

	expectedSrc = new URL(data.playUrl, location.href).href;
	dom.audio.src = data.playUrl;
	dom.audio.load();
	if (autoplay) {
		try { await dom.audio.play(); } catch { /* autoplay policy — user gesture will resume */ }
	}
	return true;
}

async function playAt(idx, opts) {
	const ok = await loadTrack(idx, opts);
	if (ok === false) {
		/* unresolvable track — skip forward once, then give up */
		if (state.queue.length > 1) {
			const nxt = stepIndex(1);
			if (nxt !== state.index) return loadTrack(nxt, opts);
		}
		return false;
	}
	return true;
}

function stepIndex(dir) {
	const len = state.queue.length;
	if (!len) return -1;
	if (state.mode === 'single') return state.index;
	if (state.mode === 'random') {
		if (len === 1) return 0;
		let n = state.index;
		while (n === state.index) n = Math.floor(Math.random() * len);
		return n;
	}
	return (state.index + dir + len) % len;
}

function togglePlay() {
	const song = currentSong();
	if (!song) {
		if (state.queue.length) return loadTrack(0);
		toast('队列是空的', '先搜索并点一首歌');
		return;
	}
	if (!dom.audio.src) {
		if (state.pendingSrc) {
			dom.audio.src = state.pendingSrc;
			state.pendingSrc = null;
		} else {
			return loadTrack(state.index);
		}
	}
	if (dom.audio.paused) dom.audio.play().catch((err) => toast('播放失败', err.message, 'error'));
	else dom.audio.pause();
}

function playNext(auto = false) {
	if (!state.queue.length) return;
	loadTrack(stepIndex(1), { autoplay: auto ? true : !dom.audio.paused });
}

function playPrev() {
	if (!state.queue.length) return;
	loadTrack(stepIndex(-1));
}

function cycleMode() {
	const i = MODES.indexOf(state.mode);
	state.mode = MODES[(i + 1) % MODES.length];
	updateMode();
	saveState();
	toast('播放模式', MODE_LABEL[state.mode]);
}

function updateMode() {
	dom.modeUse.setAttribute('href', `#${MODE_ICON[state.mode]}`);
	dom.btnMode.dataset.mode = state.mode;
	dom.btnMode.setAttribute('aria-label', `播放模式：${MODE_LABEL[state.mode]}`);
	dom.btnMode.classList.toggle('is-on', state.mode !== 'list');
}

function updateNowPlaying() {
	const song = currentSong();
	const cover = songArt(song);
	dom.nowTitle.textContent = song ? songName(song) : '未在播放';
	dom.nowSub.textContent = song ? `${songArtists(song)}${songAlbum(song) ? ` · ${songAlbum(song)}` : ''}` : '选择一首歌开始';
	dom.nowReplaced.hidden = !song || !song._replaced;

	dom.nowArt.innerHTML = song && cover
		? artImg(cover, songName(song))
		: `<span class="now__art-ph">${svg('i-note')}</span>`;

	dom.immersiveTitle.textContent = song ? songName(song) : '未在播放';
	dom.immersiveArtist.textContent = song ? songArtists(song) : '—';
	dom.immersiveAlbum.textContent = song && songAlbum(song) ? songAlbum(song) : '—';
	dom.immersiveReplaced.hidden = !song || !song._replaced;
	dom.immersiveSrc.textContent = song && song._srcHost ? `音源: ${song._srcHost}` : '';

	dom.discArt.innerHTML = song && cover ? artImg(cover, songName(song)) : `<span class="disc__ph">${svg('i-note')}</span>`;
	setImmersiveBg(cover);
}

/* Album art comes from third-party providers, so it is never interpolated raw
   into a CSS value. Parsing through URL and re-serializing percent-encodes the
   only characters that could break out of url("…") — `"`, backslashes and
   control chars/newlines — so the declaration can never be altered. Anything
   that is not a plain http(s) URL falls back to the gradient. */
function safeCssUrl(raw) {
	if (typeof raw !== 'string' || !raw) return '';
	let parsed;
	try { parsed = new URL(raw, location.href); } catch { return ''; }
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
	return parsed.href.replace(/["\\\u0000-\u001f\u007f]/g, '');
}

function setImmersiveBg(rawUrl) {
	const fallback = () => {
		dom.immersiveBg.style.backgroundImage = 'none';
		dom.immersiveBg.classList.add('is-fallback');
	};
	const url = safeCssUrl(rawUrl);
	if (!url) return fallback();
	const probe = new Image();
	probe.onload = () => {
		dom.immersiveBg.classList.remove('is-fallback');
		dom.immersiveBg.style.backgroundImage = `url("${url}")`;
	};
	probe.onerror = fallback;
	probe.src = url;
}

/* ── progress / volume ──────────────────────────────────── */
function mediaDuration() {
	const d = dom.audio.duration;
	if (Number.isFinite(d) && d > 0) return d;
	const song = currentSong();
	return song && song.duration ? song.duration / 1000 : 0;
}

function paintProgress(cur, dur) {
	const ratio = dur > 0 ? clamp(cur / dur, 0, 1) : 0;
	dom.seekFill.style.width = `${ratio * 100}%`;
	dom.seekKnob.style.left = `${ratio * 100}%`;
	dom.seek.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
	dom.seek.setAttribute('aria-valuetext', `${fmtTime(cur)} / ${fmtTime(dur)}`);
	dom.timeCur.textContent = fmtTime(cur);
	dom.timeTot.textContent = fmtTime(dur);
}

let dragging = false;

function paintVolume() {
	const v = state.muted ? 0 : state.volume;
	dom.volFill.style.width = `${v * 100}%`;
	dom.vol.setAttribute('aria-valuenow', String(Math.round(v * 100)));
	dom.vol.setAttribute('aria-valuetext', `${Math.round(v * 100)}%`);
	dom.volUse.setAttribute('href', v === 0 ? '#i-mute' : '#i-volume');
	dom.btnMute.setAttribute('aria-label', state.muted ? '取消静音' : '静音');
	dom.btnMute.classList.toggle('is-on', state.muted);
	dom.audio.volume = v;
	dom.audio.muted = false;
}

function setVolume(v, { persist = true } = {}) {
	state.volume = clamp(v, 0, 1);
	if (state.volume > 0) lastVolume = state.volume;
	state.muted = state.volume === 0;
	paintVolume();
	if (persist) saveState();
}

function toggleMute() {
	if (state.muted || state.volume === 0) {
		state.muted = false;
		state.volume = lastVolume > 0 ? lastVolume : 1;
	} else {
		lastVolume = state.volume;
		state.muted = true;
	}
	paintVolume();
	saveState();
}

/* ── overlays ───────────────────────────────────────────── */
let lastFocus = null;

function openImmersive() {
	if (!dom.immersive.hidden) return;
	lastFocus = document.activeElement;
	dom.immersive.hidden = false;
	requestAnimationFrame(() => syncLyrics(dom.audio.currentTime, { force: true }));
	$('#btnImmersiveClose').focus({ preventScroll: true });
}

function closeImmersive() {
	if (dom.immersive.hidden) return;
	dom.immersive.hidden = true;
	if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

function openQueue() { dom.app.classList.add('queue-open'); dom.btnQueue.setAttribute('aria-expanded', 'true'); }
function closeQueue() { dom.app.classList.remove('queue-open'); dom.btnQueue.setAttribute('aria-expanded', 'false'); }
function toggleQueue() {
	const narrow = window.matchMedia('(max-width: 1199px)').matches;
	if (narrow) {
		dom.app.classList.contains('queue-open') ? closeQueue() : openQueue();
		return;
	}
	dom.queuePane.animate(
		[{ boxShadow: '0 0 0 0 rgba(255,59,92,0)' }, { boxShadow: '0 0 0 2px rgba(255,59,92,.45)' }, { boxShadow: '0 0 0 0 rgba(255,59,92,0)' }],
		{ duration: 700, easing: 'cubic-bezier(.22,1,.36,1)' },
	);
}

/* ── events ─────────────────────────────────────────────── */
dom.searchForm.addEventListener('submit', (e) => {
	e.preventDefault();
	closeQueue();
	doSearch(dom.searchInput.value);
});

dom.playlistForm.addEventListener('submit', (e) => {
	e.preventDefault();
	loadPlaylist(dom.playlistInput.value);
});

dom.resultList.addEventListener('click', (e) => {
	const load = e.target.closest('[data-load]');
	if (load) return doSearch(state.keywords, { append: true });
	const row = e.target.closest('.row[data-idx]');
	if (!row) return;
	playFromResults(Number(row.dataset.idx));
});

dom.resultList.addEventListener('keydown', (e) => {
	if (e.key !== 'Enter' && e.key !== ' ') return;
	const row = e.target.closest('.row[data-idx], [data-load]');
	if (!row) return;
	e.preventDefault();
	row.click();
});

async function playFromResults(i) {
	const song = state.results[i];
	if (!song) return;
	const idx = addToQueue(song);
	renderQueue();
	const ok = await playAt(idx);
	if (ok === false) toast('已跳过', `${songName(song)} 没有可用的音源`, 'error');
}

dom.queueList.addEventListener('click', (e) => {
	const rm = e.target.closest('[data-remove]');
	if (rm) { removeFromQueue(Number(rm.dataset.remove)); return; }
	const play = e.target.closest('.q-play');
	if (!play) return;
	const row = play.closest('[data-qidx]');
	if (!row) return;
	const idx = Number(row.dataset.qidx);
	if (idx === state.index && dom.audio.src) { togglePlay(); return; }
	loadTrack(idx);
});

dom.queuePlayAll.addEventListener('click', () => {
	if (!state.queue.length) { toast('队列是空的', '先搜索并点一首歌'); return; }
	loadTrack(0);
});

dom.queueClear.addEventListener('click', () => clearQueue());
dom.queueScrim.addEventListener('click', () => closeQueue());

dom.recentList.addEventListener('click', (e) => {
	const item = e.target.closest('.recent__item');
	if (!item) return;
	const id = Number(item.dataset.id);
	const song = state.recent.find((s) => s.id === id);
	if (!song) return;
	const idx = addToQueue(song);
	renderQueue();
	loadTrack(idx);
});

/* rail nav */
$$('.nav__item').forEach((btn) => {
	btn.addEventListener('click', () => {
		$$('.nav__item').forEach((b) => b.classList.toggle('is-active', b === btn));
		if (btn.dataset.nav === 'nowplaying') openImmersive();
		else { dom.searchInput.focus(); dom.searchInput.select(); }
	});
});

/* transport buttons */
dom.btnPlay.addEventListener('click', togglePlay);
dom.btnPrev.addEventListener('click', playPrev);
dom.btnNext.addEventListener('click', () => playNext(false));
dom.btnMode.addEventListener('click', cycleMode);
dom.btnShuffle.addEventListener('click', () => {
	if (!state.queue.length) { toast('队列是空的', '先搜索并点一首歌'); return; }
	state.mode = 'random';
	updateMode();
	saveState();
	toast('播放模式', '随机');
	loadTrack(stepIndex(1));
});
dom.btnMute.addEventListener('click', toggleMute);
dom.btnLyric.addEventListener('click', openImmersive);
dom.btnQueue.addEventListener('click', toggleQueue);
dom.btnExpand.addEventListener('click', openImmersive);
$('#btnImmersiveClose').addEventListener('click', closeImmersive);

/* seek — every ratio is measured against the visible track, so the fill,
   the knob, the tooltip and the audio clock always agree. */
const seekTrack = dom.seekFill.parentElement;

function seekRatio(clientX) {
	const rect = seekTrack.getBoundingClientRect();
	return clamp((clientX - rect.left) / rect.width, 0, 1);
}

function paintSeekPreview(ratio, dur, { tooltip = true } = {}) {
	dom.seekFill.style.width = `${ratio * 100}%`;
	dom.seekKnob.style.left = `${ratio * 100}%`;
	if (!tooltip) return;
	const host = dom.seek.getBoundingClientRect();
	const track = seekTrack.getBoundingClientRect();
	dom.seekTip.hidden = false;
	dom.seekTip.textContent = fmtTime(ratio * dur);
	dom.seekTip.style.left = `${clamp(track.left - host.left + ratio * track.width, 26, host.width - 26)}px`;
}

dom.seek.addEventListener('pointerdown', (e) => {
	const dur = mediaDuration();
	if (!dur) return;
	dragging = true;
	dom.seek.classList.add('is-drag');
	let target = seekRatio(e.clientX) * dur;
	paintSeekPreview(target / dur, dur);
	dom.timeCur.textContent = fmtTime(target);
	const move = (ev) => {
		target = seekRatio(ev.clientX) * dur;
		paintSeekPreview(target / dur, dur);
		dom.timeCur.textContent = fmtTime(target);
	};
	const up = () => {
		dragging = false;
		dom.seek.classList.remove('is-drag');
		dom.seekTip.hidden = true;
		dom.audio.currentTime = target;
		paintProgress(target, mediaDuration());
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
	};
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
});

dom.seek.addEventListener('pointermove', (e) => {
	if (dragging) return;
	const dur = mediaDuration();
	if (!dur) return;
	paintSeekPreview(seekRatio(e.clientX), dur);
});
dom.seek.addEventListener('pointerleave', () => { if (!dragging) dom.seekTip.hidden = true; });

dom.seek.addEventListener('keydown', (e) => {
	const dur = mediaDuration();
	if (!dur) return;
	if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
		e.preventDefault();
		const delta = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0;
		const t = e.key === 'Home' ? 0 : e.key === 'End' ? dur : clamp(dom.audio.currentTime + delta, 0, dur);
		dom.audio.currentTime = t;
		paintProgress(t, dur);
	}
});

/* volume */
function volDragStart(e) {
	const set = (clientX) => {
		const rect = dom.vol.getBoundingClientRect();
		setVolume(clamp((clientX - rect.left) / rect.width, 0, 1));
	};
	set(e.clientX);
	const move = (ev) => set(ev.clientX);
	const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
}
dom.vol.addEventListener('pointerdown', volDragStart);

/* lyrics click-to-seek */
dom.lyrics.addEventListener('click', (e) => {
	const line = e.target.closest('.lyr');
	if (!line) return;
	const t = Number(line.dataset.lt);
	if (!Number.isFinite(t)) return;
	dom.audio.currentTime = t;
	paintProgress(t, mediaDuration());
	lastUserScroll = 0;
	syncLyrics(t, { force: true });
});

/* audio events */
dom.audio.addEventListener('play', () => setPlaying(true));
dom.audio.addEventListener('pause', () => setPlaying(false));
/* The auto-skip budget clears only once audio is genuinely flowing. `play`
   fires even for a source that is about to 404, so resetting there would let
   the skip loop forever. */
dom.audio.addEventListener('playing', () => { state.errorStreak = 0; state.halted = false; });
dom.audio.addEventListener('timeupdate', () => {
	if (dom.audio.currentTime > 0) { state.errorStreak = 0; state.halted = false; }
	if (!dragging) paintProgress(dom.audio.currentTime, mediaDuration());
	syncLyrics(dom.audio.currentTime);
});
dom.audio.addEventListener('loadedmetadata', () => paintProgress(dom.audio.currentTime, mediaDuration()));
dom.audio.addEventListener('durationchange', () => paintProgress(dom.audio.currentTime, mediaDuration()));
dom.audio.addEventListener('ended', () => {
	if (!state.queue.length) return;
	loadTrack(stepIndex(1));
});
dom.audio.addEventListener('error', () => {
	if (!dom.audio.src) return;
	/* a failure raised by a source we already replaced must not trigger a skip */
	if (expectedSrc && dom.audio.src !== expectedSrc) return;
	/* one report per failure cascade — reset only once audio really flows */
	if (state.halted) { haltAudio(); return; }
	const song = currentSong();
	const name = song ? songName(song) : '当前曲目';
	setPlaying(false);
	if (state.errorStreak === 0 && state.queue.length > 1) {
		state.errorStreak = 1;
		toast('播放出错了', `${name} 播放失败，自动跳过`, 'error');
		loadTrack(stepIndex(1));
		return;
	}
	state.halted = true;
	toast('已停止播放', `${name} 无法播放，检查音源后重试`, 'error');
	haltAudio();
});

/* ── keyboard ───────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
	const tag = (e.target.tagName || '').toLowerCase();
	const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

	if (e.key === 'Escape') {
		if (!dom.immersive.hidden) { e.preventDefault(); closeImmersive(); return; }
		if (dom.app.classList.contains('queue-open')) { e.preventDefault(); closeQueue(); return; }
		if (typing) { e.target.blur(); return; }
		return;
	}
	if (typing) return;

	switch (e.key) {
		case ' ':
			e.preventDefault();
			togglePlay();
			break;
		case 'ArrowLeft':
			e.preventDefault();
			if (mediaDuration()) { dom.audio.currentTime = clamp(dom.audio.currentTime - 5, 0, mediaDuration()); paintProgress(dom.audio.currentTime, mediaDuration()); }
			break;
		case 'ArrowRight':
			e.preventDefault();
			if (mediaDuration()) { dom.audio.currentTime = clamp(dom.audio.currentTime + 5, 0, mediaDuration()); paintProgress(dom.audio.currentTime, mediaDuration()); }
			break;
		case 'ArrowUp':
			e.preventDefault();
			setVolume(state.muted ? lastVolume : state.volume + 0.05);
			break;
		case 'ArrowDown':
			e.preventDefault();
			setVolume(state.muted ? 0 : state.volume - 0.05);
			break;
		case 'f': case 'F':
			e.preventDefault();
			dom.immersive.hidden ? openImmersive() : closeImmersive();
			break;
		case 'l': case 'L':
			e.preventDefault();
			openImmersive();
			break;
		case 'q': case 'Q':
			e.preventDefault();
			toggleQueue();
			break;
		case '/':
			e.preventDefault();
			dom.searchInput.focus();
			dom.searchInput.select();
			break;
		default:
			break;
	}
});

/* ── first gesture: lazily arm the restored track ───────── */
function firstGesture() {
	if (!state.restored) return;
	state.restored = false;
	const song = currentSong();
	if (song && !dom.audio.src) loadTrack(state.index, { autoplay: false });
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
	window.addEventListener(ev, firstGesture, { once: true, capture: true });
}

/* ── boot ───────────────────────────────────────────────── */
function boot() {
	loadState();
	paintVolume();
	updateMode();
	dom.app.classList.remove('queue-open');
	dom.btnQueue.setAttribute('aria-expanded', String(!window.matchMedia('(max-width: 1199px)').matches));

	state.view = 'search';
	dom.resultList.innerHTML = emptyHtml('开始听歌', '在上方搜索歌曲，或把歌单链接粘到左侧栏。搜索不到的歌，解灰代理会尝试换个音源给你。');

	/* restore the queue + UI state only — audio.src is armed on first gesture,
	   never autoplayed (browser policy) */
	if (state.queue.length && state.index < 0) state.index = 0;
	state.restored = state.queue.length > 0;

	renderQueue();
	renderRecent();
	updateNowPlaying();
	paintProgress(0, 0);
	highlightRow();

	window.addEventListener('resize', () => {
		if (!window.matchMedia('(max-width: 1199px)').matches) closeQueue();
	});
}

boot();