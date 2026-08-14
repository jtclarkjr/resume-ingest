import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ContentfulStatusCode,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}
