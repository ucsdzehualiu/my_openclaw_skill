#!/usr/bin/env node
/**
 * 批量测试：多个query，记录耗时、结果数、去重后数
 */
import { execSync } from 'child_process';

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

console.log('Query'.padEnd(30) + 'Results  Time    Engines');
console.log('-'.repeat(65));

for (const q of queries) {
  const t = Date.now();
  try {
    const raw = execSync(`node scripts/search.js "${q}" --max=10`, {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    const results = JSON.parse(raw);
    
    // 从stderr提取引擎信息（这里简化，只看结果数）
    console.log(q.padEnd(30) + `${results.length}`.padEnd(9) + `${elapsed}s`.padEnd(8));
  } catch (e) {
    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    console.log(q.padEnd(30) + 'FAIL'.padEnd(9) + `${elapsed}s`.padEnd(8) + e.message.split('\n')[0].slice(0, 30));
  }
}
