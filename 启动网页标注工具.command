#!/bin/zsh
cd "$(dirname "$0")"
NODE_BIN="/Users/wangkun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
DEFAULT_HTML="$(pwd)/训训B端用户使用手册.html"
TARGET_HTML="$(osascript -e 'text returned of (display dialog "请输入要标注的 HTML 文件绝对路径：" default answer "'"$DEFAULT_HTML"'" buttons {"启动"} default button "启动")')"
if [ -z "$TARGET_HTML" ]; then
  TARGET_HTML="$DEFAULT_HTML"
fi
if [ ! -f "$TARGET_HTML" ]; then
  osascript -e 'display alert "文件不存在" message "'"$TARGET_HTML"'"'
  exit 1
fi
PORT="${PORT:-8765}"
ENCODED_NAME="$("$NODE_BIN" -e 'console.log(encodeURIComponent(require("path").basename(process.argv[1])))' "$TARGET_HTML")"
URL="http://127.0.0.1:${PORT}/${ENCODED_NAME}"
open "$URL"
exec "$NODE_BIN" manual-annotator-server.mjs "$TARGET_HTML"
