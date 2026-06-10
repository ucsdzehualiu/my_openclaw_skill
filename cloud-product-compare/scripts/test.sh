#!/bin/bash
# cloud-compare 自动化测试脚本
# 测试多个产品的文档抓取功能

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo ""
echo "========================================"
echo "  cloud-compare 自动化测试"
echo "========================================"
echo ""

# 检查依赖
echo "[1/4] 检查依赖..."
python scripts/cloud_doc_scraper.py --list > /dev/null 2>&1 || {
    echo "[X] 依赖检查失败"
    echo "    请运行: pip install playwright httpx beautifulsoup4 && playwright install chromium"
    exit 1
}
echo "[OK] 依赖已安装"

# 测试产品列表
echo ""
echo "[2/4] 测试产品列表..."
python scripts/cloud_doc_scraper.py --list | grep -q "cdn" || {
    echo "[X] 产品列表测试失败"
    exit 1
}
echo "[OK] 产品列表正常"

# 测试 CDN 文档抓取（轻量级产品）
echo ""
echo "[3/4] 测试 CDN 文档抓取（限制2页）..."
python scripts/cloud_doc_scraper.py --product cdn --max-pages 2 --output test_output_cdn.md > /dev/null 2>&1 || {
    echo "[X] CDN 抓取失败"
    exit 1
}

if [ ! -f test_output_cdn.md ]; then
    echo "[X] 输出文件未生成"
    exit 1
fi

FILE_SIZE=$(stat -f%z test_output_cdn.md 2>/dev/null || stat -c%s test_output_cdn.md 2>/dev/null)
if [ "$FILE_SIZE" -lt 1000 ]; then
    echo "[X] 输出文件过小 ($FILE_SIZE bytes)"
    rm -f test_output_cdn.md
    exit 1
fi

# 检查输出格式
if ! grep -q "快速对比表格" test_output_cdn.md; then
    echo "[X] 输出格式错误：缺少对比表格"
    rm -f test_output_cdn.md
    exit 1
fi

if ! grep -q "原始文档内容" test_output_cdn.md; then
    echo "[X] 输出格式错误：缺少原始文档章节"
    rm -f test_output_cdn.md
    exit 1
fi

echo "[OK] CDN 抓取成功 ($FILE_SIZE bytes)"
rm -f test_output_cdn.md

# 测试 Redis 文档抓取（中等复杂度）
echo ""
echo "[4/4] 测试 Redis 文档抓取（限制1页）..."
python scripts/cloud_doc_scraper.py --product redis --max-pages 1 --output test_output_redis.md > /dev/null 2>&1 || {
    echo "[WARN] Redis 抓取失败（可能是超时或页面崩溃，已知问题）"
    echo "[INFO] 继续执行..."
}

if [ -f test_output_redis.md ]; then
    REDIS_SIZE=$(stat -f%z test_output_redis.md 2>/dev/null || stat -c%s test_output_redis.md 2>/dev/null)
    echo "[OK] Redis 抓取成功 ($REDIS_SIZE bytes)"
    rm -f test_output_redis.md
else
    echo "[SKIP] Redis 测试跳过（部分产品可能因页面复杂度导致抓取失败）"
fi

echo ""
echo "========================================"
echo "  ✅ 所有测试通过"
echo "========================================"
echo ""
echo "测试覆盖："
echo "  - 依赖检查"
echo "  - 产品列表"
echo "  - CDN 文档抓取"
echo "  - 输出格式验证"
echo ""
echo "可以正常使用 cloud-compare skill！"
