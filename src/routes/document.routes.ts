import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import { ERROR_CODES, MAX_REQUEST_BYTES } from '../constants/document.constants'
import type { DocumentController } from '../controllers/document.controller'
import {
  CreateDocumentFormSchema,
  CreateVersionFormSchema,
  DocumentListResponseSchema,
  DocumentParamsSchema,
  DocumentResponseSchema,
  ErrorEnvelopeSchema,
  PageQuerySchema,
  VersionListResponseSchema,
  VersionParamsSchema,
  VersionResponseSchema
} from '../dtos/document.dto'
import { bearerAuthMiddleware } from '../middleware/auth.middleware'
import type { AppEnvironment } from '../types/app.types'

const jsonContent = (schema: typeof ErrorEnvelopeSchema) => ({
  'application/json': { schema }
})

const badRequest = {
  description: 'Invalid request',
  content: jsonContent(ErrorEnvelopeSchema)
}
const unauthorized = {
  description: 'Unauthorized',
  content: jsonContent(ErrorEnvelopeSchema)
}
const notFound = {
  description: 'Not found',
  content: jsonContent(ErrorEnvelopeSchema)
}
const payloadTooLarge = {
  description: 'File too large',
  content: jsonContent(ErrorEnvelopeSchema)
}
const unsupportedMediaType = {
  description: 'Unsupported document type',
  content: jsonContent(ErrorEnvelopeSchema)
}
const unprocessableDocument = {
  description: 'Document text cannot be extracted or parsed',
  content: jsonContent(ErrorEnvelopeSchema)
}
const internalError = {
  description: 'Internal server error',
  content: jsonContent(ErrorEnvelopeSchema)
}
const upstreamError = {
  description: 'AI Gateway or Blob storage error',
  content: jsonContent(ErrorEnvelopeSchema)
}
const databaseError = {
  description: 'Database unavailable',
  content: jsonContent(ErrorEnvelopeSchema)
}

const security = [{ bearerAuth: [] }]

