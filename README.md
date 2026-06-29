# HTMLeditor

一个本地运行的通用 HTML 标注与编辑工具。启动后输入 HTML 文件绝对路径，工具会通过本地服务打开页面，并在运行时注入编辑能力，不会把工具脚本写入原 HTML。

## 功能

- 点击页面截图后放大编辑
- 对截图做红框标注和文字备注
- 保存后直接替换当前 HTML 引用的原图
- 图片版本历史、恢复历史、清空历史
- 点击正文文字后编辑并写回 HTML
- 一键打包 HTML，把本地图片内联为 base64，生成不依赖本地文件的 `*-打包版.html`

## 使用方式

### 双击启动

macOS 双击：

```bash
启动网页标注工具.command
```

弹窗中输入要编辑的 HTML 绝对路径，然后点击“启动”。

### 命令行启动

```bash
node manual-annotator-server.mjs "/absolute/path/to/your.html"
```

默认端口为 `8765`。如需修改：

```bash
PORT=8877 node manual-annotator-server.mjs "/absolute/path/to/your.html"
```

## 说明

- 工具只通过本地 `127.0.0.1` 服务运行。
- 图片保存只允许写回当前 HTML 所在目录下的 PNG 图片。
- 历史版本保存在当前 HTML 所在目录的 `assets/manual-history/`。
- “打包 HTML”会生成新文件，不会覆盖原 HTML。

## 文档

- [交互文档](./INTERACTION.md)
