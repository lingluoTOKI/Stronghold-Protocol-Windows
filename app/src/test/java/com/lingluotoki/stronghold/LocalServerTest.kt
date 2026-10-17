package com.lingluotoki.stronghold

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * 把 LocalServer **原样**跑在 JVM 上（它不依赖 android.*），用真实请求验证：
 * 路由匹不匹配、静态文件对不对、MIME 对不对、/api 与 /ws 反代能不能真的连上线上服务器。
 *
 * 这是在没有安卓设备的情况下，对「装上之后能不能联机」最接近真机的验证 ——
 * 除了 WebView 与解包本身，其余走的都是 APK 里同一份代码。
 *
 * 网络相关用例访问 https://game.lingluotoki.dpdns.org（可用 -Dsp.upstream=… 覆盖，
 * 设 -Dsp.offline=1 则跳过所有需要联网的用例）。
 */
class LocalServerTest {

    companion object {
        private const val UPSTREAM = "https://game.lingluotoki.dpdns.org"

        private lateinit var www: File
        private lateinit var server: LocalServer
        private var port = 0
        private var upstream = UPSTREAM

        @BeforeClass
        @JvmStatic
        fun setUp() {
            upstream = System.getProperty("sp.upstream") ?: UPSTREAM
            www = Files.createTempDirectory("sp-www").toFile()
            write("index.html", "<!doctype html><title>SP_INDEX_MARKER</title>")
            write("js/main.js", "export const sp = 1;\n")
            write("css/theme.css", "body{background:#0b0f0e}\n")
            write("data/assets.json", """{"version":1,"marker":"SP_DATA_MARKER"}""")
            write("shared/constants.js", "export const A = 1;\n")
            write("sim/constants.js", "export const B = 2;\n")   // 与 shared/constants.js 同名，验证不会互相覆盖
            write("assets/audio/bgm/lobby.mp3", "SP_AUDIO_MARKER")
            write("assets/char/avatar/x.png", "PNG")
            // 故意不建 data/local-assets.json：验证缺失时给空清单而不是 404

            server = LocalServer(www, upstream, "0.1.4-rhine.6", "test-build-tag") { println("[srv] $it") }
            port = runBlocking { server.start() }
            println("[test] LocalServer 起在 $port，upstream=$upstream")
        }

        @AfterClass
        @JvmStatic
        fun tearDown() {
            server.stop()
            www.deleteRecursively()
        }

        private fun write(rel: String, body: String) {
            val f = File(www, rel)
            f.parentFile?.mkdirs()
            f.writeText(body)
        }

        private val offline get() = System.getProperty("sp.offline") == "1"
    }

    private fun url(path: String) = "http://127.0.0.1:$port$path"

    /** 测试自己的 HTTP 客户端：线上那台出口很慢，默认 15 秒会误报。 */
    private fun newClient() = HttpClient {
        install(io.ktor.client.plugins.HttpTimeout) {
            requestTimeoutMillis = 60_000
            connectTimeoutMillis = 20_000
            socketTimeoutMillis = 60_000
        }
    }

    // ---- 静态路由（最关键：尾卡路由到底匹不匹配嵌套路径）-----------------------------------------

    @Test
    fun `根路径走反代：页面来自中心服务器，本机不再提供`() = runBlocking {
        // 本机客户端是「远端代码 + 本机素材」（玩家只下载一次 APK，之后服务器改代码自动跟上），
        // 所以 / 由上游提供；只有上游不可达时才回退本机 www（见下面那个用例）。
        if (offline) return@runBlocking
        newClient().use { c ->
            val r = c.get(url("/"))
            assertEquals(HttpStatusCode.OK, r.status)
            assertTrue("应是 HTML，实际 ${r.headers[HttpHeaders.ContentType]}",
                r.headers[HttpHeaders.ContentType]?.contains("text/html") == true)
            assertTrue("拿到的是本机 www 的 index —— 说明没有走反代",
                !r.bodyAsText().contains("SP_INDEX_MARKER"))
        }
    }

    @Test
    fun `嵌套的 js 路径能命中且 MIME 正确`() = runBlocking {
        newClient().use { c ->
            val r = c.get(url("/js/main.js"))
            assertEquals("尾卡路由没匹配到 /js/main.js，页面会整体打不开", HttpStatusCode.OK, r.status)
            val ct = r.headers[HttpHeaders.ContentType] ?: ""
            assertTrue("ES 模块必须带 JS MIME，实际 $ct", ct.contains("javascript"))
        }
    }

    @Test
    fun `css 与 png 的 MIME 正确`() = runBlocking {
        newClient().use { c ->
            assertTrue(c.get(url("/css/theme.css")).headers[HttpHeaders.ContentType]!!.contains("text/css"))
            assertTrue(c.get(url("/assets/char/avatar/x.png")).headers[HttpHeaders.ContentType]!!.contains("image/png"))
        }
    }

