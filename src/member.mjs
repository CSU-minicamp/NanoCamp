// 成员公开主页（`/user/<uid>/`）：**任何人都能看的那一页**。
//
// 和 src/profile.mjs 的分工：
//   /profile/      只给本人看，邮箱、资料完整度都在那里；
//   /user/<uid>/   公开页，只有昵称、一句话介绍、加入时间 —— 邮箱这类东西一律不出现。
//
// 所以这个模块只接收「可以公开的列」（backend/auth.mjs 的 findPublicUser），
// 不接收 users 整行：以后有人想在页面里加邮箱，得先改那个查询，不会顺手漏出去。
//
// owner 决定要不要给「编辑资料」入口：本人点它去 /profile/，别人看不到这个按钮。
import {esc, documentPage, accountAvatar} from './components.mjs';
import {isNoindex} from './seo.mjs';

/** 成员编号：从 uid 推出来的展示用编号，不是另一个标识。 */
const memberNo = id => `NC-${String(id).padStart(3, '0')}`;

/**
 * 加入时间拆成年月：页面上有两种写法（中文给读者、数字给 mono 标签）。
 * @param {Date|string|null} value created_at。
 * @returns {{year: string, month: string}} 年月；取不到时为「——」。
 */
function joinedParts(value){
  const date = value instanceof Date? value: new Date(value || '');
  if(Number.isNaN(date.getTime()))
    return {year: '——', month: '——'};
  return {year: String(date.getUTCFullYear()), month: String(date.getUTCMonth() + 1).padStart(2, '0')};
}

/** 昵称缺省时的显示名（老账号可能还没填，公开页不该出现空白标题）。 */
const displayName = user => String(user.nickname || '').trim() || '新伙伴';

/**
 * 公开主页的正文。
 * @param {object} user 公开资料（id / nickname / bio / joinedAt）。
 * @param {object} [options] 参数。
 * @param {boolean} [options.owner] 当前访问者是不是本人。
 * @returns {string} 页面 HTML。
 */
export function memberView(user, {owner = false} = {}){
  const name = displayName(user);
  const joined = joinedParts(user.joinedAt);
  const joinedText = joined.year === '——'? '还不清楚': `${joined.year} 年 ${Number(joined.month)} 月`;
  return `<section class="member-page container" aria-labelledby="member-name">
  <div class="member-sheet">
    <div class="member-strip" aria-hidden="true"><span class="mono">NANOCAMP MEMBER</span><span class="mono">${esc(memberNo(user.id))}</span></div>
    <div class="member-main">
      <div class="member-portrait"><span class="member-avatar" aria-hidden="true">${accountAvatar(user.id)}</span></div>
      <div class="member-copy">
        <span class="member-kicker">MEMBER SINCE ${esc(joined.year)}.${esc(joined.month)}</span>
        <h1 class="member-name" id="member-name">${esc(name)}</h1>
        <p class="member-bio">${user.bio? esc(user.bio): '<span class="member-empty">还没有写介绍，先把想法攒着。</span>'}</p>
        <dl class="member-facts">
          <div><dt>成员编号</dt><dd>${esc(memberNo(user.id))}</dd></div>
          <div><dt>加入时间</dt><dd>${esc(joinedText)}</dd></div>
        </dl>
        ${owner? '<a class="button button-primary member-edit" href="/profile/"><span class="button-label">编辑资料</span><span class="button-plus" aria-hidden="true">+</span></a>': `<p class="member-guest-note">这是${esc(name)}的公开主页，只展示公开资料。</p>`}
      </div>
    </div>
  </div>
</section>`;
}

/**
 * 公开主页的完整文档。
 * @param {object} user 公开资料。
 * @param {object} [options] 参数。
 * @param {boolean} [options.owner] 当前访问者是不是本人。
 * @returns {string} 完整 HTML。
 */
export function renderMember(user, options = {}){
  const name = displayName(user);
  return documentPage({
    title: `${name} · NanoCamp 成员主页`,
    description: `${name} 在 NanoCamp 的公开主页：一句话介绍、加入时间与成员编号。`,
    route: `/user/${user.id}/`,
    active: 'user',
    // 成员主页默认不收录（不在 seo.mjs 的白名单里）；哪天要收录，只改那一处。
    noindex: isNoindex(`/user/${user.id}/`),
    body: memberView(user, options)
  });
}
