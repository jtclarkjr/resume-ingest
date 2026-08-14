import { swaggerUI } from '@hono/swagger-ui'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { API_VERSION } from '../constants/document.constants'
import type { AppEnvironment } from '../types/app.types'

export function registerDocumentationRoutes(
  app: OpenAPIHono<AppEnvironment>
): void {
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'API key',
    description: 'Paste the DOCUMENT_API_KEY value.'
  })

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
}
