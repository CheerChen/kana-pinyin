# TODO

## Real-time candidate mode (逐键 + 实时候选)

Current REPL waits for Enter to show candidates. Real IMEs update candidates
on every keystroke. Core changes needed:

1. **Per-key input listener** (instead of waiting for Enter)
   - Capture raw keypresses, not line-buffered input
   - Maintain a live input buffer string

2. **Incremental language detection**
   - Re-run detector on each keystroke
   - Lock language once confident (3-4 chars usually enough)
   - Reset lock on commit/clear

3. **Chinese pipeline: syllable boundary detection + debounce**
   - Detect when a pinyin syllable is complete (e.g. `ni` → complete, `nih` → incomplete)
   - Only query dictionary when a syllable boundary is crossed
   - Debounce ~100-150ms to avoid queries during fast typing
   - Update candidate list in place (not reprint)

4. **Live candidate window**
   - Show candidates below the input line, update in place
   - Arrow keys / number keys to select
   - Space or Enter to commit top candidate
   - Backspace to edit input buffer

### Reference UX

```
n          → preedit: "n"
ni         → preedit: "ni"  candidates: [你, 尼, 逆...]
nih        → preedit: "ni h"
niha       → preedit: "ni ha"  candidates: [你好, 你哈...]
nihao      → preedit: "ni hao"  candidates: [你好(top)]
<Space>    → commit: 你好
```

### Segment-level commit (分段上屏)

For long inputs, allow committing word-by-word so a mid-sentence error
doesn't require retyping everything:

```
Input: nihaozhongguoren
Candidates: [你好中国人] (full)  |  [你好]→[中国]→[人] (segmented)
→ commit "你好", continue typing "zhongguoren"
```
