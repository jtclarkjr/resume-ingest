import { ERROR_CODES } from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type { DocumentListCursor } from '../types/document.types'

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decode(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new AppError(
      ERROR_CODES.validation,
      'The pagination cursor is invalid',
      400
    )
  }
}

export function encodeDocumentCursor(cursor: DocumentListCursor): string {
  return encode({ createdAt: cursor.createdAt.toISOString(), id: cursor.id })
}

export function decodeDocumentCursor(cursor: string): DocumentListCursor {
  const value = decode(cursor)
  if (
    typeof value !== 'object' ||
    value === null ||
    !('createdAt' in value) ||
    !('id' in value) ||
    typeof value.createdAt !== 'string' ||
    typeof value.id !== 'string'
  ) {
    throw new AppError(
      ERROR_CODES.validation,
      'The pagination cursor is invalid',
      400
    )
  }

  const createdAt = new Date(value.createdAt)
  if (Number.isNaN(createdAt.getTime())) {
    throw new AppError(
      ERROR_CODES.validation,
      'The pagination cursor is invalid',
      400
    )
  }
  return { createdAt, id: value.id }
}

export function encodeVersionCursor(version: number): string {
  return encode({ version })
}

export function decodeVersionCursor(cursor: string): number {
  const value = decode(cursor)
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    throw new AppError(
      ERROR_CODES.validation,
      'The pagination cursor is invalid',
      400
    )
  }
  return value.version
}
