import { z } from '@hono/zod-openapi'

const NullableTextSchema = z.string().nullable()
const ResumeDateSchema = z
  .string()
  .regex(/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/)
  .nullable()
  .openapi({
    description: 'Source-precision date: YYYY, YYYY-MM, or YYYY-MM-DD.',
    example: '2024-06'
  })

export const ResumeBasicsSchema = z
  .object({
    name: NullableTextSchema.openapi({ example: 'Jane Doe' }),
    label: NullableTextSchema.openapi({ example: 'Software Engineer' }),
    email: NullableTextSchema.openapi({ example: 'jane@example.com' }),
    phone: NullableTextSchema.openapi({ example: '+81 90 0000 0000' }),
    url: NullableTextSchema.openapi({ example: 'https://janedoe.dev' }),
    summary: NullableTextSchema.openapi({
      example: 'Backend engineer focused on reliable developer platforms.'
    }),
    location: z.object({
      address: NullableTextSchema,
      postalCode: NullableTextSchema,
      city: NullableTextSchema.openapi({ example: 'Tokyo' }),
      countryCode: NullableTextSchema.openapi({ example: 'JP' }),
      region: NullableTextSchema.openapi({ example: 'Tokyo' })
    }),
    profiles: z.array(
      z.object({
        network: NullableTextSchema.openapi({ example: 'LinkedIn' }),
        username: NullableTextSchema.openapi({ example: 'jane-doe' }),
        url: NullableTextSchema.openapi({
          example: 'https://linkedin.com/in/jane-doe'
        })
      })
    ),
    websites: z.array(
      z.object({
        name: NullableTextSchema.openapi({ example: 'Portfolio' }),
        url: z.string().openapi({ example: 'https://janedoe.dev/work' })
      })
    )
  })
  .openapi('ResumeBasics')

export const ResumeWorkSchema = z
  .object({
    name: NullableTextSchema.openapi({ example: 'Example Co.' }),
    position: NullableTextSchema.openapi({ example: 'Senior Engineer' }),
    employmentType: NullableTextSchema.openapi({ example: 'Full-time' }),
    url: NullableTextSchema,
    location: NullableTextSchema.openapi({ example: 'Tokyo, Japan' }),
    startDate: ResumeDateSchema,
    endDate: ResumeDateSchema,
    summary: NullableTextSchema,
    highlights: z.array(z.string()).openapi({
      example: ['Reduced API latency by 35%.', 'Mentored four engineers.']
    })
  })
  .openapi('ResumeWork')

export const ResumeDataSchema = z
  .object({
    basics: ResumeBasicsSchema,
    work: z.array(ResumeWorkSchema),
    volunteer: z.array(
      z.object({
        organization: NullableTextSchema,
        position: NullableTextSchema,
        url: NullableTextSchema,
        startDate: ResumeDateSchema,
        endDate: ResumeDateSchema,
        summary: NullableTextSchema,
        highlights: z.array(z.string())
      })
    ),
    education: z.array(
      z.object({
        institution: NullableTextSchema,
        url: NullableTextSchema,
        area: NullableTextSchema,
        studyType: NullableTextSchema,
        startDate: ResumeDateSchema,
        endDate: ResumeDateSchema,
        score: NullableTextSchema,
        courses: z.array(z.string())
      })
    ),
    skills: z.array(
      z.object({
        name: NullableTextSchema,
        level: NullableTextSchema,
        keywords: z.array(z.string())
      })
    ),
    projects: z.array(
      z.object({
        name: NullableTextSchema,
        description: NullableTextSchema,
        highlights: z.array(z.string()),
        keywords: z.array(z.string()),
        startDate: ResumeDateSchema,
        endDate: ResumeDateSchema,
        url: NullableTextSchema,
        roles: z.array(z.string()),
        entity: NullableTextSchema,
        type: NullableTextSchema
      })
    ),
    awards: z.array(
      z.object({
        title: NullableTextSchema,
        date: ResumeDateSchema,
        awarder: NullableTextSchema,
        summary: NullableTextSchema
      })
    ),
    certificates: z.array(
      z.object({
        name: NullableTextSchema,
        date: ResumeDateSchema,
        issuer: NullableTextSchema,
        url: NullableTextSchema
      })
    ),
    publications: z.array(
      z.object({
        name: NullableTextSchema,
        publisher: NullableTextSchema,
        releaseDate: ResumeDateSchema,
        url: NullableTextSchema,
        summary: NullableTextSchema
      })
    ),
    languages: z.array(
      z.object({
        language: NullableTextSchema,
        fluency: NullableTextSchema
      })
    ),
    interests: z.array(
      z.object({
        name: NullableTextSchema,
        keywords: z.array(z.string())
      })
    )
  })
  .openapi('ResumeData')

export const ResumeParserOutputSchema = z.object({
  data: ResumeDataSchema,
  warnings: z.array(z.string()).max(50)
})

export const ParsedResumeSchema = z
  .object({
    schemaVersion: z.string().openapi({ example: '1.0' }),
    parserVersion: z.string().openapi({ example: 'resume-json-v1' }),
    model: z.string().openapi({ example: 'openai/gpt-5.4-mini' }),
    parseRevision: z.number().int().positive().openapi({ example: 1 }),
    parsedAt: z.iso.datetime().openapi({ example: '2026-08-14T10:00:00.000Z' }),
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .openapi({
        example:
          '7f83b1657ff1fc53b92dc18148a1d65dfa13514f2d891ef3214cfe46fda14f67'
      }),
    warnings: z.array(z.string()),
    data: ResumeDataSchema
  })
  .openapi('ParsedResume')

export type ResumeData = z.infer<typeof ResumeDataSchema>
export type ResumeWork = z.infer<typeof ResumeWorkSchema>
export type ResumeParserOutput = z.infer<typeof ResumeParserOutputSchema>
export type ParsedResume = z.infer<typeof ParsedResumeSchema>
