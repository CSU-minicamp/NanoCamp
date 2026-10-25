import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
const markdown=new MarkdownIt({html:false,linkify:false,typographer:false,breaks:true});
export const forumImagePath=/^\/api\/forum\/images\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
export function postImageSources(value){
  const sources=[];const visit=tokens=>{for(const token of tokens){if(token.type==='image')sources.push(token.attrGet('src'));if(token.children)visit(token.children);}};
  visit(markdown.parse(String(value),{}));return sources;
}
export function renderMarkdown(value='',{images=false}={}){
  return sanitizeHtml(markdown.render(String(value)),{
    allowedTags:['p','br','strong','em','s','blockquote','ul','ol','li','h1','h2','h3','h4','hr','pre','code','a','table','thead','tbody','tr','th','td',...(images?['img']:[])],
    allowedAttributes:{a:['href','rel'],code:['class'],img:['src','alt','loading','decoding']},allowedSchemes:['http','https','mailto'],allowProtocolRelative:false,
    transformTags:{a:(tag,attribs)=>({tagName:'a',attribs:{href:attribs.href||'',rel:'nofollow ugc noopener noreferrer'}}),img:(tag,a)=>forumImagePath.test(a.src||'')?{tagName:'img',attribs:{src:a.src,alt:a.alt||'',loading:'lazy',decoding:'async'}}:{tagName:'span',attribs:{}}}
  });
}
