#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
free-web-search v7
意图识别 + query改写 + 请求节流 + 结果质量评分 + 单域名排除重试 + 保留CSS"""

import sys
import json
import time
import re
import argparse
import subprocess
from urllib.parse import urlencode, quote, urlparse
from datetime import datetime

# ==================== 强制UTF-8 ====================
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ==================== 配置 ====================
DEFAULT_MAX  = 10
DEFAULT_FULL = 0
TIMEOUT      = 30000
FETCH_TIMEOUT= 15000
DDG_TIMEOUT  = 10000
MAX_RETRIES  = 3
DDG_RETRIES  = 1
WAIT_TIME    = 2000

QUALITY_THRESHOLD = 0.45

MIN_REQUEST_INTERVAL = 3.0
_last_request_time = 0.0

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

BLOCK_DOMAINS = [
    # 知乎搜索结果可以抓全文（可能遇到反爬，但值得试）
]

LOW_QUALITY_DOMAINS = [
    "jingyan.baidu.com",
    "zhidao.baidu.com",
    "tieba.baidu.com",
    "baike.baidu.com",
    "wenku.baidu.com",
    "bbs.16fan.com",
    "zhihu.com",
    "zhuanlan.zhihu.com",
]

AUTHORITY_HINTS = [
    ".gov.", "gov.cn", ".org.",
    "kitco.com", "sge.com.cn", "cngold.org", "gold.org.cn",
    "kekegold.com", "cngoldprice.com", "ip138.com",
    "finance.sina", "finance.eastmoney", "10jqka.com.cn",
    "jujindata.com", "huilvbiao.com", "jinjia.com.cn",
    "mafengwo.cn", "ctrip.com", "damai.cn",
    "visitshenzhen",
]

FUZZY_TIME_WORDS = re.compile(r'(今日|今天|最新|最近|当前|目前|当下|现在)')

# ==================== 意图识别 + query 改写 ====================
CITIES = "深圳|广州|北京|上海|杭州|成都|武汉|南京|重庆|西安|长沙|苏州|厦门|青岛|大连|天津|昆明|珠海|东莞|佛山|惠州|中山"

# 意图规则: (匹配正则, 改写函数, 描述)
# 改写函数接收 match 对象和原始 query，返回改写后的完整 query
# 原则：只精简/替换，不加词！Bing CN对简洁query效果最好
INTENT_RULES = [
    # 城市+好玩/去哪 → 精简为"城市 景点"
    (re.compile(rf'({CITIES})\s*(有什么好玩的|哪里好玩|好玩的地方|去哪玩|周末.*去哪|好去处|逛|玩什么)'),
     lambda m, q: f'{m.group(1)} 景点', '城市游玩→景点'),

    # 城市+活动 → 精简
    (re.compile(rf'({CITIES})\s*(活动|展览|演出|市集|音乐会|演唱会)'),
     lambda m, q: f'{m.group(1)} {m.group(2)}', '城市活动→精简'),

    # "今日金价" → "金价"（Bing CN对"今日"匹配百度经验，去掉更好）
    (re.compile(r'今日(金价|银价|油价|铜价|铂金价)'),
     lambda m, q: f'{m.group(1)}', '今日价格→去掉今日'),

    # "xxx是什么" → "xxx 介绍"
    (re.compile(r'(.+?)是什么(?:意思)?$', re.IGNORECASE),
     lambda m, q: f'{m.group(1)} 介绍', '是什么→介绍'),

    # "xxx怎么样" → "xxx 评价"
    (re.compile(r'(.+?)怎么样$', re.IGNORECASE),
     lambda m, q: f'{m.group(1)} 评价', '怎么样→评价'),

    # "怎么xxx" → "xxx 方法"
    (re.compile(r'^怎么(.+)', re.IGNORECASE),
     lambda m, q: f'{m.group(1)} 方法', '怎么→方法'),

    # "xxx和yyy哪个好" → "xxx yyy 对比"
    (re.compile(r'(.+?)和(.+?)(哪个好|哪个更好|选哪个)'),
     lambda m, q: f'{m.group(1)} {m.group(2)} 对比', '哪个好→对比'),
]


def rewrite_query(query: str) -> tuple:
    """意图识别 + query改写。只应用第一个匹配的规则。返回 (改写后query, 意图描述或None)"""
    for pattern, rewrite_fn, desc in INTENT_RULES:
        m = pattern.search(query)
        if m:
            rewritten = rewrite_fn(m, query)
            rewritten = re.sub(r'\s+', ' ', rewritten).strip()
            return rewritten, desc
    return query, None


# 反检测初始化脚本
STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'},
        {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpafafjmlifpcpbgpcj'},
        {name: 'Native Client Executable', filename: 'internal-nacl-plugin'}
    ]
});
Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh', 'en']});
Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});
window.chrome = {runtime: {}};
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
);
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (type === 'image/png' && this.width === 220 && this.height === 30) {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANwAAAAeCAYAAABwJ3rwAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QA/wD/AP+gvaeTAAAABmJLR0QA/wD/AP+gvaeTAAAABmJLR0QA/wD/AP+gvaeT';
    }
    return originalToDataURL.apply(this, arguments);
};
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.apply(this, arguments);
};
"""

