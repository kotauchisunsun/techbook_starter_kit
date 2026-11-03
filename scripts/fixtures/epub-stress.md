# EPUB 表示のストレステスト

本文を拡大したときも、コードのインデントと数式の構造を確認します。この原稿は通常の本には含めません。

## 長いコード

```python
def summarize_results(items):
    message = "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789"
    return {"accepted_items": [item for item in items if item.get("status") == "accepted"], "message": message, "count": len(items)}

print(summarize_results([{"status": "accepted"}, {"status": "pending"}]))
```

## 長い数式

$$
A+B+C+D+E+F+G+H+I+J+K+L+M+N+O+P+Q+R+S+T=210
$$

## 複数行の数式

$$
\begin{aligned}
x^2-3x+2 &= 0 \\
x^2-x-2x+2 &= 0 \\
x(x-1)-2(x-1) &= 0 \\
(x-1)(x-2) &= 0
\end{aligned}
$$

インラインの分数 $x=\frac{3+\sqrt{9-8}}{2}$ と、次の分数・根号も確認します。

$$
\begin{aligned}
x &= \frac{-(-3)\pm\sqrt{(-3)^2-4\cdot1\cdot2}}{2\cdot1} \\
  &= \frac{3\pm\sqrt{1}}{2} \\
  &= \frac{3\pm1}{2}
\end{aligned}
$$
