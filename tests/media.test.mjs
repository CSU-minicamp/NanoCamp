import test from 'node:test';
import assert from 'node:assert/strict';
import {media} from '../src/components.mjs';

test('a supplied preview links to its full-size image without JavaScript',()=>{
  const html=media({src:'/preview.jpg',fullSrc:'/original.jpg',caption:'合照',alt:'大家的合照'});
  assert.match(html,/<a class="media-open" href="\/original.jpg"/);
  assert.match(html,/<img src="\/preview.jpg"/);
  assert.match(html,/data-caption="合照"/);
});
test('missing images do not invent photo controls and invalid full-size URLs fall back',()=>{
  assert.doesNotMatch(media({src:null}),/data-lightbox/);
  assert.match(media({src:'/preview.jpg',fullSrc:'javascript:alert(1)'}),/href="\/preview.jpg"/);
  assert.doesNotMatch(media({src:'/preview.jpg',fullSrc:'javascript:alert(1)'}),/javascript:/);
});
test('image descriptions and project identifiers remain literal content',()=>{
  const html=media({src:'/preview.jpg',caption:'<img src=x onerror=alert(1)>',alt:'" onerror="test',kind:'project',id:'<script>alert(1)</script>'});
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/data-caption="&lt;img src=x onerror=alert\(1\)&gt;"/);
});