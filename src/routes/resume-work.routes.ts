import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import type { ResumeWorkController } from '../controllers/resume-work.controller'
import { ErrorEnvelopeSchema } from '../dtos/document.dto'
import { ResumeWorkResponseSchema } from '../dtos/resume-work.dto'
import { bearerAuthMiddleware } from '../middleware/auth.middleware'
import type { AppEnvironment } from '../types/app.types'

const errorContent = {
  'application/json': { schema: ErrorEnvelopeSchema }
}

const getResumeWorkRoute = createRoute({
  method: 'get',
  path: '/v1/resume/work',
  tags: ['Resume'],
  summary: 'Get the AI-consolidated work history from current documents',
  description:
    'Uses the current ready parse from every document and regenerates a cached aggregate when those sources change.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Combined JSON Resume work history',
      content: { 'application/json': { schema: ResumeWorkResponseSchema } }
    },
    401: { description: 'Unauthorized', content: errorContent },
    500: { description: 'Internal server error', content: errorContent },
    502: { description: 'AI Gateway error', content: errorContent },
    503: {
      description: 'Database unavailable or aggregate generation in progress',
      content: errorContent
    }
  }
})

export function registerResumeWorkRoutes(
  app: OpenAPIHono<AppEnvironment>,
  dependencies: { controller: ResumeWorkController; apiKey: string }
): void {
  app.use('/v1/resume/work', bearerAuthMiddleware(dependencies.apiKey))
  app.openapi(getResumeWorkRoute, async (context) => {
    const data = await dependencies.controller.get()
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })
}
