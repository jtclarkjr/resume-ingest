import { describe, expect, test } from 'bun:test'
import { MAX_EXTRACTED_TEXT_CHARS } from '@/constants/document.constants'
import {
  DocumentResumeTextExtractor,
  validateExtractedResumeText
} from '@/services/resume-text-extractor.service'
import type { ValidatedDocumentFile } from '@/types/document.types'
import { validateDocumentFile } from '@/utils/file'
import { realDocFile, realDocxFile } from './helpers/word-fixtures'

const extractor = new DocumentResumeTextExtractor()

async function smokePdf(): Promise<File> {
  const bytes = await Bun.file(
    `${import.meta.dir}/fixtures/smoke.pdf`
  ).arrayBuffer()
  return new File([bytes], 'synthetic-resume.pdf', {
    type: 'application/pdf'
  })
}

describe('DocumentResumeTextExtractor', () => {
  test.each([
    ['PDF', smokePdf],
    ['DOCX', async () => realDocxFile()],
    ['DOC', async () => realDocFile()]
  ])(
    'extracts headings and line-oriented content from %s',
    async (_, makeFile) => {
      const validated = await validateDocumentFile(await makeFile())
      const sourceSize = validated.bytes.byteLength
      const text = await extractor.extract(validated)

      expect(text).toContain('JANE DOE')
      expect(text).toContain('EXPERIENCE')
      expect(text).toContain('Built reliable APIs')
      expect(text).toContain('TypeScript')
      expect(validated.bytes.byteLength).toBe(sourceSize)
    }
  )

  test('rejects an empty extracted document', () => {
    expect(() => validateExtractedResumeText('   \n\n')).toThrow()
  })

  test('rejects extracted text above the safety limit', () => {
    expect(() =>
      validateExtractedResumeText('x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1))
    ).toThrow()
  })

  test('returns 422 for a malformed Word document', async () => {
    const malformed: ValidatedDocumentFile = {
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      fileName: 'malformed.docx',
      extension: 'docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 4,
      sha256: '0'.repeat(64)
    }

    await expect(extractor.extract(malformed)).rejects.toMatchObject({
      code: 'DOCUMENT_EXTRACTION_FAILED',
      status: 422
    })
  })
})
