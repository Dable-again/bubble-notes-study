# 泡泡笔记

离线学习记录应用。可以建立分区、记录和小 tip，在 tip 中输入文字、插入图片、手写并导出 PDF。数据保存在设备本地，不需要登录。导入的习题文件目前作为一个整体附件保存，不自动拆题。

## 安装

面向支持 APK 安装的 Android 与 HarmonyOS 4.2。下载 [安装包](dist/downloads/bubble-notes-harmonyos-4.2.apk) 后在设备上打开安装。鸿蒙 4.2 真机安装及运行仍待验证。

## 数据

应用数据只在当前设备的应用存储中。换机、卸载或重装前，请在应用内导出备份。网站与已安装 APK 的数据不会自动同步。

## 开发

网页资源在 `dist/`，Android 封装与构建说明在 [`android-app/README.md`](android-app/README.md)。签名密钥不在仓库中；发布后续 APK 时必须沿用原密钥。
