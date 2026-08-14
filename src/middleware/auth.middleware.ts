import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { ERROR_CODES } from '../constants/document.constants'
import type { AppEnvironment } from '../types/app.types'

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

export function bearerAuthMiddleware(
  expectedKey: string
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const authorization = context.req.header('authorization')
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    if (!token || !secureEqual(token, expectedKey)) {
      return context.json(
        {
          error: {
            code: ERROR_CODES.unauthorized,
            message: 'A valid bearer API key is required',
            requestId: context.get('requestId')
          }
        },
        401,
        { 'WWW-Authenticate': 'Bearer' }
      )
    }
    await next()
  }
}