BROWSER_ARGS = [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled', '--disable-infobars',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--metrics-recording-only', '--disable-default-apps', '--no-first-run',
    '--disable-component-extensions-with-background-pages',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials', '--disable-web-security',
    '--allow-running-insecure-content',
]

ROUTE_PATTERN = "**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,mp4,ico,webp,js.map}"

_browser = None
_playwright = None


def ensure_playwright():
    try:
        import playwright; return
    except ImportError: pass
    print("[INFO] 安装 playwright...", file=sys.stderr)
    for cmd in [
        [sys.executable, "-m", "pip", "install", "-q", "playwright", "--break-system-packages"],
        [sys.executable, "-m", "pip", "install", "-q", "playwright"],
    ]:
        if subprocess.run(cmd, capture_output=True, text=True).returncode == 0:
            break
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                   capture_output=True, text=True)
    import os; os.execv(sys.executable, [sys.executable] + sys.argv)


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("query", nargs="*")
    parser.add_argument("--max", type=int, default=DEFAULT_MAX, dest="max_results")
    parser.add_argument("--full", type=int, default=DEFAULT_FULL)
    parser.add_argument("--engine", type=str, default="bing", choices=["bing", "duckduckgo", "auto"])
    parser.add_argument("--filter", action="store_true", help="过滤低质量域名")
    parser.add_argument("--no-rewrite", action="store_true", help="禁用query改写")
    args = parser.parse_args()
    query = " ".join(args.query).strip()
    args.max_results = max(1, min(20, args.max_results))
    args.full = max(0, min(5, args.full))
    return query, args.max_results, args.full, args.engine, args.filter, args.no_rewrite


def build_bing_url(query, count):
    return "https://cn.bing.com/search?" + urlencode({
        "q": query, "mkt": "zh-CN", "setlang": "zh-CN", "cc": "CN", "count": str(count + 2)
    })

def build_duckduckgo_url(query):
    return "https://duckduckgo.com/?q=" + quote(query) + "&ia=web"


def init_browser():
    global _browser, _playwright
    if _browser: return
    from playwright.sync_api import sync_playwright
    print("[DEBUG] 启动 Chromium...", file=sys.stderr)
    _playwright = sync_playwright().start()
    _browser = _playwright.chromium.launch(headless=True, args=BROWSER_ARGS)
    print("[DEBUG] Chromium 已就绪", file=sys.stderr)

def close_browser():
    try:
        if _browser: _browser.close()
        if _playwright: _playwright.stop()
    except: pass

def create_context():
    ctx = _browser.new_context(
        locale="zh-CN", user_agent=UA,
        viewport={"width":1920,"height":1080}, screen={"width":1920,"height":1080},
        device_scale_factor=1, timezone_id="Asia/Shanghai",
        has_touch=False, is_mobile=False, java_script_enabled=True,
    )
    ctx.add_init_script(STEALTH_JS)
    return ctx

def throttle():
    global _last_request_time
    gap = MIN_REQUEST_INTERVAL - (time.time() - _last_request_time)
    if gap > 0:
        time.sleep(gap)
    _last_request_time = time.time()

def is_blocked_domain(url): return any(d in url for d in BLOCK_DOMAINS)
def is_low_quality_domain(url): return any(d in url for d in LOW_QUALITY_DOMAINS)

def score_result(r):
    s = 0.5
    url, snippet = r.get("url",""), r.get("snippet","")
    if is_low_quality_domain(url): s -= 0.3
    if re.search(r'\d{2,}', snippet): s += 0.15
    if len(snippet) < 20: s -= 0.1
    for h in AUTHORITY_HINTS:
        if h in url: s += 0.2; break
    return max(0.0, min(1.0, s))

def score_results(results):
    return sum(score_result(r) for r in results) / len(results) if results else 0.0

def get_dominant_domain(results):
    if not results: return (None, 0, 0)
    domains = {}
    for r in results:
        d = urlparse(r["url"]).netloc.replace("www.", "")
        domains[d] = domains.get(d, 0) + 1
    top = max(domains, key=domains.get)
    if domains[top] > len(results) * 0.5:
        return (top, domains[top], len(results))
    return (None, 0, len(results))