    @Test
    fun `data shared sim 由上游提供，本机只留 local-assets 清单`() = runBlocking {
        // 这三棵树随代码走，必须和中心服务器同版本 —— 所以现在由反代提供，
        // 本机 www 里那三份只在上游不可达时当兜底。同名文件互相覆盖的问题也就不存在了。
        if (offline) return@runBlocking
        newClient().use { c ->
            val d = c.get(url("/data/assets.json"))
            assertEquals(HttpStatusCode.OK, d.status)
            assertTrue("拿到的还是本机 www 的 data —— 没有走反代",
                !d.bodyAsText().contains("SP_DATA_MARKER"))
        }
    }

    @Test
    fun `省扩展名的媒体路由可用`() = runBlocking {
        newClient().use { c ->
            val r = c.get(url("/media/bgm/lobby"))
            assertEquals(HttpStatusCode.OK, r.status)
            assertTrue(r.headers[HttpHeaders.ContentType]!!.contains("audio"))
            assertTrue(r.bodyAsText().contains("SP_AUDIO_MARKER"))
        }
    }

    @Test
    fun `local-assets 缺失时给空清单而不是 404`() = runBlocking {
        newClient().use { c ->
            val r = c.get(url("/data/local-assets.json"))
            assertEquals(HttpStatusCode.OK, r.status)
            assertTrue(r.bodyAsText().contains("\"count\":0"))
        }
    }

    @Test
    fun `不存在的路径是 404 且挡住目录穿越`() = runBlocking {
        newClient().use { c ->
            assertEquals(HttpStatusCode.NotFound, c.get(url("/nope/nothing.js")).status)
            val esc = c.get(url("/../../etc/passwd"))
            assertTrue("穿越必须不是 200，实际 ${esc.status}", esc.status.value != 200)
        }
    }

    @Test
    fun `healthz 跟随上游的 build 标记（页面与它必须同源同版本）`() = runBlocking {
        // 客户端的 buildGuard 拿 /healthz 的 build 和页面自己的 build 比对：页面来自上游，
        // 所以 /healthz 也必须来自上游 —— 否则会被判定成「需要刷新」，进页面就无限重载。
        if (offline) return@runBlocking
        newClient().use { c ->
            val body = c.get(url("/healthz")).bodyAsText()
            assertTrue(body, body.contains("\"ok\":true"))
            assertTrue("拿到的是本机 build 标记 —— buildGuard 会误判成要刷新", !body.contains("test-build-tag"))
        }
    }

    @Test
    fun `上游不可达时回退本机 www：离线也进得去，而不是一片空白`() = runBlocking {
        // 反代失败时静态资源回退本机 www，/api 照实报 502（实时数据回落拿旧的反而误导）。
        // 拿 127.0.0.1:1 当「死掉的上游」：这个端口没有服务，连接会被立刻拒绝。
        val dead = LocalServer(www, "http://127.0.0.1:1", "test", "dead-tag", log = {})
        val p = dead.start()
        try {
            newClient().use { c ->
                val r = c.get("http://127.0.0.1:$p/")
                assertEquals("上游不通时应给本机 www 的首页", HttpStatusCode.OK, r.status)
                assertTrue("回退拿到的不是本机 index", r.bodyAsText().contains("SP_INDEX_MARKER"))

                // 素材本来就只走本机，上游死了照样有
                assertEquals(HttpStatusCode.OK, c.get("http://127.0.0.1:$p/assets/char/avatar/x.png").status)

                // /api 是实时数据，不回落
                assertEquals(HttpStatusCode.BadGateway, c.get("http://127.0.0.1:$p/api/announcements").status)
            }
        } finally {
            dead.stop()
        }
    }

    // ---- 游戏内设置面板的服务器接口（/api/app-server）------------------------------------------

    @Test
    fun `app-server 报告当前服务器与候选列表`() = runBlocking {
        newClient().use { c ->
            val r = c.get(url("/api/app-server"))
            assertEquals(HttpStatusCode.OK, r.status)
            val body = r.bodyAsText()
            assertTrue("缺少 app 标记（前端靠它判断在不在客户端里）：$body", body.contains("\"app\":true"))
            assertTrue("缺少 current：$body", body.contains("\"current\""))
            assertTrue("候选里没有主服：$body", body.contains("101.132.104.41"))
            assertTrue("候选里没有备用服：$body", body.contains("116.62.39.28"))
            // 候选必须带 id —— 前端用它发回 POST，也用它取本地化后的显示名
            assertTrue("候选项缺少 id：$body", body.contains("\"id\":\"main\"") && body.contains("\"id\":\"backup\""))
            println("[test] /api/app-server → ${body.take(200)}")
        }
    }

