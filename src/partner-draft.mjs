// The letter is a presentation of the same draft exported by workshop.js.
const pen = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m20 6 6 6M7 19 21 5a3 3 0 0 1 4 4L11 23l-6 2 2-6Z"/><path d="M5 29h22"/></svg>';
const copyIcon = '<svg class="brief-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
const downloadIcon = '<svg class="brief-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg>';
const checkIcon = '<svg class="brief-action-check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

export function partnerDraft() {
  return `<div class="brief-fallback" data-brief-fallback><h3>一份简单的交流提案，可以先回答这些问题。</h3><ol><li>你来自哪里，想与怎样的学生交流？</li><li>想围绕什么具体主题，以什么形式开展？</li><li>预计何时进行，双方需要提供哪些支持？</li><li>希望参与者最后能带走什么？</li></ol><p>你可以自行整理这些信息，再通过官方渠道联系社区。</p></div>
  <div class="brief-workspace" data-brief-builder data-brief-live hidden>
    <form class="brief-form" data-brief-form>
      <div class="brief-form-heading"><div><span class="mono">编辑草稿</span></div><span class="brief-pen">${pen}</span></div>
      <div class="form-row">
        <div class="form-field"><label for="brief-kind">你代表的方向</label><select id="brief-kind" name="kind"><option value="学校或学生社团">学校或学生社团</option><option value="企业或机构团队">企业或机构团队</option><option value="个人实践者">个人实践者</option><option value="其他交流伙伴">其他交流伙伴</option></select></div>
        <div class="form-field"><label for="brief-format">期待的交流形式</label><select id="brief-format" name="format"><option value="技术分享">技术分享</option><option value="校园联合交流">校园联合交流</option><option value="共创工作坊">共创工作坊</option><option value="真实问题讨论">真实问题讨论</option><option value="minicamp 活动支持">minicamp 活动支持</option></select></div>
      </div>
      <div class="form-field"><label for="brief-organization">学校、社团或团队名称 <span>选填</span></label><input id="brief-organization" name="organization" type="text" maxlength="80" autocomplete="off" placeholder="让我们知道这份想法来自哪里"></div>
      <div class="form-field brief-topic-field"><label for="brief-topic">想交流的具体主题 <span class="field-required">必填</span></label><input id="brief-topic" name="topic" type="text" required maxlength="120" autocomplete="off" placeholder="例如：把课堂里的一个点子做成原型"></div>
      <div class="form-row">
        <div class="form-field"><label for="brief-audience">希望参与的人群 <span>选填</span></label><input id="brief-audience" name="audience" type="text" maxlength="120" autocomplete="off" placeholder="例如：第一次做项目的同学"></div>
        <div class="form-field"><label for="brief-timing">大致时间与方式 <span>选填</span></label><input id="brief-timing" name="timing" type="text" maxlength="100" autocomplete="off" placeholder="例如：时间可讨论，线上交流"></div>
      </div>
      <div class="form-field"><label for="brief-notes">期待、支持与补充 <span>选填</span></label><textarea id="brief-notes" name="notes" rows="4" maxlength="1500" placeholder="希望大家带走什么？可以提供什么？还需要一起确认什么？"></textarea><span class="field-note">这里只整理交流想法，不需要填写个人联系方式。</span></div>
      <div class="brief-form-actions"><button type="button" class="subtle-button" data-brief-reset>清空内容</button><a class="brief-mobile-preview" href="#brief-preview">查看草稿<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v13m-5-5 5 5 5-5"/></svg></a></div>
    </form>
    <div class="brief-preview" id="brief-preview">
      <div class="brief-form-heading"><span class="mono">草稿预览</span><span class="brief-sync" aria-hidden="true"><i></i>实时同步</span></div>
      <article id="brief-letter" class="brief-letter" data-brief-letter aria-label="交流草稿预览" tabindex="-1" hidden>
        <div class="brief-letter-masthead"><span class="brief-letter-brand">Nano<span>Camp</span></span><span>交流草稿</span></div>
        <div class="brief-letter-subject" data-letter-for="topic"><h3 data-letter-value="topic">一份合作想法，等你写下。</h3></div>
        <p class="brief-letter-greeting">致 NanoCamp：</p>
        <dl class="brief-letter-facts">
          <div data-letter-for="kind"><dt>交流方向</dt><dd data-letter-value="kind"></dd></div>
          <div data-letter-for="organization"><dt>来自</dt><dd data-letter-value="organization">学校、社团或团队待补充</dd></div>
          <div data-letter-for="format"><dt>期待的形式</dt><dd data-letter-value="format"></dd></div>
          <div data-letter-for="audience"><dt>参与人群</dt><dd data-letter-value="audience">待一起确认</dd></div>
          <div data-letter-for="timing"><dt>时间与方式</dt><dd data-letter-value="timing">待一起确认</dd></div>
        </dl>
        <section class="brief-letter-notes" data-letter-for="notes"><h4>期待、支持与补充</h4><p data-letter-value="notes">希望讨论的问题、可以提供的支持，都可以写在这里。</p></section>
        <div class="brief-letter-closing"><p>下一步，一起确认主题、参与范围、时间、分工与公开安排。</p><p>联系信息，请在自行发送前按需要补充。</p></div>
      </article>
      <label for="brief-output" class="sr-only">实时预览的完整交流草稿</label><textarea id="brief-output" data-brief-output readonly placeholder="填写左侧要点，草稿会在这里实时更新。"></textarea>
      <div class="brief-letter-readiness" data-letter-readiness hidden>${checkIcon}<span>写下主题后，即可复制或下载。</span></div>
      <div class="brief-export-actions"><button class="button button-secondary" type="button" data-brief-copy disabled><span data-brief-copy-label>复制草稿</span>${copyIcon}${checkIcon}</button><button class="button button-secondary" type="button" data-brief-download disabled><span data-brief-download-label>下载文本</span>${downloadIcon}${checkIcon}</button></div>
      <p class="tool-status" role="status" aria-live="polite" data-brief-status></p>
      <button type="button" class="brief-return" data-brief-return hidden>返回信笺预览</button>
      <p class="brief-privacy-note">这是一份交流草稿，尚未通过官网发送。内容只留在当前页面，离开前记得复制或下载。</p>
    </div>
  </div>`;
}
