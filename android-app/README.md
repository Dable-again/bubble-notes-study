# 泡泡笔记 Android / HarmonyOS 4.2 安装包

这是离线 WebView 封装。构建时将 `../dist` 中的网页资源复制进 APK，运行时从 `https://bubble.local/` 映射到安装包内的资源。所有页面请求都会被本地拦截；应用数据和导入的文件保存在设备的应用存储中，不需要账号或网络。系统文件选择器用于导入文件和保存 PDF/备份。

## 构建

需要 JDK 17、Gradle 8.7、Android SDK Platform 35 和 Build Tools 35。设置 `JAVA_HOME`、`ANDROID_HOME`，在此目录运行 `gradle assembleRelease`。输出位于 `app/build/outputs/apk/release/app-release.apk`。

正式版本使用此目录下的 `signing.properties` 与 `release-signing.jks` 签名。这两个文件不加入 Git；后续更新必须沿用同一签名密钥，否则设备不能覆盖安装。请妥善备份密钥和密码。没有签名文件时可以构建调试包，但它的签名不能用于覆盖正式版本。

本项目面向支持 APK 安装的 HarmonyOS 4.2，不适用于 HarmonyOS 5/Next 原生 HAP 安装路径。升级 APK 前建议在应用内导出数据备份。网站更新不会自动更新已安装的 APK，需重新构建并安装新版。
