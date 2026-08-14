export const API_VERSION = '1.0.0'
export const MAX_FILE_BYTES = 4_000_000
export const MAX_REQUEST_BYTES = 4_400_000
export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 100
export const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000

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
  storage: 'STORAGE_ERROR',
  database: 'DATABASE_ERROR',
  internal: 'INTERNAL_ERROR'
} as const
