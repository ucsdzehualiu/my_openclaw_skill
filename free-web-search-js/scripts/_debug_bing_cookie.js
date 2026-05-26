#!/usr/bin/env node
/**
 * 用undici的Agent + cookie支持测试Bing CN
 * Node.js 24 内置undici，可以用setGlobalDispatcher带cookie
 */
import { Agent, setGlobalDispatcher, fetch } from 'undici';

// 用带cookie的dispatcher
const agent = new Agent({ connect: { rejectUnauthorized: true } });
setGlobalDispatcher(agent);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

// 手动管理cookie
const cookies = new Map();

function extractCookies(response, url) {
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const [kv] = c.split(';');
    const [k, ...v] = kv.split('=');
    cookies.set(k.trim(), v.join('='));
  }
}

function cookieHeader(url) {
  if (cookies.size === 0) return '';
  return Array.from(cookies.entries()).map(([k,v]) => `${k}=${v}`).join('; ');
}

// Step 1: 访问Bing首页拿cookie
console.log('Step 1: 访问 cn.bing.com 首页...');
const homeR = await fetch('https://cn.bing.com/', {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
  redirect: 'follow',
  signal: AbortSignal.timeout(5000),
});
const homeHtml = await homeR.text();
extractCookies(homeR, 'https://cn.bing.com');
console.log('首页 status:', homeR.status);
console.log('Cookie:', cookieHeader('https://cn.bing.com').slice(0, 100));

// Step 2: 带cookie搜索
console.log('\nStep 2: 带cookie搜索...');
const searchR = await fetch('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie': cookieHeader('https://cn.bing.com'),
  },
  redirect: 'follow',
  signal: AbortSignal.timeout(10000),
});
const html = await searchR.text();
extractCookies(searchR, 'https://cn.bing.com');

const { load } = await import('cheerio');
const $ = load(html);

const results = [];
$('li.b_algo').each((i, el) => {
  const $a = $(el).find('h2 a');
  if ($a.length) results.push({ title: $a.text().trim().slice(0, 60), url: $a.attr('href') });
});

console.log('\n含金投网:', html.includes('cngold'));
console.log('含新浪:', html.includes('finance.sina'));
console.log('含十六番:', html.includes('16fan'));
console.log('\n前5条:');
results.slice(0, 5).forEach((r, i) => console.log(`  ${i+1}. ${r.title}\n     ${r.url?.slice(0, 80)}`));
