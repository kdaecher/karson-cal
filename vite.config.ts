import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const extractHostTarget = (path: string) => {
  const match = path.match(/^\/api\/ical\/([^/]+)(\/|$)/)
  if (match && match[1].includes('.')) {
    const newPath = path.replace(/^\/api\/ical\/[^/]+/, '') || '/'
    return { host: match[1], path: newPath }
  }
  return null
}

const getOrigin = (req: any) => {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  return `${proto}://${req.headers.host}`
}

const rewriteXmlHref = (xml: string, origin: string) =>
  xml
    .replace(
      /https?:\/\/([^/]+)(\/[^<]*)/gi,
      `${origin}/api/ical/$1$2`
    )
    .replace(
      /(<(?:\w+:)?href(?:\s+[^>]*)?>)(\/(?!api\/ical)[^<]+)/gi,
      `$1${origin}/api/ical$2`
    )

const createCaldavProxy = () =>
  ({
    target: 'https://caldav.icloud.com',
    changeOrigin: true,
    rewrite: (path: string) => {
      const info = extractHostTarget(path)
      if (info) return info.path
      return path.replace(/^\/api\/ical/, '')
    },
    selfHandleResponse: true,
    router: (req: any) => {
      const info = extractHostTarget(req.url || '')
      return info ? `https://${info.host}` : 'https://caldav.icloud.com'
    },
    configure: (proxy: any) => {
      proxy.on('proxyReq', (proxyReq: any) => {
        proxyReq.setHeader('Accept-Encoding', 'identity')
      })
      proxy.on('proxyRes', (proxyRes: any, _req: any, res: any) => {
        const origin = getOrigin(_req)
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks)
          const headers = { ...proxyRes.headers }
          const contentType = String(headers['content-type'] || '')
          let output = body

          if (contentType.includes('xml')) {
            const text = rewriteXmlHref(body.toString('utf8'), origin)
            output = Buffer.from(text, 'utf8')
            delete headers['content-encoding']
            headers['content-length'] = String(output.length)
          }

          if (headers.location) {
            const location = String(headers.location)
            if (location.startsWith('http')) {
              headers.location = location.replace(
                /https?:\/\/([^/]+)(\/.*)?/gi,
                `${origin}/api/ical/$1$2`
              )
            } else {
              headers.location = location.replace(
                /^\/(?!api\/ical)/,
                `${origin}/api/ical/`
              )
            }
          }

          res.writeHead(proxyRes.statusCode || 200, headers)
          res.end(output)
        })
      })
    },
  }) as any

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '/api/ical': createCaldavProxy(),
      '/.well-known/caldav': createCaldavProxy(),
    },
  }
})
