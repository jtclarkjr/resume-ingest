import type {
  BlobUploadResult,
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionParseRecord,
  DocumentVersionRecord,
  Page,
  ResumeParseResult
} from '../types/document.types'
import type {
  ResumeWorkAggregateCacheRecord,
  ResumeWorkAggregateReady,
  ResumeWorkSource
} from '../types/resume-work.types'

export type PendingVersionInput = Omit<
  DocumentVersionRecord,
  'version' | 'status' | 'createdAt' | 'updatedAt'
>

export type PendingParseInput = Omit<
  DocumentVersionParseRecord,
  'revision' | 'status' | 'createdAt' | 'updatedAt'
>

export interface DocumentRepository {
  createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord,
    parse: DocumentVersionParseRecord
  ): Promise<void>
  reserveVersion(
    documentId: string,
    input: PendingVersionInput
  ): Promise<DocumentVersionRecord | null>
  completeVersion(
    documentId: string,
    version: number,
    blob: BlobUploadResult,
    parse: DocumentVersionParseRecord
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
  reserveParse(
    input: PendingParseInput
  ): Promise<DocumentVersionParseRecord | null>
  completeParse(
    documentId: string,
    version: number,
    revision: number,
    result: ResumeParseResult
  ): Promise<DocumentVersionParseRecord>
  failParse(
    documentId: string,
    version: number,
    revision: number,
    reason: string
  ): Promise<void>
  findCurrentReadyParse(
    documentId: string,
    version: number
  ): Promise<DocumentVersionParseRecord | null>
  findReadyVersionsWithoutParse(limit: number): Promise<DocumentVersionRecord[]>
  listReadyVersions(
    documentId: string,
    limit: number,
    beforeVersion?: number
  ): Promise<Page<DocumentVersionRecord>>
  listCurrentReadyWorkSources(): Promise<ResumeWorkSource[]>
  findResumeWorkAggregate(): Promise<ResumeWorkAggregateCacheRecord | null>
  tryAcquireResumeWorkGeneration(
    fingerprint: string,
    owner: string,
    startedAt: Date,
    leaseUntil: Date
  ): Promise<boolean>
  completeResumeWorkGeneration(
    fingerprint: string,
    owner: string,
    ready: ResumeWorkAggregateReady
  ): Promise<boolean>
  releaseResumeWorkGeneration(fingerprint: string, owner: string): Promise<void>
  ensureIndexes(): Promise<void>
}
