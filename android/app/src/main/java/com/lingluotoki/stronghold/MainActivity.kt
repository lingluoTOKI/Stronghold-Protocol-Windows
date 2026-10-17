package com.lingluotoki.stronghold

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.JavascriptInterface
import org.json.JSONTokener
import org.json.JSONObject
import org.json.JSONArray
import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * 两台线上服务器的地址，只在这一处定义（按钮标签、选择框、自动探测都用它）。
 *
 * 都是 `http://<IP>:3000`：两台机器只开了 node 的 3000 端口，而 Let's Encrypt
 * 不给裸 IP 发证书，所以裸 IP 走不了 HTTPS。
 */
object ServerHosts {
    val MAIN: String = BuildConfig.UPSTREAM.trimEnd('/')
    val ALL = listOf(MAIN)
}

/**
 * Extract bundled art, then open a loopback gateway in WebView.
 * Art stays local while application code and multiplayer follow the selected upstream.
 */
class MainActivity : Activity() {
    companion object {
        private const val TAG = "MainActivity"
        private const val FILE_CHOOSER_REQUEST = 2101
        private const val EXPORT_DOCUMENT_REQUEST = 2102
        private const val MAX_EXPORT_CHARS = 16 * 1024 * 1024
        private const val BG = 0xFF0B0F0E.toInt()
        private const val FG = 0xFFD8E3DE.toInt()
        /** 正常消息（已连上、探测结果之类）停留多久后自动收起。 */
        private const val DIAG_OK_HIDE_MS = 10_000L
        /** 出错消息多留一会儿，方便玩家截图反馈。 */
        private const val DIAG_PROBLEM_HIDE_MS = 30_000L

        /** 美术链路探测是异步的（fetch 清单 → 解码 2048² 图集），隔一会儿取一次结果，最多取这么多次。 */
        private const val ART_PROBE_RETRY = 6
        private const val ART_PROBE_RETRY_MS = 2_000L

        /**
         * 自动选服的候选顺序（主服 → 备用服）。地址见 [ServerHosts]。
         */
        private val SERVER_CANDIDATES = ServerHosts.ALL

        /**
         * 在页面里探测 WebGL 能力。简化视图（fallback）最常见的原因就是 WebGL 不可用，
         * 而 WebView 里没有任何 API 能直接问出来，只能靠这段 JS。
         * 顺带取 GPU 名字：如果是 SwiftShader 之类的软件实现，就能一眼看出来。
         */
        private val WEBGL_PROBE_JS = """
            (function () {
              try {
                var c = document.createElement('canvas');
                var g1 = c.getContext('webgl');
                var g2 = c.getContext('webgl2');
                var g2s = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
                var g = g2 || g1, gpu = '';
                if (g) {
                  var d = g.getExtension('WEBGL_debug_renderer_info');
                  if (d) gpu = g.getParameter(d.UNMASKED_RENDERER_WEBGL);
                }
                return 'WebGL1=' + (!!g1) + ' WebGL2=' + (!!g2) + ' 严格=' + (!!g2s)
                  + (gpu ? (' GPU=' + gpu) : ' GPU=(未知)');
              } catch (e) { return 'WebGL 探测异常: ' + (e && e.message); }
            })()
        """.trimIndent()

        /**
         * 美术链路探测：清单 → 图集是否列出 → 裁剪表 → 图集图片能否下载并解码 → MAX_TEXTURE_SIZE。
         *
         * 为什么要探：棋盘原图的失败路径是**完全静默**的 —— `render/boardArt.js` 一拿不到清单或图集就
         * `return null`，格子退化成纯色，一个错误都不报。这五项能把四种完全不同的原因分开：
         *   * 清单=0 项/none  → 本机服务器给了空清单兜底（`LocalServer.kt` 的 `!file.isFile` 分支），
         *                       也就是 www 里根本没有 `data/local-assets.json`；
         *   * 图集=未列出     → 清单里没有 `map/autochess → TX_autochessi_D`；
         *   * 图集图片=失败   → 下载或解码 2048×2048 的 PNG 就挂了；
         *   * MAX_TEXTURE_SIZE < 2048 → 图集根本传不进 GPU（PIXI 会把纹理丢掉，画面就是纯色）。
         *
         * 结果是异步填进 `window.__spArtProbe`（onPageFinished 里隔一会儿来取）。
         * 注意：这段在 Kotlin 原生字符串里，**一个 $ 都不能出现**，否则会被当成模板插值。
         */
        private val ART_PROBE_JS = """
            (function () {
              window.__spArtProbe = '';
              (async function () {
                var out = [];
                try {
                  var m = null;
                  try {
                    var r = await fetch('/data/local-assets.json', { cache: 'no-store' });
                    if (r.ok) m = await r.json();
                  } catch (e) {}
                  if (!m) { out.push('清单=读不到'); }
                  else {
                    var n = (typeof m.count === 'number') ? m.count : 0;
                    var src = String(m.source || '(无)').slice(0, 18);
                    out.push('清单=' + n + ' 项/' + src);
                  }
                  var atlas = null;
                  try {
                    var g = m && m.groups && m.groups['map/autochess'];
                    atlas = (g && g['TX_autochessi_D'] && g['TX_autochessi_D'].path) || null;
                  } catch (e) {}
                  out.push('图集=' + (atlas ? '已列出' : '未列出'));
                  var tilesUrl = (atlas ? atlas.replace(/\/[^/]*$/, '') : '/assets/local/map/autochess') + '/tiles.json';
                  var tilesOk = false;
                  try { var r2 = await fetch(tilesUrl, { cache: 'no-store' }); tilesOk = r2.ok; } catch (e) {}
                  out.push('tiles.json=' + (tilesOk ? '在' : '缺'));
                  if (atlas) {
                    var info = await new Promise(function (res) {
                      var im = new Image();
                      var t = setTimeout(function () { res('超时'); }, 6000);
                      im.onload = function () { clearTimeout(t); res(im.naturalWidth + 'x' + im.naturalHeight); };
                      im.onerror = function () { clearTimeout(t); res('下载或解码失败'); };
                      im.src = atlas;
                    });
                    out.push('图集图片=' + info);
                  }
                  try {
                    var c = document.createElement('canvas');
                    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
                    out.push('MAX_TEXTURE_SIZE=' + (gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : '?'));
                  } catch (e) { out.push('MAX_TEXTURE_SIZE=?'); }

                  // 最有分量的一项：直接调游戏自己的模块，算出「真用上原图的材质有几个」。
                  // 注意：**不能**在这里直接 import() —— 注入脚本的 base URL 是 about:blank，
                  // 动态 import 必然失败（玩家截图里的「调试游戏模块失败: Failed to resolve module
                  // specifier '/js/render/boardArt.js' ... about:blank」就是这条假警报）。
                  // 改成往页面里插一个 <script type="module">，让 import 在页面自己的源里执行；
                  // 结果随后追加进 window.__spArtProbe（外壳会继续轮询几秒，取最后那一版）。
                  out.push('模块=探测中');
                  try {
                    var probeCode = "Promise.all([import('/js/render/boardArt.js'),import('/js/render/textures.js'),import('/js/assets.js')])" +
                      ".then(function(m){var load=m[0].loadBoardArt,tile=m[1].tileAtlas,MAT=m[1].MATERIALS;" +
                      "var a=m[2].assets||m[2].defaultAssets;" +
                      "if(typeof load!=='function'||typeof tile!=='function')return '模块导出不对';" +
                      "return load(a).then(function(art){if(!art)return 'loadBoardArt=null';" +
                      "var at=tile(art);return '原图材质='+(at.artCount||0)+'/'+MAT.length" +
                      "+' 源图='+Object.keys(art.images||{}).join('+')+' atlas='+((at.canvas&&at.canvas.width)||'?')+'x'+((at.canvas&&at.canvas.height)||'?');});})" +
                      ".then(function(s){window.__spArtProbe+='  '+s;})" +
                      ".catch(function(e){window.__spArtProbe+='  模块不可用:'+(e&&e.message);});";
                    var sc = document.createElement('script');
                    sc.type = 'module';
                    sc.textContent = probeCode;
                    document.head.appendChild(sc);
                  } catch (e) { out.push('模块不可用:' + (e && e.message)); }
                } catch (e) {
                  out.push('探测异常:' + (e && e.message));
                }
                window.__spArtProbe = out.join('  ');
              })();
              return 'started';
            })()
        """.trimIndent()
    }

