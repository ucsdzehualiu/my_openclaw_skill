#!/usr/bin/env node
/**
 * 用Playwright搜百度，看结果
 */
const { chromium } = await import('playwright');

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
});

// 先访问百度首页
await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
await page.waitForTimeout(1000);

// 搜索
const query = '今日黄金价格';
console.log('Baidu search:', query);
await page.goto('https://www.baidu.com/s?wd=' + encodeURIComponent(query), {
  waitUntil: 'domcontentloaded', timeout: 15000,
});
await page.waitForTimeout(2000);

const results = await page.evaluate(() => {
  const items = [];
  document.querySelectorAll('.result h3 a, .c-container h3 a').forEach(a => {
    items.push({
      title: a.textContent.trim().slice(0, 60),
      href: a.href,
    });
  });
  return items;
});

const html = await page.content();
console.log('\n含金投网:', html.includes('cngold'));
console.log('含新浪:', html.includes('finance.sina'));
console.log('含十六番:', html.includes('16fan'));
console.log('含kekegold:', html.includes('kekegold'));

console.log('\n前10条:');
results.slice(0, 10).forEach((r, i) => {
  console.log(`  ${i+1}. ${r.title}`);
  console.log(`     ${r.href.slice(0, 80)}`);
});

await browser.close();
