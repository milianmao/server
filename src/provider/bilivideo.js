const { getManagedCacheStorage } = require('../cache');
const insure = require('./insure');
const select = require('./select');
const request = require('../request');
const crypto = require('../crypto');
const { logScope } = require('../logger');
const RequestCancelled = require('../exceptions/RequestCancelled');

const logger = logScope('provider/bilivideo');
const cs = getManagedCacheStorage('provider/bilivideo');

//Wbi 和 API 部分参考： https://github.com/SocialSisterYi/bilibili-API-collect

const BILIBILI_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const mixinKeyEncTab = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
	61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
	36, 20, 34, 44, 52,
];

// 对 imgKey 和 subKey 进行字符顺序打乱编码
const getMixinKey = (orig) =>
	mixinKeyEncTab
		.map((n) => orig[n])
		.join('')
		.slice(0, 32);

// 为请求参数进行 wbi 签名
function encWbi(params, img_key, sub_key) {
	const mixin_key = getMixinKey(img_key + sub_key),
		curr_time = Math.round(Date.now() / 1000),
		chr_filter = /[!'()*]/g;

	Object.assign(params, { wts: curr_time }); // 添加 wts 字段
	// 按照 key 重排参数
	const query = Object.keys(params)
		.sort()
		.map((key) => {
			// 过滤 value 中的 "!'()*" 字符
			const value = params[key].toString().replace(chr_filter, '');
			return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		})
		.join('&');

	const wbi_sign = crypto.md5.digest(query + mixin_key); // 计算 w_rid

	return query + '&w_rid=' + wbi_sign;
}

// 获取最新的 img_key 和 sub_key
async function getWbiKeys(cancelRequest) {
	const res = await request(
		'GET',
		'https://api.bilibili.com/x/web-interface/nav',
		{
			'User-Agent': BILIBILI_UA,
			Referer: 'https://www.bilibili.com/', //对于直接浏览器调用可能不适用
		},
		undefined,
		undefined,
		cancelRequest
	);
	const {
		data: {
			wbi_img: { img_url, sub_url },
		},
	} = await res.json();

	return {
		img_key: img_url.slice(
			img_url.lastIndexOf('/') + 1,
			img_url.lastIndexOf('.')
		),
		sub_key: sub_url.slice(
			sub_url.lastIndexOf('/') + 1,
			sub_url.lastIndexOf('.')
		),
	};
}

const signParam = async (param, cancelRequest) => {
	const { img_key, sub_key } = await cs.cache(
		'wbikey',
		async () => await getWbiKeys(cancelRequest)
	);

	return encWbi(param, img_key, sub_key);
};

// B 站接口要求携带有效的 buvid3 / buvid4 cookie：
// 使用未注册的 buvid（例如从网页上抓取的过期值）会被风控拦截，
// 搜索接口会返回 `data.v_voucher` 而不是结果，因此这里向指纹接口申请当前会话的 buvid。
const getBilibiliCookies = (cancelRequest) =>
	cs
		.cache('bilicookie', () =>
			request(
				'GET',
				'https://api.bilibili.com/x/frontend/finger/spi',
				{
					'User-Agent': BILIBILI_UA,
					Referer: 'https://www.bilibili.com/',
				},
				undefined,
				undefined,
				cancelRequest
			)
				.then((response) => response.json())
				.then((jsonBody) => {
					const { b_3: buvid3, b_4: buvid4 } = jsonBody.data || {};
					return [
						buvid3 && `buvid3=${buvid3}`,
						buvid4 && `buvid4=${encodeURIComponent(buvid4)}`,
					]
						.filter(Boolean)
						.join('; ');
				})
				.catch((error) => {
					logger.warn(error, 'Failed to get the buvid cookies.');
					return '';
				})
		)
		.catch(() => '');

const HTML_ENTITIES = {
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'",
	'&lt;': '<',
	'&gt;': '>',
	'&amp;': '&',
	'&nbsp;': ' ',
};

// 搜索结果的标题带有 <em class="keyword"> 高亮标签与 HTML 实体，需要还原成纯文本。
const stripHtml = (html) =>
	String(html || '')
		.replace(/<[^>]*>/g, '')
		.replace(
			/&(?:quot|#39|apos|lt|gt|amp|nbsp);/g,
			(entity) => HTML_ENTITIES[entity]
		);

// 搜索接口的 duration 形如 "3:49" / "1:07:25"，转成毫秒以便与网易云的时长比对。
const parseDuration = (duration) => {
	if (typeof duration === 'number') return duration * 1e3;
	if (typeof duration !== 'string') return undefined;

	const parts = duration.split(':').map((part) => Number(part));
	if (!parts.length || parts.some((part) => !Number.isFinite(part)))
		return undefined;

	return parts.reduce((total, part) => total * 60 + part, 0) * 1e3;
};

const format = (song) => {
	return {
		id: song.bvid,
		name: stripHtml(song.title),
		// album: {id: song.album_id, name: song.album_title},
		artists: { id: song.mid, name: song.author },
		duration: parseDuration(song.duration),
		typename: song.typename,
		play: Number(song.play) || 0,
	};
};

// 看起来与音乐无关或者不是原曲的稿件（谱、教学、伴奏、翻弹、Cover、AI 翻唱……）
// 降权处理，避免 `几分之几` 这类歌匹配到「动态鼓谱」「AI 孙燕姿翻唱」而不是卢广仲的原曲。
const NON_MUSIC_TITLE =
	/(谱|教学|教程|讲解|解析|学唱|教唱|学会|学弹|伴奏|弹唱|翻弹|尤克里里|ukulele|reaction|混剪|剪辑|合集|串烧|歌单|钢琴|口琴|吉他|纯音乐|drum|cover|翻唱|\bai\b|dj|混音|环绕|加速|慢速|改编)/i;

// 分区本身也是「这条稿件是不是原曲」的信号：
// 音乐综合 / MV / 电台多为原曲投稿，演奏 / 翻唱 多为二次演绎，排在其后。
const TYPENAME_SCORE = new Map([
	['音乐综合', 2],
	['MV', 2],
	['音乐', 2],
	['原创音乐', 2],
	['电台', 2],
	['翻唱', 1],
	['演奏', 1],
	['音乐现场', 1],
	['VOCALOID·UTAU', 1],
	['电音', 1],
]);

const normalize = (text) =>
	String(text || '')
		// 标题里常有全角字母数字与 𝐇𝐢-𝐑𝐞𝐬 这类装饰性字符，NFKC 后统一成半角 ASCII
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\s\u3000]+/g, '')
		.replace(
			/[《》【】\[\]（）()「」『』“”"'’‘!！?？.,，、\-—_+&/|:：;；·~～]/g,
			''
		);

const DURATION_TOLERANCE = 5 * 1e3;

const isDurationClose = (song, info) =>
	Math.abs(song.duration - info.duration) <= DURATION_TOLERANCE;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// 歌手名可能简繁 / 全半角不一致（`米津玄師` vs `米津玄师`），
// 中日文字符按覆盖率比对，拉丁文仍要求完整出现。
const matchesArtist = (title, artist) => {
	if (!artist) return false;
	if (title.includes(artist)) return true;
	if (!CJK.test(artist)) return false;

	const chars = new Set(artist);
	const hits = Array.from(chars).filter((char) =>
		title.includes(char)
	).length;
	return hits >= Math.max(2, Math.ceil(chars.size * 0.6));
};

// 合辑 / 单曲循环 / 剪辑（TV size）这类明显不属于正常歌曲长度的直接丢弃：
// 上限 2.5 倍 + 60s（几十分钟的合辑），下限 0.7 倍（剪辑、试听片段）。
const isLengthSuspicious = (song, info) =>
	typeof song.duration === 'number' &&
	typeof info.duration === 'number' &&
	(song.duration > info.duration * 2.5 + 60e3 ||
		song.duration < info.duration * 0.7);

// 搜索结果是「按关键词匹配」出来的，先筛掉不可信的稿件再排序，否则会播出错误的歌：
// - 标题带完整歌名 → 认（`(Live)` / `(Remix)` 这类限定词也在歌名里，命中即认为是同版本）；
// - 只命中歌名主干（只有歌名带限定词时才会走到这里）→ 还要求时长接近，避免把
//   `Shape of You (Galantis Remix)` 播成原版；
// - 标题里没有歌名 → 丢弃（B 站有时会返回同歌手的其它歌，甚至完全无关的稿件）。
// 之后再按歌名、分区、时长、歌手、播放量排序，由 select() 做最终的时长校验。
const rank = (songs, info) => {
	const name = normalize(info.name);
	const base = normalize(String(info.name || '').split(/[（(]/)[0]);
	const main = base || name;
	const artists = (info.artists || [])
		.map((artist) => normalize(artist && artist.name))
		.filter(Boolean);

	// 完整歌名比只命中主干更可信（例如要 `XX (Live版)` 时别播成录音室版）
	const nameScore = (title) => {
		if (name && title.includes(name)) return 2;
		return base && title.includes(base) ? 1 : 0;
	};

	const scoreOf = (song) => {
		const title = normalize(song.name);
		return [
			// 鼓谱 / 教学 / 翻唱 这类是另一种演绎，绝不能靠标题更像就压过真原曲
			NON_MUSIC_TITLE.test(song.name) ? 0 : 1,
			nameScore(title),
			isDurationClose(song, info) ? 1 : 0,
			artists.some((artist) => matchesArtist(title, artist)) ? 1 : 0,
			TYPENAME_SCORE.get(song.typename) || 0,
			song.play,
		];
	};

	return songs
		.filter((song) => {
			const title = normalize(song.name);
			if (nameScore(title) === 2) return !isLengthSuspicious(song, info);
			return (
				Boolean(main) &&
				title.includes(main) &&
				isDurationClose(song, info)
			);
		})
		.map((song) => ({ song, score: scoreOf(song) }))
		.sort((a, b) => {
			for (let index = 0; index < a.score.length; index++) {
				if (a.score[index] !== b.score[index])
					return b.score[index] - a.score[index];
			}
			return 0;
		})
		.map(({ song }) => song);
};

const searchOnce = async (info, cancelRequest) => {
	const cookies = await getBilibiliCookies(cancelRequest);
	const param = await signParam(
		{
			search_type: 'video',
			keyword: info.keyword,
		},
		cancelRequest
	);
	const url =
		'https://api.bilibili.com/x/web-interface/wbi/search/type?' + param;

	const response = await request(
		'GET',
		url,
		{
			cookie: cookies,
			referer: 'https://search.bilibili.com',
		},
		undefined,
		undefined,
		cancelRequest
	);

	return response.json();
};

// 风控时 data 里只有 v_voucher；此外 B 站偶尔会对同一个关键词返回整批无关结果
// （实测出现过只回同歌手的其它歌），这时重新搜一次（签名会变，结果集也可能不同）。
const search = async (info, cancelRequest) => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const jsonBody = await searchOnce(info, cancelRequest);
		const result = jsonBody.data && jsonBody.data.result;
		if (jsonBody.code !== 0 || !Array.isArray(result) || !result.length)
			continue;

		const list = rank(result.map(format), info);
		if (!list.length) continue;

		const matched = select(list, info);
		if (matched) return matched.id;
	}

	return Promise.reject();
};

