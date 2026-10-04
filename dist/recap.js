(() => {
  const nav=document.querySelector('[data-recap-nav]');
  if(!nav) return;
  const header=document.querySelector('.site-header');
  const links=[...nav.querySelectorAll('.recap-nav-links a')];
  const sections=links.map(link=>document.getElementById(link.hash.slice(1)));
  let frame=0;
  function paint() {
    frame=0;
    if(document.hidden) return;
    const headerHeight=header.getBoundingClientRect().height;
    const navHeight=nav.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--recap-header',headerHeight+'px');
    document.documentElement.style.setProperty('--recap-offset',(headerHeight+navHeight)+'px');
    const line=headerHeight+navHeight+30;
    let current=0;
    sections.forEach((section,i)=>{if(section && section.getBoundingClientRect().top<=line)current=i;});
    links.forEach((link,i)=>{if(i===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  }
  function schedule() {if(!frame && !document.hidden)frame=requestAnimationFrame(paint);}
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('hashchange',schedule);
  if('ResizeObserver' in window) {const resize=new ResizeObserver(schedule);resize.observe(header);resize.observe(nav);resize.observe(document.body);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();});
  schedule();
})();