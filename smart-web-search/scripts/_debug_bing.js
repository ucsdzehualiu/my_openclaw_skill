#!/usr/bin/env node
/**
 * 调试脚本：测试 Bing CN 搜索，输出页面截图和 HTML
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import querystring from 'querystring';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const PAGE_COMPAT_INIT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
};

async function main() {
  const query = process.argv[2] || 'Python';
  console.log(`测试查询: "${query}"\n`);

  const browser = await chromium.launch({ headless: false }); // 非 headless 方便观察
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  await context.addInitScript(PAGE_COMPAT_INIT);
  const page = await context.newPage();

  // 访问首页
  console.log('1. 访问 Bing 首页...');
  await page.goto('https://cn.bing.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  // 搜索框提交
  console.log('2. 搜索框提交...');
  const searchBox = await page.$('#sb_form_q');
  if (searchBox) {
    await searchBox.click();
    await searchBox.fill(query);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 25000 });
    await page.waitForTimeout(2000);
  } else {
    console.log('   搜索框未找到，直接跳转搜索结果页');
    await page.goto('https://cn.bing.com/search?' + querystring.stringify({ q: query }), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000);
  }

  // 截图
  const screenshotPath = path.resolve(__dirname, '..', 'debug_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`3. 截图保存: ${screenshotPath}`);

  // 提取结果
  console.log('4. 提取搜索结果...');
  const results = await page.evaluate(() => {
    const items = [];

    // 主结果
    const algoItems = document.querySelectorAll('li.b_algo');
    console.log(`   找到 li.b_algo: ${algoItems.length} 个`);
    algoItems.forEach(el => {
      const a = el.querySelector('h2 a');
      if (a) items.push({ title: a.textContent.trim(), url: a.href });
    });

    // 备选：其他链接
    if (items.length === 0) {
      console.log('   li.b_algo 为空，尝试其他选择器...');
      document.querySelectorAll('li.b_ans, li.b_vList, li.b_entityTP').forEach(el => {
        el.querySelectorAll('a[href]').forEach(a => {
          if (a.href && a.href.startsWith('http') && !a.href.includes('bing.com')) {
            items.push({ title: a.textContent.trim().slice(0, 80), url: a.href });
          }
        });
      });
    }

    // 输出页面上所有 <li> 的 class
    const allLi = Array.from(document.querySelectorAll('li')).slice(0, 20);
    console.log(`   前20个 <li> 的 class:`);
    allLi.forEach((li, i) => {
      console.log(`     [${i}] ${li.className || '(无class)'}`);
    });

    return items;
  });

  console.log(`\n找到 ${results.length} 条结果:`);
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title}`);
    console.log(`     ${r.url}`);
  });

  // 保存 HTML
  const html = await page.content();
  const htmlPath = path.resolve(__dirname, '..', 'debug_page.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`\n5. HTML 保存: ${htmlPath}`);

  await browser.close();
}

main().catch(console.error);
