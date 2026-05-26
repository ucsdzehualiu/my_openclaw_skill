#!/usr/bin/env node
/**
 * 测试：Playwright拿cookie → fetch带cookie搜Bing
 */
const { chromium } = await import('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

// Step 1: Playwright拿cookie
console.log('Step 1: Playwright拿cookie...');
const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const context = await browser.newContext({
  userAgent: UA,
  locale: 'zh-CN',
  viewport: { width: 1920, height: 1080 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
});

const page = await context.newPage();
await page.goto('https://cn.bing.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);

const cookies = await context.cookies('https://cn.bing.com');
const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
console.log(`拿到 ${cookies.length} 个cookie，总长 ${cookieStr.length}`);

await browser.close();

// Step 2: fetch带cookie搜Bing
console.log('\nStep 2: fetch带cookie搜索...');
const r = await fetch('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie': cookieStr,
  },
  redirect: 'follow',
  signal: AbortSignal.timeout(10000),
});

const html = await r.text();
console.log('Status:', r.status, 'HTML:', html.length);

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
