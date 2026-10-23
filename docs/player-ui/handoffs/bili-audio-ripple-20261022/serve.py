#!/usr/bin/env python3
"""Two local origins for the captureStream probe.

8801: same-origin assets + /redir (302 -> 8802, cross-origin)
8802: cross-origin asset host

Both honour Range (206) like the app's /music/go proxy.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
CROSS = "http://127.0.0.1:8802"

MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",   # B站 m4s 上游实际就是 video/mp4
    ".html": "text/html; charset=utf-8",
}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, headers, body=b""):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/report":
            qs = urllib.parse.parse_qs(parsed.query)
            with open(os.path.join(ROOT, "report.jsonl"), "a") as f:
                f.write(qs.get("data", [""])[0] + "\n")
            self._send(200, {"Content-Type": "text/plain"}, b"ok")
            return
        path = parsed.path
        if self.server.server_address[1] == 8801 and path == "/redir":
            self._send(302, {"Location": CROSS + "/tone.mp3"})
            return
        if path == "/":
            path = "/probe.html"
        forced = None
        if path.startswith("/octet/"):
            forced = "application/octet-stream"
            path = path[len("/octet"):]
        fs = os.path.join(ROOT, path.lstrip("/"))
        if not os.path.isfile(fs):
            self._send(404, {"Content-Type": "text/plain"}, b"nope")
            return
        size = os.path.getsize(fs)
        ctype = forced or MIME.get(os.path.splitext(fs)[1].lower(), "application/octet-stream")
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        status = 200
        if rng and rng.startswith("bytes="):
            part = rng[6:].split("-")
            start = int(part[0] or 0)
            end = int(part[1]) if len(part) > 1 and part[1] else size - 1
            end = min(end, size - 1)
            status = 206
        with open(fs, "rb") as f:
            f.seek(start)
            body = f.read(end - start + 1)
        headers = {
            "Content-Type": ctype,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        }
        if status == 206:
            headers["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
        self._send(status, headers, body)


class Threaded(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    a = Threaded(("127.0.0.1", 8801), Handler)
    b = Threaded(("127.0.0.1", 8802), Handler)
    threading.Thread(target=a.serve_forever, daemon=True).start()
    threading.Thread(target=b.serve_forever, daemon=True).start()
    print("serving 8801 + 8802", flush=True)
    threading.Event().wait()


if __name__ == "__main__":
    main()
