# 生成本地测试页：把 darkroom/index.html 复制成 .review/harness/index.html，资源指回 darkroom/，并在 bridge.js 前插入模拟宿主 mock.js。
# 用法（在仓库根目录）：
#   python tools/harness/build.py
#   python tools/nocache_server.py . 8732
#   打开 http://127.0.0.1:8732/.review/harness/index.html （手机视口 390×844，另查 360×640）
# 改了 darkroom/index.html 之后要重新生成；只改 css / js 不用。
import io
import os

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src = io.open(os.path.join(root, 'darkroom', 'index.html'), encoding='utf-8').read()

pairs = [
    ('href="./style.css"', 'href="../../darkroom/style.css"'),
    ('<script defer src="./bridge.js"></script>',
     '<script src="../../tools/harness/mock.js"></script>\n  <script defer src="../../darkroom/bridge.js"></script>'),
    ('src="./film.js"', 'src="../../darkroom/film.js"'),
    ('src="./app.js"', 'src="../../darkroom/app.js"'),
    ('data-sample-src="./sample-clouds.jpg"', 'data-sample-src="../../darkroom/sample-clouds.jpg"'),
]
for old, new in pairs:
    if old not in src:
        raise SystemExit('index.html 里找不到：' + old)
    src = src.replace(old, new)

out_dir = os.path.join(root, '.review', 'harness')
os.makedirs(out_dir, exist_ok=True)
io.open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8', newline='\n').write(src)
print('已生成 .review/harness/index.html')