def merge_results(primary, secondary, max_results):
    seen, merged = set(), []
    for r in primary + secondary:
        if r["url"] not in seen: seen.add(r["url"]); merged.append(r)
    return merged[:max_results]

def apply_filter(results, do_filter):
    if do_filter and results:
        filtered = [r for r in results if not is_blocked_domain(r["url"]) and not is_low_quality_domain(r["url"])]
        if filtered: return filtered
        print("[WARN] --filter 过滤后为空，回退", file=sys.stderr)
    return results


# ==================== Bing 搜索 ====================
def search_bing(query, max_results, do_filter=False):
    start = time.time()
    url = build_bing_url(query, max_results + 5)
    print(f"[DEBUG] Bing: {query} | max={max_results}", file=sys.stderr)
    init_browser()
    results = []
    for attempt in range(MAX_RETRIES):
        throttle()
        ctx, page = create_context(), None
        try:
            page = ctx.new_page()
            page.route(ROUTE_PATTERN, lambda r: r.abort())
            page.goto(url, timeout=TIMEOUT, wait_until="domcontentloaded")
            page.wait_for_timeout(WAIT_TIME)
            raw = page.evaluate("""() => {
                const items = [];
                document.querySelectorAll('li.b_algo').forEach(el => {
                    try {
                        const a = el.querySelector('h2 a');
                        const p = el.querySelector('.b_caption p, .b_algoSlug');
                        if (a && a.href && a.href.startsWith('http'))
                            items.push({title:(a.innerText||a.textContent||'').trim(), url:a.href.trim(), snippet:p?(p.innerText||p.textContent||'').trim():''});
                    } catch(e) {}
                });
                return items;
            }""")
            for r in raw:
                if r["title"] and r["url"] and len(r["title"]) > 3:
                    results.append({"title":r["title"],"url":r["url"],"snippet":r["snippet"],"content":""})
            if len(results) >= max_results: break
            if len(raw) == 0 and attempt < MAX_RETRIES - 1:
                w = 5 * (attempt + 1)
                print(f"[WARN] 0结果，可能限流，等{w}s", file=sys.stderr)
                time.sleep(w)
        except Exception as e:
            print(f"[WARN] Bing尝试{attempt+1}失败: {e}", file=sys.stderr)
        finally:
            try: ctx.close()
            except: pass
    results = apply_filter(results, do_filter)[:max_results]
    dom, dc, tot = get_dominant_domain(results)
    if dom: print(f"[WARN] 单域名集中: {dom} ({dc}/{tot})", file=sys.stderr)
    q = score_results(results)
    print(f"[DEBUG] 质量: {q:.2f} | 数量: {len(results)} | 耗时: {time.time()-start:.1f}s", file=sys.stderr)
    return results, dom


# ==================== DuckDuckGo ====================
def search_duckduckgo(query, max_results, do_filter=False):
    start = time.time()
    url = build_duckduckgo_url(query)
    print(f"[DEBUG] DDG: {query}", file=sys.stderr)
    init_browser()
    results = []
    for _ in range(DDG_RETRIES):
        ctx, page = create_context(), None
        try:
            page = ctx.new_page()
            page.route(ROUTE_PATTERN, lambda r: r.abort())
            page.goto(url, timeout=DDG_TIMEOUT, wait_until="domcontentloaded")
            page.wait_for_timeout(WAIT_TIME + 1000)
            raw = page.evaluate("""() => {
                const items = [];
                for (const sel of ['article[data-testid="result"]','.result','[data-testid="result"]','li[data-layout="organic"]']) {
                    document.querySelectorAll(sel).forEach(el => {
                        try {
                            const a=el.querySelector('a[href^="http"]'),t=el.querySelector('h2,.result__a,[data-testid="result-title"] span'),s=el.querySelector('[data-testid="result-snippet"],.result__snippet');
                            if(a&&a.href&&t) items.push({title:(t.innerText||t.textContent||'').trim(),url:a.href.trim(),snippet:s?(s.innerText||'').trim():''});
                        } catch(e) {}
                    });
                    if(items.length>0) break;
                }
                return items;
            }""")
            for r in raw:
                if r["title"] and r["url"] and len(r["title"]) > 3:
                    results.append({"title":r["title"],"url":r["url"],"snippet":r["snippet"],"content":""})
            if len(results) >= max_results: break
        except Exception as e:
            print(f"[WARN] DDG失败: {e}", file=sys.stderr)
        finally:
            try: ctx.close()
            except: pass
    results = apply_filter(results, do_filter)[:max_results]
    print(f"[DEBUG] DDG: {len(results)}条 | {time.time()-start:.1f}s", file=sys.stderr)
    return results, None


