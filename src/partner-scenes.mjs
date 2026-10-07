import { esc, logoMark } from './components.mjs';

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const marks = [
  null,
  '<path d="m17 11-12 13 12 13m14-26 12 13-12 13M28 6l-8 36"/>',
  '<rect x="4" y="8" width="26" height="26" rx="3"/><rect x="18" y="16" width="26" height="26" rx="3"/>',
  '<path d="M10 14v20m28-20v20M10 24h28"/><circle cx="10" cy="9" r="5"/><circle cx="38" cy="39" r="5"/>',
];
const captions = new Map([
  ['minicamp 年度黑客松', ['minicamp', '年度黑客松']],
  ['技术分享与工作坊', ['技术分享', '一起动手的工作坊']],
  ['校园与社群联动', ['校园联动', '学校、社团与社区']],
  ['产品体验与开源共创', ['开源共创', '产品体验与真实问题']],
]);

export function ideasScene(formats) {
  const cards = formats.map((item, index) => {
    const [title, detail] = captions.get(item.name) || [item.name, '交流合作'];
    const mark = marks[index % 4];
    return `<div class="idea-paper idea-paper--${index % 4}${index === 0 ? ' is-active' : ''}" data-idea-paper="${index}" style="--paper-angle:${[-7, 6, -3, 9][index % 4]}deg;--paper-order:${formats.length - index}">
      ${mark ? `<svg class="idea-paper-mark" viewBox="0 0 48 48" fill="none">${mark}</svg>` : ''}<span class="idea-paper-print${index === 0 ? ' idea-paper-latin' : ''}">${esc(title)}</span><span class="idea-paper-detail">${esc(detail)}</span><span class="idea-paper-foot">NanoCamp${arrow}</span>
    </div>`;
  }).join('');
  return `<div class="partner-scene partner-ideas"><div class="idea-deck" aria-hidden="true">${cards}</div><nav class="idea-nav" aria-label="选择合作形式">${formats.map((item, index) => `<a href="#collab-format-${index}" data-idea-nav="${index}"${index === 0 ? ' aria-current="location"' : ''}><i aria-hidden="true"></i>${esc((captions.get(item.name) || [item.name])[0])}</a>`).join('')}</nav></div>`;
}

export function photoAlbumScene() {
  return `<div class="partner-scene partner-album">
    <a class="partner-photo partner-photo--people" href="/minicamp/" aria-label="回看首届 minicamp" style="--photo-angle:-8deg"><img src="/images/minicamp-group-photo.jpg" width="2200" height="1467" alt="首届 minicamp 参与者的现场合影" loading="lazy" decoding="async"><span>首届 minicamp${arrow}</span></a>
    <a class="partner-photo partner-photo--work" href="/projects/build-to-taste-light-of-yuelu/" aria-label="查看选手作品 Build to Taste" style="--photo-angle:7deg"><img src="/images/projects/build-to-taste-light-of-yuelu.jpg" width="1600" height="700" alt="选手作品 Build to Taste：报寝助手与麓光" loading="lazy" decoding="async"><span>一起做出的作品${arrow}</span></a>
    <span class="album-tape" aria-hidden="true"></span><span class="album-sticker" aria-hidden="true">${logoMark('symbol', '', true)}</span>
  </div>`;
}

export function puzzleScene() {
  return `<a class="partner-scene partner-puzzle" href="#contact" aria-label="带来你的支持，从一封信开始">
    <svg class="puzzle-art" viewBox="0 0 276 230" aria-hidden="true">
      <g class="puzzle-fixed"><path class="puzzle-piece puzzle-piece--blue" d="M24 28H112V56C85 50 85 88 112 82V112H84C90 139 52 139 58 112H24Z"/><text x="68" y="76" text-anchor="middle">技术</text><path class="puzzle-piece puzzle-piece--mint" d="M112 28H212V56C239 50 239 88 212 82V112H183C189 139 151 139 157 112H112V82C85 88 85 50 112 56Z"/><text x="164" y="76" text-anchor="middle">保障</text></g>
      <g class="puzzle-waiting"><path class="puzzle-piece puzzle-piece--lilac" d="M24 112H58C52 139 90 139 84 112H157C151 139 189 139 183 112H212V196H24Z"/><text x="119" y="168" text-anchor="middle">伙伴连接</text></g>
    </svg><span class="puzzle-link-label">从一封信开始${arrow}</span>
  </a>`;
}
