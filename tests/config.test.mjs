import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveMail, serverSettings, SERVER_DEFAULTS, loadConfig } from '../backend/config.mjs';

// 纯函数测试：不读 data/config.json，也不发信。

test('监听配置：空配置全部走默认值', () => {
  const settings = serverSettings({});
  assert.equal(settings.host, SERVER_DEFAULTS.host);
  assert.equal(settings.port, SERVER_DEFAULTS.port);
  assert.equal(settings.name, SERVER_DEFAULTS.name);
  assert.equal(settings.url, '');
  assert.deepEqual(settings.warnings, []);
});

test('监听配置：合法字段生效，url 自动补结尾斜杠', () => {
  const settings = serverSettings({ host: '127.0.0.1', port: 8099, name: 'Test', url: 'https://ttesestt.nanocamp.club' });
  assert.equal(settings.host, '127.0.0.1');
  assert.equal(settings.port, 8099);
  assert.equal(settings.name, 'Test');
  assert.equal(settings.url, 'https://ttesestt.nanocamp.club/');
  assert.deepEqual(settings.warnings, []);
});

test('监听配置：非法 port 与 url 回退默认值并给出告警', () => {
  const settings = serverSettings({ port: 70000, url: 'ftp://nanocamp.club/' });
  assert.equal(settings.port, SERVER_DEFAULTS.port);
  assert.equal(settings.url, '');
  assert.equal(settings.warnings.length, 2, '应该分别为 port 与 url 各报一条');
  assert.ok(settings.warnings.some(warning => warning.includes('port')));
  assert.ok(settings.warnings.some(warning => warning.includes('url')));
});

test('监听配置：容错到 null / 数组这类脏数据', () => {
  for (const raw of [null, [], 'oops']) {
    const settings = serverSettings(raw);
    assert.equal(settings.port, SERVER_DEFAULTS.port);
    assert.equal(settings.host, SERVER_DEFAULTS.host);
  }
});
// 重点验证「发件人与密钥是两个独立维度」：一个 stream 可以只换 from 而共用顶层的 Key。

test('老配置（没有 streams）行为保持不变', () => {
  const config = resolveMail({ mail: { provider: 'resend', apiKey: 're_old', from: 'NanoCamp <captcha@mail.nanocamp.club>' } });
  assert.equal(config.provider, 'resend');
  assert.equal(config.apiKey, 're_old');
  assert.equal(config.from, 'NanoCamp <captcha@mail.nanocamp.club>');
  assert.equal(config.stream, 'default');
});

test('完全没配邮件时是 console，不会偷偷发信', () => {
  const config = resolveMail({});
  assert.equal(config.provider, 'console');
  assert.equal(config.apiKey, '');
  assert.match(config.from, /donotreply@mail\.nanocamp\.club/);
});

test('streams 只换发件人，密钥从顶层继承', () => {
  const raw = {
    mail: {
      provider: 'resend',
      apiKey: 're_shared',
      streams: {
        notice: { from: 'NanoCamp <notice@mail.nanocamp.club>' }
      }
    }
  };
  const config = resolveMail(raw, 'notice');
  assert.equal(config.from, 'NanoCamp <notice@mail.nanocamp.club>');
  assert.equal(config.apiKey, 're_shared', '未写 apiKey 时应继承顶层');
  assert.equal(config.stream, 'notice');
});

test('stream 自带 apiKey / provider 时优先用它', () => {
  const raw = {
    mail: {
      provider: 'console',
      streams: {
        event: { provider: 'resend', apiKey: 're_event', from: 'minicamp <event@mail.nanocamp.club>' }
      }
    }
  };
  const config = resolveMail(raw, 'event');
  assert.equal(config.provider, 'resend');
  assert.equal(config.apiKey, 're_event');
  assert.equal(config.from, 'minicamp <event@mail.nanocamp.club>');
});

test('defaultStream 决定不指定 stream 时用哪一套', () => {
  const raw = {
    mail: {
      provider: 'resend',
      apiKey: 're_shared',
      defaultStream: 'notice',
      streams: { notice: { from: 'NanoCamp <notice@mail.nanocamp.club>' } }
    }
  };
  assert.equal(resolveMail(raw).from, 'NanoCamp <notice@mail.nanocamp.club>');
});

test('未知 stream 回退到顶层，而不是报错或静默乱发', () => {
  const raw = { mail: { provider: 'resend', apiKey: 're_shared', from: 'NanoCamp <captcha@mail.nanocamp.club>' } };
  const config = resolveMail(raw, 'typo');
  assert.equal(config.from, 'NanoCamp <captcha@mail.nanocamp.club>');
  assert.equal(config.apiKey, 're_shared');
  assert.equal(config.stream, 'typo', 'stream 名称仍要保留，便于日志定位');
});

test('baseUrl 结尾斜杠会被归一化', () => {
  assert.equal(resolveMail({ mail: { baseUrl: 'https://nanocamp.club///' } }).baseUrl, 'https://nanocamp.club');
});

test('stream 只换发件人时，密钥沿用顶层那把', () => {
  const raw = { mail: { provider: 'resend', apiKey: 're_top_key', streams: { auth: { from: 'NanoCamp <donotreply@mail.nanocamp.club>' } } } };
  const config = resolveMail(raw, 'auth');
  assert.equal(config.apiKey, 're_top_key');
  assert.equal(config.from, 'NanoCamp <donotreply@mail.nanocamp.club>');
});

test('未知字段会出现在 warnings 里，不静默忽略', () => {
  const config = resolveMail({ mail: { provider: 'resend', apiKey: 're_ok', apikey: 're_typo' } });
  assert.ok(config.warnings.some(warning => warning.includes('mail.apikey')), '应点名写错的字段');
  assert.equal(config.apiKey, 're_ok');
});

test('占位符密钥与「resend 却没有密钥」都会提前告警', () => {
  const placeholder = resolveMail({ mail: { provider: 'resend', apiKey: 're_shared_key' } });
  assert.ok(placeholder.warnings.some(warning => warning.includes('不像 Resend 的真实 Key')));

  const missing = resolveMail({ mail: { provider: 'resend' } });
  assert.ok(missing.warnings.some(warning => warning.includes('没有 apiKey')));
});

test('配置在进程内只读一次（之后的调用复用同一对象）', () => {
  const first = loadConfig();
  assert.equal(loadConfig(), first, '应复用同一个缓存对象，不再每次 readFileSync');
  assert.equal(loadConfig().mail?.provider, first.mail?.provider, '内容一致');
});
