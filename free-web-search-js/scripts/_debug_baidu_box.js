#!/usr/bin/env node
/**
 * 调试：看百度首页搜索框选择器
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
await page.goto('https://www.baidu.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);

// 列出所有input
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input')).map(el => ({
    id: el.id,
    name: el.name,
    type: el.type,
    className: el.className,
    placeholder: el.placeholder,
  }));
});
console.log('Inputs:', JSON.stringify(inputs, null, 2));

// 试搜索
const query = '今日黄金价格';
const searchBox = await page.$('#kw') || await page.$('input[name="wd"]');
if (searchBox) {
  console.log('找到搜索框:', await searchBox.evaluate(el => ({ id: el.id, name: el.name })));
  await searchBox.fill(query);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  await page.waitForTimeout(2000);
  
  const results = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.result h3 a, .c-container h3 a').forEach(a => {
      items.push(a.textContent.trim().slice(0, 50));
    });
    return items;
  });
  console.log('\n百度搜索结果前5条:');
  results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
} else {
  console.log('未找到搜索框');
}

await browser.close();
