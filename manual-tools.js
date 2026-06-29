(() => {
  const toolMarkup = "<div id=\"annotator\" class=\"annotator-backdrop\" aria-hidden=\"true\">\n  <div class=\"annotator-bar\">\n    <div class=\"annotator-title\">\n      <b>截图标注工具</b>\n      <span id=\"annotatorFile\">点击截图后开始编辑</span>\n    </div>\n    <div class=\"annotator-tools\">\n      <button type=\"button\" id=\"toolRect\" class=\"active\">框选</button>\n      <button type=\"button\" id=\"toolText\">文字</button>\n      <input id=\"annotatorText\" type=\"text\" value=\"点击这里\" aria-label=\"备注文字\">\n      <button type=\"button\" id=\"zoomOut\">缩小</button>\n      <button type=\"button\" id=\"zoomIn\">放大</button>\n      <button type=\"button\" id=\"undoAnnot\">上一步</button>\n      <button type=\"button\" id=\"saveAnnot\">应用到当前截图</button>\n      <button type=\"button\" id=\"closeAnnot\" class=\"danger\">关闭</button>\n    </div>\n  </div>\n  <div class=\"annotator-stage\">\n    <div class=\"annotator-help\">\n      用法：选择“框选”拖拽画红框；选择“文字”点击图片空白处加备注；滚轮或“放大/缩小”调整图片大小；“上一步”撤销最近一次标注。\n    </div>\n    <div class=\"annotator-canvas-wrap\">\n      <canvas id=\"annotatorCanvas\"></canvas>\n    </div>\n  </div>\n  <div class=\"annotator-history\">\n    <div class=\"annotator-history-label\">图片版本</div>\n    <div id=\"historyList\" class=\"annotator-history-list\">\n      <div class=\"history-item\"><span>暂无历史</span></div>\n    </div>\n    <div class=\"annotator-history-actions\">\n      <button type=\"button\" id=\"restoreVersion\" disabled>恢复此版本</button>\n      <button type=\"button\" id=\"clearHistory\">清空历史</button>\n    </div>\n  </div>\n  <div id=\"annotatorToast\" class=\"annotator-toast\"></div>\n  <div id=\"annotatorConfirm\" class=\"annotator-confirm\">\n    <b id=\"confirmTitle\">恢复历史版本</b>\n    <p id=\"confirmText\">将当前截图恢复为选中的版本。</p>\n    <div class=\"annotator-confirm-actions\">\n      <button type=\"button\" id=\"cancelRestore\">取消</button>\n      <button type=\"button\" id=\"confirmRestore\" class=\"primary\">确认</button>\n    </div>\n  </div>\n</div>";
  document.body.insertAdjacentHTML('beforeend', toolMarkup);
  const topbar = document.querySelector('.topbar');
  if (!document.getElementById('toggleTextEdit')) {
    const status = topbar ? topbar.querySelector('.status') : null;
    const actions = document.createElement('div');
    actions.className = 'top-actions';
    actions.innerHTML = '<button type="button" id="packageHtml" class="text-edit-toggle">打包 HTML</button><button type="button" id="toggleTextEdit" class="text-edit-toggle">编辑文字</button>';
    if (topbar && status) {
      status.replaceWith(actions);
      actions.appendChild(status);
    } else if (topbar) {
      topbar.appendChild(actions);
    } else {
      actions.classList.add('floating-tools');
      document.body.appendChild(actions);
    }
  }
  const modal = document.getElementById('annotator');
  const canvas = document.getElementById('annotatorCanvas');
  const ctx = canvas.getContext('2d');
  const fileLabel = document.getElementById('annotatorFile');
  const textInput = document.getElementById('annotatorText');
  const rectBtn = document.getElementById('toolRect');
  const textBtn = document.getElementById('toolText');
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const undoBtn = document.getElementById('undoAnnot');
  const saveBtn = document.getElementById('saveAnnot');
  const closeBtn = document.getElementById('closeAnnot');
  const historyList = document.getElementById('historyList');
  const restoreVersionBtn = document.getElementById('restoreVersion');
  const clearHistoryBtn = document.getElementById('clearHistory');
  const toast = document.getElementById('annotatorToast');
  const confirmBox = document.getElementById('annotatorConfirm');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmText = document.getElementById('confirmText');
  const cancelRestoreBtn = document.getElementById('cancelRestore');
  const confirmRestoreBtn = document.getElementById('confirmRestore');

  let sourceImg = null;
  let sourceEl = null;
  let sourceUrl = '';
  let naturalW = 0;
  let naturalH = 0;
  let scale = 1;
  let tool = 'rect';
  let marks = [];
  let draft = null;
  let drawing = false;
  let saving = false;
  let hasUnsavedMarks = false;
  let selectedHistoryId = '';
  let pendingRestoreId = '';
  let pendingAction = '';
  let lastPointerHistoryAt = 0;
  let lastPointerRestoreAt = 0;
  let lastPointerClearAt = 0;
  let toastTimer = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function setTool(nextTool) {
    tool = nextTool;
    rectBtn.classList.toggle('active', tool === 'rect');
    textBtn.classList.toggle('active', tool === 'text');
    canvas.style.cursor = tool === 'rect' ? 'crosshair' : 'text';
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / scale, 0, naturalW),
      y: clamp((event.clientY - rect.top) / scale, 0, naturalH)
    };
  }

  function resizeCanvas() {
    canvas.width = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);
  }

  function drawMark(mark) {
    ctx.save();
    ctx.scale(scale, scale);
    if (mark.type === 'rect') {
      ctx.strokeStyle = '#ef2f2f';
      ctx.lineWidth = Math.max(4 / scale, 2);
      ctx.lineJoin = 'round';
      ctx.strokeRect(mark.x, mark.y, mark.w, mark.h);
    } else if (mark.type === 'text') {
      const fontSize = Math.max(24, naturalW * 0.018);
      ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
      const paddingX = fontSize * .55;
      const paddingY = fontSize * .34;
      const metrics = ctx.measureText(mark.text);
      const boxW = metrics.width + paddingX * 2;
      const boxH = fontSize + paddingY * 2;
      ctx.fillStyle = '#ef2f2f';
      roundRect(ctx, mark.x, mark.y, boxW, boxH, fontSize * .45);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(mark.text, mark.x + paddingX, mark.y + paddingY + fontSize * .78);
    }
    ctx.restore();
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function render() {
    if (!sourceImg) return;
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
    marks.forEach(drawMark);
    if (draft && Math.abs(draft.w) > 2 && Math.abs(draft.h) > 2) {
      drawMark(normalizeRect(draft));
    }
  }

  function normalizeRect(rect) {
    const x = rect.w < 0 ? rect.x + rect.w : rect.x;
    const y = rect.h < 0 ? rect.y + rect.h : rect.y;
    return { type: 'rect', x, y, w: Math.abs(rect.w), h: Math.abs(rect.h) };
  }

  function initialScale() {
    const maxW = Math.max(360, window.innerWidth - 80);
    const maxH = Math.max(320, window.innerHeight - 150);
    return clamp(Math.min(maxW / naturalW, maxH / naturalH, 1.2), .25, 2.5);
  }

  function openEditor(imgEl) {
    sourceEl = imgEl;
    sourceUrl = imgEl.getAttribute('src');
    const img = new Image();
    img.onload = () => {
      sourceImg = img;
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      marks = [];
      draft = null;
      updateDirtyState(false);
      scale = initialScale();
      fileLabel.textContent = sourceUrl;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      render();
      loadHistory();
    };
    img.src = sourceUrl + (sourceUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
  }

  function closeEditor() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    sourceImg = null;
    sourceEl = null;
    selectedHistoryId = '';
    pendingRestoreId = '';
    pendingAction = '';
    restoreVersionBtn.disabled = true;
    confirmBox.classList.remove('show');
  }

  function changeZoom(delta) {
    scale = clamp(scale + delta, .2, 4);
    render();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function resetSaveButton() {
    saving = false;
    saveBtn.disabled = !hasUnsavedMarks;
    saveBtn.textContent = '应用到当前截图';
  }

  function updateDirtyState(nextState) {
    hasUnsavedMarks = nextState;
    if (!saving) saveBtn.disabled = !hasUnsavedMarks;
  }

  async function saveImage() {
    if (!sourceImg) return;
    if (saving) return;
    if (!hasUnsavedMarks || !marks.length) {
      showToast('当前没有新的标注，不需要保存。');
      resetSaveButton();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '应用中...';
    const blob = await createAnnotatedBlob(sourceImg);
    if (!blob) {
      showToast('当前打开方式限制图片导出，请使用本地标注服务打开手册后再保存。');
      resetSaveButton();
      return;
    }

    try {
      const response = await fetch('/__annotator__/save-image', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          path: sourceUrl.split('?')[0],
          image: await blobToDataUrl(blob)
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || '保存失败');
      }
      renderHistory(result.history || []);
    } catch (error) {
      showToast('没有连接到本地标注服务，暂时不能直接替换原图。');
      resetSaveButton();
      return;
    }

    if (sourceEl) {
      const refreshed = sourceUrl + (sourceUrl.includes('?') ? '&' : '?') + 'saved=' + Date.now();
      sourceEl.src = refreshed;
      await loadVersionPreview(refreshed, true);
    }
    updateDirtyState(false);
    showToast('已替换当前截图。');
    resetSaveButton();
  }

  async function loadHistory() {
    if (!sourceUrl) return;
    historyList.innerHTML = '<div class="history-item"><span>读取中...</span></div>';
    try {
      const response = await fetch(`/__annotator__/history?path=${encodeURIComponent(sourceUrl.split('?')[0])}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '读取历史失败');
      renderHistory(result.history || []);
    } catch (error) {
      historyList.innerHTML = '<div class="history-item"><span>启动本地服务后显示历史</span></div>';
    }
  }

  function renderHistory(items) {
    if (!items.length) {
      historyList.innerHTML = '<div class="history-item"><span>暂无历史</span></div>';
      return;
    }
    historyList.innerHTML = '';
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `history-item${item.current ? ' active' : ''}`;
      button.dataset.historyId = item.current ? '' : item.id;
      button.dataset.current = item.current ? '1' : '0';
      button.dataset.url = item.url;
      button.innerHTML = `<img src="${item.url}" alt=""><span>${item.label}</span>`;
      historyList.appendChild(button);
    });
  }

  function selectHistoryButton(button) {
    selectedHistoryId = button.dataset.historyId || '';
    restoreVersionBtn.disabled = button.dataset.current === '1';
    document.querySelectorAll('.history-item').forEach(node => node.classList.remove('active'));
    button.classList.add('active');
    marks = [];
    draft = null;
    updateDirtyState(false);
    loadVersionPreview(button.dataset.url, true);
  }

  async function restoreHistory(historyId) {
    if (!sourceUrl || !historyId) return;
    try {
      const response = await fetch('/__annotator__/restore-history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: sourceUrl.split('?')[0],
          historyId
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '恢复失败');
      renderHistory(result.history || []);
      await loadVersionPreview(sourceUrl + (sourceUrl.includes('?') ? '&' : '?') + 'restored=' + Date.now(), true);
      if (sourceEl) sourceEl.src = sourceImg.src;
      updateDirtyState(false);
      showToast('已恢复到选中的历史版本。');
    } catch (error) {
      showToast('恢复失败，请确认本地标注服务正在运行。');
    }
  }

  function requestRestore(historyId) {
    if (!historyId) return;
    pendingAction = 'restore';
    pendingRestoreId = historyId;
    confirmTitle.textContent = '恢复历史版本';
    confirmText.textContent = '将当前截图恢复为选中的版本，不会额外保存当前状态。';
    confirmBox.classList.add('show');
  }

  function requestClearHistory() {
    if (!sourceUrl) return;
    pendingAction = 'clear';
    pendingRestoreId = '';
    confirmTitle.textContent = '清空图片历史';
    confirmText.textContent = '只清空这张截图的历史版本记录，不会删除或修改当前截图。';
    confirmBox.classList.add('show');
  }

  async function clearHistory() {
    if (!sourceUrl) return;
    try {
      const response = await fetch('/__annotator__/clear-history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: sourceUrl.split('?')[0] })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '清空历史失败');
      renderHistory(result.history || []);
      showToast('已清空这张截图的历史记录。');
    } catch (error) {
      showToast('清空历史失败，请确认本地标注服务正在运行。');
    }
  }

  function closeRestoreConfirm() {
    pendingRestoreId = '';
    pendingAction = '';
    confirmBox.classList.remove('show');
  }

  function loadVersionPreview(url, clearMarks) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        sourceImg = img;
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        if (clearMarks) {
          marks = [];
          draft = null;
        }
        scale = initialScale();
        render();
        resolve();
      };
      img.src = url;
    });
  }

  async function createAnnotatedBlob(baseImage) {
    const output = document.createElement('canvas');
    output.width = naturalW;
    output.height = naturalH;
    const outCtx = output.getContext('2d');
    try {
      outCtx.drawImage(baseImage, 0, 0, naturalW, naturalH);
    } catch (error) {
      return null;
    }
    marks.forEach(mark => drawMarkToContext(outCtx, mark));
    return canvasToPng(output);
  }

  function canvasToPng(output) {
    return new Promise(resolve => {
      try {
        output.toBlob(blob => resolve(blob), 'image/png');
      } catch (error) {
        resolve(null);
      }
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function drawMarkToContext(targetCtx, mark) {
    targetCtx.save();
    if (mark.type === 'rect') {
      targetCtx.strokeStyle = '#ef2f2f';
      targetCtx.lineWidth = 4;
      targetCtx.lineJoin = 'round';
      targetCtx.strokeRect(mark.x, mark.y, mark.w, mark.h);
    } else if (mark.type === 'text') {
      const fontSize = Math.max(24, naturalW * 0.018);
      targetCtx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
      const paddingX = fontSize * .55;
      const paddingY = fontSize * .34;
      const metrics = targetCtx.measureText(mark.text);
      const boxW = metrics.width + paddingX * 2;
      const boxH = fontSize + paddingY * 2;
      targetCtx.fillStyle = '#ef2f2f';
      roundRect(targetCtx, mark.x, mark.y, boxW, boxH, fontSize * .45);
      targetCtx.fill();
      targetCtx.fillStyle = '#fff';
      targetCtx.fillText(mark.text, mark.x + paddingX, mark.y + paddingY + fontSize * .78);
    }
    targetCtx.restore();
  }

  function downloadBlob(blob, fileName) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.querySelectorAll('.screenshot').forEach(img => {
    img.addEventListener('click', () => openEditor(img));
    img.title = '点击打开截图标注工具';
  });

  canvas.addEventListener('pointerdown', event => {
    if (!sourceImg) return;
    const point = pointFromEvent(event);
    if (tool === 'text') {
      const text = textInput.value.trim() || '备注';
      marks.push({ type: 'text', x: point.x, y: point.y, text });
      updateDirtyState(true);
      render();
      return;
    }
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    draft = { type: 'rect', x: point.x, y: point.y, w: 0, h: 0 };
  });

  canvas.addEventListener('pointermove', event => {
    if (!drawing || !draft) return;
    const point = pointFromEvent(event);
    draft.w = point.x - draft.x;
    draft.h = point.y - draft.y;
    render();
  });

  canvas.addEventListener('pointerup', event => {
    if (!drawing || !draft) return;
    drawing = false;
    canvas.releasePointerCapture(event.pointerId);
    const rect = normalizeRect(draft);
    draft = null;
    if (rect.w > 6 && rect.h > 6) {
      marks.push(rect);
      updateDirtyState(true);
    }
    render();
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    changeZoom(event.deltaY > 0 ? -.1 : .1);
  }, { passive: false });

  rectBtn.addEventListener('click', () => setTool('rect'));
  textBtn.addEventListener('click', () => setTool('text'));
  zoomInBtn.addEventListener('click', () => changeZoom(.15));
  zoomOutBtn.addEventListener('click', () => changeZoom(-.15));
  undoBtn.addEventListener('click', () => {
    marks.pop();
    updateDirtyState(marks.length > 0);
    render();
  });
  saveBtn.addEventListener('click', saveImage);
  saveBtn.addEventListener('pointerup', event => {
    event.preventDefault();
    saveImage();
  });
  restoreVersionBtn.addEventListener('click', () => {
    if (Date.now() - lastPointerRestoreAt < 350) return;
    requestRestore(selectedHistoryId);
  });
  restoreVersionBtn.addEventListener('pointerup', event => {
    event.preventDefault();
    lastPointerRestoreAt = Date.now();
    requestRestore(selectedHistoryId);
  });
  clearHistoryBtn.addEventListener('click', () => {
    if (Date.now() - lastPointerClearAt < 350) return;
    requestClearHistory();
  });
  clearHistoryBtn.addEventListener('pointerup', event => {
    event.preventDefault();
    lastPointerClearAt = Date.now();
    requestClearHistory();
  });
  cancelRestoreBtn.addEventListener('click', closeRestoreConfirm);
  confirmRestoreBtn.addEventListener('click', () => {
    const id = pendingRestoreId;
    const action = pendingAction;
    closeRestoreConfirm();
    if (action === 'restore') restoreHistory(id);
    if (action === 'clear') clearHistory();
  });
  historyList.addEventListener('click', event => {
    if (Date.now() - lastPointerHistoryAt < 350) return;
    const button = event.target.closest('.history-item');
    if (button) selectHistoryButton(button);
  });
  historyList.addEventListener('pointerup', event => {
    const button = event.target.closest('.history-item');
    if (!button) return;
    event.preventDefault();
    lastPointerHistoryAt = Date.now();
    selectHistoryButton(button);
  });
  closeBtn.addEventListener('click', closeEditor);
  modal.addEventListener('click', event => { if (event.target === modal) closeEditor(); });
  document.addEventListener('keydown', event => {
    if (!modal.classList.contains('open')) return;
    if (event.key === 'Escape') closeEditor();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      marks.pop();
      updateDirtyState(marks.length > 0);
      render();
    }
  });

  const textEditBtn = document.getElementById('toggleTextEdit');
  const packageBtn = document.getElementById('packageHtml');
  let textEditMode = false;
  let textEditor = null;
  let activeTextTarget = null;

  const editableSelector = '.content h1, .content h2, .content h3, .content p, .content span, .content b, .content strong, .content td, .content th';

  function escapeHtml(value) {
    return String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  }

  function editableTextElements() {
    return [...document.querySelectorAll(editableSelector)].filter(el => {
      if (el.closest('.text-editor, #annotator, .sidebar, .topbar')) return false;
      if (el.querySelector('img, canvas, table, .card, .panel, .steps, .step, .flow')) return false;
      return el.textContent.trim().length > 0;
    });
  }

  function occurrenceIndex(target, text) {
    return editableTextElements().filter(el => el.textContent.trim() === text).indexOf(target);
  }

  function closeTextEditor() {
    if (textEditor) textEditor.remove();
    textEditor = null;
    activeTextTarget = null;
  }

  function openTextEditor(target) {
    closeTextEditor();
    activeTextTarget = target;
    const originalText = target.textContent.trim();
    textEditor = document.createElement('div');
    textEditor.className = 'text-editor';
    textEditor.innerHTML = '<textarea></textarea><button type="button" class="primary">确认</button><button type="button">取消</button>';
    const textarea = textEditor.querySelector('textarea');
    const confirm = textEditor.querySelector('.primary');
    const cancel = textEditor.querySelector('button:not(.primary)');
    textarea.value = originalText;
    target.insertAdjacentElement('afterend', textEditor);
    textarea.focus();
    textarea.select();
    cancel.addEventListener('click', closeTextEditor);
    confirm.addEventListener('click', async () => {
      const nextText = textarea.value.trim();
      if (!nextText || nextText === originalText) {
        closeTextEditor();
        return;
      }
      const occurrence = occurrenceIndex(target, originalText);
      target.innerHTML = escapeHtml(nextText).replace(/\n/g, '<br>');
      closeTextEditor();
      try {
        const response = await fetch('/__annotator__/save-text', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ originalText, nextText, occurrence })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || '保存失败');
        showToast('文字已保存到 HTML。');
      } catch (error) {
        showToast('文字只改了当前页面，未写回 HTML。请确认本地服务正在运行。');
      }
    });
  }

  if (textEditBtn) {
    textEditBtn.addEventListener('click', () => {
      textEditMode = !textEditMode;
      textEditBtn.classList.toggle('active', textEditMode);
      document.body.classList.toggle('manual-text-editing', textEditMode);
      if (!textEditMode) closeTextEditor();
      showToast(textEditMode ? '文字编辑已开启。点击正文文字进行编辑。' : '文字编辑已关闭。');
    });
  }

  if (packageBtn) {
    packageBtn.addEventListener('click', async () => {
      if (packageBtn.disabled) return;
      packageBtn.disabled = true;
      const oldText = packageBtn.textContent;
      packageBtn.textContent = '打包中...';
      try {
        const response = await fetch('/__annotator__/package-html', { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || '打包失败');
        showToast(`已生成：${result.fileName}`);
      } catch (error) {
        showToast(error.message || '打包失败，请确认本地服务正在运行。');
      } finally {
        packageBtn.disabled = false;
        packageBtn.textContent = oldText;
      }
    });
  }

  document.addEventListener('click', event => {
    if (!textEditMode) return;
    if (event.target.closest('.text-editor, #annotator, .sidebar, .topbar')) return;
    const target = event.target.closest(editableSelector);
    if (!target || !editableTextElements().includes(target)) return;
    event.preventDefault();
    event.stopPropagation();
    openTextEditor(target);
  }, true);
})();
