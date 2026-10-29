// 剥掉图片里的元数据（EXIF / XMP / 注释 / 文本块），**不动像素**。
//
// 为什么自己写而不是让 sharp 重编码：这个项目对头像的承诺是「不压缩」。重编码哪怕 quality=100，
// JPEG 也是有损的、动图还得逐帧处理；而元数据本来就在容器的独立块里，摘掉它不影响任何像素，
// 也不需要重新计算压缩数据。四种格式都是这种方式：
//
//   JPEG  段结构（0xFF 标记 + 长度）      去掉 APP1（EXIF/XMP）、APP13（Photoshop）、COM（注释）
//   PNG   块结构（长度 + 类型 + CRC）     去掉 eXIf / tEXt / zTXt / iTXt
//   WebP  RIFF 块（4cc + 长度）          去掉 EXIF / XMP ，并清掉 VP8X 里的对应标记位
//   GIF   扩展块（0x21 + 标签）          去掉注释扩展、XMP 应用扩展
//
// 各格式都保留：ICC 色彩配置、Adobe APP14（决定 CMYK/YCCK 的颜色变换）、PNG 的 iCCP / pHYs / tIME、
// GIF 的 Netscape 循环块 —— 删了它们会改变显示效果或让动图不再循环。
//
// 解析失败（结构不完整、不是这四种格式）时**原样返回**，由调用方决定怎么处理：宁可留着元数据，
// 也不要把一张好好的图截断成坏文件。

/**
 * 按格式剥掉元数据块。
 * @param {Buffer} buffer 原始字节。
 * @param {string} format sharp 认出来的格式（jpeg / png / webp / gif）。
 * @returns {Buffer} 去掉元数据后的字节；无法解析时返回原 buffer。
 */
export function stripMetadata(buffer, format){
  if(!Buffer.isBuffer(buffer) || buffer.length < 12)
    return buffer;
  try{
    if(format === 'jpeg')
      return stripJpeg(buffer);
    if(format === 'png')
      return stripPng(buffer);
    if(format === 'webp')
      return stripWebp(buffer);
    if(format === 'gif')
      return stripGif(buffer);
  }
  catch{
    // 结构异常：保持原样，绝不让半截文件落库
  }
  return buffer;
}

/**
 * JPEG：从结构里摘掉 APP1（EXIF/XMP）、APP13（Photoshop 资源）、COM（注释）。
 * 走到 SOS（0xDA）就停 —— 后面是熵编码数据，原样拷到结尾，不碰。
 * @param {Buffer} buffer JPEG 字节。
 * @returns {Buffer} 处理后的字节。
 */
function stripJpeg(buffer){
  if(buffer[0] !== 0xFF || buffer[1] !== 0xD8)
    return buffer;
  const kept = [buffer.subarray(0, 2)];
  let dropped = false;
  let index = 2;
  while(index + 4 <= buffer.length){
    if(buffer[index] !== 0xFF)
      break;
    let marker = buffer[index + 1];
    // 标记前允许有若干个 0xFF 填充字节
    while(marker === 0xFF && index + 2 < buffer.length){
      index += 1;
      marker = buffer[index + 1];
    }
    // 无长度的独立标记（RSTn / SOI / TEM）
    if(marker === 0x01 || marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)){
      kept.push(buffer.subarray(index, index + 2));
      index += 2;
      continue;
    }
    // SOS 之后是压缩数据，整段拷走
    if(marker === 0xDA)
      break;
    const length = buffer.readUInt16BE(index + 2);
    const end = index + 2 + length;
    if(length < 2 || end > buffer.length)
      return buffer;
    const drop = marker === 0xE1 || marker === 0xED || marker === 0xFE;
    if(drop)
      dropped = true;
    else
      kept.push(buffer.subarray(index, end));
    index = end;
  }
  kept.push(buffer.subarray(index));
  return dropped? Buffer.concat(kept): buffer;
}

/**
 * PNG：去掉 eXIf（EXIF）、tEXt / zTXt / iTXt（文字块，常带软件名与作者）。
 * 其余块原样保留 —— 删块不需要重算其它块的 CRC。
 * @param {Buffer} buffer PNG 字节。
 * @returns {Buffer} 处理后的字节。
 */
