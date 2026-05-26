import { execSync } from 'child_process';
const t = Date.now();
const p = execSync('node scripts/search.js "今日黄金价格" --max=8', {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 60000,
  cwd: import.meta.dirname,
});
console.log('耗时:', ((Date.now() - t) / 1000).toFixed(1), '秒');
console.log('结果数:', JSON.parse(p).length);
