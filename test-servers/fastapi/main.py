import asyncio
import json
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse

app = FastAPI()
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da63fcff1f0003030200efa3c1540000000049454e44ae426082")


@app.get("/ping")
async def ping() -> dict[str, bool]:
    return {"ok": True}


@app.api_route("/echo", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def echo(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    raw = await request.body()
    body: Any = None
    files = []
    if "application/json" in content_type and raw:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = raw.decode("utf-8", errors="replace")
    elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        body = {}
        for key, value in form.multi_items():
            if hasattr(value, "filename"):
                data = await value.read()
                files.append({"fieldname": key, "originalname": value.filename, "mimetype": value.content_type, "size": len(data)})
            else:
                body[key] = value
    elif raw:
        body = raw.decode("utf-8", errors="replace")
    return {"method": request.method, "path": request.url.path, "query": dict(request.query_params), "headers": dict(request.headers), "body": body, "files": files}


@app.get("/status/{code}")
async def status(code: int) -> JSONResponse:
    return JSONResponse(status_code=code, content={"status": code})


@app.get("/slow")
async def slow(ms: int = 5000) -> dict[str, int]:
    await asyncio.sleep(max(0, ms) / 1000)
    return {"waitedMs": max(0, ms)}


@app.get("/big")
async def big(mb: int = 30) -> StreamingResponse:
    remaining = min(30, max(0, mb)) * 1024 * 1024
    chunk = b"x" * (1024 * 1024)

    async def stream():
        nonlocal remaining
        while remaining:
            size = min(len(chunk), remaining)
            remaining -= size
            yield chunk[:size]

    return StreamingResponse(stream(), media_type="text/plain")


@app.get("/bigint")
async def bigint() -> Response:
    return Response('{"id":9007199254740993}', media_type="application/json")


@app.get("/html", response_class=HTMLResponse)
async def html() -> str:
    return "<!doctype html><main><h1>Sandboxed preview</h1><p>Scripts are disabled.</p></main>"


@app.get("/image")
async def image() -> Response:
    return Response(PNG, media_type="image/png")


@app.get("/redirect")
async def redirect() -> RedirectResponse:
    return RedirectResponse("/ping", status_code=302)


@app.get("/sse")
async def sse() -> StreamingResponse:
    async def stream():
        while True:
            yield b": still open\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/empty")
async def empty() -> Response:
    return Response(status_code=204)


@app.get("/latin1")
async def latin1() -> Response:
    return Response(bytes([0x63, 0x61, 0x66, 0xE9]), media_type="text/plain; charset=iso-8859-1")