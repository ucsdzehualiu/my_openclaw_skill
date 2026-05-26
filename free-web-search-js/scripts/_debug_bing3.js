#!/usr/bin/env node
/**
 * 用undici的cookie jar测试Bing CN搜索
 * 看带cookie后结果是否不同
 */
import pkg from 'undici';
const { CookieJar, fetch: undiciFetch } = pkg;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

const jar = new CookieJar();

// Step 1: 访问Bing首页，让cookie jar收集cookie
console.log('Step 1: 访问 cn.bing.com 首页...');
const homeR = await undiciFetch('https://cn.bing.com/', {
  headers: { 'User-Agent': UA, 'Accept': 'text/html' },
  redirect: 'follow',
  signal: AbortSignal.timeout(5000),
}, { dispatcher: jar });
console.log('首页 status:', homeR.status);

// 看cookie jar里有什么
const cookies = await jar.getCookies('https://cn.bing.com');
console.log('Cookie数量:', cookies.length);
cookies.forEach(c => console.log(`  ${c.key}=${String(c.value).slice(0, 30)}...`));

// Step 2: 带cookie搜索
console.log('\nStep 2: 带cookie搜索...');
const searchR = await undiciFetch('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
  redirect: 'follow',
  signal: AbortSignal.timeout(10000),
}, { dispatcher: jar });

const html = await searchR.text();
console.log('搜索 status:', searchR.status, 'HTML:', html.length, 'bytes');

const { load } = await import('cheerio');
const $ = load(html);

const results = [];
$('li.b_algo').each((i, el) => {
  const $a = $(el).find('h2 a');
  if ($a.length) results.push($a.text().trim().slice(0, 60));
});

console.log('\n含金投网:', html.includes('cngold'));
console.log('含新浪:', html.includes('finance.sina'));
console.log('含十六番:', html.includes('16fan'));
console.log('\n前5条:');
results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
