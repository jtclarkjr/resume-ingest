export const API_VERSION = '1.0.0'
export const MAX_FILE_BYTES = 4_000_000
export const MAX_REQUEST_BYTES = 4_400_000
export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 100
export const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000
export const MAX_EXTRACTED_TEXT_CHARS = 200_000
export const RESUME_PARSER_TIMEOUT_MS = 60_000
export const RESUME_SCHEMA_VERSION = '1.0'
export const RESUME_PARSER_VERSION = 'resume-json-v1'
export const DEFAULT_RESUME_PARSER_MODEL = 'openai/gpt-5.4-mini'

export const SUPPORTED_DOCUMENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword'
} as const

export type SupportedDocumentExtension = keyof typeof SUPPORTED_DOCUMENT_TYPES

export const ERROR_CODES = {
  unauthorized: 'UNAUTHORIZED',
  validation: 'VALIDATION_ERROR',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  documentNotFound: 'DOCUMENT_NOT_FOUND',
  versionNotFound: 'VERSION_NOT_FOUND',
  extraction: 'DOCUMENT_EXTRACTION_FAILED',
  parser: 'RESUME_PARSE_FAILED',
  storage: 'STORAGE_ERROR',
  database: 'DATABASE_ERROR',
  internal: 'INTERNAL_ERROR'
} as const
