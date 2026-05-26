#!/usr/bin/env node
/**
 * 批量测试（进程内）：直接调search函数，不spawn子进程
 */
import querystring from 'querystring';

const queries = [
  '今日黄金价格',
  '俄乌冲突最新消息',
  '怎么做红烧肉',
  '上海明天天气',
  '感冒吃什么药',
  '量子计算',
  '北京',
  '今日铜价',
];

// 动态import search.js的函数太复杂，直接用时间戳包装exec
import { exec } from 'child_process';

async function runOne(q) {
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    const t = Date.now();
    const p = spawn('node', ['scripts/search.js', q, '--max=10'], {
      cwd: import.meta.dirname,
    });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    p.on('close', (code) => {
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      if (code !== 0) {
        resolve({ q, ok: false, elapsed, error: `exit ${code}` });
        return;
      }
      try {
        const results = JSON.parse(stdout);
        const bingMatch = stderr.match(/\[Bing:pw\] (\d+) 条/);
        const baiduMatch = stderr.match(/\[百度:pw\] (\d+) 条/);
        resolve({
          q, ok: true, elapsed,
          count: results.length,
          bing: bingMatch ? parseInt(bingMatch[1]) : 0,
          baidu: baiduMatch ? parseInt(baiduMatch[1]) : 0,
        });
      } catch (e) {
        resolve({ q, ok: false, elapsed, error: 'parse error' });
      }
    });
    p.on('error', e => {
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      resolve({ q, ok: false, elapsed, error: e.message.slice(0, 30) });
    });
  });
}

console.log('Query'.padEnd(24) + 'Results  Bing  Baidu  Time');
console.log('-'.repeat(60));

const allResults = [];
for (const q of queries) {
  const r = await runOne(q);
  allResults.push(r);
  if (r.ok) {
    console.log(r.q.padEnd(24) + `${r.count}`.padEnd(9) + `${r.bing}`.padEnd(6) + `${r.baidu}`.padEnd(7) + `${r.elapsed}s`);
  } else {
    console.log(r.q.padEnd(24) + 'FAIL'.padEnd(9) + ''.padEnd(6) + ''.padEnd(7) + `${r.elapsed}s ` + r.error);
  }
}

// 汇总
const okResults = allResults.filter(r => r.ok);
const avgTime = okResults.reduce((s, r) => s + parseFloat(r.elapsed), 0) / okResults.length;
const avgCount = okResults.reduce((s, r) => s + r.count, 0) / okResults.length;
console.log('-'.repeat(60));
console.log(`平均: ${avgCount.toFixed(1)}条  ${avgTime.toFixed(1)}s  (${okResults.length}/${allResults.length} 成功)`);
