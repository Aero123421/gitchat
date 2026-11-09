"""Static file server for the UI prototype with caching turned off, so edits show up on reload."""

import functools
import http.server
import sys


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
root = sys.argv[2] if len(sys.argv) > 2 else "."
handler = functools.partial(NoStoreHandler, directory=root)
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
