import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnvironment } from '../types/app.types'

export function success<T>(
  context: Context<AppEnvironment>,
  data: T,
  status: ContentfulStatusCode = 200
) {
  return context.json({ data, requestId: context.get('requestId') }, status)
}
