# _build · 生成器（可选）

这两个脚本是"单一数据源 → SVG + geometry.json"的生成器。**交付的 SVG 已经生成好，正常不需要跑它们**；只有当你需要改几何（列宽、行高、字位）时才用。

| 脚本 | 产出 |
|---|---|
| `gen_table_a.py` | `全站仪导线观测记录表.svg` + `geometry.json`（表 A，全站仪导线观测记录表） |
| `gen_table_b.py` | `三四等水准-记录表.svg` + `三四等水准-geometry.json`（表 B，三、四等水准测量记录、计算表） |

## 跑之前改两处路径

两个脚本顶部都有：

```python
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("JUJIN_OUT", os.path.dirname(HERE))
```

输出目录可用环境变量 `JUJIN_OUT` 覆盖。预览脚本的字体目录默认指向仓库里的 `web/assets/fonts`，也可用 `JUJIN_FONTS` 覆盖：

```python
FONTS = os.environ.get("JUJIN_FONTS", os.path.join(HERE, "..", "..", "web", "assets", "fonts"))
```

## 用法

```powershell
python gen_table_a.py     # 输出 SVG + JSON
python gen_table_b.py
```

改几何就改脚本里的 `COLS` / `ROWS` / 文字表，**不要手改 SVG**——手改会让 SVG 与 geometry.json 失配。

## 预览渲染

`preview_build*.py` 把 SVG 内联进一个 HTML 并内嵌 HarmonyOS Sans SC（woff2 → data URI），用无头 Edge 截图：

```powershell
& msedge --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1600,1098 --screenshot=preview.png file:///.../preview.html
```

表 A 用 `1600×1098`，表 B 用 `1036×1638`。
