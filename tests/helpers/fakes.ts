import type {
  DocumentRepository,
  PendingVersionInput
} from '@/repositories/document.repository'
import type {
  BlobStorage,
  BlobUploadResult,
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionRecord,
  Page,
  ValidatedDocumentFile
} from '@/types/document.types'
import { encodeDocumentCursor, encodeVersionCursor } from '@/utils/cursor'

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>()
  readonly versions = new Map<string, DocumentVersionRecord>()
  failCreate = false

  async createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord
  ): Promise<void> {
    if (this.failCreate) throw new Error('create failed')
    this.documents.set(document._id, structuredClone(document))
    this.versions.set(
      this.key(document._id, version.version),
      structuredClone(version)
    )
  }

  async reserveVersion(
    documentId: string,
    input: PendingVersionInput
  ): Promise<DocumentVersionRecord | null> {
    const document = this.documents.get(documentId)
    if (!document) return null
    const now = new Date()
    const record: DocumentVersionRecord = {
      ...structuredClone(input),
      version: document.nextVersion,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
    document.nextVersion += 1
    document.updatedAt = now
    this.versions.set(this.key(documentId, record.version), record)
    return structuredClone(record)
  }

  async completeVersion(
    documentId: string,
    version: number,
    blob: BlobUploadResult
  ): Promise<DocumentVersionRecord> {
    const record = this.versions.get(this.key(documentId, version))
    const document = this.documents.get(documentId)
    if (!record || !document) throw new Error('reserved version missing')
    record.status = 'ready'
    record.blobPathname = blob.pathname
    record.blobEtag = blob.etag
    record.updatedAt = new Date()
    document.currentVersion = Math.max(document.currentVersion, version)
    document.updatedAt = record.updatedAt
    return structuredClone(record)
  }

  async failVersion(
    documentId: string,
    version: number,
    reason: string
  ): Promise<void> {
    const record = this.versions.get(this.key(documentId, version))
    if (record?.status === 'pending') {
      record.status = 'failed'
      record.failureReason = reason
      record.updatedAt = new Date()
    }
  }

  async findDocument(documentId: string): Promise<DocumentRecord | null> {
    const value = this.documents.get(documentId)
    return value ? structuredClone(value) : null
  }

  async listDocuments(
    limit: number,
    cursor?: DocumentListCursor
  ): Promise<Page<DocumentRecord>> {
    const sorted = [...this.documents.values()]
      .filter(
        (document) =>
          !cursor ||
          document.createdAt < cursor.createdAt ||
          (document.createdAt.getTime() === cursor.createdAt.getTime() &&
            document._id < cursor.id)
      )
      .toSorted(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right._id.localeCompare(left._id)
      )
    const hasMore = sorted.length > limit
    const items = sorted.slice(0, limit).map((item) => structuredClone(item))
    const last = items.at(-1)
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeDocumentCursor({ createdAt: last.createdAt, id: last._id })
          : null
    }
  }

  async findReadyVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionRecord | null> {
    const value = this.versions.get(this.key(documentId, version))
    return value?.status === 'ready' ? structuredClone(value) : null
  }

  async listReadyVersions(
    documentId: string,
    limit: number,
    beforeVersion?: number
  ): Promise<Page<DocumentVersionRecord>> {
    const sorted = [...this.versions.values()]
      .filter(
        (version) =>
          version.documentId === documentId &&
          version.status === 'ready' &&
          (!beforeVersion || version.version < beforeVersion)
      )
      .toSorted((left, right) => right.version - left.version)
    const hasMore = sorted.length > limit
    const items = sorted.slice(0, limit).map((item) => structuredClone(item))
    const last = items.at(-1)
    return {
      items,
      nextCursor: hasMore && last ? encodeVersionCursor(last.version) : null
    }
  }

  async ensureIndexes(): Promise<void> {}

  private key(documentId: string, version: number): string {
    return `${documentId}:${version}`
  }
}

export class InMemoryBlobStorage implements BlobStorage {
  readonly files = new Map<string, ValidatedDocumentFile>()
  readonly deleted: string[] = []
  failUploads = false

  async upload(
    pathname: string,
    file: ValidatedDocumentFile
  ): Promise<BlobUploadResult> {
    if (this.failUploads) throw new Error('upload failed')
    if (this.files.has(pathname)) throw new Error('blob already exists')
    this.files.set(pathname, structuredClone(file))
    return { pathname, etag: `etag-${this.files.size}` }
  }

  async delete(pathname: string): Promise<void> {
    this.deleted.push(pathname)
    this.files.delete(pathname)
  }

  async createDownloadUrl(pathname: string): Promise<string> {
    if (!this.files.has(pathname)) throw new Error('blob missing')
    return `https://blob.example.test/${encodeURIComponent(pathname)}?signed=1`
  }
}
