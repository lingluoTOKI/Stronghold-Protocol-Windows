import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 构建时刻。Kotlin DSL 里不能写 java.text.X —— `java` 会被解析成 Gradle 的 Java 扩展而不是包名，
// 所以必须像上面那样 import 进来再用。
val spBuildTime: String = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(Date())

// ---------------------------------------------------------------------------------------------
// 版本号：单一来源是**仓库根的 package.json**（npm run dist 会显式传 -P 覆盖）。
// 这里以前手写 "0.1.4-rhine.7-r14"，和 package.json 各说各话 —— 玩家截图报错时根本说不清是哪一版。
// ---------------------------------------------------------------------------------------------
val repoVersion: String = runCatching {
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
        .find(rootProject.file("../package.json").readText())
        ?.groupValues?.get(1)
}.getOrNull().orEmpty().ifEmpty { "0.0.0" }

val spVersionName: String =
    (project.findProperty("SP_VERSION_NAME") as String?)?.takeIf { it.isNotBlank() } ?: repoVersion

// versionCode 必须单调递增，否则装不上新包。默认由版本号推导（0.2.4 → 204）。
val spVersionCode: Int = (project.findProperty("SP_VERSION_CODE") as String?)?.trim()?.toIntOrNull()
    ?: repoVersion.split('.').take(3).let { p ->
        val maj = p.getOrNull(0)?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        val min = p.getOrNull(1)?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        val pat = p.getOrNull(2)?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 0
        maj * 10000 + min * 100 + pat
    }

/**
 * 读一个配置项：Gradle 属性 → 环境变量 → android/keystore.properties（该文件在 .gitignore 里）。
 *
 * **口令不能写进 gradle.properties** —— 那个文件会进版本库（本仓库曾经在里面存过明文口令）。
 * npm run dist 走的是环境变量这条路。
 */
fun spSecret(name: String): String {
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }?.let { return it }
    System.getenv(name)?.takeIf { it.isNotBlank() }?.let { return it }
    val f = rootProject.file("keystore.properties")
    if (f.exists()) {
        val props = Properties()
        f.inputStream().use { props.load(it) }
        props.getProperty(name)?.takeIf { it.isNotBlank() }?.let { return it }
    }
    return ""
}

// 线上服务器地址 / 签名信息（便于换服不用改代码）
val spUpstream: String = spSecret("SP_UPSTREAM").ifEmpty { "http://101.132.104.41:3000" }
val keystorePath: String = spSecret("SP_KEYSTORE")
val keystoreFile = if (keystorePath.isNotEmpty()) file(keystorePath) else null
val keystorePassword: String = spSecret("SP_KEYSTORE_PASSWORD")
val keyAliasName: String = spSecret("SP_KEY_ALIAS").ifEmpty { "stronghold" }
val keyPasswordValue: String = spSecret("SP_KEY_PASSWORD")
// 有库 + 有口令才走正式签名；否则退回 debug 签名（一样能侧载，只是不适合正式分发）。
val canSignRelease: Boolean = keystoreFile != null && keystoreFile.exists() &&
    keystorePassword.isNotEmpty() && keyPasswordValue.isNotEmpty()

logger.lifecycle(
    "SP 构建：版本 ${spVersionName} (code ${spVersionCode}) · " +
        "签名 ${if (canSignRelease) "release" else "debug（缺密钥库或口令）"} · 上游 $spUpstream",
)

android {
    namespace = "com.lingluotoki.stronghold"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lingluotoki.stronghold"
        minSdk = 24
        targetSdk = 34
        versionCode = spVersionCode
        versionName = spVersionName

        // 打进 BuildConfig，Kotlin 侧直接读
        buildConfigField("String", "UPSTREAM", "\"$spUpstream\"")
        // 构建时刻。界面会显示它 —— 没有这个标记时，报的错到底是哪一版根本分不出来
        // （曾经因此把「旧包没换掉」误判成「修了还是不行」）。
        buildConfigField("String", "BUILD_TIME", "\"$spBuildTime\"")
    }

    // www.zip 是已经压过的容器，别再让 AGP 压一遍；同时也避免 AssetManager 对
    // 压缩资源的 1 MB 读取限制（未压缩的 asset 可以整体流式打开）。
    androidResources {
        noCompress += listOf("zip")
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = keystoreFile
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            // 有密钥库 + 口令就用它签，否则退回 debug 签名（一样能装，只是不适合正式分发）
            signingConfig = if (canSignRelease) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/INDEX.LIST",
                "/META-INF/DEPENDENCIES",
                "/META-INF/*.kotlin_module",
            )
        }
    }

    lint {
        abortOnError = false
    }

    // LocalServer 是纯 JVM 代码（不碰 android.*），所以能在普通 JVM 单元测试里原样跑起来，
    // 用真实 HTTP / WebSocket 断言路由、静态文件与反代是否真的能用。
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // 本地 HTTP 服务 + 服务端 WebSocket
    implementation("io.ktor:ktor-server-core-jvm:2.3.12")
    implementation("io.ktor:ktor-server-cio-jvm:2.3.12")
    implementation("io.ktor:ktor-server-websockets-jvm:2.3.12")

    // 作为客户端去连线上服务器（HTTP 反代 /api/*，WebSocket 反代 /ws）
    implementation("io.ktor:ktor-client-core-jvm:2.3.12")
    implementation("io.ktor:ktor-client-cio-jvm:2.3.12")
    implementation("io.ktor:ktor-client-websockets-jvm:2.3.12")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    testImplementation("io.ktor:ktor-client-cio-jvm:2.3.12")
    testImplementation("io.ktor:ktor-client-websockets-jvm:2.3.12")
}
