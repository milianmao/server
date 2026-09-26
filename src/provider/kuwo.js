const insure = require('./insure');
const select = require('./select');
const crypto = require('../crypto');
const request = require('../request');
const { getManagedCacheStorage } = require('../cache');

const format = (song) => ({
	id: song.MUSICRID.split('_').pop(),
	name: song.SONGNAME,
	artist: song.ARTIST,
	// duration: song.songTimeMinutes.split(':').reduce((minute, second) => minute * 60 + parseFloat(second), 0) * 1000,
	duration: song.DURATION * 1000,
	album: { id: song.ALBUMID, name: song.ALBUM },
	artists: song.ARTIST.split('&').map((name, index) => ({
		id: index ? null : song.ARTISTID,
		name,
	})),
});

const search = (info) => {
	// const keyword = encodeURIComponent(info.keyword.replace(' - ', ' '));
	// const url = `http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${keyword}&pn=1&rn=30`;
	// const cookie = process.env.KUWO_COOKIE || null;

	// return request('GET', url, {
	// 	referer: `http://www.kuwo.cn/search/list?key=${keyword}`,
	// 	secret: cookie
	// 		? (cookie.match(/Secret=([0-9a-f]{72})/) || [])[1]
	// 		: null,
	// 	cookie,
	// })
	// 	.then((response) => response.json())
	// 	.then((jsonBody) => {
	// 		if (!jsonBody || jsonBody.code !== 200 || jsonBody.data.total < 1)
	// 			return Promise.reject();
	// 		const list = jsonBody.data.list.map(format);`
	// 		const matched = select(list, info);
	// 		return matched ? matched.id : Promise.reject();
	// 	});

	const keyword = encodeURIComponent(info.keyword.replace(' - ', ' '));
	const url =
		// 'http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8' +
		// '&rformat=json&mobi=1&show_copyright_off=1&searchapi=9&all=' +
		// keyword;
		'http://search.kuwo.cn/r.s?user=XkcRWmlVXwBmWFxJDhFHDA%3D%3D&android_id=XkcRWmlVXwBmWFxJDhFHDA%3D%3D&prod=kwplayer_ar_11.3.2.0&corp=kuwo&newver=3&vipver=11.3.2.0&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk&p2p=1&q36=4234e4fc3e245c1d925cd4b4100015617204&approval=false&loginUid=0&loginSid=0&appuid=2796182286&allpay=0&notrace=0&oaid=CUNOXm9TWVE7XF1BWkFADA%3D%3D&client=kt&' +
		'&all=' +
		keyword +
		'&correct=1&uid=2796182286&loginid=0&ver=kwplayer_ar_11.3.2.0&stype=comprehensive&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&show_copyright_off=1&issubtitle=1&isshowshortv=1&searchapi=9&province=&city=&userIP=223.160.230.105&searchNo=2796182286%E5%87%A0%E5%88%86%E4%B9%8B%E5%87%A01765260152538&spPrivilege=0&jfencv=user%2Candroid_id%2Coaid';
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			const musicpage =
				jsonBody &&
				Array.isArray(jsonBody.content) &&
				jsonBody.content.find((entry) => entry && entry.musicpage);
			const abslist = musicpage && musicpage.musicpage.abslist;
			if (!Array.isArray(abslist) || abslist.length < 1)
				return Promise.reject();
			const list = abslist
				// .filter((v) => v.tpay /* vip ? */ === '0')
				.map(format);
			const matched = select(list, info);
			return matched ? matched.id : Promise.reject();
		});
};

const SOURCE = 'kwplayer_ar_6.4.1.1_B_jiakong_vh.apk';
const USER = '52f5601c9390ed0c';
// 加密格式 (mflac / mgg) 客户端解不开，必须回退到 mp3
const ENCRYPTED_FORMATS = ['mflac', 'mgg'];

const convert = (id, br) =>
	request(
		'GET',
		'https://nmobi.kuwo.cn/mobi.s?f=web&source=' +
			SOURCE +
			'&type=convert_url_with_sign&rid=' +
			id +
			'&br=' +
			br +
			'&user=' +
			USER +
			'&loginUid=0',
		{ 'user-agent': 'okhttp/3.10.0' }
	)
		.then((response) => response.json())
		.then((jsonBody) => {
			const data = jsonBody && jsonBody.data;
			if (!data || !data.url || ENCRYPTED_FORMATS.includes(data.format))
				return Promise.reject();
			return data.url;
		});

const track = (id) =>
	// 高码率请求会返回加密格式，逐级降码率直到拿到可解码的音频
	['2000kflac', '320kmp3', '128kmp3']
		.slice(select.ENABLE_FLAC ? 0 : 1)
		.reduce(
			(promise, br) => promise.catch(() => convert(id, br)),
			Promise.reject()
		)
		.catch(() => insure().kuwo.track(id));

const cs = getManagedCacheStorage('provider/kuwo');
const check = (info) => cs.cache(info, () => search(info)).then(track);

module.exports = { check, track };
