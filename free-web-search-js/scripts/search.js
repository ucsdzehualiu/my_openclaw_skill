#!/usr/bin/env node
/**
 * free-web-search-js search.js v28.0
 *
 * 国内: Bing CN (Playwright 搜索框提交)
 * 海外: DDG HTML (纯 HTTP)
 * 搜完自动抓取 top N 结果内容
 */
import process from 'process';
import child_process from 'child_process';
import querystring from 'querystring';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, request as playwrightRequest } from 'playwright';
import { findBrowserExecutable, launchBrowser } from './playwright-support.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const ENDPOINT_FILE = path.resolve(SKILL_ROOT, '.browser-endpoint');

const DEFAULT_MAX = 10;
const DEFAULT_FETCH = 3;
const HTTP_TIMEOUT = 10000;
const PW_TIMEOUT = 25000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// ==================== 依赖 ====================
async function ensureDeps() {
  try { await import('cheerio'); } catch {
    child_process.execSync('npm install cheerio --silent', { stdio: 'inherit' });
  }
  try { await import('commander'); } catch {
    child_process.execSync('npm install commander --silent', { stdio: 'inherit' });
  }
}

// ==================== IP 检测 ====================
let _inChinaCache = null;
async function detectInChina() {
  if (_inChinaCache !== null) return _inChinaCache;

  const probes = [
    (async () => {
      for (const url of ['https://myip.ipip.net', 'https://cip.cc']) {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3000) });
          if (!r.ok) continue;
          const text = await r.text();
          if (/中国|CN/i.test(text)) {
            const ip = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)?.[1] ?? '?';
            return { inChina: true, label: `${ip} → CN` };
          }
        } catch {}
      }
      throw new Error('cn probe failed');
    })(),
    (async () => {
      for (const url of ['https://ipinfo.io/json', 'https://ipapi.co/json/']) {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3000) });
          if (!r.ok) continue;
          const d = await r.json();
          const cc = String(d.country || d.country_code || '').toUpperCase();
          if (!cc) continue;
          return { inChina: cc === 'CN', label: `${d.ip ?? '?'} → ${cc}` };
        } catch {}
      }
      throw new Error('intl probe failed');
    })(),
    (async () => {
      const r = await fetch('https://cn.bing.com', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3000), redirect: 'manual' });
      return { inChina: r.status === 200 || r.status === 302, label: `cn.bing.com → ${r.status}` };
    })(),
  ];

  try {
    const winner = await Promise.any(probes);
    console.error(`[地理] ${winner.label} → ${winner.inChina ? '国内' : '国外'}`);
    _inChinaCache = winner.inChina;
    return winner.inChina;
  } catch {
    console.error('[地理] 检测失败，默认国内');
    _inChinaCache = true;
    return true;
  }
}

// ==================== URL 处理 ====================
function decodeBingUrl(url) {
  if (!url?.includes('bing.com/ck/')) return url;
  try {
    const u = new URL(url).searchParams.get('u');
    if (!u) return url;
    const stripped = u.replace(/^a[0-9]/, '');
    const b64 = stripped + '='.repeat((4 - stripped.length % 4) % 4);
    const dec = Buffer.from(b64, 'base64').toString('utf-8');
    return dec.startsWith('http') ? dec : url;
  } catch { return url; }
}

function normalizeUrl(raw) {
  let url = clean(raw);
  if (!url) return url;
  url = decodeBingUrl(url);
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of ['utm_source','utm_medium','utm_campaign','gclid','fbclid','msclkid','spm','from','ref','src']) {
      u.searchParams.delete(k);
    }
    return u.toString();
  } catch { return url; }
}

async function resolveRedirectUrl(url, timeout = 6000) {
  if (!url) return url;
  if (!/sogou\.com\/link/i.test(url)) return url;
  try {
    const r = await fetch(url, {
      method: 'GET', headers: { 'User-Agent': UA },
      redirect: 'follow', signal: AbortSignal.timeout(timeout),
    });
    if (r.url && r.url.startsWith('http') && !/sogou\.com\/link/i.test(r.url)) {
      return r.url;
    }
    const text = await r.text();
    const jsMatch = text.match(/window\.location\.replace\s*\(\s*["']([^"']+)["']/);
    if (jsMatch) return jsMatch[1];
    const metaMatch = text.match(/URL\s*=\s*['"]([^'"]+)['"]/i);
    if (metaMatch) return metaMatch[1];
  } catch {}
  return url;
}

// ==================== Playwright 浏览器管理 ====================
const PAGE_COMPAT_INIT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) => (
      params.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(params)
    );
  }
};

