import { z } from '@hono/zod-openapi'
import { RequestIdSchema } from './document.dto'
import { ResumeWorkAggregateSchema } from '../schemas/resume-work-aggregate.schema'
import type { ResumeWorkAggregateReady } from '../types/resume-work.types'

export const ResumeWorkResponseSchema = z
  .object({ data: ResumeWorkAggregateSchema, requestId: RequestIdSchema })
  .openapi('ResumeWorkResponse')

export type ResumeWorkAggregateDto = z.infer<typeof ResumeWorkAggregateSchema>

export function toResumeWorkAggregateDto(
  aggregate: ResumeWorkAggregateReady
): ResumeWorkAggregateDto {
  return {
    work: aggregate.work,
    warnings: aggregate.warnings,
    generatedAt: aggregate.generatedAt.toISOString(),
    model: aggregate.model,
    sources: aggregate.sources
  }
}
