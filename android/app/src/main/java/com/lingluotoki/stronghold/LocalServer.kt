package com.lingluotoki.stronghold

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.websocket.WebSockets as ClientWebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readBytes
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO as ServerEngine
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.httpMethod
import io.ktor.server.request.receiveStream
import io.ktor.server.request.uri
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondFile
import io.ktor.server.response.respondText
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.head
import io.ktor.server.routing.options
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.routing
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.server.websocket.WebSockets as ServerWebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.Frame
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.io.File
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Local art gateway: application code, game data, health and multiplayer follow the selected server.
 * Bundled art uses the server's content hash when supplied; missing or changed files use the server.
 * Never fall back to bundled application code: it may disagree with the live battle protocol.
 */
class LocalServer(
    private val wwwDir: File,
    private val upstream: String,
    private val appVersion: String,
    private val buildTag: String,
    /**
     * 日志出口。故意不直接用 android.util.Log：这样这一个类就是纯 JVM 代码，
     * 可以在 `app/src/test` 里原样跑起来做真实的 HTTP / WebSocket 断言（见 LocalServerTest）。
     */
    private val log: (String) -> Unit = {},
    /**
     * 玩家在**游戏内设置面板**里切换服务器时回调（参数是新上游；空串表示交还自动探测）。
     * 由 MainActivity 负责写进 SharedPreferences 并重启 App —— LocalServer 不碰 android.*，
     * 才能继续在纯 JVM 测试里跑。
     */
    private val onSwitchServer: ((String) -> Unit)? = null,
    private val projectOnly: Boolean = true,
) {
    companion object {
        /** /media/ 后缀顺序，与 shared/media.js 的 AUDIO_EXTS 对齐。 */
        private val AUDIO_EXTS = listOf(".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav")

        /** 逐跳首部：既不转发给上游，也不回传给页面。accept-encoding 也排除，避免压缩/长度对不上。 */
        private val HOP_BY_HOP = setOf(
            "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding",
        )

        /** 游戏内设置面板用的服务器接口（本机专有，不反代）。 */
        const val APP_SERVER_PATH = "/api/app-server"

        /** 两台线上服务器（与 MainActivity.ServerHosts 保持一致）。 */
        const val MAIN_SERVER = "http://101.132.104.41:3000"
        const val BACKUP_SERVER = "http://116.62.39.28:3000"

        /** (id, url, 显示名) —— 顺序即候选顺序，第一个是主服。 */
        private val SERVERS = listOf(
            Triple("main", MAIN_SERVER, "上海 · 主服"),
            Triple("backup", BACKUP_SERVER, "杭州 · 备用服"),
        )

        /**
         * 启动前的可用性探测：能不能在 [timeoutMs] 内拿到 `/healthz`。
         *
         * 刻意做成**静态**、并且**自己建一个临时 HttpClient**：主服探测必须发生在选上游之前，
         * 而那时 LocalServer 还没实例化（它的 upstream 是构造参数，定了就改不了）。
         * 探测用的客户端必须随用随关，否则每次启动都漏一个连接池。
         *
         * 只认 `ok:true`：能连上但返回错误体的服务器（正在重启、崩了）不该被当成可用，
         * 否则玩家会连到一台半死的服务器上，比直接切备用服更糟。
         */
        suspend fun probeReachable(base: String, timeoutMs: Long = 3_000): Boolean {
            val client = HttpClient(io.ktor.client.engine.cio.CIO) {
                install(HttpTimeout) {
                    requestTimeoutMillis = timeoutMs
                    connectTimeoutMillis = timeoutMs
                    socketTimeoutMillis = timeoutMs
                }
                expectSuccess = false
            }
            return try {
                val r = client.get("${base.trimEnd('/')}/healthz")
                r.status.value == 200 && r.bodyAsText().contains("\"ok\":true")
            } catch (c: kotlinx.coroutines.CancellationException) {
                throw c
            } catch (_: Throwable) {
                false
            } finally {
                try { client.close() } catch (_: Throwable) { }
            }
        }

        /**
         * 按顺序挑第一台可用的服务器。全都不通时返回 [candidates] 的第一项
         * （仍是主服：让玩家看到主服的报错，比默默连一台同样连不上的备用服更好排查）。
         *
         * 返回 `Pair(选中地址, 探测记录)`，记录用于写进诊断行 —— 玩家截一张图就知道
         * 「主服探测失败、已自动切到杭州」，而不是莫名其妙连到了备用服。
         */
        suspend fun pickReachable(candidates: List<String>, timeoutMs: Long = 3_000): Pair<String, String> {
            val notes = mutableListOf<String>()
            for ((i, base) in candidates.withIndex()) {
                val t0 = System.currentTimeMillis()
                val ok = probeReachable(base, timeoutMs)
                val ms = System.currentTimeMillis() - t0
                notes += "${if (i == 0) "主服" else "备$i"} ${hostOf(base)} ${if (ok) "可用" else "不可用"}(${ms}ms)"
                if (ok) return base to notes.joinToString(" ")
            }
            return candidates.first() to (notes.joinToString(" ") + " → 全不可用，仍用主服")
        }

        /** 日志里显示的短主机名（去掉协议与端口，只留 IP/域名）。 */
        private fun hostOf(base: String): String =
            base.removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore(':')
    }

    /**
     * 本地服务的**固定**端口候选（见 start() 的注释）。
     *
     * WebView 加载的是 http://127.0.0.1:<port>/，而 localStorage 按「源」（协议 + 主机 + 端口）隔离：
     * 端口一变就等于换了个站点，玩家存在里面的会话凭证 / 干员技能 / 昵称 / 设置 / 统计全都读不到，
     * 表现就是「每次退出重进都要重新配一遍技能」。所以首选端口必须固定，候选表只用于首选被别的
     * 进程占用时兜底（顺序固定，尽量仍然落在同一个源上）。
     */
    private val PORT_CANDIDATES = intArrayOf(17_800, 17_801, 17_802, 17_803)

    private var engine: ApplicationEngine? = null
    private val startedAt = System.currentTimeMillis()

    /** 实际监听的端口（start() 之后才有意义）。 */
    var port: Int = 0
        private set

    private val client = HttpClient(io.ktor.client.engine.cio.CIO) {
        install(ClientWebSockets) {
            maxFrameSize = Long.MAX_VALUE
            pingInterval = 30_000
        }
        // 线上那台是轻量机，公网出口实测只有 17–105 KB/s 且高峰期还会被宿主机抢资源，
        // 一次 TLS 握手偶发超过 Ktor 默认的 15 秒是可能的（实测遇到过一次 /api 超时，
        // 而同一时刻 curl 只用了 0.5 秒）。把超时放宽，别让偶发抖动变成玩家看到的失败。
        install(HttpTimeout) {
            requestTimeoutMillis = 60_000
            connectTimeoutMillis = 20_000
            socketTimeoutMillis = 60_000
        }
        expectSuccess = false
    }

    private val upstreamHttp = upstream.trimEnd('/')
    private val upstreamWs = upstreamHttp
        .replaceFirst("https://", "wss://")
        .replaceFirst("http://", "ws://")

    /** 把异常链摊平成一行，日志里能看到最底层的原因（TLS 校验失败之类都在 cause 里）。 */
    private fun chain(t: Throwable): String = generateSequence(t) { it.cause }
        .take(6)
        .joinToString(" ← ") { "${it::class.java.simpleName}: ${it.message}" }

    /**
     * 启动时探一次上游 HTTPS。这一步和 WebSocket 走同一套 Ktor 客户端与同一份信任库，
     * 所以它能区分两件完全不同的事：
     *   · 探测就失败 → 是「这个 App 根本连不上那台服务器」（证书链 / 网络 / 被拦）
     *   · 探测成功而 /ws 连不上 → 问题在 WebSocket 这一层
     * 没有它的时候，屏幕上只有一句「正在重连」，这两种情况长得一模一样。
     */
    suspend fun probeUpstream(): String = try {
        val r = client.get("$upstreamHttp/healthz")
        val body = r.bodyAsText().take(160)
        "上游 HTTPS 探测：HTTP ${r.status.value}  $body"
    } catch (c: kotlinx.coroutines.CancellationException) {
        throw c
    } catch (t: Throwable) {
        "上游 HTTPS 探测失败：${chain(t)}"
    }

    /**
     * 在 127.0.0.1 上起服务，返回实际端口。
     *
     * 端口取 [PORT_CANDIDATES] 里的第一个可用值，**固定优先**：端口是 localStorage 的「源」的一部分，
     * 变了就换站点、玩家数据（技能 / 昵称 / 设置 / 统计）全部读不到。别再用 `port = 0`（内核随机分配）——
     * 那正是「每次退出重进都要再配一遍技能」的原因。
     *
     * 不要去「先起服务再 connect 探活」：start(wait = false) 返回时 bind 未必已经完成，那个竞态会让每个
     * 端口都探测失败、最后误报「没有可用端口」（第一版就是这个 bug）。resolvedConnectors() 是挂起函数，
     * 它等到真正进入监听状态才返回，所以这里用它是安全的。
     */
    suspend fun start(): Int {
        var last: Throwable? = null
        for ((i, candidate) in PORT_CANDIDATES.withIndex()) {
            try {
                val e = embeddedServer(ServerEngine, host = "127.0.0.1", port = candidate) { module() }
                e.start(wait = false)
                val bound = e.resolvedConnectors().firstOrNull()
                    ?: throw IllegalStateException("引擎没有报告任何监听端口")
                engine = e
                port = bound.port
                if (i > 0) {
                    log("WARN 首选端口 ${PORT_CANDIDATES[0]} 被占用，本次改用 ${bound.port}（因此读不到上次存在 localStorage 里的数据）")
                }
                log("listening on http://127.0.0.1:${bound.port}  upstream=$upstreamHttp")
                return bound.port
            } catch (t: Throwable) {
                last = t
                log("WARN 端口 $candidate 起不来：${t::class.java.simpleName}: ${t.message}")
            }
        }
        log("ERROR 起本地服务失败：${last?.let { "${it::class.java.simpleName}: ${it.message}" }}")
        throw IllegalStateException("起本地服务失败：${last?.message}", last)
    }

    fun stop() {
        try { client.close() } catch (_: Throwable) { }
        try { engine?.stop(500, 1000) } catch (_: Throwable) { }
        engine = null
    }

    // ---------------------------------------------------------------------------------------------

    private fun Application.module() {
        install(ServerWebSockets) {
            // 对局快照可能大于默认的 64 KB，放宽到不限
            // 注意：2.3.x 的属性名是 pingPeriodMillis / timeoutMillis（Long），不是 Duration
            maxFrameSize = Long.MAX_VALUE
            masking = false
            pingPeriodMillis = 30_000
            timeoutMillis = 120_000
        }
        routing {
            // WebSocket 单独一条路由：它走的是 Upgrade，不经过下面的 HTTP 分发
            webSocket("/ws") { bridgeWs() }
            // 其余按方法注册尾卡路由。没用 handle {}：它在各 Ktor 2.x 小版本里位置变过，
            // 显式按动词注册只依赖 get/post/… 这些一直稳定的入口。
            get("/") { dispatch(call) }
            get("{path...}") { dispatch(call) }
            post("{path...}") { dispatch(call) }
            put("{path...}") { dispatch(call) }
            patch("{path...}") { dispatch(call) }
            delete("{path...}") { dispatch(call) }
            options("{path...}") { dispatch(call) }
            head("{path...}") { dispatch(call) }
        }
    }

    /** Only bundled art and notices are local; all application routes follow the live server. */
    private suspend fun dispatch(call: ApplicationCall) {
        val uri = call.request.uri
        val path = uri.substringBefore('?')
        when {
            path == APP_SERVER_PATH -> appServerRoute(call, uri)
            path.startsWith("/about/") -> serveStatic(call, path)
            path == "/data/assets.json" || path == "/data/local-assets.json" || path == "/data/local-fx.json" -> serveStatic(call, path)
            path.startsWith("/assets/") || path.startsWith("/fonts/") || path.startsWith("/media/") -> {
                val localPath = path.replaceFirst(Regex("^/(assets|fonts|media)/~[0-9a-f]{16}/"), "/$1/")
                val hash = Regex("^/(?:assets|fonts|media)/~([0-9a-f]{16})/").find(path)?.groupValues?.get(1)
                val file = bundledArt(localPath, hash)
                if (file != null) {
                    call.response.headers.append(HttpHeaders.CacheControl, "no-cache")
                    call.respondFile(file)
                } else proxyApi(call, uri)
            }
            else -> proxyApi(call, uri)
        }
    }

    private val artHashes = ConcurrentHashMap<String, String>()

    /** Resolve only inside www, and check hashed URLs against actual local bytes. */
    private fun bundledArt(path: String, expectedHash: String?): File? {
        val decoded = try { URLDecoder.decode(path, "UTF-8") } catch (_: Exception) { return null }
        if (decoded.contains('\u0000')) return null
        val root = wwwDir.canonicalPath + File.separator
        val candidates = if (decoded.startsWith("/media/")) {
            val relative = decoded.removePrefix("/media/")
            val base = File(wwwDir, "assets/audio/$relative")
            listOf(base) + AUDIO_EXTS.map { File(wwwDir, "assets/audio/$relative$it") }
        } else listOf(File(wwwDir, decoded.trimStart('/')))
        return candidates.firstOrNull { file ->
            file.canonicalPath.startsWith(root) && file.isFile &&
                (expectedHash == null || artHashes.getOrPut(file.canonicalPath) {
                    val digest = MessageDigest.getInstance("SHA-256")
                    file.inputStream().buffered().use { input ->
                        val buffer = ByteArray(65536)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            digest.update(buffer, 0, n)
                        }
                    }
                    digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }.take(16)
                } == expectedHash)
        }
    }

    /**
     * `/api/app-server`：App 内的服务器选择接口。
     *
     *   GET  → `{ ok:true, app:true, current:"<url>", candidates:[{ id,label,url }] }`
     *   POST → body 为候选 id（或自定义 url），写了就回 `{ ok:true, restart:true }`，
     *          随后由 [onSwitchServer] 触发 App 重启；成功时 deliberately 慢一步再重启，
     *          让 HTTP 响应先回到页面（不然页面只会看到连接被切断）。
     *
     * 这两条路由**不反代**给线上：它们是本机客户端自己的能力，线上服务器没有也不该有。
     */
    private suspend fun appServerRoute(call: ApplicationCall, uri: String) {
        if (call.request.httpMethod == io.ktor.http.HttpMethod.Get) {
            call.respondText(appServerJson(), ContentType.Application.Json)
            return
        }
        if (call.request.httpMethod != io.ktor.http.HttpMethod.Post) {
            call.respondText("""{"ok":false,"error":"method not allowed"}""", ContentType.Application.Json, HttpStatusCode.MethodNotAllowed)
            return
        }
        val body = try { call.receiveStream().readBytes().toString(Charsets.UTF_8) } catch (_: Throwable) { "" }
        val wanted = Regex("\"id\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1)
            ?: Regex("\"url\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1)
        // 解析成「要写进配置的地址」：'auto'（或没给值）→ 空串 = 交还自动探测；
        // 已知 id → 它的地址；其它 → 必须是一个 http(s) 地址，否则视为非法输入。
        // 用空串而不是 null 表示「自动」，这样下面不需要再区分「null 是非法还是自动」。
        val next: String = when {
            projectOnly && wanted !in listOf(null, "", "auto", "main", upstreamHttp) -> {
                call.respondText("""{"ok":false,"error":"this APK connects to the clean project only"}""", ContentType.Application.Json, HttpStatusCode.BadRequest)
                return
            }
            projectOnly && wanted == "main" -> upstreamHttp
            wanted.isNullOrEmpty() || wanted == "auto" -> ""
            else -> SERVERS.firstOrNull { it.first == wanted }?.second
                ?: wanted.takeIf { it.startsWith("http://") || it.startsWith("https://") }
                ?: run {
                    call.respondText("""{"ok":false,"error":"unknown server"}""", ContentType.Application.Json, HttpStatusCode.BadRequest)
                    return
                }
        }
        call.respondText("""{"ok":true,"restart":true,"next":"$next"}""", ContentType.Application.Json)
        log("设置在游戏内切换服务器 → ${next.ifEmpty { "(自动)" }}，即将重启")
        onSwitchServer?.invoke(next)
    }

    /** 供 GET /api/app-server 序列化：当前服务器 + 候选项。 */
    private fun appServerJson(): String {
        val cur = if (upstreamHttp == MAIN_SERVER) "main" else if (upstreamHttp == BACKUP_SERVER) "backup" else upstreamHttp
        val available = if (projectOnly) listOf(Triple("main", upstreamHttp, "纯净联机版 · 本项目服务器")) else SERVERS
        val list = available.joinToString(",") { (id, url, label) -> """{"id":"$id","url":"$url","label":"$label"}""" }
        return """{"ok":true,"app":true,"current":"$cur","currentUrl":"$upstreamHttp","auto":${upstreamHttp == MAIN_SERVER},"candidates":[$list]}"""
    }

    private fun healthJson(): String {
        val up = (System.currentTimeMillis() - startedAt) / 1000
        return """{"ok":true,"version":1,"app":"$appVersion","build":"$buildTag","uptimeSec":$up,""" +
            """"sockets":0,"sessions":0,"rooms":0,"matches":0,"humans":0,"bots":0,"spectators":0}"""
    }

    // ---- 静态文件 ---------------------------------------------------------------------------------

    private suspend fun serveStatic(call: ApplicationCall, rawPath: String) {
        val decoded = try {
            URLDecoder.decode(rawPath, "UTF-8")
        } catch (_: Exception) {
            null
        }
        if (decoded == null || decoded.contains('\u0000')) {
            call.respondText("Bad request", ContentType.Text.Plain, HttpStatusCode.BadRequest)
            return
        }
        val root = wwwDir.canonicalPath + File.separator
        var file = File(wwwDir, decoded.trimStart('/'))
        if (file.isDirectory) file = File(file, "index.html")
        if (!file.canonicalPath.startsWith(root)) {          // 目录穿越
            call.respondText("Forbidden", ContentType.Text.Plain, HttpStatusCode.Forbidden)
            return
        }
        if (!file.isFile) {
            // 与线上一致：data/local-assets.json 缺失时给一份空清单，省得每次开页面浏览器都报 404
            if (decoded == "/data/local-assets.json") {
                call.respondText(
                    """{"version":1,"source":"none","count":0,"groups":{}}""",
                    ContentType.Application.Json, HttpStatusCode.OK,
                )
                return
            }
            call.respondText(notFoundPage(decoded), ContentType.Text.Html, HttpStatusCode.NotFound)
            return
        }
        call.respondFile(file)                                // PartialContent 插件自动处理 Range
    }

    private fun notFoundPage(path: String): String = """<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 · 卫戍协议：盟约</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#111614;color:#d8e3de;font:16px/1.6 system-ui,sans-serif}
main{border:1px solid #2c3a35;padding:32px 40px;max-width:560px;text-align:center}
h1{margin:0;color:#4ed8af;font-size:56px;letter-spacing:4px}p{opacity:.7;word-break:break-all}
</style></head><body><main><h1>404</h1><p>页面不存在 · Not found</p><p>${path.replace("<", "&lt;")}</p></main></body></html>"""

    // ---- /media/：省扩展名的音频路由 ----------------------------------------------------------------

    private suspend fun serveMedia(call: ApplicationCall, path: String) {
        val rest = path.removePrefix("/media/")
        val segs = rest.split('/').filter { it.isNotEmpty() }
        val bad = segs.isEmpty() || rest.endsWith("/") ||
            segs.any { it == ".." || it == "." || it.startsWith(".") || it.endsWith(".") }
        if (bad) { call.respondText("Not found", ContentType.Text.Plain, HttpStatusCode.NotFound); return }

        val last = segs.last()
        val given = AUDIO_EXTS.firstOrNull { last.lowercase().endsWith(it) } ?: ""
        val stem = if (given.isNotEmpty()) last.substring(0, last.length - given.length) else last
        if (stem.isEmpty() || stem.startsWith(".")) {
            call.respondText("Not found", ContentType.Text.Plain, HttpStatusCode.NotFound); return
        }

        val audioRoot = File(wwwDir, "assets/audio")
        val rootPrefix = audioRoot.canonicalPath + File.separator
        val dir = if (segs.size > 1) File(audioRoot, segs.dropLast(1).joinToString("/")) else audioRoot
        // 给了扩展名就先试它，否则按 AUDIO_EXTS 的顺序
        val order = if (given.isNotEmpty()) listOf(given) + AUDIO_EXTS.filter { it != given } else AUDIO_EXTS
        for (ext in order) {
            val f = File(dir, stem + ext)
            if (!f.canonicalPath.startsWith(rootPrefix)) continue
            if (f.isFile) { call.respondFile(f); return }
        }
        call.respondText("Not found", ContentType.Text.Plain, HttpStatusCode.NotFound)
    }

    // ---- /api/*：HTTP 反代 ------------------------------------------------------------------------

    /** `/api/…`：实时数据，转发失败就是 502（不像静态资源那样回退，拿旧的反而误导）。 */
    private suspend fun proxyApi(call: ApplicationCall, uri: String) {
        if (!proxyUpstream(call, uri)) {
            call.respondText(
                """{"error":"upstream unreachable"}""",
                ContentType.Application.Json, HttpStatusCode.BadGateway,
            )
        }
    }

    /**
     * 把一条请求原样转发给中心服务器，成功返回 true。
     *
     * **失败时什么都不写**并返回 false，由调用方决定怎么办：静态资源可以回退本机 www（离线时至少还能
     * 进到「正在重连」界面，而不是一片空白），`/api/…` 则直接报 502。
     */
    private suspend fun proxyUpstream(call: ApplicationCall, uri: String): Boolean {
        val target = upstreamHttp + uri
        val method = HttpMethod.parse(call.request.httpMethod.value)
        val body: ByteArray = if (method == HttpMethod.Post || method == HttpMethod.Put || method == HttpMethod.Patch) {
            try { call.receiveStream().readBytes() } catch (_: Throwable) { ByteArray(0) }
        } else {
            ByteArray(0)
        }
        return try {
            val resp = client.request(target) {
                this.method = method
                call.request.headers.forEach { k, vs ->
                    if (k.lowercase() !in HOP_BY_HOP) vs.forEach { v -> header(k, v) }
                }
                if (body.isNotEmpty()) setBody(body)
            }
            val bytes = resp.readBytes()
            resp.headers.forEach { k, vs ->
                val lk = k.lowercase()
                if (lk !in HOP_BY_HOP && lk != "content-type") {
                    vs.forEach { v -> call.response.headers.append(k, v) }
                }
            }
            val ct = resp.headers[HttpHeaders.ContentType]
                ?.let { runCatching { ContentType.parse(it) }.getOrNull() }
                ?: ContentType.Application.OctetStream
            call.respondBytes(bytes, ct, HttpStatusCode.fromValue(resp.status.value))
            true
        } catch (c: kotlinx.coroutines.CancellationException) {
            throw c                       // 下游断开是正常收尾，不是错误，也不能吞掉取消
        } catch (t: Throwable) {
            log("WARN 反代 $uri 失败：${t.message}")
            false
        }
    }

    // ---- /ws：WebSocket 反代 ----------------------------------------------------------------------

    private suspend fun DefaultWebSocketServerSession.bridgeWs() {
        val target = "$upstreamWs/ws"
        val t0 = System.currentTimeMillis()
        log("WS 开始反代 → $target")
        try {
            client.webSocket(urlString = target) {
                log("WS 上游已连上（握手 ${System.currentTimeMillis() - t0} ms）")
                val down = this@bridgeWs
                val up = this
                coroutineScope {
                    val a = launch {
                        for (frame in down.incoming) {
                            if (frame is Frame.Text || frame is Frame.Binary) up.send(frame)
                        }
                    }
                    val b = launch {
                        for (frame in up.incoming) {
                            if (frame is Frame.Text || frame is Frame.Binary) down.send(frame)
                        }
                    }
                    a.join()
                    b.join()
                }
                log("WS 上游会话结束")
            }
        } catch (c: kotlinx.coroutines.CancellationException) {
            log("WS 下游断开，收掉上游（存活 ${System.currentTimeMillis() - t0} ms）")
            throw c
        } catch (t: Throwable) {
            log("ERROR WS 反代失败（${System.currentTimeMillis() - t0} ms）：${chain(t)}")
        }
    }
}
