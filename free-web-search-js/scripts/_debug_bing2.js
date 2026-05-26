#!/usr/bin/env node
/**
 * 逐步排查Bing CN搜索结果差异的原因
 * 对比不同请求头/cookie组合下的结果
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = '今日黄金价格';

async function testBing(label, url, headers) {
  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const html = await r.text();
    const { load } = await import('cheerio');
    const $ = load(html);
    
    const results = [];
    $('li.b_algo').each((i, el) => {
      const $a = $(el).find('h2 a');
      if ($a.length) results.push($a.text().trim().slice(0, 50));
    });
    
    const hasCngold = html.includes('cngold');
    const hasSina = html.includes('finance.sina');
    const has16fan = html.includes('16fan');
    
    console.log(`\n=== ${label} ===`);
    console.log(`Status: ${r.status}, HTML: ${html.length} bytes`);
    console.log(`含金投网: ${hasCngold}, 含新浪: ${hasSina}, 含十六番: ${has16fan}`);
    console.log(`前3条:`);
    results.slice(0, 3).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
  } catch (e) {
    console.log(`\n=== ${label} === FAILED: ${e.message}`);
  }
}

// Test 1: skill当前的方式（最简header）
await testBing('1. 当前skill方式(简header)', 
  'https://cn.bing.com/search?q=' + encodeURIComponent(query),
  {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
);

// Test 2: 加更多浏览器标准header
await testBing('2. 完整浏览器header',
  'https://cn.bing.com/search?q=' + encodeURIComponent(query),
  {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  }
);

// Test 3: 用www.bing.com而不是cn.bing.com
await testBing('3. www.bing.com + zh-CN',
  'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN&cc=cn',
  {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
);

// Test 4: cn.bing.com + FORM=R5FD1 (Bing CN标准参数)
await testBing('4. cn.bing.com + FORM=R5FD1',
  'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&FORM=R5FD1',
  {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
);

// Test 5: 先访问cn.bing.com首页拿cookie，再搜索
console.log('\n=== 5. 先拿cookie再搜索 ===');
try {
  // 先访问首页
  const homeR = await fetch('https://cn.bing.com/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    redirect: 'follow', signal: AbortSignal.timeout(5000),
  });
  const homeHtml = await homeR.text();
  console.log('首页 status:', homeR.status, 'size:', homeHtml.length);
  
  // 提取set-cookie
  // Note: Node.js fetch doesn't expose Set-Cookie easily, but let's check
  console.log('首页 headers:', Object.fromEntries(homeR.headers.entries()));
  
  // 再搜索
  await testBing('5a. 拿cookie后搜索',
    'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&FORM=R5FD1',
    {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    }
  );
} catch (e) {
  console.log('Cookie test failed:', e.message);
}
