#!/usr/bin/env python3
"""Hit Aster's public market-data endpoints and print the shapes.

No API keys, no signatures, no order calls. Stdlib only.

Usage:
    python3 scripts/verify_aster_public.py
"""

from __future__ import annotations

import base64
import json
import os
import socket
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request

UA = "aster-stage0-verify/1.0"
TIMEOUT = 20


def http_get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read()
            weight = {
                key: value
                for key, value in response.headers.items()
                if key.lower().startswith("x-mbx")
            }
            return {
                "url": url,
                "status": response.status,
                "ms": round((time.time() - started) * 1000),
                "weight": weight,
                "bytes": len(body),
                "json": json.loads(body.decode("utf-8")),
            }
    except urllib.error.HTTPError as error:
        payload = error.read()[:300]
        return {
            "url": url,
            "status": error.code,
            "ms": round((time.time() - started) * 1000),
            "error": payload.decode("utf-8", "replace"),
        }
    except Exception as error:  # noqa: BLE001 — report and keep going
        return {
            "url": url,
            "status": None,
            "ms": round((time.time() - started) * 1000),
            "error": str(error),
        }


def ws_one_text(host: str, path: str) -> dict:
    """Read a single text frame from a public market stream."""
    context = ssl.create_default_context()
    raw = socket.create_connection((host, 443), timeout=TIMEOUT)
    tls = context.wrap_socket(raw, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        f"User-Agent: {UA}\r\n\r\n"
    )
    tls.sendall(handshake.encode())
    tls.settimeout(TIMEOUT)
    buffer = b""
    while b"\r\n\r\n" not in buffer:
        chunk = tls.recv(4096)
        if not chunk:
            break
        buffer += chunk
    header, _, rest = buffer.partition(b"\r\n\r\n")
    status_line = header.split(b"\r\n", 1)[0].decode("latin1", "replace")
    data = rest
    payload = None
    deadline = time.time() + TIMEOUT
    while time.time() < deadline and payload is None:
        if len(data) < 2:
            data += tls.recv(4096)
            continue
        opcode = data[0] & 0x0F
        masked = (data[1] & 0x80) != 0
        length = data[1] & 0x7F
        index = 2
        if length == 126:
            length = struct.unpack("!H", data[2:4])[0]
            index = 4
        elif length == 127:
            length = struct.unpack("!Q", data[2:10])[0]
            index = 10
        if masked:
            index += 4
        if len(data) < index + length:
            data += tls.recv(8192)
            continue
        frame = data[index : index + length]
        if opcode == 0x1:
            payload = frame[:500].decode("utf-8", "replace")
        elif opcode == 0x9:
            data = data[index + length :]
            continue
        else:
            payload = f"opcode={opcode}"
    tls.close()
    return {"host": host, "path": path, "status": status_line, "payload": payload}


def summarize_exchange(payload: dict) -> dict:
    symbols = payload.get("symbols") or []
    focus = {}
    for symbol in symbols:
        name = symbol.get("symbol")
        if name in {"BTCUSDT", "ETHUSDT"}:
            focus[name] = {
                "contractType": symbol.get("contractType"),
                "status": symbol.get("status"),
                "marginAsset": symbol.get("marginAsset"),
                "quoteAsset": symbol.get("quoteAsset"),
                "orderTypes": symbol.get("orderTypes"),
                "timeInForce": symbol.get("timeInForce"),
                "minNotional": next(
                    (
                        item.get("notional")
                        for item in symbol.get("filters") or []
                        if item.get("filterType") == "MIN_NOTIONAL"
                    ),
                    None,
                ),
            }
    return {
        "futuresType": payload.get("futuresType"),
        "timezone": payload.get("timezone"),
        "rateLimits": payload.get("rateLimits"),
        "symbolCount": len(symbols),
        "focus": focus,
    }


def main() -> int:
    checks = [
        ("mainnet_ping", "https://fapi.asterdex.com/fapi/v3/ping"),
        ("mainnet_time", "https://fapi.asterdex.com/fapi/v3/time"),
        ("mainnet_exchange", "https://fapi.asterdex.com/fapi/v3/exchangeInfo"),
        ("btc_premium", "https://fapi.asterdex.com/fapi/v3/premiumIndex?symbol=BTCUSDT"),
        ("btc_funding", "https://fapi.asterdex.com/fapi/v3/fundingRate?symbol=BTCUSDT&limit=1"),
        ("btc_funding_info", "https://fapi.asterdex.com/fapi/v3/fundingInfo?symbol=BTCUSDT"),
        ("btc_klines", "https://fapi.asterdex.com/fapi/v3/klines?symbol=BTCUSDT&interval=5m&limit=1"),
        ("btc_price", "https://fapi.asterdex.com/fapi/v3/ticker/price?symbol=BTCUSDT"),
        ("btc_depth", "https://fapi.asterdex.com/fapi/v3/depth?symbol=BTCUSDT&limit=5"),
        ("testnet_ping", "https://fapi.asterdex-testnet.com/fapi/v3/ping"),
        ("testnet_time", "https://fapi.asterdex-testnet.com/fapi/v3/time"),
    ]
    report = {"http": {}, "websocket": []}
    failures = []
    for name, url in checks:
        result = http_get(url)
        if name == "mainnet_exchange" and isinstance(result.get("json"), dict):
            result["summary"] = summarize_exchange(result.pop("json"))
        if name == "btc_depth" and isinstance(result.get("json"), dict):
            book = result["json"]
            result["json"] = {
                "lastUpdateId": book.get("lastUpdateId"),
                "bidLevels": len(book.get("bids") or []),
                "askLevels": len(book.get("asks") or []),
                "bestBid": (book.get("bids") or [[None]])[0],
                "bestAsk": (book.get("asks") or [[None]])[0],
            }
        report["http"][name] = result
        if result.get("status") != 200:
            failures.append(name)

    for host, path in (
        ("fstream.asterdex.com", "/ws/btcusdt@markPrice"),
        ("fstream.asterdex-testnet.com", "/ws/btcusdt@markPrice"),
    ):
        try:
            frame = ws_one_text(host, path)
        except Exception as error:  # noqa: BLE001
            frame = {"host": host, "path": path, "error": str(error)}
            failures.append(host)
        report["websocket"].append(frame)
        if "101" not in str(frame.get("status", "")):
            failures.append(host)

    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    if failures:
        print("FAILED:", ", ".join(failures), file=sys.stderr)
        return 1
    print("Public Aster market-data checks passed.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
