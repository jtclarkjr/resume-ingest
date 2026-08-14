import { fileTypeFromBuffer } from 'file-type'
import {
  ERROR_CODES,
  MAX_FILE_BYTES,
  SUPPORTED_DOCUMENT_TYPES,
  type SupportedDocumentExtension
} from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type { ValidatedDocumentFile } from '../types/document.types'

const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function getExtension(fileName: string): SupportedDocumentExtension | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension === 'pdf' || extension === 'docx' || extension === 'doc'
    ? extension
    : null
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function sanitizeFileName(fileName: string): string {
  const baseName = fileName.replaceAll('\\', '/').split('/').pop() ?? 'document'
  const sanitized = baseName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
  return sanitized || 'document'
}

function hasExpectedSignature(
  extension: SupportedDocumentExtension,
  bytes: Uint8Array,
  detectedExtension?: string
): boolean {
  if (extension === 'pdf') {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  }
  if (extension === 'doc') {
    return startsWith(bytes, COMPOUND_FILE_SIGNATURE)
  }
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    (!detectedExtension ||
      detectedExtension === 'zip' ||
      detectedExtension === 'docx')
  )
}

export async function validateDocumentFile(
  file: File
): Promise<ValidatedDocumentFile> {
  if (file.size === 0) {
    throw new AppError(
      ERROR_CODES.validation,
      'The uploaded file is empty',
      400
    )
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AppError(
      ERROR_CODES.payloadTooLarge,
      `Files must be ${MAX_FILE_BYTES} bytes or smaller`,
      413
    )
  }

  const extension = getExtension(file.name)
  if (!extension) {
    throw new AppError(
      ERROR_CODES.unsupportedMediaType,
      'Only PDF, DOCX, and DOC files are supported',
      415
    )
  }
  if (file.type !== SUPPORTED_DOCUMENT_TYPES[extension]) {
    throw new AppError(
      ERROR_CODES.unsupportedMediaType,
      `The declared media type does not match .${extension}`,
      415
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>
  try {
    detected = await fileTypeFromBuffer(bytes)
  } catch {
    detected = undefined
  }
  if (!hasExpectedSignature(extension, bytes, detected?.ext)) {
    throw new AppError(
      ERROR_CODES.unsupportedMediaType,
      `The file contents do not match .${extension}`,
      415
    )
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    bytes,
    fileName: sanitizeFileName(file.name),
    extension,
    contentType: SUPPORTED_DOCUMENT_TYPES[extension],
    sizeBytes: file.size,
    sha256: Buffer.from(digest).toString('hex')
  }
}

export function defaultTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.(pdf|docx|doc)$/i, '').replaceAll('-', ' ')
}
