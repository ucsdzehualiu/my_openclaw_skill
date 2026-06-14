#!/usr/bin/env node
/**
 * smart-web-search search.js v1.1
 *
 * 策略更新：全部改用 HTTP，避免 Playwright headless 检测
 * 国内: Bing HTML (HTTP) → 失败兜底 DDG
 * 海外: DDG HTML (HTTP) → 失败兜底 Bing
 * Query 意图改写 + 自动抓取正文
 */
import process from 'process';
import child_process from 'child_process';
import querystring from 'querystring';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

const DEFAULT_MAX = 10;
const DEFAULT_FETCH = 3;
const HTTP_TIMEOUT = 12000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const LOW_QUALITY_DOMAINS = [
  'jingyan.baidu.com', 'zhidao.baidu.com', 'tieba.baidu.com',
  'baike.baidu.com', 'wenku.baidu.com', 'zhihu.com', 'zhuanlan.zhihu.com',
];

// ==================== Query 意图改写 ====================
const CITIES = '深圳|广州|北京|上海|杭州|成都|武汉|南京|重庆|西安|长沙|苏州|厦门|青岛|大连|天津|昆明|珠海|东莞|佛山|惠州|中山';

const INTENT_RULES = [
  // 城市相关
  [new RegExp(`(${CITIES})\\s*(有什么好玩的|哪里好玩|好玩的地方|去哪玩|周末.*去哪|好去处|逛|玩什么)`),
    (m) => `${m[1]} 景点`, '城市游玩→景点'],
  [new RegExp(`(${CITIES})\\s*(活动|展览|演出|市集|音乐会|演唱会)`),
    (m) => `${m[1]} ${m[2]}`, '城市活动→精简'],
  [new RegExp(`(${CITIES})\\s*(美食|小吃|餐厅|好吃的)`),
    (m) => `${m[1]} 美食推荐`, '城市美食→美食推荐'],

  // 价格查询（去掉模糊时间词）
  [/今日(金价|银价|油价|铜价|铂金价|汇率|股价)/,
    (m) => m[1], '今日价格→去掉今日'],
  [/现在(.*?)(价格|多少钱)/,
    (m) => `${m[1]} 价格`, '现在价格→去掉现在'],

  // 教程类
  [/(.+?)(教程|入门|学习|怎么学)/,
    (m) => `${m[1]} 教程`, '教程类→标准化'],
  [/^怎么(做|用|玩|安装|配置|设置)(.+)/i,
    (m) => `${m[2]} ${m[1]}法`, '怎么做→方法'],
  [/^如何(.+)/i,
    (m) => `${m[1]} 方法`, '如何→方法'],

  // 下载类
  [/(.+?)(下载|安装包|安装)/,
    (m) => `${m[1]} 官方下载`, '下载→官方下载'],

  // 官网查询
  [/(.+?)(官网|官方网站|主页)/,
    (m) => `${m[1]} 官网`, '官网查询→精简'],

  // 最新资讯
  [/(最新|最近)(.*?)(消息|新闻|动态|进展)/,
    (m) => `${m[2]} 最新`, '最新消息→精简'],

  // 知识类
  [/(.+?)是什么(?:意思)?$/i,
    (m) => `${m[1]} 介绍`, '是什么→介绍'],
  [/什么是(.+)/i,
    (m) => `${m[1]} 介绍`, '什么是→介绍'],

  // 评价类
  [/(.+?)怎么样$/i,
    (m) => `${m[1]} 评价`, '怎么样→评价'],
  [/(.+?)(好不好|靠谱吗|可靠吗)/i,
    (m) => `${m[1]} 评价`, '好不好→评价'],

  // 对比类
  [/(.+?)和(.+?)(哪个好|哪个更好|选哪个|区别)/,
    (m) => `${m[1]} ${m[2]} 对比`, '对比类→标准化'],
  [/(.+?)(vs|VS)(.+)/,
    (m) => `${m[1]} ${m[3]} 对比`, 'VS→对比'],
];

function rewriteQuery(query) {
  for (const [pattern, rewrite, desc] of INTENT_RULES) {
    const m = query.match(pattern);
    if (m) {
      const rewritten = rewrite(m).replace(/\s+/g, ' ').trim();
      return { rewritten, desc };
    }
  }
  return { rewritten: query, desc: null };
}

// ==================== 工具函数 ====================
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

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

function isLowQuality(url) {
  try {
    const host = new URL(url).hostname;
    return LOW_QUALITY_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

function dedupKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|mobile)\./, '');
    const p = u.pathname.replace(/\/+$/, '').replace(/\.(html?|php|aspx?)$/, '');
    return `${host}${p}`.toLowerCase();
  } catch { return url.toLowerCase(); }
}

