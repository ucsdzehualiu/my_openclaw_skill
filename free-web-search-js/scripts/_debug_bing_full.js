#!/usr/bin/env node
/**
 * 排查Bing CN结果差异：
 * 1. 编码问题（URL编码 vs UTF-8）
 * 2. Cookie问题（先访问首页拿cookie）
 * 3. 反爬问题（Playwright加强伪装）
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

// ===== Test 1: 编码问题 =====
console.log('=== Test 1: 编码对比 ===');
const url1 = 'https://cn.bing.com/search?q=' + encodeURIComponent(query);
const url2 = 'https://cn.bing.com/search?q=' + query;  // 不编码，让fetch自动处理
console.log('encodeURIComponent:', url1);
console.log('raw UTF-8:', url2);
console.log('');

// ===== Test 2: 用Playwright加强伪装 =====
console.log('=== Test 2: Playwright加强伪装 ===');
const { chromium } = await import('playwright');

const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
  ],
});

const context = await browser.newContext({
  userAgent: UA,
  locale: 'zh-CN',
  viewport: { width: 1920, height: 1080 },
  // 模拟真实浏览器环境
  extraHTTPHeaders: {
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  },
});

// 注入反检测脚本
await context.addInitScript(() => {
  // 隐藏webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  // 添加chrome对象
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  // 修改permissions
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) => (
      params.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(params)
    );
  }
  // 修改plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
  // 修改languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });
});

const page = await context.newPage();

// 先访问Bing首页，让浏览器自然拿cookie
console.log('Step 1: 访问 cn.bing.com 首页...');
await page.goto('https://cn.bing.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);

// 检查cookie
const cookies = await context.cookies('https://cn.bing.com');
console.log('Cookie数量:', cookies.length);
cookies.forEach(c => console.log(`  ${c.name}=${c.value.slice(0, 30)}...`));

// Step 2: 在首页搜索框输入搜索（模拟真实用户行为）
console.log('\nStep 2: 在搜索框输入搜索...');
try {
  const searchBox = await page.$('#sb_form_q');
  if (searchBox) {
    await searchBox.click();
    await searchBox.fill(query);
    await page.waitForTimeout(500);
    // 按Enter搜索
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await page.waitForTimeout(3000);
    console.log('通过搜索框搜索成功');
  } else {
    console.log('搜索框未找到，直接URL搜索');
    await page.goto('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
    await page.waitForTimeout(3000);
  }
} catch (e) {
  console.log('搜索框搜索失败，fallback到URL:', e.message.slice(0, 50));
  await page.goto('https://cn.bing.com/search?q=' + encodeURIComponent(query), {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(3000);
}

// 提取结果
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
console.log('含汇率表:', html.includes('huilvbiao'));
console.log('含金价网:', html.includes('jinjia') || html.includes('94723'));
console.log('含kekegold:', html.includes('kekegold'));

console.log('\n前10条:');
results.slice(0, 10).forEach((r, i) => {
  console.log(`  ${i+1}. ${r.title}`);
  console.log(`     ${r.url?.slice(0, 80)}`);
});

// 检查当前URL
console.log('\n当前页面URL:', page.url());

await browser.close();