// B 站会按请求把音频分配到不同节点：`*.mcdn.bilivideo.cn` 不带 Referer 也能播，
// 而 P2P / 镜像节点（如 `*.edge.mountaintoys.cn`、`upos-sz-mirror*`）只认 Referer，
// 网易云客户端不带 Referer，播放就会 403；节点本身偶尔也会 503。
// 因此这里逐个探测（用 range 请求，只读 1 字节），必要时重新申请播放地址
// （B 站每次分配的节点可能不同）。
const isPlayable = async (url, cancelRequest) => {
	try {
		const response = await request(
			'GET',
			url,
			{
				'user-agent': BILIBILI_UA,
				range: 'bytes=0-1',
			},
			undefined,
			undefined,
			cancelRequest
		);
		const ok = response.statusCode >= 200 && response.statusCode <= 299;
		response.destroy();
		return ok;
	} catch (error) {
		return false;
	}
};

const getAudioUrls = async (id, cid, cancelRequest) => {
	const playParam = await signParam(
		{
			bvid: id,
			cid,
			fnval: 16,
			platform: 'pc',
		},
		cancelRequest
	);
	const playUrl =
		'https://api.bilibili.com/x/player/wbi/playurl?' + playParam;

	const play = await request(
		'GET',
		playUrl,
		{
			'User-Agent': BILIBILI_UA,
		},
		undefined,
		undefined,
		cancelRequest
	).then((response) => response.json());

	if (play.code !== 0 || !play.data || !play.data.dash)
		return Promise.reject();

	const audio = play.data.dash.audio;
	if (!Array.isArray(audio) || !audio.length) return Promise.reject();

	// dash.audio 是同一个音轨的多个码率，取最高的那个。
	const best = audio.reduce((best, track) =>
		track.bandwidth > best.bandwidth ? track : best
	);

	return [best.base_url, ...(best.backup_url || [])];
};