function stripPng(buffer){
  if(buffer.readUInt32BE(0) !== 0x89504E47)
    return buffer;
  const drop = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
  const kept = [buffer.subarray(0, 8)];
  let dropped = false;
  let index = 8;
  while(index + 12 <= buffer.length){
    const length = buffer.readUInt32BE(index);
    const type = buffer.toString('latin1', index + 4, index + 8);
    const end = index + 12 + length;
    if(end > buffer.length)
      return buffer;
    if(drop.has(type))
      dropped = true;
    else
      kept.push(buffer.subarray(index, end));
    index = end;
    if(type === 'IEND')
      break;
  }
  kept.push(buffer.subarray(index));
  return dropped? Buffer.concat(kept): buffer;
}

/**
 * WebP：去掉 EXIF / XMP 块，并把 VP8X 里的「有 EXIF / 有 XMP」标记位清掉
 * （某些解码器会按标记位去找块，块没了却还标着会报错），最后重算 RIFF 总长度。
 * @param {Buffer} buffer WebP 字节。
 * @returns {Buffer} 处理后的字节。
 */
function stripWebp(buffer){
  if(buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP')
    return buffer;
  const chunks = [];
  let index = 12;
  while(index + 8 <= buffer.length){
    const id = buffer.toString('latin1', index, index + 4);
    const size = buffer.readUInt32LE(index + 4);
    const end = index + 8 + size + (size % 2);
    if(end > buffer.length)
      return buffer;
    chunks.push({id, start: index, end});
    index = end;
  }
  const kept = chunks.filter(chunk => chunk.id !== 'EXIF' && chunk.id !== 'XMP ');
  if(kept.length === chunks.length)
    return buffer;
  const body = kept.map(chunk => {
    const raw = buffer.subarray(chunk.start, chunk.end);
    if(chunk.id !== 'VP8X')
      return raw;
    const copy = Buffer.from(raw);
    copy[8] &= ~(0x08 | 0x04);   // bit3 = EXIF，bit2 = XMP
    return copy;
  });
  const payload = Buffer.concat(body);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(payload.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, payload]);
}

/**
 * GIF：去掉注释扩展（0x21 0xFE）与 XMP 应用扩展（0x21 0xFF 0x0B "XMP DataXMP"）。
 * Netscape 循环扩展要留着，否则动图只播一次。
 * @param {Buffer} buffer GIF 字节。
 * @returns {Buffer} 处理后的字节。
 */
function stripGif(buffer){
  const head = buffer.toString('latin1', 0, 6);
  if(head !== 'GIF89a' && head !== 'GIF87a')
    return buffer;
  const globalTable = buffer[10] & 0x80? 3 * (1 << ((buffer[10] & 0x07) + 1)): 0;
  const kept = [buffer.subarray(0, 13 + globalTable)];
  let dropped = false;
  let index = 13 + globalTable;
  while(index < buffer.length){
    const marker = buffer[index];
    if(marker === 0x3B){            // trailer
      kept.push(buffer.subarray(index));
      break;
    }
    if(marker === 0x2C){            // 图像块：跳过描述符 + LZW 子块
      let cursor = index + 10;
      cursor += 1;                  // LZW 最小码长
      while(cursor < buffer.length && buffer[cursor] !== 0)
        cursor += buffer[cursor] + 1;
      cursor += 1;
      kept.push(buffer.subarray(index, cursor));
      index = cursor;
      continue;
    }
    if(marker !== 0x21)             // 结构异常，剩下原样拷走
      break;
    const label = buffer[index + 1];
    let cursor = index + 2;
    while(cursor < buffer.length && buffer[cursor] !== 0)
      cursor += buffer[cursor] + 1;
    cursor += 1;
    const isXmp = label === 0xFF && buffer.toString('latin1', index + 3, index + 14) === 'XMP DataXMP';
    if(label === 0xFE || isXmp)
      dropped = true;
    else
      kept.push(buffer.subarray(index, cursor));
    index = cursor;
  }
  kept.push(buffer.subarray(index));
  return dropped? Buffer.concat(kept): buffer;
}
