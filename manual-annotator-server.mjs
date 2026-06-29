import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const targetArg = process.argv[2] || process.env.ANNOTATOR_HTML || '训训B端用户使用手册.html';
const manualHtmlPath = resolve(process.cwd(), targetArg);
const root = dirname(manualHtmlPath);
const historyDir = resolve(root, 'assets/manual-history');
const port = Number(process.env.PORT || 8765);
const targetUrlPath = `/${basename(manualHtmlPath).split('/').map(encodeURIComponent).join('/')}`;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = normalize(decoded.replace(/^\/+/, ''));
  const fullPath = resolve(root, relative || basename(manualHtmlPath));
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function safeManualImagePath(inputPath) {
  const decoded = decodeURIComponent(String(inputPath || '').split('?')[0]);
  const relative = normalize(decoded.replace(/^\/+/, ''));
  const fullPath = resolve(root, relative);
  if (!fullPath.startsWith(root)) return null;
  if (extname(fullPath).toLowerCase() !== '.png') return null;
  return fullPath;
}

function historyFolderFor(targetPath) {
  const name = basename(targetPath, '.png');
  return resolve(historyDir, name);
}

function historyUrlFor(filePath) {
  return `/${relative(root, filePath).split('/').map(encodeURIComponent).join('/')}`;
}

function stamp() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('') + `-${String(date.getMilliseconds()).padStart(3, '0')}`;
}

async function ensureInitialHistory(targetPath) {
  const folder = historyFolderFor(targetPath);
  await mkdir(folder, { recursive: true });
  const initialPath = join(folder, '000-initial.png');
  try {
    await stat(initialPath);
  } catch {
    await copyFile(targetPath, initialPath);
  }
}

async function backupCurrentImage(targetPath) {
  await ensureInitialHistory(targetPath);
  const backupPath = join(historyFolderFor(targetPath), `${stamp()}-before-save.png`);
  await copyFile(targetPath, backupPath);
  return backupPath;
}

async function snapshotSavedImage(targetPath) {
  await ensureInitialHistory(targetPath);
  const savedPath = join(historyFolderFor(targetPath), `${stamp()}-saved.png`);
  await copyFile(targetPath, savedPath);
  return savedPath;
}

async function historyItems(targetPath) {
  await ensureInitialHistory(targetPath);
  const folder = historyFolderFor(targetPath);
  const names = (await readdir(folder)).filter(name => name.endsWith('.png')).sort();
  const items = [];
  for (const name of names) {
    const fullPath = join(folder, name);
    const info = await stat(fullPath);
    items.push({
      id: name,
      label: historyLabel(name),
      url: `${historyUrlFor(fullPath)}?t=${info.mtimeMs}`,
      mtime: info.mtimeMs
    });
  }
  const currentInfo = await stat(targetPath);
  items.push({
    id: '__current__',
    label: '当前状态',
    url: `${historyUrlFor(targetPath)}?t=${currentInfo.mtimeMs}`,
    mtime: currentInfo.mtimeMs,
    current: true
  });
  return items;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function saveImage(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const targetPath = safeManualImagePath(body.path);
    if (!targetPath) {
      sendJson(res, 400, { ok: false, error: '只能替换当前 HTML 所在目录下的 PNG 图片' });
      return;
    }
    const match = String(body.image || '').match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
      sendJson(res, 400, { ok: false, error: '图片数据格式不正确' });
      return;
    }
    await backupCurrentImage(targetPath);
    await writeFile(targetPath, Buffer.from(match[1], 'base64'));
    await snapshotSavedImage(targetPath);
    sendJson(res, 200, { ok: true, path: body.path, history: await historyItems(targetPath) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '保存失败' });
  }
}

function historyLabel(name) {
  if (name === '000-initial.png') return '初始状态';
  const time = name.slice(0, 18).replace('-', ' ');
  if (name.endsWith('-saved.png')) return `保存状态 ${time}`;
  if (name.endsWith('-before-save.png')) return `保存前 ${time}`;
  return name.replace(/\.png$/, '');
}

async function listHistory(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const targetPath = safeManualImagePath(url.searchParams.get('path'));
  if (!targetPath) {
    sendJson(res, 400, { ok: false, error: '只能查看当前 HTML 所在目录下的 PNG 图片历史' });
    return;
  }
  try {
    sendJson(res, 200, { ok: true, history: await historyItems(targetPath) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '读取历史失败' });
  }
}

async function restoreHistory(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const targetPath = safeManualImagePath(body.path);
    if (!targetPath) {
      sendJson(res, 400, { ok: false, error: '只能恢复当前 HTML 所在目录下的 PNG 图片历史' });
      return;
    }
    const historyId = String(body.historyId || '');
    if (!historyId || historyId.includes('/') || !historyId.endsWith('.png')) {
      sendJson(res, 400, { ok: false, error: '历史版本不正确' });
      return;
    }
    const historyPath = resolve(historyFolderFor(targetPath), historyId);
    if (!historyPath.startsWith(historyFolderFor(targetPath))) {
      sendJson(res, 400, { ok: false, error: '历史版本路径不正确' });
      return;
    }
    await stat(historyPath);
    await copyFile(historyPath, targetPath);
    sendJson(res, 200, { ok: true, path: body.path, history: await historyItems(targetPath) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '恢复失败' });
  }
}

