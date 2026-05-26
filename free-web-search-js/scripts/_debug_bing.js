#!/usr/bin/env node
/**
 * 调试：看Bing CN返回的原始搜索结果是什么
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const query = '今日黄金价格';
console.log('Query:', query);

const url = 'https://cn.bing.com/search?' + new URLSearchParams({ q: query });
console.log('URL:', url);

const r = await fetch(url, {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
  redirect: 'follow',
});

console.log('Status:', r.status);
const html = await r.text();
console.log('HTML length:', html.length);

// 提取结果
const { load } = await import('cheerio');
const $ = load(html);

const results = [];
$('li.b_algo').each((i, el) => {
  const $el = $(el);
  const $a = $el.find('h2 a');
  if (!$a.length) return;
  const title = $a.text().trim();
  const href = $a.attr('href') || '';
  const snippet = $el.find('.b_caption p').text().trim();
  
  results.push({
    index: i + 1,
    title: title.slice(0, 60),
    href: href.slice(0, 80),
    snippet: snippet.slice(0, 60)
  });
});

console.log('\\n=== Bing CN Results ===');
results.slice(0, 10).forEach(r => {
  console.log(`${r.index}. ${r.title}`);
  console.log(`   href: ${r.href}`);
  console.log(`   snippet: ${r.snippet}`);
  console.log('');
});

// 检查第一页内容里有没有金投网
const hasCngold = html.includes('cngold.org') || html.includes('金投网');
const hasSina = html.includes('finance.sina') || html.includes('新浪财经');
console.log('HTML contains cngold.org/金投网:', hasCngold);
console.log('HTML contains finance.sina/新浪财经:', hasSina);
