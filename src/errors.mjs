import { eyebrow, pageLink } from './components.mjs';

// 401 与 404 的分工：404 是「地址不对」，401 是「身份不对」。
// 这一页只讲一件事 —— 这个位置只对本人开放，先登录再回来；不展示任何用户数据。
// 版式复用 missing-page 那套（三张纸 + 大字），所以不需要新增样式文件。
export function unauthorizedPage() {
  return `<section class="container missing-page unauthorized-page" aria-labelledby="unauthorized-title"><div class="missing-art" aria-hidden="true"><span>4</span><div class="missing-orbit"><i></i><b>0</b></div><span>1</span></div>${eyebrow('THIS PART IS ONLY FOR YOU.')}<h1 id="unauthorized-title">这里需要登录，<br>先确认一下<span class="blue-text">是你本人。</span></h1><p>账号资料、报名记录和没写完的草稿，只对本人开放。<br>登录之后会回到你刚才停留的地方。</p><div class="portal-actions">${pageLink('/login/', '去登录', 'missing-primary')}${pageLink('/', '回到首页')}</div><div class="missing-shortcuts"><a href="/community/">了解怎样加入 <span aria-hidden="true">↗</span></a><a href="/search/">站内搜索 <span aria-hidden="true">↗</span></a><a href="/faq/">常见问题 <span aria-hidden="true">↗</span></a></div></section>`;
}
