import { extractText } from 'unpdf'
import WordExtractor from 'word-extractor'
import {
  ERROR_CODES,
  MAX_EXTRACTED_TEXT_CHARS
} from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type {
  ResumeTextExtractor,
  ValidatedDocumentFile
} from '../types/document.types'

function normalizeExtractedText(value: string): string {
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

export function validateExtractedResumeText(text: string): string {
  if (!text.trim()) {
    throw new AppError(
      ERROR_CODES.extraction,
      'The document does not contain extractable résumé text',
      422
    )
  }
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new AppError(
      ERROR_CODES.extraction,
      `Extracted text must be ${MAX_EXTRACTED_TEXT_CHARS} characters or fewer`,
      422
    )
  }
  return text
}

export class DocumentResumeTextExtractor implements ResumeTextExtractor {
  async extract(file: ValidatedDocumentFile): Promise<string> {
    try {
      const text =
        file.extension === 'pdf'
          ? await this.extractPdf(file.bytes)
          : await this.extractWord(file.bytes)
      return validateExtractedResumeText(normalizeExtractedText(text))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ERROR_CODES.extraction,
        'The document text could not be extracted',
        422,
        error instanceof Error ? error.message : 'Unknown extraction error'
      )
    }
  }

  private async extractPdf(bytes: Uint8Array): Promise<string> {
    // PDF.js may transfer and detach its input buffer. Preserve the validated
    // source bytes because the same immutable bytes are uploaded after parsing.
    const result = await extractText(Uint8Array.from(bytes), {
      mergePages: true
    })
    return Array.isArray(result.text) ? result.text.join('\n\n') : result.text
  }

  private async extractWord(bytes: Uint8Array): Promise<string> {
    const document = await new WordExtractor().extract(Buffer.from(bytes))
    return [
      document.getHeaders(),
      document.getBody(),
      document.getFootnotes(),
      document.getEndnotes(),
      document.getAnnotations(),
      document.getTextboxes(),
      document.getFooters()
    ]
      .filter((section) => section.trim().length > 0)
      .join('\n\n')
  }
}
