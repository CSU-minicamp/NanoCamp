import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {stripMetadata} from '../backend/avatar/metadata.mjs';

// 无数据库：只验证「剥元数据不动像素」这件事本身。
// 每张图都造出带元数据的版本，剥完既要比像素一致，也要比元数据确实没了。

const pixels = buffer => sharp(buffer, {animated: false}).raw().toBuffer();

test('JPEG：去掉 EXIF，像素与压缩数据一字不差', async () => {
  const clean = await sharp({create: {width: 40, height: 30, channels: 3, background: '#618ae3'}}).jpeg({quality: 92}).toBuffer();
  const tagged = await sharp(clean).withExif({IFD0: {Copyright: 'NanoCamp', Software: 'secret-camera'}}).toBuffer();
  assert.ok((await sharp(tagged).metadata()).exif, '前置条件：确实带 EXIF');

  const stripped = stripMetadata(tagged, 'jpeg');
  assert.ok(stripped.length < tagged.length, '元数据段应被删掉');
  assert.equal((await sharp(stripped).metadata()).exif, undefined, 'EXIF 应被清空');
  assert.deepEqual(await pixels(stripped), await pixels(tagged), '像素必须完全一致');
  // 压缩数据没重写：剥完的字节应当是原文件的子序列
  assert.ok(tagged.includes(stripped.subarray(2)), 'SOS 之后的压缩数据应原样保留');
});

test('PNG：去掉 eXIf 与文本块，像素不变', async () => {
  const plain = await sharp({create: {width: 24, height: 24, channels: 3, background: '#79c8ab'}}).png().toBuffer();
  const text = Buffer.from('Software\0secret-camera');
  const chunk = Buffer.alloc(12 + text.length);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + text.length)), 8 + text.length);
  const iend = plain.length - 12;
  const tagged = Buffer.concat([plain.subarray(0, iend), chunk, plain.subarray(iend)]);
  assert.ok(tagged.includes(Buffer.from('tEXt')), '前置条件：确实插入了 tEXt');

  const stripped = stripMetadata(tagged, 'png');
  assert.equal(stripped.includes(Buffer.from('tEXt')), false, 'tEXt 应被删掉');
  assert.ok(stripped.includes(Buffer.from('IEND')), '结构应仍然完整');
  assert.deepEqual(await pixels(stripped), await pixels(tagged), '像素必须完全一致');
});

test('WebP：去掉 EXIF 块并清掉 VP8X 标记位', async () => {
  const plain = await sharp({create: {width: 32, height: 32, channels: 3, background: '#e0a03a'}}).webp().toBuffer();
  const tagged = await sharp(plain).withExif({IFD0: {Copyright: 'NanoCamp'}}).toBuffer();
  assert.ok(tagged.includes(Buffer.from('EXIF')), '前置条件：确实带 EXIF 块');

  const stripped = stripMetadata(tagged, 'webp');
  assert.equal(stripped.includes(Buffer.from('EXIF')), false, 'EXIF 块应被删掉');
  const vp8x = stripped.indexOf(Buffer.from('VP8X'));
  if(vp8x >= 0)
    assert.equal(stripped[vp8x + 8] & 0x08, 0, 'VP8X 的 EXIF 标记位要清零');
  // RIFF 长度必须与实际字节对得上，否则解码器会截断
  assert.equal(stripped.readUInt32LE(4), stripped.length - 8, 'RIFF 长度应重算');
  assert.deepEqual(await pixels(stripped), await pixels(tagged), '像素必须完全一致');
});

test('GIF：去掉注释扩展，动画与像素不变', async () => {
  const plain = await sharp({create: {width: 16, height: 16, channels: 3, background: '#3a7ae0'}}).gif().toBuffer();
  const comment = Buffer.concat([Buffer.from([0x21, 0xFE, 0x0B]), Buffer.from('secret-cam!', 'latin1'), Buffer.from([0x00])]);
  const trailer = plain.length - 1;
  const tagged = Buffer.concat([plain.subarray(0, trailer), comment, plain.subarray(trailer)]);
  assert.ok(tagged.includes(Buffer.from('secret-cam!')), '前置条件：确实插入了注释');

  const stripped = stripMetadata(tagged, 'gif');
  assert.equal(stripped.includes(Buffer.from('secret-cam!')), false, '注释扩展应被删掉');
  assert.equal(stripped[stripped.length - 1], 0x3B, '结尾仍应是 trailer');
  assert.deepEqual(await pixels(stripped), await pixels(tagged), '像素必须完全一致');
});

test('没有元数据的文件原样返回（一个字节都不改）', async () => {
  const jpeg = await sharp({create: {width: 12, height: 12, channels: 3, background: '#ffffff'}}).jpeg().toBuffer();
  assert.equal(stripMetadata(jpeg, 'jpeg'), jpeg, '没有可删的段时应返回同一个 Buffer');
});

test('结构损坏的文件原样返回，不截断', async () => {
  const broken = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00]), Buffer.alloc(8, 0x41)]);
  assert.deepEqual(stripMetadata(broken, 'jpeg'), broken);
});

/** PNG 块 CRC（只给测试造块用）。 */
function crc32(buffer){
  let crc = 0xFFFFFFFF;
  for(const byte of buffer){
    crc ^= byte;
    for(let bit = 0; bit < 8; bit++)
      crc = crc & 1? (crc >>> 1) ^ 0xEDB88320: crc >>> 1;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
