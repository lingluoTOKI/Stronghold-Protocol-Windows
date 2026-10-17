package com.lingluotoki.stronghold

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * 把 APK 内置的 `assets/www.zip` 解到内部存储 `filesDir/www/`，只做一次。
 *
 * 为什么是「打进包里的 zip + 首次解压」而不是让 AGP 直接把素材当 assets 用：
 * AGP 的 assets.srcDirs 是把多个目录的**内容**并到同一层，而这几棵树里
 * `shared/constants.js` 与 `server/sim/constants.js` 同名，并到一层必然互相覆盖；
 * zip 能带路径前缀，绕开这件事。解压到文件系统后再由 LocalServer 按普通文件提供，
 * 也顺便拿到了 Range、Last-Modified 这些现成能力。
 *
 * 版本标记用 BuildConfig.VERSION_CODE：APK 一升级就重新解一次，避免新旧素材混在一起。
 */
object WwwInstaller {
    private const val ZIP_ASSET = "www.zip"
    private const val MARKER = ".extracted-version"
    private const val BUF = 1 shl 16

    /** 素材目录（不保证已解压）。 */
    fun dirOf(ctx: Context): File = File(ctx.filesDir, "www")

    /** 是否需要（重新）解压。 */
    fun needsExtract(ctx: Context): Boolean {
        val dir = dirOf(ctx)
        val marker = File(dir, MARKER)
        val want = BuildConfig.VERSION_CODE.toString()
        if (!marker.isFile || marker.readText().trim() != want) return true
        return !File(dir, "index.html").isFile
    }

    /**
     * 解压。`onProgress` 在 IO 线程上被调用，次数很少（每 250 个文件一次）。
     * @return 解压后的 www 目录
     */
    suspend fun extract(ctx: Context, onProgress: (done: Int, name: String) -> Unit = { _, _ -> }): File =
        withContext(Dispatchers.IO) {
            val dir = dirOf(ctx)
            val rootPrefix = dir.canonicalPath + File.separator
            if (dir.exists() && !dir.deleteRecursively()) throw IllegalStateException("无法清理旧素材：$dir")
            if (!dir.mkdirs()) throw IllegalStateException("无法创建素材目录：$dir")

            var count = 0
            ctx.assets.open(ZIP_ASSET).use { raw ->
                ZipInputStream(BufferedInputStream(raw, BUF)).use { zin ->
                    val buf = ByteArray(BUF)
                    while (true) {
                        val e = zin.nextEntry ?: break
                        val out = File(dir, e.name)
                        // zip-slip：条目名里带 ../ 时不许写到目录外
                        if (!out.canonicalPath.startsWith(rootPrefix)) { zin.closeEntry(); continue }
                        if (e.isDirectory) {
                            out.mkdirs()
                        } else {
                            out.parentFile?.mkdirs()
                            FileOutputStream(out).use { fos ->
                                while (true) {
                                    val n = zin.read(buf)
                                    if (n <= 0) break
                                    fos.write(buf, 0, n)
                                }
                            }
                            count++
                            if (count % 250 == 0) onProgress(count, e.name)
                        }
                        zin.closeEntry()
                    }
                }
            }
            File(dir, MARKER).writeText(BuildConfig.VERSION_CODE.toString())
            onProgress(count, "")
            dir
        }
}
