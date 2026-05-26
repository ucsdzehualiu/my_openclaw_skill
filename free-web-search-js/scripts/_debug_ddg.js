#!/usr/bin/env node
/**
 * 调试DDG HTML Lite
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const query = 'python tutorial';

console.log('Test 1: DDG HTML Lite POST');
try {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'q=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(10000),
  });
  console.log('Status:', r.status, 'Size:', (await r.clone().text()).length);
  const html = await r.text();
  const { load } = await import('cheerio');
  const $ = load(html);
  const results = [];
  $('.result, .web-result').each((i, el) => {
    const $a = $(el).find('.result__title a, .result__a, h2 a').first();
    if ($a.length) results.push($a.text().trim().slice(0, 50));
  });
  console.log('Results:', results.length);
  results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
} catch (e) {
  console.log('Failed:', e.message);
}

console.log('\nTest 2: DDG HTML Lite GET');
try {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  console.log('Status:', r.status, 'Size:', (await r.clone().text()).length);
  const html = await r.text();
  const { load } = await import('cheerio');
  const $ = load(html);
  const results = [];
  $('.result, .web-result').each((i, el) => {
    const $a = $(el).find('.result__title a, .result__a, h2 a').first();
    if ($a.length) results.push($a.text().trim().slice(0, 50));
  });
  console.log('Results:', results.length);
  results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
} catch (e) {
  console.log('Failed:', e.message);
}

console.log('\nTest 3: Bing International');
try {
  const r = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(query), {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  });
  console.log('Status:', r.status, 'Size:', (await r.clone().text()).length);
  const html = await r.text();
  const { load } = await import('cheerio');
  const $ = load(html);
  const results = [];
  $('li.b_algo').each((i, el) => {
    const $a = $(el).find('h2 a');
    if ($a.length) results.push($a.text().trim().slice(0, 50));
  });
  console.log('Results:', results.length);
  results.slice(0, 5).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
} catch (e) {
  console.log('Failed:', e.message);
}
