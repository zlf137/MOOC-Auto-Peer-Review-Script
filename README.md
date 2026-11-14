# MOOC Auto Peer Review Script

中国大学 MOOC / SPOC 互评专用用户脚本。面板只保留互评操作，不包含自动学习、讨论回复、测验作答或考试功能。

## 安装

需要先安装 ScriptCat、Tampermonkey 或 Violentmonkey。

**唯一官方安装地址：**

<https://raw.githubusercontent.com/zlf137/MOOC-Auto-Peer-Review-Script/main/MOOC-Auto-Peer-Review.user.js>

点击上面的链接后，脚本管理器会打开安装页。也可从仓库首页打开 [`MOOC-Auto-Peer-Review.user.js`](./MOOC-Auto-Peer-Review.user.js) 查看源码。

> 请勿从其他 ScriptCat、Greasy Fork 页面或其他 GitHub 仓库安装；那些页面不是本项目的发布渠道。

## 功能

- 默认从当前互评详情页连续处理 6 份。
- 可添加 1–200 之间的自定义互评份数。
- 右键份数按钮后再点击红色 `delete` 即可删除。
- 进入删除模式后，在页面任意位置再右键一次即可退出。
- 自定义份数入口不可删除。
- 支持停止正在运行的互评任务。
- 自定义按钮保存在浏览器本地，刷新后仍然保留。

## 使用

1. 安装脚本。
2. 登录 <https://www.icourse163.org/>。
3. 进入一份可评阅作业的互评详情页。
4. 在页面右侧的「MOOC 互评」面板中选择互评份数。

脚本会按评分项的真实分值选择最高分，默认评语为「科技改变生活」。请仅在课程允许自动化处理的情况下使用。

## 平台

脚本不依赖 Windows API，可在支持用户脚本扩展的 Windows、macOS 和 Linux 桌面浏览器中运行。移动版中国大学 MOOC 可能使用不同页面结构，不作保证。

## 更新与安全

脚本的 `@downloadURL` 和 `@updateURL` 都固定指向本仓库 `main` 分支的 `.user.js` 文件。脚本管理器检查更新时，不会跳转到其他仓库或第三方脚本市场。

问题反馈：<https://github.com/zlf137/MOOC-Auto-Peer-Review-Script/issues>

## 许可证与来源

本项目基于 [weiy02/ChinaMOOC-Auto](https://github.com/weiy02/ChinaMOOC-Auto) 修改，保留原 MIT License 和版权声明。该链接仅用于开源归属，不是本项目的安装或更新地址。
