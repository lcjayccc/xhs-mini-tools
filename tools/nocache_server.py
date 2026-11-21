# 不缓存的本地静态服务：python -m http.server 会让浏览器缓存 js / css，改完代码截图看到的还是旧版。
# 用法：python tools/nocache_server.py <目录> <端口>，例如 python tools/nocache_server.py . 8732
import functools
import http.server
import sys

root, port = sys.argv[1], int(sys.argv[2])


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCache, directory=root)
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
