const select = require('./select');
const request = require('../request');
const { getManagedCacheStorage } = require('../cache');

const format = (song) => ({
	id: song.id,
	name: song.name,
	artist: song.artist,
	album: song.album,
	duration: song.DURATION * 1000,
	pic_id: song.pic_id,
	url_id: song.url_id,
	lyric_id: song.lyric_id,
	source: song.source
});

const search = (info) => {
	const url =
		'https://music-api.gdstudio.xyz/api.php?types=search&source=joox&name='+ encodeURIComponent(info.keyword.split('_')[0]) + '&count=1&pages=30';
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			const list = jsonBody.map(format)
			const matched = select(list, info);
			return matched ? matched.id : Promise.reject();
		});
};


const track = (info) => {
	// Credit: This API is provided by GD studio (music.gdstudio.xyz).
	const url =
		'https://music-api.gdstudio.xyz/api.php?types=url&source=joox&id=' +
		info
		// '&br= 999'
		// ['999', '740'].slice(
		// 	select.ENABLE_FLAC ? 0 : 1,
		// 	select.ENABLE_FLAC ? 1 : 2
		// );
	return request('GET', url)
		.then((response) => response.json())
		.then((jsonBody) => {
			if (
				jsonBody &&
				typeof jsonBody === 'object' &&
				(!'url') in jsonBody
			)
				return Promise.reject();

			return jsonBody.br > 0 ? jsonBody.url : Promise.reject();
		});
};

const cs = getManagedCacheStorage('provider/pyncmd');
const check = (info) => cs.cache(info, () => search(info)).then(track);

module.exports = { check,track };
