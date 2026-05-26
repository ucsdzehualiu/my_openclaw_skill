#!/usr/bin/env node
/**
 * 用Playwright真实浏览器搜Bing CN，看结果是否不同
 */
const { chromium } = await import('playwright');

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
});

// 访问Bing CN搜索
const query = '今日黄金价格';
console.log('Navigating to Bing CN...');
await page.goto('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
  waitUntil: 'domcontentloaded', timeout: 15000,
});
await page.waitForTimeout(2000);

const results = await page.evaluate(() => {
  const items = [];
  document.querySelectorAll('li.b_algo').forEach(el => {
    const a = el.querySelector('h2 a');
    if (a) items.push({
      title: a.textContent.trim().slice(0, 60),
      url: a.href,
      snippet: el.querySelector('.b_caption p')?.textContent?.trim().slice(0, 60) || '',
    });
  });
  return items;
});

const html = await page.content();
console.log('\n含金投网:', html.includes('cngold'));
console.log('含新浪:', html.includes('finance.sina'));
console.log('含十六番:', html.includes('16fan'));

console.log('\n前10条:');
results.slice(0, 10).forEach((r, i) => {
  console.log(`  ${i+1}. ${r.title}`);
  console.log(`     ${r.url}`);
});

await browser.close();
