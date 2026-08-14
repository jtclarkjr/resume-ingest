import type { OpenAPIHono } from '@hono/zod-openapi'
import { API_VERSION } from '../constants/document.constants'
import type { AppEnvironment } from '../types/app.types'

export function registerHealthRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.get('/health', (context) =>
    context.json({
      data: { status: 'ok', version: API_VERSION },
      requestId: context.get('requestId')
    })
  )
}
