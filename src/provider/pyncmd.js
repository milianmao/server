const select = require('./select');
const request = require('../request');
const { getManagedCacheStorage } = require('../cache');

// Credit: This API is provided by GD studio (music.gdstudio.xyz).
const API = 'https://music-api.gdstudio.xyz/api.php';

// 音源池。2026-09-26 逐个探测 types=search / types=url 的结果：
//   netease —— 稳定可取流，且能取到网易云灰掉的曲目；
//   joox —— 搜索稳定，取流时好时坏（不可用时返回 { url: '', br: -1 }），仅作兜底；
//   bilibili —— 能搜索，但 types=url 恒返回 { url: '', br: -1 }，取不到音频；
//   tencent、kuwo、tidal、qobuz、apple、ytmusic、spotify 等返回
//   "Value of `source` is not supported."。
// 因此只保留可用音源，按优先级尝试。
//
// 注意：该 API 限制 5 分钟内不超过 50 次请求，故缓存搜索结果。
const SOURCES = ['netease', 'joox'];

const format = (song) => ({
	id: song.id,
	name: song.name || '',
	album: {
		id: 0,
		name: song.album || '',
	},
	artists: (Array.isArray(song.artist) ? song.artist : []).map((name) => ({
		id: 0,
		name: name || '',
	})),
	// 搜索接口不返回时长，select() 找不到时长匹配时会退回第一条结果。
	duration: 0,
	source: song.source,
});

const search = (source, info) => {
	const url =
		API +
		'?types=search&source=' +
		source +
		'&name=' +
		encodeURIComponent(info.keyword.split('_')[0]) +
		'&count=1&pages=1';
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			if (!Array.isArray(jsonBody)) return Promise.reject();
			const matched = select(jsonBody.map(format), info);
			return matched ? matched.id : Promise.reject();
		});
};

const track = (source, id) => {
	// 999 为 24bit 无损、740 为 16bit 无损，音源会自动降级到可用的最高音质。
	const url =
		API +
		'?types=url&source=' +
		source +
		'&id=' +
		encodeURIComponent(id) +
		'&br=' +
		(select.ENABLE_FLAC ? '999' : '320');
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			// 音源不可用时返回 { url: '', br: -1, size: 0 }。
			return jsonBody && jsonBody.br > 0 && jsonBody.url
				? jsonBody.url
				: Promise.reject();
		});
};

const cs = getManagedCacheStorage('provider/pyncmd');

/** 依次尝试 SOURCES 中的音源，返回第一个可用的音频直链。 */
const check = async (info) => {
	for (const source of SOURCES) {
		try {
			const id = await cs.cache(
				source + ':' + (info.keyword || info.id),
				() => search(source, info)
			);
			return await track(source, id);
		} catch (err) {
			// 换下一个音源。
		}
	}
	throw new Error('pyncmd: no audio from ' + SOURCES.join(', '));
};

module.exports = { check, track };
