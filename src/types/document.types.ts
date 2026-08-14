import type { SupportedDocumentExtension } from '../constants/document.constants'
import type { ParsedResume, ResumeData } from '../schemas/resume.schema'

export type DocumentVersionStatus = 'pending' | 'ready' | 'failed'
export type DocumentVersionParseStatus = 'pending' | 'ready' | 'failed'

export interface DocumentRecord {
  _id: string
  title: string
  currentVersion: number
  nextVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface DocumentVersionRecord {
  _id: string
  documentId: string
  version: number
  status: DocumentVersionStatus
  fileName: string
  extension: SupportedDocumentExtension
  contentType: string
  sizeBytes: number
  sha256: string
  blobPathname?: string
  blobEtag?: string
  changeNote?: string
  currentParseRevision?: number
  nextParseRevision?: number
  failureReason?: string
  createdAt: Date
  updatedAt: Date
}

export interface ValidatedDocumentFile {
  bytes: Uint8Array
  fileName: string
  extension: SupportedDocumentExtension
  contentType: string
  sizeBytes: number
  sha256: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface DocumentListCursor {
  createdAt: Date
  id: string
}

export interface BlobUploadResult {
  pathname: string
  etag: string
}

export interface BlobStorage {
  upload(
    pathname: string,
    file: ValidatedDocumentFile
  ): Promise<BlobUploadResult>
  delete(pathname: string): Promise<void>
  download(pathname: string): Promise<Uint8Array>
  createDownloadUrl(pathname: string): Promise<string>
}

export interface ResumeTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface DocumentVersionParseRecord {
  _id: string
  documentId: string
  version: number
  revision: number
  status: DocumentVersionParseStatus
  schemaVersion: string
  parserVersion: string
  model: string
  sourceSha256: string
  data?: ResumeData
  warnings?: string[]
  usage?: ResumeTokenUsage
  failureReason?: string
  parsedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface ResumeParseResult {
  model: string
  data: ResumeData
  warnings: string[]
  usage: ResumeTokenUsage
}

export interface ResumeParser {
  readonly model: string
  parse(text: string): Promise<ResumeParseResult>
}

export interface ResumeTextExtractor {
  extract(file: ValidatedDocumentFile): Promise<string>
}

export interface DocumentDetails {
  document: DocumentRecord
  latestVersion: DocumentVersionRecord | null
  parsedResume: ParsedResume | null
}

export interface DocumentVersionDetails {
  version: DocumentVersionRecord
  parsedResume: ParsedResume | null
}
