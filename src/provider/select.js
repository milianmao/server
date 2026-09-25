const usableNames = (artists) =>
	(Array.isArray(artists) ? artists : [])
		.map((artist) => artist && artist.name)
		.filter((name) => typeof name === 'string' && name);

module.exports = (list, info) => {
	const { duration } = info;
	const artistNames = usableNames(info.artists);

	const song = list
		.slice(0, 20) // 最多检查前 20 个结果
		.find((song) => {
			const timeResult =
				song.duration && Math.abs(song.duration - duration) <= 5 * 1e3;
			// 音源不一定提供歌手信息 (酷狗、B 站)，任一方缺失时只比对时长
			const songArtistNames = usableNames(song.artists);
			const artistResult =
				!artistNames.length ||
				!songArtistNames.length ||
				songArtistNames.some((songArtist) =>
					artistNames.some((artist) => songArtist.includes(artist))
				);
			return timeResult && artistResult;
		}); // 第一个时长相差 5s (5000ms) 且歌手匹配的结果

	if (song) return song;
	else return list[0]; // 没有就播放第一条
};

module.exports.ENABLE_FLAC =
	(process.env.ENABLE_FLAC || '').toLowerCase() === 'true';
