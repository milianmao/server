// B 站音频区（`api.bilibili.com/audio/music-service-c`）已经下线：
// 搜索接口对任何关键词都返回空结果，`web/url` 也只会返回「音频未找到或已下架」，
// 因此 `bilibili` 音源改为复用 `bilivideo`（B 站视频音源）的实现，
// 以免 `-o bilibili` 的配置直接失效。
module.exports = require('./bilivideo');
