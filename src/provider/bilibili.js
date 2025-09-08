const {
	cacheStorage,
	CacheStorageGroup,
	getManagedCacheStorage,
} = require('../cache');
const insure = require('./insure');
const select = require('./select');
const request = require('../request');

const cookie = "enable_web_push=DISABLE; home_feed_column=5; DedeUserID=130543114; DedeUserID__ckMd5=4f2caa991c679664; buvid_fp_plain=undefined; header_theme_version=CLOSE; fingerprint=61382190d3e3e37d9d857aa8061123f4; buvid_fp=61382190d3e3e37d9d857aa8061123f4; hit-dyn-v2=1; CURRENT_FNVAL=4048; buvid3=9B3562C9-1E07-12E7-19C6-8E4741907C8830326infoc; b_nut=1747893430; _uuid=42BBDFEB-CD19-49107-F3DC-4F2A63DA421432101infoc; rpdid=|(k|k)~lu~l|0J'u~lkRlmJRk; theme-tip-show=SHOWED; theme-avatar-tip-show=SHOWED; CURRENT_QUALITY=0; buvid4=2743ADF0-ABCE-3BDF-5437-1CD55FFC9BD345544-024052205-f+iDO5AcmVo8In4LOVhy0A%3D%3D; bili_ticket=eyJhbGciOiJIUzI1NiIsImtpZCI6InMwMyIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTU0MjM0NTIsImlhdCI6MTc1NTE2NDE5MiwicGx0IjotMX0.IJLS0zco_hwHu59vCbKUGS13Hd9ic32ikfjjysVVwVw; bili_ticket_expires=1755423392; bili_jct=15916fd3b67eb7c2ead79f4ceb15e0ed; sid=q3hrzpg5; b_lsid=32245512_198AB4FEB12; bmg_af_switch=1; bmg_src_def_domain=i1.hdslb.com; browser_resolution=1435-1012; bsource=search_baidu"

const mid = '130543114'

const platform = 'web'

const format = (song) => {
	return {
		id: song.id,
		name: song.title,
		// album: {id: song.album_id, name: song.album_title},
		artists: { id: song.mid, name: song.author },
	};
};

const search = (info) => {
	const url =
		'https://api.bilibili.com/audio/music-service-c/s?' +
		'search_type=music&page=1&pagesize=30&' +
		`keyword=${encodeURIComponent(info.keyword)}`;
	console.log(url);
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			const list = jsonBody.data.result.map(format);
			const matched = select(list, info);
			return matched ? matched.id : Promise.reject();
		});
};

// const track = (id) => {
// 	const url =
// 		'https://www.bilibili.com/audio/music-service-c/web/url?rivilege=2&quality=2&' +
// 		'sid=' +
// 		id;
//
// 	return request('GET', url)
// 		.then((response) => response.json())
// 		.then((jsonBody) => {
// 			if (jsonBody.code === 0) {
// 				// bilibili music requires referer, connect do not support referer, so change to http
// 				return jsonBody.data.cdns[0].replace('https', 'http');
// 			} else {
// 				return Promise.reject();
// 			}
// 		})
// 		.catch(() => insure().bilibili.track(id));
// };

const track = (id) => {
	const url =
		'https://api.bilibili.com/audio/music-service-c/url?rivilege=2&quality=3&' +
		'songid=' + id + '&access_key=' + cookie + '&mid=' + mid + '&platform=' + platform;

	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			if (jsonBody.code === 0) {
				// bilibili music requires referer, connect do not support referer, so change to http
				return jsonBody.data.cdns[0].replace('https', 'http');
			} else {
				return Promise.reject();
			}
		})
		.catch(() => insure().bilibili.track(id));
};


const cs = getManagedCacheStorage('provider/bilibili');
const check = (info) => cs.cache(info, () => search(info)).then(track);

module.exports = { check, track };
