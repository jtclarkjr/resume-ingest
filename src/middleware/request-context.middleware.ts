import type { MiddlewareHandler } from 'hono'
import type { AppEnvironment } from '../types/app.types'

export function requestContextMiddleware(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const incomingRequestId = context.req.header('x-request-id')
    const requestId =
      incomingRequestId && incomingRequestId.length <= 128
        ? incomingRequestId
        : crypto.randomUUID()
    context.set('requestId', requestId)
    context.header('x-request-id', requestId)

    const startedAt = performance.now()
    await next()
    console.info(
      JSON.stringify({
        requestId,
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      })
    )
  }
}
