#!/usr/bin/env node
/**
 * 调试：Bing搜索框输入中文后实际搜了什么
 */
const { chromium } = await import('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const context = await browser.newContext({ userAgent: UA, locale: 'zh-CN', viewport: { width: 1920, height: 1080 } });
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
});

const page = await context.newPage();
await page.goto('https://cn.bing.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);

// 输入搜索
const query = '怎么做红烧肉';
const searchBox = await page.$('#sb_form_q');
await searchBox.click();
await searchBox.fill(query);
await page.waitForTimeout(500);

// 看搜索框的值
const inputValue = await page.evaluate(() => document.getElementById('sb_form_q').value);
console.log('搜索框值:', inputValue);

// 按Enter
await page.keyboard.press('Enter');
await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
await page.waitForTimeout(2000);

// 看最终URL
console.log('最终URL:', page.url());

// 看结果
const results = await page.evaluate(() => {
  const items = [];
  document.querySelectorAll('li.b_algo').forEach(el => {
    const a = el.querySelector('h2 a');
    if (a) items.push(a.textContent.trim().slice(0, 50));
  });
  return items;
});

console.log('\n前5条:');
results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));

await browser.close();