    private lateinit var root: FrameLayout
    private lateinit var loading: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var diag: TextView
    /** 诊断行的自动收起计时器（每次新消息都重置）。 */
    private var diagHide: Runnable? = null
    /** 每次新消息都拼一次：能力探测独占一行，其余消息一行，互不覆盖。 */
    private var diagProbe: String? = null
    private var diagConsole: String? = null
    private var pendingExport: Pair<String, String>? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var web: WebView? = null
    private var server: LocalServer? = null
    /** 本次启动自动探测选中的上游（仅用于日志/诊断，玩家手动选择以 SharedPreferences 为准）。 */
    private var autoPickedUpstream: String? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        // 显式要求硬件加速窗口。manifest 里已经写了 hardwareAccelerated=true，
        // 但某些系统（电脑模式 / 云手机 / 兼容容器）会替应用降级成软件渲染，那样 WebView 拿不到
        // WebGL，PixiJS 直接抛 "Unable to auto-detect a suitable renderer"，游戏退到最简视图。
        // 这一句是能在应用侧做的唯一抵抗；加不上也无害。
        try {
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        } catch (t: Throwable) {
            Log.w(TAG, "无法请求硬件加速窗口：${t.message}")
        }
        setContentView(buildLoadingUi())
        // 恢复上次的显示选择（全屏 / 页面缩放）：这两项由「长按右下角构建字样」的菜单切换。
        fullscreen = prefs.getBoolean("fullscreen", false)
        pageZoom = prefs.getInt("zoom", 100)
        applySystemBars()
        boot()
    }

    /** 与「服务器选择」共用同一份 SharedPreferences。 */
    private val prefs get() = getSharedPreferences("sp", MODE_PRIVATE)

    /** 沉浸式全屏（隐藏状态栏 / 导航栏）。玩家反馈「没有全屏按钮」——入口见 showServerPicker()。 */
    private var fullscreen = false

    /** 页面缩放百分比（100 = 不缩放）。默认 100，保证现有观感不变；玩家反馈「地图太小」时可以放大。 */
    private var pageZoom = 100

    /**
     * 应用（或退出）沉浸式全屏。
     *
     * API 30+ 用 WindowInsetsController；更老的用已废弃但仍有效的 systemUiVisibility。
     * 用 IMMERSIVE_STICKY / BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE：从屏幕边缘滑一下能临时唤出系统栏，
     * 不会把玩家困在全屏里出不去。
     */
    private fun applySystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val c = window.insetsController ?: return
            if (fullscreen) {
                c.hide(WindowInsets.Type.systemBars())
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else {
                c.show(WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (fullscreen) {
                (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
            } else {
                0
            }
        }
    }

    private fun toggleFullscreen() {
        fullscreen = !fullscreen
        prefs.edit().putBoolean("fullscreen", fullscreen).apply()
        applySystemBars()
        toast(if (fullscreen) "已进入全屏（从屏幕边缘滑动可临时唤出系统栏）" else "已退出全屏")
    }

    /** 页面缩放：100 不缩放；>100 时关掉 overview 并用 setInitialScale，重载后生效。 */
    private fun setPageZoom(percent: Int) {
        pageZoom = percent
        prefs.edit().putInt("zoom", percent).apply()
        val w = web
        if (w != null) {
            if (percent > 100) {
                w.settings.useWideViewPort = false
                w.setInitialScale(percent)
            } else {
                w.settings.useWideViewPort = true
                w.setInitialScale(0)
            }
            w.reload()
        }
        toast("页面缩放 $percent%（已重载）")
    }

    private fun toast(msg: String) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // 沉浸式是 sticky 的，但切后台 / 弹过对话框后系统栏可能回来，这里补一次
        if (hasFocus && fullscreen) applySystemBars()
    }

    private fun buildLoadingUi(): View {
        root = FrameLayout(this).apply { setBackgroundColor(BG) }
        loading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        status = TextView(this).apply {
            setTextColor(FG)
            textSize = 16f
            gravity = Gravity.CENTER
            text = "正在准备…"
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
        }
        val textLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = 28 }
        val barLp = LinearLayout.LayoutParams(760, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            leftMargin = 24; rightMargin = 24
        }
        loading.addView(status, textLp)
        loading.addView(progress, barLp)
        // 非官方同人声明：必须让玩家看得见，不能只藏在包里。
        // 措辞对齐仓库根的 NOTICE.md / README.md。
        loading.addView(
            TextView(this).apply {
                setTextColor(0x99D8E3DE.toInt())
                textSize = 12f
                gravity = Gravity.CENTER
                text = "非官方同人作品 · 与鹰角网络及其关联方无关\n" +
                    "游戏素材版权归原权利人所有，不适用 GPL · 严禁任何形式盈利 · 权利人要求即删除"
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 40 },
        )
        root.addView(
            loading,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            ).apply { gravity = Gravity.CENTER },
        )
        // 常驻的构建标识：玩家截图反馈时能立刻分清是哪一版。
        //   点一下 → 把刚收起的诊断行叫回来（不用为了看状态而重开 App）
        //   长按   → 弹服务器选择（进游戏后「切换服务器」按钮会隐藏，这里是它的入口；
        //            这行字很小、在右下角，不挡画面）
        root.addView(
            TextView(this).apply {
                setTextColor(0x66FFFFFF.toInt())
                textSize = 12f
                text = buildStamp()
                setOnClickListener { renderDiag(true) }
                setOnLongClickListener { showServerPicker(); true }
            },
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.END
                marginEnd = 24; bottomMargin = 16
            },
        )
        // 服务器选择已经搬进**游戏内的设置面板**（public/js/ui/settings.js 的「服务器」一栏，
        // 由 /api/app-server 这条本机专有接口驱动）。所以这里不再画任何常驻 UI ——
        // 之前那个青绿色方块压在左下角，挡着「交流 / 设置」那一排，玩家反馈「又丑又难看」。
        // 仍然是双入口：游戏设置面板（主要）、长按右下角构建字样（兜底，万一进不去游戏）。
        // 诊断行：联机出问题时屏幕上只有「正在重连」，看不出是证书、网络还是反代本身。
        // 这一行会把最后一件事写出来（上游探测结果、WS 握手耗时、异常链），
        // 玩家截一张图就能定位，不必再猜。
        diag = TextView(this).apply {
            setTextColor(0xFFFFD479.toInt())
            textSize = 11f
            maxLines = 3
            ellipsize = android.text.TextUtils.TruncateAt.END
            setBackgroundColor(0xCC101614.toInt())
            setPadding(18, 10, 18, 10)
            visibility = View.GONE
        }
        root.addView(
            diag,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.START
                // 抬到「切换服务器」按钮上方一行（按钮在 bottomMargin=16 处，高约 52dp）
                marginStart = 16; marginEnd = 16; bottomMargin = 84
            },
        )
        return root
    }

    /**
     * 把一条诊断信息显示到屏幕上（也会进 logcat），然后自动收起。
     *
     * 计时规则是「**最后一条消息之后** N 秒」而不是「每条各自计时」：
     * 持续出问题时消息会不断刷新计时，这一行就自己留住了，玩家随时截得到；
     * 一切正常时最后一条是「WS 上游已连上」之类，10 秒后就干净了。点一下可以立刻收起。
     */
    private fun showDiag(line: String) {
        diagConsole = line
        renderDiag(line.startsWith("ERROR") || line.contains("失败"))
    }

    /**
     * 能力探测结果：单独占一行，且不随其它消息被覆盖。
     *
     * **只有真出问题时才自动弹出来** —— 探测每进一次图都跑，无条件弹就是"每次开页面都蹦一条"
     * （玩家反馈"你这个报错弹窗也太普遍了"）。一切正常时它静默存在，玩家点右下角构建字样随时能看。
     * 「模块不可用」不算问题：那是模块探测的时机问题（PIXI 可能还没加载完），不是游戏坏了。
     */
    private fun setProbe(line: String) {
        diagProbe = line
        val broken = listOf("失败", "WebGL1=false", "硬件加速=false", "清单=0", "loadBoardArt=null", "MAX_TEXTURE_SIZE=?")
            .any { line.contains(it) }
        if (broken) renderDiag(true)
    }

    private fun renderDiag(problem: Boolean) {
        // 屏幕诊断行已按要求隐藏：错误只写进 logcat（adb logcat 可查），不再弹到玩家屏幕上。
        runOnUiThread { diag.visibility = View.GONE }
    }

    /** 界面与错误里显示的构建标识。 */
    private fun buildStamp(): String = "构建 ${BuildConfig.BUILD_TIME} · ${BuildConfig.VERSION_NAME}"

    private fun boot() {
        scope.launch {
            try {
                val t0 = System.currentTimeMillis()
                val dir = if (WwwInstaller.needsExtract(this@MainActivity)) {
                    status.text = "首次启动：正在解包内置素材…"
                    WwwInstaller.extract(this@MainActivity) { done, name ->
                        runOnUiThread {
                            status.text = "首次启动：正在解包内置素材…已 $done 个文件"
                            if (name.isNotEmpty()) Log.v(TAG, "unzip: $name")
                        }
                    }
                } else {
                    WwwInstaller.dirOf(this@MainActivity)
                }
                status.text = "正在启动本地服务…"
                val upstream = resolveUpstream()
                val srv = LocalServer(
                    dir, upstream, BuildConfig.VERSION_NAME, buildTag(),
                    log = { line ->
                        Log.i(TAG, line)
                        showDiag(line)
                    },
                    // 游戏内设置面板切服务器 → 写盘 + 重启（页面会被重载到新服务器）
                    onSwitchServer = { next -> applyServerSwitch(next) },
                )
                val p = srv.start()
                server = srv
                Log.i(TAG, "本地服务已就绪：http://127.0.0.1:$p/（准备耗时 ${(System.currentTimeMillis() - t0) / 1000} s）")
                showGame("http://127.0.0.1:$p/")
                // 不挡进游戏：并行探一次上游，结果只写进诊断行
                scope.launch { showDiag(srv.probeUpstream()) }
            } catch (t: Throwable) {
                Log.e(TAG, "启动失败", t)
                progress.visibility = View.GONE
                // 不把技术异常链暴露给玩家：只给简洁提示，详细错误只在 logcat。
                status.text = "启动失败，请检查网络后\n重新打开本应用。"
            }
        }
    }

    /**
     * buildGuard 用的构建标记（public/js/ui/buildGuard.js）：同一份 APK 内必须恒定，
     * 否则页面会以为自己过期而反复刷新。用版本号 + 素材包字节数拼一个。
     */
    private fun buildTag(): String {
        val len = try {
            assets.openFd("www.zip").use { it.length }
        } catch (_: Throwable) {
            try {
                assets.open("www.zip").use { it.available().toLong() }
            } catch (_: Throwable) {
                -1L
            }
        }
        return "android-${BuildConfig.VERSION_CODE}-$len"
    }

    /**
     * 自动选服：玩家手动指定过就用他的选择；否则按 [SERVER_CANDIDATES] 顺序探测，
     * 第一台能通的就用它（通常是主服；主服挂了自动落到杭州）。
     *
     * 为什么要自动：玩家开着游戏遇到主服限流时只会看到「正在重连」，然后以为游戏坏了。
     */
    private suspend fun resolveUpstream(): String {
        // This APK belongs to the clean project. Discard server selections inherited from other editions.
        val selected = getSharedPreferences("sp", MODE_PRIVATE)
        val manual = selected.getString("upstream", null)
        if (manual != null && manual.trimEnd('/') == ServerHosts.MAIN) return ServerHosts.MAIN
        if (manual != null) selected.edit().remove("upstream").apply()
        status.text = "正在选择服务器…"
        val (picked, note) = LocalServer.pickReachable(SERVER_CANDIDATES)
        Log.i(TAG, "自动选服：$note")
        showDiag("选服 ${note}")
        // 记下来（不写进 SharedPreferences：那是玩家手动选择的语义，自动结果不该覆盖它）
        autoPickedUpstream = picked
        return picked
    }

    /**
     * 游戏内设置面板切了服务器：写进 SharedPreferences，然后重启 App 生效。
     *
     * 空串 = 交还自动探测（清掉玩家指定，下次启动按主服→备用服探测）。
     * 故意延迟 600ms：HTTP 响应要先回到页面，否则页面只会看到连接被切断、
     * 表现为「点了没反应」。
     */
    private fun applyServerSwitch(next: String) {
        runOnUiThread {
            val ed = getSharedPreferences("sp", MODE_PRIVATE).edit()
            if (next.isEmpty()) ed.remove("upstream") else ed.putString("upstream", next)
            ed.apply()
            val what = if (next.isEmpty()) "自动选服" else next
            android.widget.Toast.makeText(this, "已切换到 $what，正在重启…", android.widget.Toast.LENGTH_LONG).show()
            root.postDelayed({ recreate() }, 600)
        }
    }

    /** 长按右下角构建标识弹出的菜单：服务器选择 + 显示（全屏 / 页面缩放）。 */
    private fun showServerPicker() {
        val labels = arrayOf(
            "连接本项目服务器 · ${ServerHosts.MAIN}",
            if (fullscreen) "显示：退出全屏" else "显示：进入全屏",
            "显示：页面缩放 100%（原始）",
            "显示：页面缩放 110%",
            "显示：页面缩放 125%",
            "显示：页面缩放 150%",
        )
        AlertDialog.Builder(this)
            .setTitle("纯净联机版 / 显示")
            .setItems(labels) { _, which ->
                when (which) {
                    0 -> applyServerSwitch("")
                    1 -> toggleFullscreen()
                    2 -> setPageZoom(100)
                    3 -> setPageZoom(110)
                    4 -> setPageZoom(125)
                    5 -> setPageZoom(150)
                }
            }
            .show()
    }

    /** The only native bridge operation: save JSON to a destination explicitly chosen by the user. */
    private inner class ExportBridge {
        @JavascriptInterface
        fun saveJson(filename: String, text: String) {
            if (text.length > MAX_EXPORT_CHARS) {
                runOnUiThread { toast("导出文件过大，未保存") }
                return
            }
            val valid = runCatching {
                val parser = JSONTokener(text)
                val value = parser.nextValue()
                (value is JSONObject || value is JSONArray) && parser.nextClean() == 0.toChar()
            }.getOrDefault(false)
            if (!valid) {
                runOnUiThread { toast("导出内容不是有效的 JSON 文件") }
                return
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (pendingExport != null) {
                    toast("请先完成或取消上一次保存")
                    return@runOnUiThread
                }
                val name = filename.substringAfterLast('/').substringAfterLast('\\')
                    .replace(Regex("[^a-zA-Z0-9._-]"), "_").take(120)
                    .let { if (it.endsWith(".json", true)) it else "stronghold-export.json" }
                pendingExport = name to text
                try {
                    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "application/json"
                        putExtra(Intent.EXTRA_TITLE, name)
                    }
                    startActivityForResult(intent, EXPORT_DOCUMENT_REQUEST)
                } catch (e: Exception) {
                    pendingExport = null
                    Log.w(TAG, "Cannot open export destination", e)
                    toast("无法打开保存窗口，请确认系统文件管理器可用")
                }
            }
        }
    }

    private fun installExportHandler(view: WebView) {
        // Anchor downloads use blob: URLs, which Android's DownloadManager cannot read.
        // Read in the page's own origin, then ask Android for a user-selected destination.
        view.evaluateJavascript("""
            (() => {
              if (window.__spAndroidExportInstalled) return;
              window.__spAndroidExportInstalled = true;
              document.addEventListener('click', event => {
                const anchor = event.target && event.target.closest && event.target.closest('a[download]');
                if (!anchor || !anchor.href.startsWith('blob:') || !anchor.download.toLowerCase().endsWith('.json')) return;
                event.preventDefault();
                fetch(anchor.href).then(response => {
                  if (!response.ok) throw new Error('export blob unavailable');
                  return response.text();
                }).then(text => SpAndroidExport.saveJson(anchor.download, text))
                  .catch(() => alert('无法读取导出内容，请重新导出'));
              }, true);
            })()
        """.trimIndent(), null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showGame(url: String) {
        val w = WebView(this).apply { setBackgroundColor(BG) }
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                      // 会话凭证 / 昵称存在 localStorage、sessionStorage
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false       // BGM 与干员语音
            allowFileAccess = false
            allowContentAccess = true                      // user-selected content:// files from the system picker
            cacheMode = WebSettings.LOAD_NO_CACHE
            // 忽略系统「字体大小 / 显示大小」的无障碍缩放：否则文字被放大后布局会挤爆
            // （结算页的返回按钮被挤出视口之类），这也是玩家反馈「字好大」的来源。
            textZoom = 100
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        w.addJavascriptInterface(ExportBridge(), "SpAndroidExport")
        w.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?, callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST)
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "Cannot open file picker", e)
                    fileChooserCallback = null
                    callback?.onReceiveValue(null)
                    toast("无法打开文件选择器，请确认系统已安装文件管理器")
                    true
                }
            }

            /**
             * 把页面的 console 输出接进诊断行。
             *
             * 游戏自己的降级路径全是**只写 console.warn 就悄悄换视图**的，例如
             * public/js/ui/fieldHost.js:212
             *   `[field] render engine unavailable, using the simplified view: <原因>`
             * 屏幕上只会看到「已切换为简化视图」，而真正的原因（WebGL 不可用？12 秒超时？）
             * 只有这里拿得到。全部进 logcat，WARN/ERROR 额外显示到屏幕上。
             */
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val level = msg.messageLevel()
                val line = "console[${level.name}] ${msg.message()}  @${msg.sourceId()}:${msg.lineNumber()}"
                Log.i(TAG, line)
                if (level == ConsoleMessage.MessageLevel.WARNING || level == ConsoleMessage.MessageLevel.ERROR) {
                    showDiag("console: ${msg.message()}")
                }
                return true
            }
        }
        w.webViewClient = object : WebViewClient() {
            /** 加载出错（断网/本地服务未就绪）：不显示系统默认的 net::ERR 错误页，用深色遮罩盖住，点击重试。 */
            override fun onReceivedError(
                view: WebView?, request: android.webkit.WebResourceRequest?,
                error: android.webkit.WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                // 只处理主框架的错误；子资源（图片/字体/素材）失败不打断游戏。
                if (request?.isForMainFrame != true) return
                val v = view ?: return
                Log.w(TAG, "页面加载失败（已隐藏系统错误页）: ${error?.description}")
                runOnUiThread {
                    // loading 是不透明深色面板，盖住 WebView 的系统错误页；点击后重新加载。
                    loading.setBackgroundColor(BG)
                    status.text = "网络连接中…\n\n轻触此处重试"
                    status.setOnClickListener {
                        status.setOnClickListener(null)
                        status.text = "正在准备…"
                        (loading.parent as? ViewGroup)?.removeView(loading)
                        v.reload()
                    }
                    if (loading.parent == null) {
                        root.addView(
                            loading,
                            FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                            ),
                        )
                        loading.bringToFront()
                    }
                }
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (view != null && url?.startsWith("http://127.0.0.1:") == true) installExportHandler(view)
                // 页面正常加载完成后撤掉错误遮罩（如果还在）
                if (loading.parent != null) {
                    (loading.parent as? ViewGroup)?.removeView(loading)
                }
                // 页面就绪后探一次 WebGL —— 简化视图最常见的原因就是它不可用
                view?.evaluateJavascript(WEBGL_PROBE_JS) { raw ->
                    val text = raw?.trim()?.removeSurrounding("\"")?.replace("\\n", " ") ?: "(no result)"
                    val hw = try { view.isHardwareAccelerated } catch (_: Throwable) { null }
                    val line = "硬件加速=$hw  $text"
                    Log.i(TAG, "WebGL 探测: $line")
                    setProbe(line)

                    // 美术链路（棋盘原图）单独再探一次：它是异步的，而且失败时页面上一声不吭。
                    // 结果取到就并进同一行诊断 —— 那行是常驻的，玩家直接截图就能说明问题。
                    view.evaluateJavascript(ART_PROBE_JS) { }
                    fun readArtProbe(attempt: Int) {
                        // 显式标签：这个作用域里有两个 evaluateJavascript，用默认标签会有歧义（Kotlin 会警告）
                        view.evaluateJavascript("window.__spArtProbe || ''") artProbe@{ artRaw ->
                            val art = artRaw?.trim()?.removeSurrounding("\"")?.replace("\\n", " ")
                            if (!art.isNullOrBlank()) {
                                Log.i(TAG, "美术探测: $art")
                                setProbe("$line  |  $art")
                            }
                            // 「原图材质」那一段是异步的（模块由 <script type="module"> 加载后才追加），
                            // 所以拿到结果也要继续轮询几轮、取最后那一版，否则只会停在「模块=探测中」。
                            if (attempt < ART_PROBE_RETRY) {
                                view.postDelayed({ readArtProbe(attempt + 1) }, ART_PROBE_RETRY_MS)
                            }
                        }
                    }
                    readArtProbe(0)
                }
            }
        }
        web = w
        root.removeView(loading)
        root.addView(
            w,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        // 页面缩放（默认 100 = 不动）：>100 时关掉宽视口 overview、改用 setInitialScale 把整页放大
        if (pageZoom > 100) {
            w.settings.useWideViewPort = false
            w.setInitialScale(pageZoom)
        }
        w.loadUrl(url)
        diag.bringToFront()          // 诊断行压在最上层（平时是 GONE，不挡画面）
    }

    @Deprecated("Activity result API retained for the plain Activity shell")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == EXPORT_DOCUMENT_REQUEST) {
            val export = pendingExport
            pendingExport = null
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null || export == null) {
                toast("已取消保存")
                return
            }
            scope.launch {
                val result = kotlinx.coroutines.withContext(Dispatchers.IO) {
                    runCatching {
                        val output = contentResolver.openOutputStream(uri, "wt")
                            ?: error("No output stream")
                        output.bufferedWriter(Charsets.UTF_8).use { it.write(export.second) }
                    }
                }
                if (result.isSuccess) toast("已保存：${export.first}")
                else {
                    Log.w(TAG, "Export write failed", result.exceptionOrNull())
                    toast("保存失败，请重新导出并选择其他位置")
                }
            }
            return
        }
        if (requestCode != FILE_CHOOSER_REQUEST) return
        val callback = fileChooserCallback
        fileChooserCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            val w = web
            if (w != null && w.canGoBack()) {
                w.goBack()
                return true
            }
            moveTaskToBack(true)                          // 与浏览器行为一致：退到后台，不断线
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        pendingExport = null
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        scope.launch { }
        server?.stop()
        server = null
        web?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        web = null
        super.onDestroy()
    }
}
