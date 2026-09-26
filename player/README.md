# player — UNM Web 音乐播放器

本目录是一个基于 UnblockNeteaseMusic（UNM）代理服务器的本地 Web 音乐播放器。

- `player/server.js` — Node 后端。它把浏览器请求转发到本仓库的 UNM 代理，并负责静态文件、音源替换、音频流转发。仅用 Node 标准库，无第三方依赖。
- `player/public/` — 纯静态前端（原生 HTML/CSS/JS，无框架无构建）。

## 原理

浏览器无法直接调用 UNM：UNM 的钩子只处理 `Host` 头（或 URL）包含 `music.163.com` 的请求，而浏览器无法伪造该 Host 头，因此必须由 `player/server.js` 在服务端带上 `Host: music.163.com` 请求上游。

## 前置条件

- Node.js ≥ 12（现代 Node 更佳）
- 本仓库已安装依赖（Yarn 3 PnP）

## 启动（两个命令）

```bash
# 1. 先启动 UNM 代理（仓库根目录）
yarn node src/app.js -p 6666:8081 -e -
# 未安装 Yarn 的机器上改用（本机即如此）:
# node precompiled/app.js -p 6666:8081 -e -

# 2. 再启动播放器后端
node player/server.js
# 或: yarn player
```

浏览器访问 `http://127.0.0.1:7788`。

## 接口

所有 JSON 响应均为 `application/json; charset=utf-8` 且 `cache-control: no-store`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/search?keywords=<s>&limit=30&offset=0` | 搜索歌曲，返回 `{code,total,songs}` |
| GET | `/api/song?id=<id>` | 单曲详情 `{code,song}` |
| GET | `/api/url?id=<id>&br=<320000\|999000>` | 取播放地址，返回 `{code,data:{url,playUrl,br,size,md5,type,replaced,proxied}}`；`replaced` 表示音源已被 UNM 替换 |
| GET | `/api/lyric?id=<id>` | 歌词 `{code,lrc,tlyric,romalrc}`（原始 LRC，前端解析） |
| GET | `/api/playlist?id=<id>` | 歌单 `{code,playlist:{id,name,coverImgUrl,trackCount,songs}}` |
| GET | `/api/stream?src=<base64url>` | 音频流转发（支持 `Range`、`HEAD`） |
| GET | `/api/health` | 健康检查 `{ok,upstream,upstreamReachable}` |

> 注意：服务默认只绑定 `127.0.0.1`。如果用 `--host 0.0.0.0` 等方式对局域网/公网开放，`/api/stream` 会把这台机器变成一个开放的带宽中继（任何人都能借它转发任意 http(s) 地址），请勿在不受信任的网络里这样做。

## 排错

- 请求返回 502 — 上游不通或上游响应异常。看 `player/server.js` 终端里的日志定位；搜索接口按顺序尝试 `/api/cloudsearch/pc` → `/api/search/pc` → `/api/search/get` → `/api/search/get/web`，取第一个带结果且带封面的响应。
- `该歌曲暂无可用音源`（404）— UNM 在所有备选音源里都没匹配到这首歌；换 `br` 参数（320000/999000）或稍后重试。

## 命令行参数

```
node player/server.js [-p 端口] [-H 绑定地址] [-u 上游地址]
```

- `-p, --port`（默认 7788）
- `-H, --host`（默认 `127.0.0.1`；改成其它地址会对外暴露服务）
- `-u, --upstream`（默认 `http://127.0.0.1:6666`）
- `-h, --help` 查看帮助（另见本文件）
