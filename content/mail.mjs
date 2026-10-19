// 验证码邮件的文案。放在 content/ 而不是 backend/：这里只回答「说什么」，
// 怎么发（Resend / console、超时、错误处理）留在 backend/mail.mjs。
//
// 刻意做得朴素：单列、无图片、无短链，只带一行站名与官网地址 ——
// 这些都会影响垃圾邮件判定，花哨的模板反而更容易进垃圾箱。
/**
 * @param {object} options 参数。
 * @param {string} options.code 6 位验证码。
 * @param {number} options.minutes 有效期（分钟）。
 * @param {string} options.baseUrl 站点地址，用于落款。
 * @returns {{subject: string, text: string, html: string}} 主题与两种正文。
 */
export function loginCodeMessage({code, minutes, baseUrl}){
  const subject = `NanoCamp 登录验证码：${code}`;
  const text = [
    '你好，',
    '',
    `这是你的 NanoCamp 登录验证码：${code}`,
    `验证码 ${minutes} 分钟内有效，仅可使用一次。`,
    '',
    '如果这不是你本人的操作，可以忽略这封邮件，账号不会有任何变化。',
    '',
    `NanoCamp · ${baseUrl}`
  ].join('\n');
  const html = `<div style="margin:0;padding:28px 20px;background:#f7f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#1d2b33;line-height:1.7">
  <div style="max-width:480px;margin:0 auto;padding:28px 26px;background:#ffffff;border:1px solid #dfe6e4;border-radius:12px">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;color:#5d7284">NANOCAMP / LOGIN</p>
    <h1 style="margin:0 0 18px;font-size:20px;font-weight:600;color:#172b36">登录验证码</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#3f5560">在登录页面输入下面这串数字即可进入你的账号：</p>
    <p style="margin:0 0 16px;padding:16px 0;text-align:center;background:#f1f7f3;border:1px dashed #bcd3c5;border-radius:10px;font-size:30px;font-weight:600;letter-spacing:.28em;color:#26544a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
    <p style="margin:0 0 20px;font-size:13px;color:#5d7284">验证码 ${minutes} 分钟内有效，仅可使用一次。首次验证会自动创建 NanoCamp 账号。</p>
    <p style="margin:0;padding-top:16px;border-top:1px solid #eef2f0;font-size:12px;color:#6b7f8c">如果这不是你本人的操作，可以忽略这封邮件，账号不会有任何变化。</p>
  </div>
  <p style="max-width:480px;margin:14px auto 0;font-size:11px;color:#8a9aa5;text-align:center">NanoCamp · ${baseUrl}</p>
</div>`;
  return {subject, text, html};
}
