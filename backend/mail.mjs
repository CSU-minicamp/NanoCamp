// 邮件投递：只做一件事 —— 把登录验证码发出去。
//
// 适配器只有两个（provider 决定用哪个）：
//   resend  —— POST https://api.resend.com/emails，用内置 fetch，不引 SDK；
//   console —— 不打网络，把验证码打到 stdout，供本机开发。
// 换服务商时只需要再加一个 adapter，调用方（认证接口）不用改。
//
// 注意：验证码绝不写日志（PRD US-007）。console 适配器是唯一的例外，
// 且它只在 provider=console（即明确没配生产发信）时才会被选中。
import {randomInt} from 'node:crypto';

import {mailConfig} from './config.mjs';
import {loginCodeMessage} from '../content/mail.mjs';

/** 生成 6 位数字验证码（密码学安全随机源，不用 Math.random）。 */
export const createEmailCaptcha = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// 仅供测试读取：console 模式下把最近一次验证码记在内存里，测试脚本据此走完整的验证流程。
// 生产用 resend，不会走到这里；这里存的是本机调试用的码，不是任何真实凭证。
const consoleCodes = new Map();
/**
 * 仅供测试：console 模式下最近一次发给这个邮箱的验证码。
 * @param {string} to 收件邮箱。
 * @returns {string} 六位码；没发过就返回空串。
 */
export const lastConsoleEmailCaptcha = to => consoleCodes.get(String(to).toLowerCase()) || '';

/** 验证码邮件的文案在 content/mail.mjs（文案归内容、发送归后端），这里只管怎么发。 */

/**
 * 发一封验证码邮件。
 *
 * 只向调用方暴露三种结果：成功（带服务商 id）、未配置（console，返回 provider='console'）、失败（抛错）。
 * 调用方据此区分「服务已受理」与「用户已收到」—— 任何实现都不该宣称后者。
 *
 * 走 `auth` 这个 stream：以后要给通知、活动提醒各配一把 Key 与发件人时，
 * 只要在 data/config.json 的 mail.streams 里加一项，这里不用改。
 * @param {object} options 参数。
 * @param {string} options.to 收件邮箱（已规范化）。
 * @param {string} options.code 6 位验证码。
 * @param {number} [options.minutes=10] 有效期（分钟）。
 * @returns {Promise<{id: string|null, provider: string, stream: string}>} 投递受理结果。
 */
export async function sendLoginCode({to, code, minutes = 10}){
  const config = mailConfig('auth');
  const message = loginCodeMessage({code, minutes, baseUrl: config.baseUrl});
  // 直接把已解析好的 config 交给 deliver：不再让 sendMail 重新解析一遍同一个 stream。
  return deliver(config, to, message, code);
}

/**
 * Resend 适配器。
 * @param {object} config mailConfig() 的结果。
 * @param {string} to 收件邮箱。
 * @param {{subject: string, text: string, html: string}} message 邮件内容。
 * @returns {Promise<{id: string, provider: string}>} 受理结果。
 */
async function sendWithResend(config, to, message){
  if(!config.apiKey)
    throw new Error('mail.apiKey 为空：请先在 data/config.json 里填入 Resend 的 API Key');
  const payload = {
    from: config.from,
    to: [to],
    subject: message.subject,
    text: message.text,
    html: message.html
  };
  if(config.replyTo)
    payload.reply_to = config.replyTo;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json'},
    body: JSON.stringify(payload)
  });
  if(!response.ok){
    // 把服务商的错误原文带上（截断），否则排查发信问题只有一句"The request failed"。
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend 返回 ${response.status}：${detail.slice(0, 300) || '无正文'}`);
  }
  const data = await response.json();
  return {id: data.id || null, provider: 'resend'};
}

/**
 * 通用的发信入口。业务侧只关心「发给谁、说什么」，
 * 用哪个发件人、哪把 Key 由 stream 决定（见 config.mjs 的 resolveMail）。
 * @param {object} options 参数。
 * @param {string} [options.stream='auth'] 邮件类别，对应 mail.streams 里的键。
 * @param {string} options.to 收件人。
 * @param {string} options.subject 主题。
 * @param {string} options.text 纯文本正文。
 * @param {string} options.html HTML 正文。
 * @param {string} [options.code] 若是一封验证码邮件，传进来以便 console 模式下被测试读取。
 * @returns {Promise<{id: string|null, provider: string, stream: string}>} 投递受理结果。
 */
export async function sendMail({stream = 'auth', to, subject, text, html, code = ''}){
  return deliver(mailConfig(stream), to, {subject, text, html}, code);
}

/**
 * 真正投递的地方：配置已经解析好，这里只按 provider 分派。
 *
 * 单独立一个函数是为了「一次发送只解析一次配置」—— 之前 sendLoginCode 为了拿 baseUrl
 * 先调了一次 mailConfig()，又让 sendMail 调第二次，同一个 stream 被解析两遍。
 * @param {object} config mailConfig() 的结果。
 * @param {string} to 收件邮箱。
 * @param {{subject: string, text: string, html: string}} message 邮件内容。
 * @param {string} [code] 验证码（console 模式下记下来给测试读）。
 * @returns {Promise<{id: string|null, provider: string, stream: string}>} 投递受理结果。
 */
async function deliver(config, to, message, code = ''){
  if(config.provider === 'console'){
    if(code) consoleCodes.set(String(to).toLowerCase(), code);
    console.log(`[mail:console:${config.stream}] 未配置真实发信，本应发给 ${to}：${message.subject}`);
    return {id: null, provider: 'console', stream: config.stream};
  }
  if(config.provider === 'resend')
    return {...await sendWithResend(config, to, message), stream: config.stream};
  throw new Error(`未知的邮件服务商：${config.provider}（stream=${config.stream}）`);
}