async function clearHistory(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const targetPath = safeManualImagePath(body.path);
    if (!targetPath) {
      sendJson(res, 400, { ok: false, error: '只能清空当前 HTML 所在目录下的 PNG 图片历史' });
      return;
    }
    await rm(historyFolderFor(targetPath), { recursive: true, force: true });
    sendJson(res, 200, { ok: true, path: body.path, history: await historyItems(targetPath) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '清空历史失败' });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function normalizeHtmlText(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function injectManualTools(html) {
  let output = html;
  if (!output.includes('manual-tools.css')) {
    output = output.replace('</head>', '<link rel="stylesheet" href="/__annotator__/manual-tools.css">\n</head>');
  }
  if (!output.includes('manual-tools.js')) {
    output = output.replace('</body>', '<script src="/__annotator__/manual-tools.js" defer></script>\n</body>');
  }
  return output;
}

function stripInjectedTools(html) {
  return html
    .replace(/\s*<link[^>]+href=["']\/__annotator__\/manual-tools\.css["'][^>]*>\s*/gi, '\n')
    .replace(/\s*<script[^>]+src=["']\/__annotator__\/manual-tools\.js["'][^>]*>\s*<\/script>\s*/gi, '\n');
}

function isPackableUrl(src) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  if (src.startsWith('//')) return false;
  return true;
}

function htmlAttrEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function dataUrlForAsset(src) {
  const cleanSrc = decodeURIComponent(String(src).split('#')[0].split('?')[0]);
  const assetPath = resolve(root, normalize(cleanSrc.replace(/^\/+/, '')));
  if (!assetPath.startsWith(root)) return null;
  const ext = extname(assetPath).toLowerCase();
  const mime = types[ext];
  if (!mime || !mime.startsWith('image/')) return null;
  const data = await readFile(assetPath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function inlineImageSources(html) {
  const srcPattern = /(<(?:img|source)\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi;
  const matches = [...html.matchAll(srcPattern)];
  let output = html;
  for (const match of matches) {
    const [full, prefix, src, suffix] = match;
    if (!isPackableUrl(src)) continue;
    try {
      const dataUrl = await dataUrlForAsset(src);
      if (!dataUrl) continue;
      output = output.replace(full, `${prefix}${htmlAttrEscape(dataUrl)}${suffix}`);
    } catch {
      // Keep the original reference if an optional image cannot be read.
    }
  }
  return output;
}

async function inlineStyleUrls(html) {
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const blocks = [...html.matchAll(stylePattern)];
  let output = html;
  for (const block of blocks) {
    const [full, css] = block;
    const urlMatches = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)];
    let nextCss = css;
    for (const match of urlMatches) {
      const [fullUrl, quote, src] = match;
      if (!isPackableUrl(src)) continue;
      try {
        const dataUrl = await dataUrlForAsset(src);
        if (!dataUrl) continue;
        nextCss = nextCss.replace(fullUrl, `url(${quote}${dataUrl}${quote})`);
      } catch {
        // Keep optional CSS references as-is.
      }
    }
    if (nextCss !== css) output = output.replace(full, full.replace(css, nextCss));
  }
  return output;
}

async function packageHtml(req, res) {
  try {
    let html = await readFile(manualHtmlPath, 'utf8');
    html = stripInjectedTools(html);
    html = await inlineImageSources(html);
    html = await inlineStyleUrls(html);
    const parsed = extname(manualHtmlPath).toLowerCase() === '.html'
      ? basename(manualHtmlPath, extname(manualHtmlPath))
      : basename(manualHtmlPath);
    const outputPath = resolve(root, `${parsed}-打包版.html`);
    await writeFile(outputPath, html, 'utf8');
    sendJson(res, 200, {
      ok: true,
      fileName: basename(outputPath),
      path: outputPath
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '打包失败' });
  }
}

async function saveText(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const originalText = String(body.originalText || '').trim();
    const nextText = String(body.nextText || '').trim();
    const occurrence = Number(body.occurrence || 0);
    if (!originalText || !nextText || occurrence < 0) {
      sendJson(res, 400, { ok: false, error: '文字内容不正确' });
      return;
    }
    const html = await readFile(manualHtmlPath, 'utf8');
    const tagPattern = /<(h1|h2|h3|p|span|b|strong|td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let seen = 0;
    let replaced = false;
    const nextHtmlText = escapeHtml(nextText).replace(/\n/g, '<br>');
    const updated = html.replace(tagPattern, (match, tag, attrs = '', inner) => {
      if (normalizeHtmlText(inner) !== originalText) return match;
      if (seen !== occurrence) {
        seen += 1;
        return match;
      }
      replaced = true;
      return `<${tag}${attrs}>${nextHtmlText}</${tag}>`;
    });
    if (!replaced) {
      sendJson(res, 404, { ok: false, error: '未找到要替换的文字' });
      return;
    }
    await writeFile(manualHtmlPath, updated, 'utf8');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '保存文字失败' });
  }
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === '/__annotator__/manual-tools.css' || pathname === '/__annotator__/manual-tools.js') {
    const toolPath = resolve(toolRoot, basename(pathname));
    res.writeHead(200, {
      'content-type': types[extname(toolPath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(toolPath).pipe(res);
    return;
  }
  const filePath = safeResolve(pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    await stat(filePath);
    if (filePath === manualHtmlPath) {
      const html = await readFile(filePath, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(injectManualTools(html));
      return;
    }
    res.writeHead(200, {
      'content-type': types[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__annotator__/save-image') {
    await saveImage(req, res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/__annotator__/history')) {
    await listHistory(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/__annotator__/restore-history') {
    await restoreHistory(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/__annotator__/clear-history') {
    await clearHistory(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/__annotator__/save-text') {
    await saveText(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/__annotator__/package-html') {
    await packageHtml(req, res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`网页标注服务已启动: http://127.0.0.1:${port}${targetUrlPath}`);
  console.log(`目标 HTML: ${manualHtmlPath}`);
  console.log('编辑截图后点击“应用到当前截图”，会直接替换当前 HTML 引用的 PNG 图片。');
});
