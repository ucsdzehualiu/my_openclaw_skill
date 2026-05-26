const start = Date.now();
process.argv = ['node', 'scripts/search.js', '今日黄金价格', '--max=8'];
import('./search.js').catch(() => {}).finally(() => {
  // search.js自己会process.exit，这里不一定能跑到
});