let _browserInstance = null;

async function getBrowser() {
  if (_browserInstance) return _browserInstance;
  try {
    const info = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf-8'));
    process.kill(info.pid, 0);
    const browser = await chromium.connectOverCDP(info.wsEndpoint);
    _browserInstance = { browser, shared: true };
    return _browserInstance;
  } catch {}
  const browser = await launchBrowser({ headless: true });
  _browserInstance = { browser, shared: false };
  return _browserInstance;
}

async function closeBrowser() {
  if (!_browserInstance) return;
  try {
    if (_browserInstance.shared) _browserInstance.browser.disconnect();
    else await _browserInstance.browser.close();
  } catch {}
  _browserInstance = null;
}

// ==================== 搜索引擎 ====================

async function searchBingPW(query, max) {
  console.error(`[Bing:pw] ${query}`);
  const out = [], seen = new Set();
  const base = 'https://cn.bing.com';
  let context;
  try {
    const { browser } = await getBrowser();
    context = await browser.newContext({
      userAgent: UA,
      locale: 'zh-CN',
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    await context.addInitScript(PAGE_COMPAT_INIT);

    const page = await context.newPage();

    // 先访问首页拿 cookie
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);

    // 搜索框提交
    try {
      const searchBox = await page.$('#sb_form_q');
      if (searchBox) {
        await searchBox.click();
        await searchBox.fill(query);
        await page.waitForTimeout(300);
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: PW_TIMEOUT }),
          page.keyboard.press('Enter'),
        ]);
        await page.waitForTimeout(2000);
      } else {
        await page.goto(base + '/search?' + querystring.stringify({ q: query }), {
          waitUntil: 'domcontentloaded', timeout: PW_TIMEOUT,
        });
        await page.waitForTimeout(1500);
      }
    } catch {
      await page.goto(base + '/search?' + querystring.stringify({ q: query }), {
        waitUntil: 'domcontentloaded', timeout: PW_TIMEOUT,
      });
      await page.waitForTimeout(1500);
    }

    const results = await page.evaluate(() => {
      const items = [];
      const seen = new Set();
      const add = (title, url, snippet) => {
        if (title && url && url.startsWith('http') && !seen.has(url)) {
          seen.add(url);
          items.push({ title, url, snippet });
        }
      };

      // 1) 主结果：li.b_algo
      document.querySelectorAll('li.b_algo').forEach(el => {
        const a = el.querySelector('h2 a');
        if (!a) return;
        add(a.textContent.trim(), a.href, el.querySelector('.b_caption p')?.textContent?.trim() || '');
      });

      // 2) 答案卡片/知识面板里的链接（li.b_ans, li.b_vList, li.b_entityTP）
      if (items.length === 0) {
        document.querySelectorAll('li.b_ans, li.b_vList, li.b_entityTP, li.b_mop').forEach(el => {
          el.querySelectorAll('a[href]').forEach(a => {
            const href = a.href;
            // 跳过 Bing 内部链接
            if (!href || href.includes('bing.com') || href.includes('microsoft.com') || href.startsWith('javascript:')) return;
            add(a.textContent.trim().slice(0, 120), href, '');
          });
        });
      }

      return items;
    });
    for (const item of results) {
      const url = normalizeUrl(item.url);
      const title = clean(item.title);
      const snippet = clean(item.snippet);
      if (title && url && url.startsWith('http') && !seen.has(url.toLowerCase())) {
        seen.add(url.toLowerCase());
        out.push({ title, url, snippet });
      }
    }

    // 3) 0 结果时补词重试（强制出网页结果而非即时卡片）
    if (out.length === 0) {
      const suffixes = [' 网站', ' 详情', ' 介绍'];
      for (const suffix of suffixes) {
        const retryQuery = query + suffix;
        console.error(`[Bing:pw] 0条，补词重试: "${retryQuery}"`);
        try {
          await page.goto(base + '/search?' + querystring.stringify({ q: retryQuery }), {
            waitUntil: 'domcontentloaded', timeout: PW_TIMEOUT,
          });
          await page.waitForTimeout(1500);

          const retryResults = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('li.b_algo').forEach(el => {
              const a = el.querySelector('h2 a');
              if (!a) return;
              items.push({
                title: a.textContent.trim(),
                url: a.href || '',
                snippet: el.querySelector('.b_caption p')?.textContent?.trim() || '',
              });
            });
            return items;
          });
          for (const item of retryResults) {
            const url = normalizeUrl(item.url);
            const title = clean(item.title);
            const snippet = clean(item.snippet);
            if (title && url && url.startsWith('http') && !seen.has(url.toLowerCase())) {
              seen.add(url.toLowerCase());
              out.push({ title, url, snippet });
            }
          }
          if (out.length > 0) break;
        } catch {}
      }
    }

    console.error(`[Bing:pw] ${out.length} 条`);
  } catch (e) {
    console.error(`[Bing:pw] 错误: ${e.message.split('\n')[0]}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return out.slice(0, max);
}

async function searchSogouHttp(query, max) {
  console.error(`[搜狗:http] ${query}`);
  const out = [], seen = new Set();
  try {
    const url = 'https://www.sogou.com/web?' + querystring.stringify({ query });
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT), redirect: 'follow',
    });
    if (!r.ok) { console.error(`[搜狗:http] HTTP ${r.status}`); return out; }

    const html = await r.text();
    const { load } = await import('cheerio');
    const $ = load(html);

    const rawItems = [];
    $('.vrwrap, .rb').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('h3 a').first();
      if (!$a.length) return;
      const title = clean($a.text());
      let href = $a.attr('href') || '';
      if (href.startsWith('/link?')) href = 'https://www.sogou.com' + href;
      const snippet = clean($el.find('.str-text-info, .str_info').text());
      if (title && href) rawItems.push({ title, href, snippet });
    });

    const resolved = await Promise.all(rawItems.map(async (item) => ({ ...item, url: normalizeUrl(await resolveRedirectUrl(item.href)) })));
    for (const item of resolved) {
      if (item.url && item.url.startsWith('http') && !seen.has(item.url.toLowerCase())) {
        seen.add(item.url.toLowerCase());
        out.push({ title: item.title, url: item.url, snippet: item.snippet });
      }
    }
    console.error(`[搜狗:http] ${out.length} 条`);
  } catch (e) {
    console.error(`[搜狗:http] 错误: ${e.message.split('\n')[0]}`);
  }
  return out.slice(0, max);
}


async function fetchTextViaPlaywright(url, timeout = HTTP_TIMEOUT) {
  const api = await playwrightRequest.newContext({
    userAgent: UA,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  try {
    const r = await api.get(url, { timeout, maxRedirects: 5 });
    if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
    return await r.text();
  } finally {
    await api.dispose().catch(() => {});
  }
}

async function searchDDGHtml(query, max) {
  console.error(`[DDG:html] ${query}`);
  const out = [], seen = new Set();
  try {
    let html = '';
    try {
      const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT), redirect: 'follow',
      });
      if (!r.ok) { console.error(`[DDG:html] HTTP ${r.status}`); return out; }
      html = await r.text();
    } catch (e) {
      console.error(`[DDG:html] fetch 失败，改用 Playwright request: ${e.message.split('\n')[0]}`);
      html = await fetchTextViaPlaywright('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
    }
    const { load } = await import('cheerio');
    const $ = load(html);

    $('.result, .web-result').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('.result__title a, .result__a, h2 a').first();
      if (!$a.length) return;
      const title = clean($a.text());
      let href = $a.attr('href') || '';
      try {
        const uddg = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
        if (uddg) href = uddg;
      } catch {}
      const snippet = clean($el.find('.result__snippet, .result__body').text());
      const url = normalizeUrl(href);
      if (title && url && url.startsWith('http') && !seen.has(url.toLowerCase())) {
        seen.add(url.toLowerCase());
        out.push({ title, url, snippet });
      }
    });
    console.error(`[DDG:html] ${out.length} 条`);
  } catch (e) {
    console.error(`[DDG:html] 错误: ${e.message.split('\n')[0]}`);
  }
  return out.slice(0, max);
}

// ==================== 自动抓取 ====================
async function autoFetchUrls(results, fetchCount, maxLen) {
  if (fetchCount <= 0 || results.length === 0) return;
  const urls = results.slice(0, Math.min(fetchCount, results.length)).map(r => r.url);
  console.error(`[fetch] 自动抓取 ${urls.length} 条...`);

  try {
    const fetchArgs = ['node', path.resolve(__dirname, 'fetch.js'), ...urls, `--max-len=${maxLen}`, '--headed'];
    const raw = child_process.execSync(fetchArgs.join(' '), {
      encoding: 'utf8', timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const fetched = JSON.parse(raw);
      for (let i = 0; i < Math.min(fetchCount, fetched.length); i++) {
        if (fetched[i] && fetched[i].content) {
          results[i].content = fetched[i].content.slice(0, maxLen);
        }
      }
      console.error(`[fetch] 抓取完成`);
    } catch (e) {
      console.error(`[fetch] 解析失败: ${e.message.split('\n')[0]}`);
    }
  } catch (e) {
    console.error(`[fetch] 抓取失败: ${e.message.split('\n')[0]}`);
  }
}

// ==================== main ====================
async function main() {
  const startTime = Date.now();
  await ensureDeps();
  const { program } = await import('commander');
  program
    .argument('[query...]', '搜索关键词')
    .option('--max <n>', '结果数 (1-30)', v => parseInt(v, 10), DEFAULT_MAX)
    .option('--region <r>', '区域: auto/cn/intl', 'auto')
    .option('--engine <e>', '引擎: auto/bing/sogou/ddg', 'auto')
    .option('--fetch <n>', '自动抓前N条URL内容 (0=不抓)', v => parseInt(v, 10), DEFAULT_FETCH)
    .option('--max-len <n>', '单页最大字符数', v => parseInt(v, 10), 6000)
    .option('--no-fetch', '禁用自动抓取')
    .parse(process.argv);

  const opts = program.opts();
  const query = clean(program.args.join(' '));
  if (!query) { console.log(JSON.stringify({ error: '未传入搜索关键词' })); process.exit(1); }

  const max = Math.max(1, Math.min(30, opts.max));
  const fetchCount = opts.fetch === true ? DEFAULT_FETCH : (opts.noFetch ? 0 : opts.fetch);

  let inChina;
  if (opts.region === 'cn') inChina = true;
  else if (opts.region === 'intl') inChina = false;
  else inChina = await detectInChina();

  const out = [], seen = new Set();

  function dedupKey(url) {
    try {
      const u = new URL(url);
      let host = u.hostname.replace(/^(www|m|mobile)\./, '');
      let p = u.pathname.replace(/\/+$/, '').replace(/\.(html?|php|aspx?)$/, '');
      return `${host}${p}`.toLowerCase();
    } catch { return url.toLowerCase(); }
  }

  const add = (items) => {
    for (const item of items) {
      const key = dedupKey(item.url);
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
  };

  if (inChina) {
    // 国内：根据 --engine 选择
    const engine = opts.engine === 'auto' ? 'bing' : opts.engine;
    if (engine === 'sogou') {
      console.error('[策略] 国内 → 搜狗 HTTP (⚠ 无cookie易被反爬拦截，结果可能为空)');
      add(await searchSogouHttp(query, max));
    } else {
      console.error('[策略] 国内 → Bing PW');
      add(await searchBingPW(query, max));
      if (out.length === 0) {
        console.error('[策略] Bing 为空，兜底 → DDG HTML');
        add(await searchDDGHtml(query, max));
      }
    }
  } else {
    console.error('[策略] 海外 → DDG HTML');
    add(await searchDDGHtml(query, max));
    if (out.length === 0) {
      console.error('[策略] DDG 为空，兜底 → Bing PW');
      add(await searchBingPW(query, max));
    }
  }

  const results = out.slice(0, max);

  // 自动抓取
  await autoFetchUrls(results, fetchCount, opts.maxLen || 6000);

  console.log(JSON.stringify(results, null, 2));
  console.error(`[耗时] ${((Date.now() - startTime) / 1000).toFixed(1)}s | ${results.length}条结果`);
  await closeBrowser();
}

main().then(() => process.exit(0)).catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