    @Test
    fun `app-server 接受已知 id 并把地址回调给 App`() = runBlocking {
        val picked = java.util.concurrent.CopyOnWriteArrayList<String>()
        // 单独起一台，带回调：不能污染 @BeforeClass 那台共享实例
        val extra = LocalServer(www, upstream, "test", "tag", log = {}, onSwitchServer = { picked.add(it) })
        val p = extra.start()
        try {
            newClient().use { c ->
                val r = c.post("http://127.0.0.1:$p/api/app-server") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"id":"backup"}""")
                }
                assertEquals(HttpStatusCode.OK, r.status)
                val body = r.bodyAsText()
                assertTrue("没回 restart：$body", body.contains("\"restart\":true"))
                // 回调必须已经在响应之前发生，否则页面会先看到连接被切断
                assertEquals(listOf("http://116.62.39.28:3000"), picked.toList())
            }
        } finally {
            extra.stop()
        }
    }

    @Test
    fun `app-server 的 auto 回空串表示交还自动探测`() = runBlocking {
        val picked = java.util.concurrent.CopyOnWriteArrayList<String>()
        val extra = LocalServer(www, upstream, "test", "tag", log = {}, onSwitchServer = { picked.add(it) })
        val p = extra.start()
        try {
            newClient().use { c ->
                val r = c.post("http://127.0.0.1:$p/api/app-server") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"id":"auto"}""")
                }
                assertEquals(HttpStatusCode.OK, r.status)
                assertEquals(listOf(""), picked.toList())
            }
        } finally {
            extra.stop()
        }
    }

    @Test
    fun `app-server 拒绝未知服务器且不触发切换`() = runBlocking {
        val picked = java.util.concurrent.CopyOnWriteArrayList<String>()
        val extra = LocalServer(www, upstream, "test", "tag", log = {}, onSwitchServer = { picked.add(it) })
        val p = extra.start()
        try {
            newClient().use { c ->
                val r = c.post("http://127.0.0.1:$p/api/app-server") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"id":"evil.example.com"}""")
                }
                assertEquals(HttpStatusCode.BadRequest, r.status)
                assertTrue("非法输入不该触发重启：$picked", picked.isEmpty())
            }
        } finally {
            extra.stop()
        }
    }

    // ---- 反代：这才是「能不能联机」的关键 --------------------------------------------------------

    @Test
    fun `api 反代真的能拿到线上公告`() = runBlocking {
        if (offline) return@runBlocking
        newClient().use { c ->
            val r = c.get(url("/api/announcements"))
            assertEquals("反代 /api 没通（upstream=$upstream）", HttpStatusCode.OK, r.status)
            val body = r.bodyAsText()
            assertTrue("返回不是公告 JSON：${body.take(200)}", body.contains("\"items\""))
            println("[test] /api/announcements 通过反代取到 ${body.length} 字节")
        }
    }

    @Test
    fun `WebSocket 反代把帧送到线上并收得到回包`() = runBlocking {
        if (offline) return@runBlocking
        val client = HttpClient { install(WebSockets) }
        client.use {
            client.webSocket(urlString = "ws://127.0.0.1:$port/ws") {
                // 没先 hello 就发随便一条：线上服务器（server/net.js:602）会回
                // {t:'error', …,'hello required'}。收得到就证明帧真的穿过反代到了线上，
                // 而且回包也穿了回来 —— 这两件事都成立才叫「能联机」。
                send(Frame.Text("""{"t":"ping"}"""))
                val reply = withTimeout(15_000) {
                    var got: String? = null
                    for (f in incoming) {
                        if (f is Frame.Text) { got = f.readText(); break }
                        if (f is Frame.Close) break
                    }
                    got
                }
                println("[test] 反代回来的第一帧：$reply")
                assertNotNull("15 秒内一帧都没回来，反代没通", reply)
                assertTrue("回帧不像线上服务器的报文：$reply", reply!!.contains("\"t\""))
            }
        }
    }

    @Test
    fun `WebSocket 反代发 hello 能拿到 welcome`() = runBlocking {
        if (offline) return@runBlocking
        val client = HttpClient { install(WebSockets) }
        client.use {
            client.webSocket(urlString = "ws://127.0.0.1:$port/ws") {
                send(Frame.Text("""{"t":"hello","name":"安卓反代自测"}"""))
                val reply = withTimeout(15_000) {
                    var got: String? = null
                    for (f in incoming) {
                        if (f is Frame.Text) { got = f.readText(); break }
                        if (f is Frame.Close) break
                    }
                    got
                }
                println("[test] hello 的回复：${reply?.take(300)}")
                assertNotNull("hello 没有回复", reply)
                assertTrue("没拿到 welcome，实际：$reply", reply!!.contains("welcome"))
            }
        }
    }
}
