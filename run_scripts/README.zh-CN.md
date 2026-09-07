# 一键脚本

[English](./README.md) | 简体中文

Linux 使用 `linux/*.sh`，Windows 使用 `windows/*.cmd`。所有脚本都会自动切换到项目根目录，可以从任意工作目录启动。运行前需安装 Node.js、pnpm 和 Git。

| 脚本             | 用途                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `run`            | 启动已构建的生产 Web + Runtime 服务（`pnpm start`），需先运行 `build`。 |
| `dev`            | 安装依赖，启动支持热更新的 Web + Runtime 开发服务。                     |
| `electron-dev`   | 安装依赖，构建并打开 Electron 桌面应用。                                |
| `build`          | 安装依赖，构建 Runtime、Web 和 Electron 产物。                          |
| `electron-build` | 安装依赖、构建并生成 Linux DEB 或 Windows NSIS EXE 安装包，不上传。     |
| `release`        | 构建正式发布产物，仅在构建成功后上传到 GitHub Release。                 |
| `release-upload` | 上传此前由 `release:build` 生成的正式发布产物，不重新构建。             |

`dev`、`electron-dev`、`build` 和 `electron-build` 使用冻结锁文件安装依赖，包含开发依赖。构建产物位于 `.desktop-build/`，安装包位于 `dist-electron/`。请在目标操作系统上打包，架构默认采用本机架构。

Windows 打包使用 `electron:dist:artifact`，会验证产物文件，但不运行仅支持 Linux 的完整应用启动检查。Web 和 Electron 开发均使用端口 `3000`，请勿同时启动。

## 使用示例

Linux：

```bash
./run_scripts/linux/dev.sh
./run_scripts/linux/electron-build.sh
./run_scripts/linux/release.sh
```

Windows PowerShell 或 CMD：

```powershell
.\run_scripts\windows\dev.cmd
.\run_scripts\windows\electron-build.cmd
.\run_scripts\windows\release.cmd
```

参数会传递给最后执行的 pnpm 命令。例如，`release-upload.sh --clobber` 或 `release-upload.cmd --clobber` 会覆盖 Release 中的同名文件。

## 发布前提

发布脚本复用 `scripts/local-release.mjs`。需先通过 `gh auth login` 登录，保持各应用版本一致，并处于对应 `v<版本号>` 标签的干净工作区。该标签指向的提交必须已包含在 `origin/main` 中。上传前需推送标签并创建对应的 GitHub Release。

`release` 将正式发布产物构建到 `release-assets/<平台目标>/`，`release-upload` 上传这些经过校验的产物。仅有 `dist-electron/` 中的普通安装包不足以运行 `release-upload`。
