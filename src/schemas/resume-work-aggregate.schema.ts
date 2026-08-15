import { z } from '@hono/zod-openapi'
import { ResumeWorkSchema } from './resume.schema'

export const ResumeWorkCombineOutputSchema = z.object({
  work: z.array(ResumeWorkSchema),
  warnings: z.array(z.string()).max(50)
})

export const ResumeWorkSourceSchema = z
  .object({
    documentId: z.uuid(),
    version: z.number().int().positive(),
    parseRevision: z.number().int().positive(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .openapi('ResumeWorkSource')

export const ResumeWorkAggregateSchema = z
  .object({
    work: z.array(ResumeWorkSchema),
    warnings: z.array(z.string()),
    generatedAt: z.iso.datetime(),
    model: z.string(),
    sources: z.array(ResumeWorkSourceSchema)
  })
  .openapi('ResumeWorkAggregate')

export type ResumeWorkCombineOutput = z.infer<
  typeof ResumeWorkCombineOutputSchema
>
