// 发一封真实验证码，用来确认「Resend 域名 + 发件人 + API Key」三件事都通了。
//
// 用法：npm run mail:test -- 你的邮箱 [stream]
//   stream 省略时是 auth（登录验证码）；传别的名字会发一封普通测试邮件，
//   用来验证 mail.streams 里那套 from / apiKey 是否生效。
import { createEmailCaptcha, sendLoginCode, sendMail } from '../backend/mail.mjs';
import { mailConfig } from '../backend/config.mjs';

const to = process.argv[2];
const stream = process.argv[3] || 'auth';
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('用法：npm run mail:test -- 你的邮箱 [stream，默认 auth]');
  process.exit(1);
}

const config = mailConfig(stream);
console.log(`stream:   ${config.stream}`);
console.log(`provider: ${config.provider}`);
console.log(`from:     ${config.from}`);
console.log(`reply-to: ${config.replyTo || '(未设置)'}`);
console.log(`to:       ${to}`);
if (config.provider === 'resend' && !config.apiKey)
  console.error('⚠️  provider 是 resend，但这一层没有 apiKey（且顶层也没配），请求一定会失败。');

const started = Date.now();
try {
  const code = createEmailCaptcha();
  const result = stream === 'auth'
    ? await sendLoginCode({ to, code, minutes: 10 })
    : await sendMail({
      stream,
      to,
      subject: `NanoCamp 发信测试（${stream}）`,
      text: `这是一封来自 ${stream} 通道的测试邮件，收到即说明该 stream 的发件人与密钥都生效。\n\nNanoCamp · ${config.baseUrl}`,
      html: `<p>这是一封来自 <strong>${stream}</strong> 通道的测试邮件，收到即说明该 stream 的发件人与密钥都生效。</p><p style="color:#5d7284;font-size:13px">NanoCamp · ${config.baseUrl}</p>`
    });
  console.log(`已受理（${Date.now() - started}ms）：provider=${result.provider} id=${result.id ?? '-'}`);
  if (result.provider === 'console') {
    console.log('本地模式，没有真发信。要真发信：把 data/config.json 的 mail.provider 改成 "resend" 并填上 apiKey。');
  } else {
    console.log('去收件箱看看（也翻一下垃圾箱）。收到即说明 SPF/DKIM 生效；');
    console.log('没收到先看 Resend 控制台的 Emails 日志与退信原因。');
  }
} catch (error) {
  console.error('发送失败：' + error.message);
  process.exitCode = 1;
}
