import type { OpenAPIHono } from '@hono/zod-openapi'
import { DocumentController } from '../controllers/document.controller'
import type { DocumentRepository } from '../repositories/document.repository'
import { DocumentService } from '../services/document.service'
import type { AppEnvironment } from '../types/app.types'
import type { BlobStorage } from '../types/document.types'
import type { ResumeParser, ResumeTextExtractor } from '../types/document.types'
import { registerDocumentRoutes } from './document.routes'
import { registerDocumentationRoutes } from './documentation.routes'
import { registerHealthRoutes } from './health.routes'

export interface RouteDependencies {
  repository: DocumentRepository
  storage: BlobStorage
  extractor: ResumeTextExtractor
  parser: ResumeParser
  apiKey: string
}

export function registerRoutes(
  app: OpenAPIHono<AppEnvironment>,
  dependencies: RouteDependencies
): void {
  const service = new DocumentService(
    dependencies.repository,
    dependencies.storage,
    dependencies.extractor,
    dependencies.parser
  )

  registerHealthRoutes(app)
  registerDocumentRoutes(app, {
    controller: new DocumentController(service),
    apiKey: dependencies.apiKey
  })
  registerDocumentationRoutes(app)
}
