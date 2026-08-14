import { describe, expect, test } from 'bun:test'
import { DEFAULT_RESUME_PARSER_MODEL } from '@/constants/document.constants'
import { AiGatewayResumeParser } from '@/services/ai-resume-parser.service'

const enabled = process.env.RUN_AI_INTEGRATION_TESTS === '1'
const integrationDescribe = enabled ? describe : describe.skip

integrationDescribe('Vercel AI Gateway résumé parsing integration', () => {
  test('parses a synthetic résumé with source-only structured output', async () => {
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error(
        'AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is required for this test'
      )
    }

    const parser = new AiGatewayResumeParser(
      process.env.RESUME_PARSER_MODEL ?? DEFAULT_RESUME_PARSER_MODEL
    )
    const result = await parser.parse(`SYNTHETIC CANDIDATE
Software Engineer
synthetic@example.test

EXPERIENCE
Example Co. — Software Engineer — 2022-04 to Present
- Built TypeScript APIs.

SKILLS
TypeScript, Hono`)

    expect(result.data.basics.name?.toUpperCase()).toBe('SYNTHETIC CANDIDATE')
    expect(result.data.work[0]).toMatchObject({
      name: 'Example Co.',
      position: 'Software Engineer',
      startDate: '2022-04',
      endDate: null
    })
    expect(result.data.skills.length).toBeGreaterThan(0)
  }, 70_000)
})
