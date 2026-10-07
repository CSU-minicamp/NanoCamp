(() => {
  document.querySelectorAll('[data-checklist]').forEach(list => {
    const key = `nanocamp-checklist-${list.dataset.checklist}-v1`;
    const inputs = [...list.querySelectorAll('input[type="checkbox"]')];
    const note = list.querySelector('[data-check-save]');
    const reset = list.querySelector('[data-check-reset]');
    let backup;
    let persistent = true;
    function clearUndo() {
      backup = null;
      reset.textContent = '清空勾选';
      delete reset.dataset.undo;
    }
    function readChoices() {
      let raw;
      try { raw = localStorage.getItem(key); persistent = true; } catch { persistent = false; return []; }
      try { const values = JSON.parse(raw); return Array.isArray(values) ? values.filter(v => typeof v === 'string') : []; } catch { return []; }
    }
    function update(save = false) {
      const values = inputs.filter(input => input.checked).map(input => input.value);
      if (save) {
        try { localStorage.setItem(key, JSON.stringify(values)); persistent = true; } catch { persistent = false; }
      }
      const complete = values.length === inputs.length;
      list.classList.toggle('is-complete', complete);
      list.querySelector('progress').value = values.length;
      list.querySelector('[data-check-count]').textContent = complete ? `已完成 ${values.length} / ${inputs.length}，准备好出发。` : `已完成 ${values.length} / ${inputs.length}`;
      note.textContent = persistent ? '勾选进度仅保存在这台设备的浏览器中。' : '浏览器暂未允许保存，当前页面仍可正常勾选。';
      reset.disabled = !values.length && !backup;
    }
    function restore() {
      clearUndo();
      const saved = new Set(readChoices());
      inputs.forEach(input => { input.checked = saved.has(input.value); });
      update();
    }
    inputs.forEach(input => input.addEventListener('change', () => { clearUndo(); update(true); }));
    reset.addEventListener('click', () => {
      if (backup) {
        const saved = new Set(backup);
        inputs.forEach(input => { input.checked = saved.has(input.value); });
        clearUndo();
      } else {
        const checked = inputs.filter(input => input.checked).map(input => input.value);
        if (!checked.length) return;
        backup = checked;
        inputs.forEach(input => { input.checked = false; });
        reset.textContent = '撤销清空';
        reset.dataset.undo = 'true';
      }
      update(true);
    });
    window.addEventListener('storage', event => { if (event.key === key || event.key === null) restore(); });
    list.querySelectorAll('[data-check-enhanced], [data-check-save]').forEach(element => { element.hidden = false; });
    restore();
  });

  document.querySelectorAll('[data-template-copy]').forEach(button => {
    const section = button.closest('.guide-template');
    const text = section.querySelector('[data-template-text]');
    const status = section.querySelector('[data-template-status]');
    const label = button.firstChild;
    const original = label.textContent;
    let timer;
    button.hidden = false;
    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      clearTimeout(timer);
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      delete button.dataset.state;
      label.textContent = '正在复制 ';
      status.dataset.state = 'pending';
      status.textContent = '正在复制模板…';
      try {
        await navigator.clipboard.writeText(text.textContent);
        status.dataset.state = 'success';
        status.textContent = '模板已复制，粘贴到共用文档即可。';
        label.textContent = '已复制 ';
        button.dataset.state = 'success';
        timer = setTimeout(() => { label.textContent = original; delete button.dataset.state; }, 2200);
      } catch {
        label.textContent = original;
        const selection = window.getSelection();
        if (selection) {
          text.focus({ preventScroll: true });
          const range = document.createRange();
          range.selectNodeContents(text);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        status.dataset.state = 'error';
        status.textContent = selection ? '无法自动复制。模板已选中，可手动复制或下载。' : '无法自动复制。可选中下方模板手动复制，或下载文本。';
      } finally {
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
      }
    });
  });

  const toc = document.querySelector('.guide-toc nav');
  if (toc) {
    const entries = [...toc.querySelectorAll('a[href^="#"]')].map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).filter(item => item.section);
    let frame = 0;
    function update() {
      frame = 0;
      let active = entries[0];
      for (const item of entries) if (item.section.getBoundingClientRect().top <= 165) active = item;
      entries.forEach(item => item === active ? item.link.setAttribute('aria-current', 'location') : item.link.removeAttribute('aria-current'));
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
  }

  const builder = document.querySelector('[data-brief-builder]');
  if (!builder) return;
  const form = builder.querySelector('[data-brief-form]');
  const output = builder.querySelector('[data-brief-output]');
  const preview = builder.querySelector('.brief-preview');
  const state = builder.querySelector('[data-brief-state]');
  const status = builder.querySelector('[data-brief-status]');
  const copy = builder.querySelector('[data-brief-copy]');
  const download = builder.querySelector('[data-brief-download]');
  const reset = builder.querySelector('[data-brief-reset]');
  const live = builder.hasAttribute('data-brief-live');
  const names = ['kind', 'format', 'organization', 'topic', 'audience', 'timing', 'notes'];
  let ready = false;
  let revision = 0;
  let backup;
  const field = name => form.elements.namedItem(name);
  const value = (name, limit = 1500) => field(name).value.trim().slice(0, limit);
  function feedback(message, kind = 'info', action = '') {
    status.textContent = message;
    status.dataset.state = kind;
    if (live) builder.dispatchEvent(new CustomEvent('brief:feedback', { detail: { message, kind, action } }));
  }
  function notifyDraft() {
    if (live) builder.dispatchEvent(new CustomEvent('brief:update', { detail: { values: Object.fromEntries(names.map(name => [name, value(name)])), ready } }));
  }
  function markReady(value, label) {
    ready = value;
    copy.disabled = !value;
    download.disabled = !value;
    preview.classList.toggle('is-ready', value);
    preview.dataset.state = value ? 'ready' : live ? 'incomplete' : output.value ? 'stale' : 'empty';
    if (state) state.textContent = label;
  }
  function clearUndo() { backup = null; reset.textContent = '清空内容'; }
  function updateDraft() {
    output.value = [
      'NanoCamp 交流草稿', '',
      `交流方向：${value('kind', 80)}`,
      `学校、社团或团队：${value('organization', 80) || '待补充'}`,
      `期待的形式：${value('format', 80)}`,
      `交流主题：${value('topic', 120) || '待补充'}`,
      `参与人群：${value('audience', 120) || '待一起确认'}`,
      `时间与方式：${value('timing', 100) || '待一起确认'}`, '',
      '期待、可提供的支持与需要讨论的问题：', value('notes') || '待补充', '',
      '下一步：一起确认主题、参与范围、时间、分工与公开安排。',
      '联系信息：请在自行发送前按需要补充。', '',
      '这是一份交流草稿，尚未通过官网发送。',
    ].join('\n');
    markReady(Boolean(value('topic', 120)), '草稿已就绪');
    notifyDraft();
  }
  function edited() {
    field('topic').setCustomValidity('');
    revision++;
    clearUndo();
    if (live) {
      updateDraft();
      feedback('');
    } else if (output.value) {
      markReady(false, '请重新生成');
      feedback('内容已修改，请重新生成草稿后再复制或下载。');
    }
  }
  form.addEventListener('input', edited);
  form.addEventListener('change', edited);
  form.addEventListener('submit', event => {
    event.preventDefault();
    field('topic').setCustomValidity(value('topic') ? '' : '请写下一个具体的交流主题。');
    if (!form.reportValidity()) return;
    revision++;
    clearUndo();
    updateDraft();
    if (live) return;
    feedback('草稿已生成。复制或下载后，可自行联系。', 'success');
    output.scrollTop = 0;
    output.focus({ preventScroll: true });
    preview.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  reset.addEventListener('click', () => {
    revision++;
    if (backup) {
      names.forEach(name => { field(name).value = backup.fields[name]; });
      output.value = backup.output;
      markReady(backup.ready, backup.state);
      clearUndo();
      notifyDraft();
      feedback('已恢复清空前的内容。', 'success');
      return;
    }
    const hasChanges = names.some(name => {
      const control = field(name);
      const original = control.tagName === 'SELECT' ? ([...control.options].find(option => option.defaultSelected) || control.options[0]).value : control.defaultValue;
      return control.value !== original;
    });
    if ((!live && output.value) || hasChanges) {
      backup = { fields: Object.fromEntries(names.map(name => [name, field(name).value])), output: output.value, ready, state: state?.textContent };
    }
    form.reset();
    field('topic').setCustomValidity('');
    output.value = '';
    markReady(false, '等待你的想法');
    if (live) updateDraft();
    feedback(backup ? '内容已清空，可点击「撤销清空」恢复。' : '');
    reset.textContent = backup ? '撤销清空' : '清空内容';
  });
  copy.addEventListener('click', async () => {
    if (!ready) return;
    const current = revision;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(output.value);
      if (revision === current) feedback('草稿已复制，可粘贴到自己的文档中。', 'success', 'copy');
    } catch {
      if (revision === current) {
        if (preview.classList.contains('is-letter-enhanced')) {
          output.hidden = false;
          preview.classList.add('is-manual-copy');
        }
        output.focus();
        output.select();
        feedback('无法自动复制。草稿已选中，可手动复制或下载。', 'error', 'manual');
      }
    } finally { copy.disabled = !ready; }
  });
  download.addEventListener('click', () => {
    if (!ready) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', output.value], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'NanoCamp-交流草稿.txt';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    feedback('已发起下载，可在浏览器的下载记录中查看。', 'success', 'download');
  });
  if (live) updateDraft();
  document.querySelector('[data-brief-fallback]').hidden = true;
  builder.hidden = false;
})();
