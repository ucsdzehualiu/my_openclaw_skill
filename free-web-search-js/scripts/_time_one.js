#!/usr/bin/env node
/**
 * 单个query测试，输出耗时+结果数
 */
const q = process.argv[2] || '今日黄金价格';
const max = process.argv[3] || '10';

// 改process.argv让search.js执行
process.argv = [process.argv[0], 'scripts/search.js', q, '--max=' + max];

const t = Date.now();
try {
  await import('./search.js');
} catch {}
// search.js会process.exit，如果没exit：
console.error('\n总耗时:', ((Date.now() - t) / 1000).toFixed(1), '秒');