# ==================== 全文抓取 ====================
def fetch_full(url):
    start = time.time()
    print(f"[DEBUG] 抓全文: {url}", file=sys.stderr)
    if is_blocked_domain(url): return "黑名单域名，跳过"
    ctx, page = create_context(), None
    text = ""
    try:
        page = ctx.new_page()
        page.route(ROUTE_PATTERN, lambda r: r.abort())
        page.goto(url, timeout=FETCH_TIMEOUT, wait_until="domcontentloaded")
        page.wait_for_timeout(800)
        try: page.wait_for_load_state("networkidle", timeout=5000)
        except: pass
        text = page.evaluate("""() => {
            document.querySelectorAll('script,style,nav,header,footer,.ad,.ads,[class*="banner"],[id*="banner"],.sidebar,.comment,.popup,.modal,.cookie').forEach(e=>e.remove());
            for (const sel of ['article','main','.content','.post','.article','#content','#main','.entry-content','.post-content','[itemprop="articleBody"]']) {
                const m=document.querySelector(sel); if(m&&m.innerText.length>200) return m.innerText;
            }
            return document.body?document.body.innerText:'';
        }""")
    except Exception as e:
        print(f"[ERROR] 全文失败: {e}", file=sys.stderr)
    finally:
        try: ctx.close()
        except: pass
    result = (text or "").strip()[:8000]
    print(f"[DEBUG] 全文: {len(result)}字 | {time.time()-start:.1f}s", file=sys.stderr)
    return result or "抓取失败"


# ==================== 主函数 ====================
def main():
    ensure_playwright()
    query, max_results, full, engine, do_filter, no_rewrite = parse_args()
    if not query:
        print(json.dumps({"error": "no query"}, ensure_ascii=False)); sys.exit(1)

    # 意图识别 + query改写(仅在搜索质量差时触发,不提前改写)
    original_query = query

    results = []

    if engine == "duckduckgo":
        results, _ = search_duckduckgo(query, max_results, do_filter)

    else:
        # 第1步: 用原始 query 搜索
        results, dominant = search_bing(query, max_results, do_filter)
        quality = score_results(results)

        # 第2步: 单域名集中/低质量域名 → 排除重试(最多2轮,限流时停止)
        if len(results) > 0:
            excluded = set()
            for _ in range(2):
                target = None
                if dominant and dominant not in excluded:
                    target = dominant
                elif results and is_low_quality_domain(results[0]["url"]):
                    d = urlparse(results[0]["url"]).netloc.replace("www.", "")
                    if d not in excluded: target = d
                if not target: break
                excluded.add(target)
                rq = query + " " + " ".join(f"-site:{d}" for d in excluded)
                print(f"[INFO] 排除({target})重试", file=sys.stderr)
                rr, _ = search_bing(rq, max_results, do_filter)
                if not rr: break
                rq_score = score_results(rr)
                if rq_score > quality:
                    results = merge_results(rr, results, max_results)
                    quality = score_results(results)
                    dominant, _, _ = get_dominant_domain(results)
                else: break

        # 第3步: 质量差 → 尝试改写 query 重试(仅当启用改写且原始query未改写时)
        if not no_rewrite and quality < QUALITY_THRESHOLD and len(results) > 0:
            rewritten, intent = rewrite_query(query)
            if intent and rewritten != query:
                print(f"[INFO] 质量低({quality:.2f})，意图改写({intent}): {query} → {rewritten}", file=sys.stderr)
                rr, _ = search_bing(rewritten, max_results, do_filter)
                if rr and score_results(rr) > quality:
                    results = rr
                    quality = score_results(results)

        # 第4步: auto模式 - 质量仍差 → 简化query(去模糊时间词)
        if engine == "auto" and quality < QUALITY_THRESHOLD and len(results) > 0:
            simplified = re.sub(FUZZY_TIME_WORDS, '', query).strip()
            simplified = re.sub(r'\s+', ' ', simplified).strip()
            if simplified != query and len(simplified) >= 2:
                print(f"[INFO] 简化重试: {simplified}", file=sys.stderr)
                rr, _ = search_bing(simplified, max_results, do_filter)
                if rr and score_results(rr) > quality:
                    results = rr

        # 第5步: auto模式 - Bing完全无结果 → DDG兜底
        if engine == "auto" and not results:
            print("[INFO] Bing无结果，DDG兜底...", file=sys.stderr)
            results, _ = search_duckduckgo(query, max_results, do_filter)

    # 全文抓取
    if full > 0 and results:
        for i in range(min(full, len(results))):
            results[i]["content"] = fetch_full(results[i]["url"])

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try: main()
    finally: close_browser()
