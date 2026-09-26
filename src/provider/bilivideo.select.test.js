// 该用例使用伪造的 B 站接口响应，验证「搜索结果的挑选」这一环节：
// 曾经 `几分之几` 会播放到《动态鼓谱》/《AI 孙燕姿翻唱》而不是卢广仲的原曲。
process.env.NO_CACHE = 'true';

jest.mock('../request');

const request = require('../request');
const bilivideo = require('./bilivideo');

const INFO = {
	id: 530995517,
	name: '几分之几 (You Complete Me)',
	duration: 229000,
	artists: [{ id: 3690, name: '卢广仲' }],
	keyword: '几分之几 (You Complete Me) - 卢广仲',
};

// https://www.bilibili.com/video/BV1GJH1zXE6L
const ORIGINAL = {
	bvid: 'BV1GJH1zXE6L',
	title: '【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《<em class="keyword">几分之几</em>》- 卢广仲 -‘那一天你走进了我的生命’',
	duration: '3:49',
	typename: '音乐综合',
	author: 'VV音乐局',
	play: 1283528,
};

const OTHER_SONGS = [
	{
		// 动态鼓谱：歌名、歌手、时长都对得上，但不是原曲
		bvid: 'BV1LxuEzDEtb',
		title: '几分之几 (You Complete Me)【卢广仲】动态鼓谱',
		duration: '3:49',
		typename: '演奏',
		author: '看哦爱随风原创鼓谱',
		play: 16807,
	},
	{
		// AI 翻唱
		bvid: 'BV1GdpKzUEdg',
		title: '《几分之几》-卢广仲，【AI孙燕姿】（翻唱Cover)  超好听！',
		duration: '3:47',
		typename: '翻唱',
		author: '我不是肉波特',
		play: 39049,
	},
	{
		// 钢琴版
		bvid: 'BV1TDrNYzE5x',
		title: '【几分之几】- 卢广仲 I 就算犯错 你拿岁月等我',
		duration: '3:44',
		typename: '演奏',
		author: 'Ilya-v-',
		play: 365,
	},
	{
		// 与关键词完全无关：B 站偶尔会返回这种结果
		bvid: 'BV14mez6VErX',
		title: '少女时代 SNSD - Complete (2011.09.17 Live)',
		duration: '4:01',
		typename: '音乐现场',
		author: '4K60FPS',
		play: 1008,
	},
];

const MCDN_HIGH =
	'https://xy106x41x209x205xy.mcdn.bilivideo.cn:8082/v1/resource/30280.m4s';
const AUDIO_LOW = 'https://upos-sz-estgoss.bilivideo.com/30216.m4s';
// P2P 节点：不带 Referer 时 403
const P2P_HIGH =
	'https://b-baai4p084colbv29i62qkh4fw45e.edge.mountaintoys.cn:4483/upgcxcode/30280.m4s';

// 探测播放地址时的响应：只有 `*.mcdn.bilivideo.cn` 不需要 Referer
const probeResponse = (url) => {
	const playable = /(^|\.)mcdn\.bilivideo\.cn/.test(new URL(url).hostname);
	return { statusCode: playable ? 200 : 403, destroy() {} };
};

const mockApi = (searchResult, playUrls = [MCDN_HIGH]) => {
	let playUrlCalls = 0;
	request.mockImplementation(async (method, url) => {
		if (url.includes('/x/web-interface/nav'))
			return {
				json: async () => ({
					data: {
						wbi_img: {
							img_url:
								'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
							sub_url:
								'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
						},
					},
				}),
			};
		if (url.includes('/x/frontend/finger/spi'))
			return {
				json: async () => ({
					code: 0,
					data: { b_3: 'BUVid3', b_4: 'BUVid4' },
				}),
			};
		if (url.includes('/wbi/search/type'))
			return {
				json: async () => ({
					code: 0,
					data: {
						result:
							typeof searchResult === 'function'
								? searchResult()
								: searchResult,
					},
				}),
			};
		if (url.includes('/x/web-interface/wbi/view'))
			return {
				json: async () => ({ code: 0, data: { cid: 32277269102 } }),
			};
		if (url.includes('/x/player/wbi/playurl')) {
			const current =
				playUrls[Math.min(playUrlCalls++, playUrls.length - 1)];
			return {
				json: async () => ({
					code: 0,
					data: {
						dash: {
							audio: [
								{ base_url: AUDIO_LOW, bandwidth: 66011 },
								{
									base_url: current,
									bandwidth: 193928,
									backup_url: [P2P_HIGH],
								},
							],
						},
					},
				}),
			};
		}
		if (url.endsWith('.m4s')) return probeResponse(url);
		throw new Error(`Unexpected request: ${url}`);
	});
};

