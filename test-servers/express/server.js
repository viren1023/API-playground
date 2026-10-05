const express = require('express')
const multer = require('multer')

const app = express()
const upload = multer({ limits: { fileSize: 26 * 1024 * 1024 } })
app.use(express.json({ limit: '26mb' }))
app.use(express.urlencoded({ extended: true, limit: '26mb' }))

app.get('/ping', (_req, res) => res.json({ ok: true }))
app.all('/echo', upload.any(), (req, res) => res.json({
  method: req.method,
  path: req.path,
  query: req.query,
  headers: req.headers,
  body: req.body ?? null,
  files: (req.files ?? []).map(({ fieldname, originalname, mimetype, size }) => ({ fieldname, originalname, mimetype, size })),
}))
app.get('/status/:code', (req, res) => res.status(Number(req.params.code)).json({ status: Number(req.params.code) }))
app.get('/slow', (req, res) => setTimeout(() => res.json({ waitedMs: Math.max(0, Number(req.query.ms) || 5000) }), Math.max(0, Number(req.query.ms) || 5000)))
app.get('/big', (req, res) => {
  const bytes = Math.min(30, Math.max(0, Number(req.query.mb) || 30)) * 1024 * 1024
  const chunk = Buffer.alloc(1024 * 1024, 'x')
  res.type('text/plain')
  let written = 0
  const write = () => {
    while (written < bytes) {
      const next = Math.min(chunk.length, bytes - written)
      written += next
      if (!res.write(chunk.subarray(0, next))) { res.once('drain', write); return }
    }
    res.end()
  }
  write()
})
app.get('/bigint', (_req, res) => { res.type('application/json').send('{"id":9007199254740993}') })
app.get('/html', (_req, res) => res.type('html').send('<!doctype html><main><h1>Sandboxed preview</h1><p>Scripts are disabled.</p></main>'))
app.get('/image', (_req, res) => res.type('png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwVQAAAAASUVORK5CYII=', 'base64')))
app.get('/redirect', (_req, res) => res.redirect(302, '/ping'))
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  const timer = setInterval(() => res.write(': still open\n\n'), 1000)
  req.on('close', () => clearInterval(timer))
})
app.get('/empty', (_req, res) => res.status(204).end())
app.get('/latin1', (_req, res) => res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1').end(Buffer.from([0x63, 0x61, 0x66, 0xe9])))

const port = Number(process.env.PORT) || 3000
app.listen(port, '127.0.0.1', () => console.log(`Express fixtures listening at http://127.0.0.1:${port}`))