// ==================== 依赖检查 ====================
async function ensureDeps() {
  try { await import('cheerio'); } catch {
    child_process.execSync('npm install cheerio --silent', { stdio: 'inherit', cwd: SKILL_ROOT });
  }
  try { await import('commander'); } catch {
    child_process.execSync('npm install commander --silent', { stdio: 'inherit', cwd: SKILL_ROOT });
  }
}

// ==================== 区域检测 ====================
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
          if (/中国|CN/i.test(text)) return { inChina: true, label: 'CN probe' };
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
          return { inChina: cc === 'CN', label: `intl probe → ${cc}` };
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

// ==================== Bing HTML (HTTP) ====================
async function searchBingHtml(query, max) {
  console.error(`[Bing:html] "${query}"`);
  const out = [], seen = new Set();
  try {
    const url = 'https://cn.bing.com/search?' + querystring.stringify({ q: query });
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US,en;q=0.8',
        'Referer': 'https://cn.bing.com/',
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT), redirect: 'follow',
    });
    if (!r.ok) { console.error(`[Bing:html] HTTP ${r.status}`); return out; }

    const html = await r.text();
    const { load } = await import('cheerio');
    const $ = load(html);

    $('li.b_algo').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('h2 a').first();
      if (!$a.length) return;
      const title = clean($a.text());
      const href = $a.attr('href') || '';
      const snippet = clean($el.find('.b_caption p, .b_caption').text());
      const url = normalizeUrl(href);
      if (title && url?.startsWith('http') && !seen.has(url.toLowerCase())) {
        seen.add(url.toLowerCase());
        out.push({ title, url, snippet });
      }
    });

    // 备选：从答案卡片提取链接
    if (out.length === 0) {
      $('li.b_ans, li.b_vList, li.b_entityTP, li.b_mop').each((_, el) => {
        $(el).find('a[href]').each((_, a) => {
          const href = $(a).attr('href') || '';
          if (!href || href.includes('bing.com') || href.includes('microsoft.com') || href.startsWith('javascript:')) return;
          const title = clean($(a).text()).slice(0, 100);
          const url = normalizeUrl(href);
          if (title && url?.startsWith('http') && !seen.has(url.toLowerCase())) {
            seen.add(url.toLowerCase());
            out.push({ title, url, snippet: '' });
          }
        });
      });
    }

    console.error(`[Bing:html] ${out.length} 条`);
  } catch (e) {
    console.error(`[Bing:html] 错误: ${e.message.split('\n')[0]}`);
  }
  return out.slice(0, max);
}