const requestedUrl = (path) => {
	const call = request.mock.calls.find(([, url]) => url.includes(path));
	return call && call[1];
};

describe('bilivideo', () => {
	beforeEach(() => {
		request.mockClear();
	});

	test('picks the original song instead of the drum score or the cover', async () => {
		mockApi([...OTHER_SONGS, ORIGINAL]);

		const url = await bilivideo.check(INFO);

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			`bvid=${ORIGINAL.bvid}`
		);
		// dash.audio 有多个码率时取最高码率
		expect(url).toBe(MCDN_HIGH);
	});

	test('retries the playurl request when the assigned node needs a referer', async () => {
		// 第一次分配到的 P2P 节点不带 Referer 会 403，重新申请后拿到可直连的节点
		mockApi([ORIGINAL], [P2P_HIGH, MCDN_HIGH]);

		const url = await bilivideo.check(INFO);

		expect(url).toBe(MCDN_HIGH);
		expect(
			request.mock.calls.filter(([, requestUrl]) =>
				requestUrl.includes('/x/player/wbi/playurl')
			).length
		).toBe(2);
	});

	test('accepts a longer upload when the song name has no qualifier', async () => {
		// `魔法少女チノ` (3:50) 在 B 站只有 5:14 的特典 MV，也应当能用
		mockApi([
			{
				bvid: 'BV1q5411L7Xv',
				title: '【特典MV/中日双语字幕】「魔法少女チノ」『请问您今天要来点兔子吗？BLOOM』OP 初回限定盘特典EP05',
				duration: '5:14',
				typename: '官方延伸',
				author: '点兔',
				play: 6766,
			},
		]);

		const url = await bilivideo.check({
			id: 33955999,
			name: '魔法少女チノ',
			duration: 230234,
			artists: [{ id: 1, name: '水瀬いのり' }],
			keyword: '魔法少女チノ - 水瀬いのり',
		});

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1q5411L7Xv'
		);
		expect(url).toBe(MCDN_HIGH);
	});

	test('drops compilation uploads that only carry the song name', async () => {
		// 55 分钟的「单曲循环」合辑不是这首歌，即使它标题带歌名、播放量更高
		mockApi([
			{
				bvid: 'BV1VTMRz1EdU',
				title: '【单曲循环】周杰伦《青花瓷》「天青色等烟雨 而我在等你」',
				duration: '55:17',
				typename: '音乐综合',
				author: '歌单君',
				play: 414545,
			},
			{
				bvid: 'BV1YH4y1Y7Y4',
				title: '青花瓷',
				duration: '3:56',
				typename: '音乐现场',
				author: 'live 君',
				play: 100,
			},
		]);

		await bilivideo.check({
			id: 185811,
			name: '青花瓷',
			duration: 239000,
			artists: [{ id: 1, name: '周杰伦' }],
			keyword: '青花瓷 - 周杰伦',
		});

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1YH4y1Y7Y4'
		);
	});

	test('drops shortened uploads (TV size / clips)', async () => {
		// 3:50 的歌，B 站上的 2:37 剪辑版（播放量更高）不能盖过 5:14 的官方特典 MV
		mockApi([
			{
				bvid: 'BV1short',
				title: '【4K60】魔法少女チノ【智乃】【请问您今天要来点兔子吗】',
				duration: '2:37',
				typename: '音乐综合',
				author: '剪辑君',
				play: 900000,
			},
			{
				bvid: 'BV1q5411L7Xv',
				title: '【特典MV/中日双语字幕】「魔法少女チノ」『请问您今天要来点兔子吗？BLOOM』OP 特典EP05',
				duration: '5:14',
				typename: '官方延伸',
				author: '点兔',
				play: 6766,
			},
		]);

		await bilivideo.check({
			id: 33955999,
			name: '魔法少女チノ',
			duration: 230234,
			artists: [{ id: 1, name: '水瀬いのり' }],
			keyword: '魔法少女チノ - 水瀬いのり',
		});

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1q5411L7Xv'
		);
	});

	test('matches a song title written with decorative characters', async () => {
		// 标题里的 𝐋𝐞𝐦𝐨𝐧 是数学粗体，NFKC 之后才等同于 `Lemon`
		mockApi([
			{
				bvid: 'BV1LK4y1o7Ti',
				title: '【𝐋𝐞𝐦𝐨𝐧】米津玄師 高音质',
				duration: '4:16',
				typename: '音乐综合',
				author: '音乐搬运',
				play: 100,
			},
		]);

		const url = await bilivideo.check({
			id: 536622304,
			name: 'Lemon',
			duration: 256000,
			artists: [{ id: 1, name: '米津玄師' }],
			keyword: 'Lemon - 米津玄師',
		});

		expect(url).toBe(MCDN_HIGH);
	});

	test('prefers the upload naming the artist, despite the simplified/traditional forms', async () => {
		mockApi([
			{
				// 歌手名用了简体「米津玄师」，仍应认得出
				bvid: 'BV1tY411B7T9',
				title: '在百万豪装录音棚大声听米津玄师《Lemon》【Hi-res】',
				duration: '4:19',
				typename: '音乐综合',
				author: 'JLRS',
				play: 100,
			},
			{
				bvid: 'BV1hV7vzGELh',
				title: 'Lemon 高音质无损',
				duration: '4:15',
				typename: '音乐综合',
				author: '另一个搬运',
				play: 900000,
			},
		]);

		await bilivideo.check({
			id: 536622304,
			name: 'Lemon',
			duration: 256000,
			artists: [{ id: 1, name: '米津玄師' }],
			keyword: 'Lemon - 米津玄師',
		});

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1tY411B7T9'
		);
	});

	test('prefers the matching version over the same song in another version', async () => {
		mockApi([
			{
				bvid: 'BV1Uw411U775',
				title: 'Dua Lipa - New Rules (Initial Talk Remix)',
				duration: '3:45',
				typename: '音乐综合',
				author: 'remix 搬运',
				play: 100,
			},
			{
				bvid: 'BV1yC4y147xK',
				title: 'Dua Lipa - New Rules 官方MV 中英字幕',
				duration: '3:40',
				typename: 'MV',
				author: 'MV 君',
				play: 900000,
			},
		]);

		await bilivideo.check({
			id: 520521849,
			name: 'New Rules (Initial Talk Remix)',
			duration: 224520,
			artists: [{ id: 1, name: 'Dua Lipa' }],
			keyword: 'New Rules (Initial Talk Remix) - Dua Lipa',
		});

		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1Uw411U775'
		);
	});

	test('searches again when the result set is unusable', async () => {
		// 第一次返回同歌手的其它歌，第二次才返回正确结果
		let searchCalls = 0;
		mockApi(() => {
			searchCalls += 1;
			return searchCalls === 1
				? [
						{
							bvid: 'BV1kg4zzAEKn',
							title: 'YOASOBI-アイドル（偶像）2023红白歌会',
							duration: '4:21',
							typename: '音乐现场',
							author: 'ハリズ',
							play: 17193,
						},
					]
				: [
						{
							bvid: 'BV1Ph411C7S5',
							title: 'YOASOBI 夜に駆ける (Yoru ni Kakeru) Official Music Video',
							duration: '4:21',
							typename: 'MV',
							author: 'YOASOBI',
							play: 14758830,
						},
					];
		});

		const url = await bilivideo.check({
			id: 1409311773,
			name: '夜に駆ける',
			duration: 261013,
			artists: [{ id: 1, name: 'YOASOBI' }],
			keyword: '夜に駆ける - YOASOBI',
		});

		expect(searchCalls).toBe(2);
		expect(requestedUrl('/x/web-interface/wbi/view')).toContain(
			'bvid=BV1Ph411C7S5'
		);
		expect(url).toBe(MCDN_HIGH);
	});

	test('rejects when no result is related to the song', async () => {
		mockApi(OTHER_SONGS.filter((song) => song.bvid === 'BV14mez6VErX'));

		await expect(bilivideo.check(INFO)).rejects.toBeUndefined();
		expect(requestedUrl('/x/web-interface/wbi/view')).toBeUndefined();
	});

	test('rejects another song from the same artist', async () => {
		// 搜 `夜に駆ける - YOASOBI` 时 B 站返回过同歌手的《アイドル》
		mockApi([
			{
				bvid: 'BV1kg4zzAEKn',
				title: '【4K60】【第2次补档】YOASOBI-アイドル（偶像）2023红白歌会',
				duration: '4:24',
				typename: '音乐现场',
				author: 'ハリズ',
				play: 17193,
			},
		]);

		await expect(
			bilivideo.check({
				id: 1409311773,
				name: '夜に駆ける',
				duration: 261013,
				artists: [{ id: 1, name: 'YOASOBI' }],
				keyword: '夜に駆ける - YOASOBI',
			})
		).rejects.toBeUndefined();
		expect(requestedUrl('/x/web-interface/wbi/view')).toBeUndefined();
	});

	test('rejects a different version of the song', async () => {
		// `Shape of You (Galantis Remix)` (3:16) 不能播成原版 (4:21)
		mockApi([
			{
				bvid: 'BV1po4y1Q7kk',
				title: '【台版/瑞影KTV】Ed Sheeran - Shape Of You（Warnar Music 华纳音乐）',
				duration: '4:21',
				typename: 'MV',
				author: '小万练歌房_Channel',
				play: 1626,
			},
		]);

		await expect(
			bilivideo.check({
				id: 458697799,
				name: 'Shape of You (Galantis Remix)',
				duration: 195988,
				artists: [{ id: 1, name: 'Ed Sheeran' }],
				keyword:
					'Shape of You (Galantis Remix) - Ed Sheeran / Galantis',
			})
		).rejects.toBeUndefined();
		expect(requestedUrl('/x/web-interface/wbi/view')).toBeUndefined();
	});

	test('stops in-flight requests when the match is cancelled', async () => {
		const { CancelRequest, ON_CANCEL } = require('../cancel');
		const RequestCancelled = require('../exceptions/RequestCancelled');

		mockApi([ORIGINAL]);
		const pending = new Map();
		const original = request.getMockImplementation();
		request.mockImplementation(async (method, url, ...rest) => {
			const cancelRequest = rest[3];
			// 让 view 这一步一直挂着，模拟「另一个音源已经胜出」
			if (url.includes('/x/web-interface/wbi/view'))
				return new Promise((resolve, reject) => {
					const abort = () => reject(new RequestCancelled(url));
					if (cancelRequest?.cancelled) abort();
					else cancelRequest?.on(ON_CANCEL, abort);
					pending.set(url, true);
				});
			return original(method, url, ...rest);
		});

		const cancelRequest = new CancelRequest();
		const matched = bilivideo.check(INFO, cancelRequest);
		await new Promise((resolve) => setTimeout(resolve, 50));
		cancelRequest.cancel();

		await expect(matched).rejects.toBeInstanceOf(RequestCancelled);
		expect(pending.size).toBe(1);
	});

	test('rejects when the search is intercepted', async () => {
		request.mockImplementation(async (method, url) => {
			if (url.includes('/x/web-interface/nav'))
				return {
					json: async () => ({
						data: {
							wbi_img: {
								img_url: 'https://i0.hdslb.com/bfs/wbi/a.png',
								sub_url: 'https://i0.hdslb.com/bfs/wbi/b.png',
							},
						},
					}),
				};
			if (url.includes('/x/frontend/finger/spi'))
				return { json: async () => ({ code: 0, data: {} }) };
			if (url.includes('/wbi/search/type'))
				// 风控：只有 v_voucher，没有 result
				return {
					json: async () => ({
						code: 0,
						data: { v_voucher: 'voucher' },
					}),
				};
			throw new Error(`Unexpected request: ${url}`);
		});

		await expect(bilivideo.check(INFO)).rejects.toBeUndefined();
	});
});
