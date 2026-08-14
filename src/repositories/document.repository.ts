import type {
  BlobUploadResult,
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionRecord,
  Page
} from '../types/document.types'

export type PendingVersionInput = Omit<
  DocumentVersionRecord,
  'version' | 'status' | 'createdAt' | 'updatedAt'
>

export interface DocumentRepository {
  createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord
  ): Promise<void>
  reserveVersion(
    documentId: string,
    input: PendingVersionInput
  ): Promise<DocumentVersionRecord | null>
  completeVersion(
    documentId: string,
    version: number,
    blob: BlobUploadResult
  ): Promise<DocumentVersionRecord>
  failVersion(
    documentId: string,
    version: number,
    reason: string
  ): Promise<void>
  findDocument(documentId: string): Promise<DocumentRecord | null>
  listDocuments(
    limit: number,
    cursor?: DocumentListCursor
  ): Promise<Page<DocumentRecord>>
  findReadyVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionRecord | null>
  listReadyVersions(
    documentId: string,
    limit: number,
    beforeVersion?: number
  ): Promise<Page<DocumentVersionRecord>>
  ensureIndexes(): Promise<void>
}
