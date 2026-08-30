import type { ResumeData } from '@/schemas/resume.schema'
import type { ResumeParseResult } from '@/types/document.types'

export function sampleResumeData(): ResumeData {
  return {
    basics: {
      name: 'Jane Doe',
      label: 'Software Engineer',
      email: 'jane@example.test',
      phone: null,
      url: 'https://example.test',
      summary: null,
      location: {
        address: null,
        postalCode: null,
        city: 'Tokyo',
        countryCode: 'JP',
        region: 'Tokyo'
      },
      profiles: [],
      websites: [{ name: 'Portfolio', url: 'https://example.test' }]
    },
    work: [
      {
        name: 'Example Co.',
        position: 'Software Engineer',
        employmentType: 'Full-time',
        url: null,
        location: 'Tokyo',
        startDate: '2022-04',
        endDate: null,
        summary: null,
        highlights: ['Built reliable APIs.']
      }
    ],
    volunteer: [],
    education: [],
    skills: [{ name: 'TypeScript', level: null, keywords: ['Bun', 'Hono'] }],
    projects: [],
    awards: [],
    certificates: [],
    publications: [],
    languages: [],
    interests: []
  }
}

export function sampleParseResult(
  model = 'openai/gpt-5.4-mini'
): ResumeParseResult {
  return {
    model,
    isJapaneseShokumuKeirekisho: false,
    data: sampleResumeData(),
    warnings: [],
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
  }
}
