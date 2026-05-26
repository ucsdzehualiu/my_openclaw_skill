#!/usr/bin/env node
/**
 * 测试：Playwright拿cookie → fetch带cookie + form=QBLH参数搜Bing
 */
const { chromium } = await import('playwright');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

// Step 1: Playwright拿cookie
console.log('Step 1: Playwright拿cookie...');
const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const context = await browser.newContext({
  userAgent: UA, locale: 'zh-CN', viewport: { width: 1920, height: 1080 },
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
console.log(`拿到 ${cookies.length} 个cookie`);
await browser.close();

// Step 2: fetch带cookie + 不同URL参数组合
const tests = [
  ['cookie + form=QBLH', `https://cn.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`],
  ['cookie + form=QBLH + cvid', `https://cn.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH&sp=-1&lq=0&pq=&sc=12-0&qs=n&sk=&cvid=${crypto.randomUUID().replace(/-/g,'').slice(0,32)}`],
  ['cookie + FORM=R5FD1', `https://cn.bing.com/search?q=${encodeURIComponent(query)}&FORM=R5FD1`],
  ['cookie only', `https://cn.bing.com/search?q=${encodeURIComponent(query)}`],
  ['no cookie + form=QBLH', `https://cn.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`],
];

for (const [label, url] of tests) {
  const useCookie = !label.startsWith('no cookie');
  try {
    const headers = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
    if (useCookie) headers['Cookie'] = cookieStr;
    
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const html = await r.text();
    const { load } = await import('cheerio');
    const $ = load(html);
    const results = [];
    $('li.b_algo').each((i, el) => {
      const $a = $(el).find('h2 a');
      if ($a.length) results.push($a.text().trim().slice(0, 50));
    });
    
    console.log(`\n=== ${label} ===`);
    console.log(`含金投网: ${html.includes('cngold')}, 含十六番: ${html.includes('16fan')}`);
    console.log(`前3: ${results.slice(0, 3).join(' | ')}`);
  } catch (e) {
    console.log(`\n=== ${label} === FAILED: ${e.message}`);
  }
}