const createDocumentRoute = createRoute({
  method: 'post',
  path: '/v1/documents',
  tags: ['Documents'],
  summary: 'Create a document with version 1',
  security,
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': { schema: CreateDocumentFormSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Document created',
      content: { 'application/json': { schema: DocumentResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    413: payloadTooLarge,
    415: unsupportedMediaType,
    422: unprocessableDocument,
    500: internalError,
    502: upstreamError,
    503: databaseError
  }
})

const listDocumentsRoute = createRoute({
  method: 'get',
  path: '/v1/documents',
  tags: ['Documents'],
  summary: 'List documents',
  security,
  request: { query: PageQuerySchema },
  responses: {
    200: {
      description: 'Cursor-paginated documents',
      content: { 'application/json': { schema: DocumentListResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    500: internalError,
    503: databaseError
  }
})

const getDocumentRoute = createRoute({
  method: 'get',
  path: '/v1/documents/{documentId}',
  tags: ['Documents'],
  summary: 'Get a document and its current ready version',
  security,
  request: { params: DocumentParamsSchema },
  responses: {
    200: {
      description: 'Document metadata',
      content: { 'application/json': { schema: DocumentResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    500: internalError,
    503: databaseError
  }
})

const createVersionRoute = createRoute({
  method: 'post',
  path: '/v1/documents/{documentId}/versions',
  tags: ['Versions'],
  summary: 'Upload the next immutable document version',
  security,
  request: {
    params: DocumentParamsSchema,
    body: {
      required: true,
      content: {
        'multipart/form-data': { schema: CreateVersionFormSchema }
      }
    }
  },
  responses: {
    201: {
      description: 'Document version created',
      content: { 'application/json': { schema: DocumentResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    413: payloadTooLarge,
    415: unsupportedMediaType,
    422: unprocessableDocument,
    500: internalError,
    502: upstreamError,
    503: databaseError
  }
})

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/v1/documents/{documentId}/versions',
  tags: ['Versions'],
  summary: 'List ready versions newest-first',
  security,
  request: { params: DocumentParamsSchema, query: PageQuerySchema },
  responses: {
    200: {
      description: 'Cursor-paginated document versions',
      content: { 'application/json': { schema: VersionListResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    500: internalError,
    503: databaseError
  }
})

const getVersionRoute = createRoute({
  method: 'get',
  path: '/v1/documents/{documentId}/versions/{version}',
  tags: ['Versions'],
  summary: 'Get one ready document version',
  security,
  request: { params: VersionParamsSchema },
  responses: {
    200: {
      description: 'Document version metadata',
      content: { 'application/json': { schema: VersionResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    500: internalError,
    503: databaseError
  }
})

const downloadVersionRoute = createRoute({
  method: 'get',
  path: '/v1/documents/{documentId}/versions/{version}/download',
  tags: ['Versions'],
  summary: 'Redirect to a five-minute signed private Blob URL',
  security,
  request: { params: VersionParamsSchema },
  responses: {
    302: {
      description: 'Temporary signed download redirect',
      headers: {
        Location: {
          description: 'Short-lived private Blob URL',
          schema: { type: 'string', format: 'uri' }
        }
      }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    500: internalError,
    502: upstreamError,
    503: databaseError
  }
})

const reparseVersionRoute = createRoute({
  method: 'post',
  path: '/v1/documents/{documentId}/versions/{version}/reparse',
  tags: ['Versions'],
  summary: 'Create the next parsed résumé revision from the immutable file',
  description:
    'Downloads the private source internally and promotes a new parse only after successful extraction and AI validation.',
  security,
  request: { params: VersionParamsSchema },
  responses: {
    200: {
      description: 'New parsed résumé revision',
      content: { 'application/json': { schema: VersionResponseSchema } }
    },
    400: badRequest,
    401: unauthorized,
    404: notFound,
    422: unprocessableDocument,
    500: internalError,
    502: upstreamError,
    503: databaseError
  }
})

export function registerDocumentRoutes(
  app: OpenAPIHono<AppEnvironment>,
  dependencies: { controller: DocumentController; apiKey: string }
): void {
  const { controller, apiKey } = dependencies
  app.use('/v1/*', bearerAuthMiddleware(apiKey))

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

  app.openapi(createDocumentRoute, async (context) => {
    const form = context.req.valid('form')
    const data = await controller.create(form.file, form.title)
    return context.json({ data, requestId: context.get('requestId') }, 201)
  })

  app.openapi(listDocumentsRoute, async (context) => {
    const query = context.req.valid('query')
    const data = await controller.list(query.limit, query.cursor)
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })

  app.openapi(getDocumentRoute, async (context) => {
    const { documentId } = context.req.valid('param')
    const data = await controller.get(documentId)
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })

  app.openapi(createVersionRoute, async (context) => {
    const { documentId } = context.req.valid('param')
    const form = context.req.valid('form')
    const data = await controller.addVersion(
      documentId,
      form.file,
      form.changeNote
    )
    return context.json({ data, requestId: context.get('requestId') }, 201)
  })

  app.openapi(listVersionsRoute, async (context) => {
    const { documentId } = context.req.valid('param')
    const query = context.req.valid('query')
    const data = await controller.listVersions(
      documentId,
      query.limit,
      query.cursor
    )
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })

  app.openapi(getVersionRoute, async (context) => {
    const { documentId, version } = context.req.valid('param')
    const data = await controller.getVersion(documentId, version)
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })

  app.openapi(reparseVersionRoute, async (context) => {
    const { documentId, version } = context.req.valid('param')
    const data = await controller.reparseVersion(documentId, version)
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })

  app.openapi(downloadVersionRoute, async (context) => {
    const { documentId, version } = context.req.valid('param')
    const location = await controller.createDownloadUrl(documentId, version)
    return context.redirect(location, 302)
  })
}