const getAudioUrl = async (id, cancelRequest) => {
	const viewParam = await signParam({ bvid: id }, cancelRequest);
	const viewUrl =
		'https://api.bilibili.com/x/web-interface/wbi/view?' + viewParam;

	const view = await request(
		'GET',
		viewUrl,
		{
			'User-Agent': BILIBILI_UA,
		},
		undefined,
		undefined,
		cancelRequest
	).then((response) => response.json());

	if (view.code !== 0 || !view.data || !view.data.cid)
		return Promise.reject();

	let urls = [];
	for (let attempt = 0; attempt < 3; attempt++) {
		urls = await getAudioUrls(id, view.data.cid, cancelRequest);
		for (const url of urls) {
			if (await isPlayable(url, cancelRequest)) return url;
		}
	}

	return urls[0];
};

const track = (id, cancelRequest) =>
	getAudioUrl(id, cancelRequest).catch((error) =>
		// 被取消时不要再绕一次 cnrelay，直接放弃（此时通常已有别的音源胜出）
		error instanceof RequestCancelled
			? Promise.reject(error)
			: insure().bilibili.track(id)
	);

const check = (info, cancelRequest) =>
	cs
		.cache(info, () => search(info, cancelRequest))
		.then((id) => track(id, cancelRequest));

module.exports = { check, track };