// ==================== Bing Headed (Playwright 有头浏览器兜底) ====================
async function searchBingHeaded(query, max) {
  console.error(`[Bing:headed] "${query}" (启动有头浏览器)`);
  const out = [], seen = new Set();
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    // 屏蔽图片/字体/媒体以加速
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'font' || t === 'media') return route.abort();
      route.continue();
    });

    const page = await ctx.newPage();

    // 关键：先访问首页拿 cookies + 建立 session，再搜索
    console.error('[Bing:headed] warm-up: 访问首页建立 session');
    await page.goto('https://cn.bing.com/', { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const url = 'https://cn.bing.com/search?' + querystring.stringify({ q: query });
    await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
    try {
      await page.waitForSelector('li.b_algo h2 a', { timeout: 12000 });
    } catch {
      console.error('[Bing:headed] 等待 li.b_algo 超时，直接采集当前 DOM');
    }
    console.error(`[Bing:headed] final URL: ${page.url()}`);
    console.error(`[Bing:headed] title: ${await page.title()}`);

    const items = await page.$$eval('li.b_algo', els =>
      els.map(el => {
        const a = el.querySelector('h2 a');
        const title = a?.textContent?.trim() || '';
        const href = a?.href || '';
        const snippet = el.querySelector('.b_caption p, .b_caption')?.textContent?.trim() || '';
        return { title, href, snippet };
      })
    );

    for (const { title, href, snippet } of items) {
      const url = normalizeUrl(href);
      if (title && url?.startsWith('http') && !seen.has(url.toLowerCase())) {
        seen.add(url.toLowerCase());
        out.push({ title, url, snippet });
      }
    }

    console.error(`[Bing:headed] ${out.length} 条`);
  } catch (e) {
    console.error(`[Bing:headed] 错误: ${e.message.split('\n')[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return out.slice(0, max);
}

// 判断结果是否看起来像"品牌首页"（URL 路径过浅）
function looksLikeBrandPages(results) {
  if (results.length < 3) return false;
  const shallow = results.filter(r => {
    try {
      const u = new URL(r.url);
      const pathDepth = u.pathname.split('/').filter(Boolean).length;
      return pathDepth <= 1; // 只有 / 或 /xxx，没有更深路径
    } catch {
      return false;
    }
  });
  return shallow.length >= Math.min(4, results.length); // >= 4 条或 >= 80% 是首页
}

// ==================== DDG HTML (HTTP) ====================
async function searchDDGHtml(query, max) {
  console.error(`[DDG:html] "${query}"`);
  const out = [], seen = new Set();
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT), redirect: 'follow',
    });
    if (!r.ok) { console.error(`[DDG:html] HTTP ${r.status}`); return out; }

    const html = await r.text();
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
      const url = normalizeUrl(href);
      const snippet = clean($el.find('.result__snippet, .result__body').text());
      if (title && url?.startsWith('http') && !seen.has(url.toLowerCase())) {
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

// ==================== 自动抓取正文 ====================
async function autoFetch(results, fetchCount, maxLen) {
  if (fetchCount <= 0 || results.length === 0) return;
  const urls = results.slice(0, Math.min(fetchCount, results.length)).map(r => r.url);
  console.error(`[fetch] 抓取 ${urls.length} 条正文...`);
  try {
    const raw = child_process.execSync(
      `node "${path.resolve(__dirname, 'fetch.js')}" ${urls.map(u => `"${u}"`).join(' ')} --max-len=${maxLen}`,
      { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'], cwd: SKILL_ROOT }
    );
    const fetched = JSON.parse(raw);
    for (let i = 0; i < Math.min(fetchCount, fetched.length); i++) {
      if (fetched[i]?.content) results[i].content = fetched[i].content.slice(0, maxLen);
    }
    console.error('[fetch] 完成');
  } catch (e) {
    console.error(`[fetch] 失败: ${e.message.split('\n')[0]}`);
  }
}

// ==================== main ====================
async function main() {
  const startTime = Date.now();
  await ensureDeps();
  const { program } = await import('commander');
  program
    .argument('[query...]', '搜索关键词')
    .option('--max <n>', '最大结果数 (1-30)', v => parseInt(v, 10), DEFAULT_MAX)
    .option('--region <r>', '区域: auto/cn/intl', 'auto')
    .option('--fetch <n>', '自动抓取前N条正文 (0=不抓)', v => parseInt(v, 10), DEFAULT_FETCH)
    .option('--max-len <n>', '单页最大字符数', v => parseInt(v, 10), 6000)
    .option('--no-fetch', '禁用正文抓取')
    .option('--filter', '过滤低质量域名（知乎/百度经验等）')
    .option('--no-rewrite', '跳过 Query 意图改写')
    .parse(process.argv);

  const opts = program.opts();
  const rawQuery = clean(program.args.join(' '));
  if (!rawQuery) { console.log(JSON.stringify({ error: '未传入搜索关键词' })); process.exit(1); }

  // Query 改写
  let query = rawQuery;
  if (!opts.noRewrite) {
    const { rewritten, desc } = rewriteQuery(rawQuery);
    if (desc) {
      console.error(`[改写] ${desc}: "${rawQuery}" → "${rewritten}"`);
      query = rewritten;
    }
  }

  const max = Math.max(1, Math.min(30, opts.max));
  const fetchCount = opts.noFetch ? 0 : (typeof opts.fetch === 'number' ? opts.fetch : DEFAULT_FETCH);
  const maxLen = opts.maxLen || 6000;

  let inChina;
  if (opts.region === 'cn') inChina = true;
  else if (opts.region === 'intl') inChina = false;
  else inChina = await detectInChina();

  const out = [], seen = new Set();
  const add = (items) => {
    for (const item of items) {
      if (opts.filter && isLowQuality(item.url)) continue;
      const key = dedupKey(item.url);
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
  };

  if (inChina) {
    console.error('[策略] 国内 → Bing HTML');
    add(await searchBingHtml(query, max));
    if (out.length === 0) {
      console.error('[策略] Bing 为空，兜底 → DDG HTML');
      add(await searchDDGHtml(query, max));
    } else if (looksLikeBrandPages(out)) {
      console.error(`[策略] 检测到结果疑似品牌首页堆叠（${out.length} 条多为根路径），切换有头浏览器重试`);
      out.length = 0; seen.clear();
      add(await searchBingHeaded(query, max));
      if (out.length === 0) {
        console.error('[策略] 有头浏览器为空，回退 DDG');
        add(await searchDDGHtml(query, max));
      }
    }
  } else {
    console.error('[策略] 海外 → DDG HTML');
    add(await searchDDGHtml(query, max));
    if (out.length === 0) {
      console.error('[策略] DDG 为空，兜底 → Bing HTML');
      add(await searchBingHtml(query, max));
    }
  }

  const results = out.slice(0, max);
  await autoFetch(results, fetchCount, maxLen);

  console.log(JSON.stringify(results, null, 2));
  console.error(`[完成] ${((Date.now() - startTime) / 1000).toFixed(1)}s | ${results.length} 条结果`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
