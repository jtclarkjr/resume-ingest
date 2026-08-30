import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { ResumeWorkController } from '../controllers/resume-work.controller'
import { ErrorEnvelopeSchema } from '../dtos/document.dto'
import { ResumeWorkResponseSchema } from '../dtos/resume-work.dto'
import { bearerAuthMiddleware } from '../middleware/auth.middleware'
import type { AppEnvironment } from '../types/app.types'

const errorContent = {
  'application/json': { schema: ErrorEnvelopeSchema }
}

const ResumeWorkQuerySchema = z.object({
  lang: z.literal('ja').optional().openapi({
    description: 'Use only verified Japanese 職務経歴書 sources.',
    example: 'ja'
  })
})

const getResumeWorkRoute = createRoute({
  method: 'get',
  path: '/v1/resume/work',
  tags: ['Resume'],
  summary: 'Get the AI-consolidated work history from current documents',
  description:
    'Uses current ready parses. With lang=ja, only verified Japanese 職務経歴書 parses are combined in Japanese; each variant is cached independently and regenerated when its sources change.',
  security: [{ bearerAuth: [] }],
  request: { query: ResumeWorkQuerySchema },
  responses: {
    200: {
      description: 'Combined JSON Resume work history',
      content: { 'application/json': { schema: ResumeWorkResponseSchema } }
    },
    400: { description: 'Invalid language', content: errorContent },
    401: { description: 'Unauthorized', content: errorContent },
    422: {
      description: 'No verified Japanese 職務経歴書 source',
      content: errorContent
    },
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
    const { lang } = context.req.valid('query')
    const data = await dependencies.controller.get(lang)
    return context.json({ data, requestId: context.get('requestId') }, 200)
  })
}
