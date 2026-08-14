import { describe, expect, test } from 'bun:test'
import { ERROR_CODES, MAX_FILE_BYTES } from '@/constants/document.constants'
import { AppError } from '@/errors/app-error'
import { validateDocumentFile } from '@/utils/file'
import { docFile, docxFile, oversizedPdfFile, pdfFile } from './helpers/files'

describe('document file validation', () => {
  test.each([
    [pdfFile(), 'pdf', 'application/pdf'],
    [
      docxFile(),
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    [docFile(), 'doc', 'application/msword']
  ] as const)('accepts %s', async (file, extension, contentType) => {
    const result = await validateDocumentFile(file)

    expect(result.extension).toBe(extension)
    expect(result.contentType).toBe(contentType)
    expect(result.sizeBytes).toBe(file.size)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  test('rejects a spoofed file signature', async () => {
    const file = new File(['not a pdf'], 'resume.pdf', {
      type: 'application/pdf'
    })

    await expect(validateDocumentFile(file)).rejects.toMatchObject({
      code: ERROR_CODES.unsupportedMediaType,
      status: 415
    } satisfies Partial<AppError>)
  })

  test('rejects a mismatched MIME declaration', async () => {
    const source = pdfFile()
    const file = new File([await source.arrayBuffer()], 'resume.pdf', {
      type: 'application/msword'
    })

    await expect(validateDocumentFile(file)).rejects.toMatchObject({
      code: ERROR_CODES.unsupportedMediaType,
      status: 415
    } satisfies Partial<AppError>)
  })

  test('rejects files larger than the four megabyte application limit', async () => {
    expect(oversizedPdfFile().size).toBe(MAX_FILE_BYTES + 1)
    await expect(
      validateDocumentFile(oversizedPdfFile())
    ).rejects.toMatchObject({
      code: ERROR_CODES.payloadTooLarge,
      status: 413
    } satisfies Partial<AppError>)
  })
})
