import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import {
  API_VERSION,
  ERROR_CODES,
  MAX_REQUEST_BYTES
} from './constants/document.constants'
import { DocumentController } from './controllers/document.controller'
import { AppError } from './errors/app-error'
import { bearerAuthMiddleware } from './middleware/auth.middleware'
import { requestContextMiddleware } from './middleware/request-context.middleware'
import type { DocumentRepository } from './repositories/document.repository'
import { registerDocumentRoutes } from './routes/document.routes'
import { DocumentService } from './services/document.service'
import type { AppEnvironment } from './types/app.types'
import type { BlobStorage } from './types/document.types'

export interface ApplicationDependencies {
  repository: DocumentRepository
  storage: BlobStorage
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
  app.use('/v1/*', bearerAuthMiddleware(dependencies.apiKey))
  const uploadLimit = bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (context) =>
      context.json(
        {
          error: {
            code: ERROR_CODES.payloadTooLarge,
            message: 'The multipart request is too large',
            requestId: context.get('requestId')
          }
        },
        413
      )
  })
  app.use('/v1/documents', uploadLimit)
  app.use('/v1/documents/*/versions', uploadLimit)

  app.get('/health', (context) =>
    context.json({
      data: { status: 'ok', version: API_VERSION },
      requestId: context.get('requestId')
    })
  )

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'API key',
    description: 'Paste the DOCUMENT_API_KEY value.'
  })

  const service = new DocumentService(
    dependencies.repository,
    dependencies.storage
  )
  registerDocumentRoutes(app, new DocumentController(service))

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Resume Ingest API',
      version: API_VERSION,
      description:
        'Upload private PDF, DOCX, and DOC files and manage immutable document versions.'
    },
    servers: [{ url: '/', description: 'Current deployment' }],
    tags: [
      { name: 'Documents', description: 'Logical document operations' },
      { name: 'Versions', description: 'Immutable file version operations' }
    ]
  })

  app.use('/docs', async (context, next) => {
    context.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'"
    )
    context.header('Cache-Control', 'no-store')
    await next()
  })
  app.get(
    '/docs',
    swaggerUI({
      url: '/openapi.json',
      version: '5.32.9',
      deepLinking: true,
      displayRequestDuration: true,
      persistAuthorization: false,
      tryItOutEnabled: true
    })
  )

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
