#!/bin/bash
# prompt-optimizer 测试脚本（纯文本 skill，验证文档完整性）
set +e

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SKILL_ROOT" || exit 1

PASS=0
FAIL=0
RESULTS=()

run_test() {
  local name="$1"
  local cmd="$2"
  local expect="$3"
  echo ""
  echo "=========================================="
  echo "  [测试] $name"
  echo "=========================================="
  local output
  output=$(eval "$cmd" 2>&1)
  if echo "$output" | grep -q "$expect"; then
    echo "[PASS] $name"
    PASS=$((PASS + 1))
    RESULTS+=("[PASS] $name")
  else
    echo "[FAIL] $name (期望: $expect)"
    FAIL=$((FAIL + 1))
    RESULTS+=("[FAIL] $name")
  fi
}

echo ""
echo "##########################################"
echo "  prompt-optimizer 测试套件"
echo "##########################################"

# 1. SKILL.md 存在
run_test "SKILL.md 文件存在" \
  "ls SKILL.md 2>&1" \
  "SKILL.md"

# 2. YAML frontmatter
run_test "YAML frontmatter - name 字段" \
  "head -10 SKILL.md 2>&1" \
  "name:"

# 3. YAML frontmatter - description
run_test "YAML frontmatter - description 字段" \
  "head -10 SKILL.md 2>&1" \
  "description:"

# 4. 包含 CO-STAR 方法论
run_test "方法论 - CO-STAR 框架" \
  "cat SKILL.md 2>&1" \
  "CO-STAR"

# 5. 包含 Chain-of-Thought
run_test "方法论 - Chain-of-Thought" \
  "cat SKILL.md 2>&1" \
  "Chain-of-Thought"

# 6. 包含 ACON
run_test "方法论 - ACON" \
  "cat SKILL.md 2>&1" \
  "ACON"

# 7. 包含 APE
run_test "方法论 - APE" \
  "cat SKILL.md 2>&1" \
  "APE"

# 8. 包含 Self-Refine
run_test "方法论 - Self-Refine" \
  "cat SKILL.md 2>&1" \
  "Self-Refine"

# 9. 双语支持
run_test "双语支持 - 检测语言提示" \
  "cat SKILL.md 2>&1" \
  "Chinese\|English\|双语\|中文"

# 10. 删除的 en 版本不应存在
run_test "prompt-optimizer-en 已删除" \
  "ls ../prompt-optimizer-en 2>&1 || echo 'NOT_FOUND'" \
  "NOT_FOUND"

# 总结
echo ""
echo "##########################################"
echo "  测试结果汇总"
echo "##########################################"
for r in "${RESULTS[@]}"; do
  echo "$r"
done
echo ""
echo "通过: $PASS / $((PASS + FAIL))"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "全部测试通过"
  exit 0
else
  echo "$FAIL 项失败"
  exit 1
fi
