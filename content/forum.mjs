// 论坛的「词表」：分类名与举报理由。
//
// 放 content/ 而不是 backend/：这两份是**内容**，不是后端逻辑 ——
// 后端拿它们当白名单校验（帖子分类、举报理由必须命中），模板拿它们渲染（分类横条、举报弹窗）。
// 谁都不该为了借一个数组去 import 对方的实现文件，所以放在两边都认识的这一层。
export const categories = [{id: 'questions', name: '提问交流'}, {id: 'projects', name: '作品实践'}, {id: 'teams', name: '组队招募'}];

export const reportReasons = ['垃圾推广', '人身攻击或骚扰', '隐私泄露', '违法或不当内容', '其他'];
