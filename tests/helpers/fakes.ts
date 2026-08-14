import type {
  DocumentRepository,
  PendingVersionInput
} from '@/repositories/document.repository'
import type {
  BlobStorage,
  BlobUploadResult,
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionParseRecord,
  DocumentVersionRecord,
  Page,
  ResumeParseResult,
  ResumeParser,
  ResumeTextExtractor,
  ValidatedDocumentFile
} from '@/types/document.types'
import type { PendingParseInput } from '@/repositories/document.repository'
import { encodeDocumentCursor, encodeVersionCursor } from '@/utils/cursor'
import { sampleParseResult } from './resume'

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>()
  readonly versions = new Map<string, DocumentVersionRecord>()
  readonly parses = new Map<string, DocumentVersionParseRecord>()
  failCreate = false

  async createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord,
    parse: DocumentVersionParseRecord
  ): Promise<void> {
    if (this.failCreate) throw new Error('create failed')
    this.documents.set(document._id, structuredClone(document))
    this.versions.set(
      this.key(document._id, version.version),
      structuredClone(version)
    )
    this.parses.set(
      this.parseKey(document._id, version.version, parse.revision),
      structuredClone(parse)
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
    blob: BlobUploadResult,
    parse: DocumentVersionParseRecord
  ): Promise<DocumentVersionRecord> {
    const record = this.versions.get(this.key(documentId, version))
    const document = this.documents.get(documentId)
    if (!record || !document) throw new Error('reserved version missing')
    record.status = 'ready'
    record.blobPathname = blob.pathname
    record.blobEtag = blob.etag
    record.currentParseRevision = parse.revision
    record.nextParseRevision = parse.revision + 1
    record.updatedAt = new Date()
    document.currentVersion = Math.max(document.currentVersion, version)
    document.updatedAt = record.updatedAt
    this.parses.set(
      this.parseKey(documentId, version, parse.revision),
      structuredClone(parse)
    )
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

  async reserveParse(
    input: PendingParseInput
  ): Promise<DocumentVersionParseRecord | null> {
    const version = this.versions.get(this.key(input.documentId, input.version))
    if (version?.status !== 'ready') return null
    const revision =
      version.nextParseRevision ?? (version.currentParseRevision ?? 0) + 1
    version.nextParseRevision = revision + 1
    const now = new Date()
    const parse: DocumentVersionParseRecord = {
      ...structuredClone(input),
      revision,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
    this.parses.set(
      this.parseKey(input.documentId, input.version, revision),
      parse
    )
    return structuredClone(parse)
  }

  async completeParse(
    documentId: string,
    versionNumber: number,
    revision: number,
    result: ResumeParseResult
  ): Promise<DocumentVersionParseRecord> {
    const parse = this.parses.get(
      this.parseKey(documentId, versionNumber, revision)
    )
    const version = this.versions.get(this.key(documentId, versionNumber))
    if (!parse || parse.status !== 'pending' || !version) {
      throw new Error('reserved parse missing')
    }
    const now = new Date()
    Object.assign(parse, {
      status: 'ready' as const,
      model: result.model,
      data: structuredClone(result.data),
      warnings: [...result.warnings],
      usage: structuredClone(result.usage),
      parsedAt: now,
      updatedAt: now
    })
    version.currentParseRevision = Math.max(
      version.currentParseRevision ?? 0,
      revision
    )
    return structuredClone(parse)
  }

  async failParse(
    documentId: string,
    version: number,
    revision: number,
    reason: string
  ): Promise<void> {
    const parse = this.parses.get(this.parseKey(documentId, version, revision))
    if (parse?.status === 'pending') {
      parse.status = 'failed'
      parse.failureReason = reason
      parse.updatedAt = new Date()
    }
  }

  async findCurrentReadyParse(
    documentId: string,
    version: number
  ): Promise<DocumentVersionParseRecord | null> {
    const parse = [...this.parses.values()]
      .filter(
        (item) =>
          item.documentId === documentId &&
          item.version === version &&
          item.status === 'ready'
      )
      .toSorted((left, right) => right.revision - left.revision)[0]
    return parse ? structuredClone(parse) : null
  }

  async findReadyVersionsWithoutParse(
    limit: number
  ): Promise<DocumentVersionRecord[]> {
    return [...this.versions.values()]
      .filter(
        (version) =>
          version.status === 'ready' &&
          ![...this.parses.values()].some(
            (parse) =>
              parse.documentId === version.documentId &&
              parse.version === version.version &&
              parse.status === 'ready'
          )
      )
      .slice(0, limit)
      .map((version) => structuredClone(version))
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

  private parseKey(
    documentId: string,
    version: number,
    revision: number
  ): string {
    return `${documentId}:${version}:${revision}`
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

  async download(pathname: string): Promise<Uint8Array> {
    const file = this.files.get(pathname)
    if (!file) throw new Error('blob missing')
    return structuredClone(file.bytes)
  }

  async createDownloadUrl(pathname: string): Promise<string> {
    if (!this.files.has(pathname)) throw new Error('blob missing')
    return `https://blob.example.test/${encodeURIComponent(pathname)}?signed=1`
  }
}

export class FakeResumeTextExtractor implements ResumeTextExtractor {
  readonly files: ValidatedDocumentFile[] = []
  text = 'Jane Doe\nSoftware Engineer\n• Built reliable APIs.'
  error: Error | undefined

  async extract(file: ValidatedDocumentFile): Promise<string> {
    this.files.push(structuredClone(file))
    if (this.error) throw this.error
    return this.text
  }
}

export class FakeResumeParser implements ResumeParser {
  readonly texts: string[] = []
  readonly model = 'openai/gpt-5.4-mini'
  result: ResumeParseResult = sampleParseResult(this.model)
  error: Error | undefined

  async parse(text: string): Promise<ResumeParseResult> {
    this.texts.push(text)
    if (this.error) throw this.error
    return structuredClone(this.result)
  }
}
