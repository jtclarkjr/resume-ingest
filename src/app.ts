import { OpenAPIHono } from '@hono/zod-openapi'
import { secureHeaders } from 'hono/secure-headers'
import { ERROR_CODES } from './constants/document.constants'
import { AppError } from './errors/app-error'
import { requestContextMiddleware } from './middleware/request-context.middleware'
import type { DocumentRepository } from './repositories/document.repository'
import { registerRoutes } from './routes'
import type { AppEnvironment } from './types/app.types'
import type {
  BlobStorage,
  ResumeParser,
  ResumeTextExtractor
} from './types/document.types'
import type { ResumeWorkCombiner } from './types/resume-work.types'

export interface ApplicationDependencies {
  repository: DocumentRepository
  storage: BlobStorage
  extractor: ResumeTextExtractor
  parser: ResumeParser
  workCombiner: ResumeWorkCombiner
  apiKey: string
}

export function createApplication(dependencies: ApplicationDependencies) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) => {
      if (result.success) return
      return context.json(
        {
          error: {
            code: ERROR_CODES.validation,
            message: 'The request is invalid',
            details: result.error.issues,
            requestId: context.get('requestId')
          }
        },
        400
      )
    }
  })

  app.use('*', requestContextMiddleware())
  app.use('*', secureHeaders())
  app.use('/v1/*', async (context, next) => {
    await next()
    context.header('Cache-Control', 'private, no-store')
  })
  registerRoutes(app, dependencies)

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          requestId: context.get('requestId')
        }
      },
      404
    )
  )

  app.onError((error, context) => {
    if (error instanceof AppError) {
      if (error.status >= 500) {
        console.error('Request failed', {
          requestId: context.get('requestId'),
          code: error.code,
          error: error.message,
          cause: error.details
        })
      }
      return context.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.status < 500 && error.details
              ? { details: error.details }
              : {}),
            requestId: context.get('requestId')
          }
        },
        error.status
      )
    }

    console.error('Unhandled request error', {
      requestId: context.get('requestId'),
      error: error instanceof Error ? error.message : String(error)
    })
    return context.json(
      {
        error: {
          code: ERROR_CODES.internal,
          message: 'An unexpected error occurred',
          requestId: context.get('requestId')
        }
      },
      500
    )
  })

  return app
}
