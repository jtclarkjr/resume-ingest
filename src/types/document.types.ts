import type { SupportedDocumentExtension } from '../constants/document.constants'

export type DocumentVersionStatus = 'pending' | 'ready' | 'failed'

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
  createDownloadUrl(pathname: string): Promise<string>
}

export interface DocumentDetails {
  document: DocumentRecord
  latestVersion: DocumentVersionRecord | null
}
