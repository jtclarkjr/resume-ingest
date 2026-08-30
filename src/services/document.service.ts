import {
  DEFAULT_PAGE_LIMIT,
  ERROR_CODES,
  MAX_PAGE_LIMIT,
  RESUME_PARSER_VERSION,
  RESUME_SCHEMA_VERSION
} from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type { DocumentRepository } from '../repositories/document.repository'
import type { ParsedResume } from '../schemas/resume.schema'
import type {
  BlobStorage,
  DocumentDetails,
  DocumentRecord,
  DocumentVersionDetails,
  DocumentVersionParseRecord,
  DocumentVersionRecord,
  Page,
  ResumeParseResult,
  ResumeParser,
  ResumeTextExtractor,
  ValidatedDocumentFile
} from '../types/document.types'
import { decodeDocumentCursor, decodeVersionCursor } from '../utils/cursor'
import { defaultTitleFromFileName, validateDocumentFile } from '../utils/file'

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function internalFailureReason(error: unknown): string {
  if (error instanceof AppError) return error.code
  return error instanceof Error ? error.name : 'UnknownError'
}

function safeLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT)
}

export interface ParseBackfillResult {
  found: number
  parsed: number
  failed: Array<{ documentId: string; version: number; reason: string }>
}

export class DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: BlobStorage,
    private readonly extractor: ResumeTextExtractor,
    private readonly parser: ResumeParser,
    private readonly pathPrefix = 'documents'
  ) {}

  async createDocument(file: File, title?: string): Promise<DocumentDetails> {
    const validated = await validateDocumentFile(file)
    const parsed = await this.extractAndParse(validated)
    const documentId = crypto.randomUUID()
    const now = new Date()
    const pathname = this.buildPath(documentId, 1, validated.fileName)

    let blob: { pathname: string; etag: string }
    try {
      blob = await this.storage.upload(pathname, validated)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.storage,
        'The document could not be stored',
        502,
        errorReason(error)
      )
    }

    const document: DocumentRecord = {
      _id: documentId,
      title: title?.trim() || defaultTitleFromFileName(validated.fileName),
      currentVersion: 1,
      nextVersion: 2,
      createdAt: now,
      updatedAt: now
    }
    const version: DocumentVersionRecord = {
      _id: crypto.randomUUID(),
      documentId,
      version: 1,
      status: 'ready',
      fileName: validated.fileName,
      extension: validated.extension,
      contentType: validated.contentType,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      blobPathname: blob.pathname,
      blobEtag: blob.etag,
      currentParseRevision: 1,
      nextParseRevision: 2,
      createdAt: now,
      updatedAt: now
    }
    const parse = this.readyParseRecord(
      documentId,
      1,
      1,
      validated.sha256,
      parsed,
      now
    )

    try {
      await this.repository.createInitial(document, version, parse)
    } catch (error) {
      await this.safeDelete(blob.pathname)
      throw new AppError(
        ERROR_CODES.database,
        'The document metadata could not be stored',
        503,
        errorReason(error)
      )
    }
    return {
      document,
      latestVersion: version,
      parsedResume: this.toParsedResume(parse)
    }
  }

  async addVersion(
    documentId: string,
    file: File,
    changeNote?: string
  ): Promise<DocumentDetails> {
    const validated = await validateDocumentFile(file)
    const parsed = await this.extractAndParse(validated)
    let reserved: DocumentVersionRecord | null
    try {
      reserved = await this.repository.reserveVersion(documentId, {
        _id: crypto.randomUUID(),
        documentId,
        fileName: validated.fileName,
        extension: validated.extension,
        contentType: validated.contentType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        ...(changeNote?.trim() ? { changeNote: changeNote.trim() } : {})
      })
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'A new document version could not be reserved',
        503,
        errorReason(error)
      )
    }
    if (!reserved) {
      throw new AppError(
        ERROR_CODES.documentNotFound,
        'Document not found',
        404
      )
    }

    const pathname = this.buildPath(
      documentId,
      reserved.version,
      validated.fileName
    )
    let blob: { pathname: string; etag: string } | undefined
    try {
      blob = await this.storage.upload(pathname, validated)
      const now = new Date()
      const parse = this.readyParseRecord(
        documentId,
        reserved.version,
        1,
        validated.sha256,
        parsed,
        now
      )
      const completed = await this.repository.completeVersion(
        documentId,
        reserved.version,
        blob,
        parse
      )
      const document = await this.requireDocument(documentId)
      return {
        document,
        latestVersion: completed,
        parsedResume: this.toParsedResume(parse)
      }
    } catch (error) {
      if (blob) await this.safeDelete(blob.pathname)
      await this.safeFailVersion(
        documentId,
        reserved.version,
        internalFailureReason(error)
      )
      throw new AppError(
        blob ? ERROR_CODES.database : ERROR_CODES.storage,
        blob
          ? 'The version metadata could not be completed'
          : 'The document version could not be stored',
        blob ? 503 : 502,
        errorReason(error)
      )
    }
  }

  async getDocument(documentId: string): Promise<DocumentDetails> {
    const document = await this.requireDocument(documentId)
    const latestVersion =
      document.currentVersion > 0
        ? await this.findReadyVersion(documentId, document.currentVersion)
        : null
    const parse = latestVersion
      ? await this.findCurrentReadyParse(documentId, latestVersion.version)
      : null
    return {
      document,
      latestVersion,
      parsedResume: parse ? this.toParsedResume(parse) : null
    }
  }

  async listDocuments(
    limit?: number,
    cursor?: string
  ): Promise<Page<DocumentRecord>> {
    const decodedCursor = cursor ? decodeDocumentCursor(cursor) : undefined
    try {
      return await this.repository.listDocuments(
        safeLimit(limit),
        decodedCursor
      )
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'Documents could not be listed',
        503,
        errorReason(error)
      )
    }
  }

  async getVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionDetails> {
    const record = await this.findReadyVersion(documentId, version)
    if (!record) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version not found',
        404
      )
    }
    const parse = await this.findCurrentReadyParse(documentId, version)
    return {
      version: record,
      parsedResume: parse ? this.toParsedResume(parse) : null
    }
  }

  async listVersions(
    documentId: string,
    limit?: number,
    cursor?: string
  ): Promise<Page<DocumentVersionRecord>> {
    await this.requireDocument(documentId)
    const beforeVersion = cursor ? decodeVersionCursor(cursor) : undefined
    try {
      return await this.repository.listReadyVersions(
        documentId,
        safeLimit(limit),
        beforeVersion
      )
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'Document versions could not be listed',
        503,
        errorReason(error)
      )
    }
  }

  async reparseVersion(
    documentId: string,
    versionNumber: number
  ): Promise<DocumentVersionDetails> {
    const version = await this.findReadyVersion(documentId, versionNumber)
    if (!version?.blobPathname) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version not found',
        404
      )
    }

    let bytes: Uint8Array
    try {
      bytes = await this.storage.download(version.blobPathname)
      await this.assertSourceDigest(bytes, version.sha256)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.storage,
        'The document version could not be read for parsing',
        502,
        errorReason(error)
      )
    }

    let reserved: DocumentVersionParseRecord | null
    try {
      reserved = await this.repository.reserveParse({
        _id: crypto.randomUUID(),
        documentId,
        version: versionNumber,
        schemaVersion: RESUME_SCHEMA_VERSION,
        parserVersion: RESUME_PARSER_VERSION,
        model: this.parser.model,
        sourceSha256: version.sha256
      })
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'A parse revision could not be reserved',
        503,
        errorReason(error)
      )
    }
    if (!reserved) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version not found',
        404
      )
    }

    const source: ValidatedDocumentFile = {
      bytes,
      fileName: version.fileName,
      extension: version.extension,
      contentType: version.contentType,
      sizeBytes: bytes.byteLength,
      sha256: version.sha256
    }

    try {
      const parsed = await this.extractAndParse(source)
      const completed = await this.repository.completeParse(
        documentId,
        versionNumber,
        reserved.revision,
        parsed
      )
      version.currentParseRevision = completed.revision
      version.nextParseRevision = completed.revision + 1
      version.updatedAt = completed.updatedAt
      return { version, parsedResume: this.toParsedResume(completed) }
    } catch (error) {
      await this.safeFailParse(
        documentId,
        versionNumber,
        reserved.revision,
        internalFailureReason(error)
      )
      if (error instanceof AppError) throw error
      throw new AppError(
        ERROR_CODES.database,
        'The parse revision could not be completed',
        503,
        errorReason(error)
      )
    }
  }

  async backfillUnparsedVersions(limit = 100): Promise<ParseBackfillResult> {
    let versions: DocumentVersionRecord[]
    try {
      versions = await this.repository.findReadyVersionsWithoutParse(limit)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'Unparsed versions could not be listed',
        503,
        errorReason(error)
      )
    }

    const result: ParseBackfillResult = {
      found: versions.length,
      parsed: 0,
      failed: []
    }
    for (const version of versions) {
      try {
        await this.reparseVersion(version.documentId, version.version)
        result.parsed += 1
      } catch (error) {
        result.failed.push({
          documentId: version.documentId,
          version: version.version,
          reason: internalFailureReason(error)
        })
      }
    }
    return result
  }

  async createDownloadUrl(
    documentId: string,
    version: number
  ): Promise<string> {
    const details = await this.getVersion(documentId, version)
    if (!details.version.blobPathname) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version is not available for download',
        404
      )
    }
    try {
      return await this.storage.createDownloadUrl(details.version.blobPathname)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.storage,
        'A download URL could not be created',
        502,
        errorReason(error)
      )
    }
  }

  private async extractAndParse(
    file: ValidatedDocumentFile
  ): Promise<ResumeParseResult> {
    let text = ''
    try {
      try {
        text = await this.extractor.extract(file)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(
          ERROR_CODES.extraction,
          'The document text could not be extracted',
          422,
          internalFailureReason(error)
        )
      }

      try {
        return await this.parser.parse(text)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(
          ERROR_CODES.parser,
          'The résumé could not be parsed by the AI Gateway',
          502,
          internalFailureReason(error)
        )
      }
    } finally {
      text = ''
    }
  }

  private async requireDocument(documentId: string): Promise<DocumentRecord> {
    let document: DocumentRecord | null
    try {
      document = await this.repository.findDocument(documentId)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The document could not be read',
        503,
        errorReason(error)
      )
    }
    if (!document) {
      throw new AppError(
        ERROR_CODES.documentNotFound,
        'Document not found',
        404
      )
    }
    return document
  }

  private async findReadyVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionRecord | null> {
    try {
      return await this.repository.findReadyVersion(documentId, version)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The document version could not be read',
        503,
        errorReason(error)
      )
    }
  }

  private async findCurrentReadyParse(
    documentId: string,
    version: number
  ): Promise<DocumentVersionParseRecord | null> {
    try {
      return await this.repository.findCurrentReadyParse(documentId, version)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The parsed résumé could not be read',
        503,
        errorReason(error)
      )
    }
  }

  private readyParseRecord(
    documentId: string,
    version: number,
    revision: number,
    sourceSha256: string,
    parsed: ResumeParseResult,
    now: Date
  ): DocumentVersionParseRecord {
    return {
      _id: crypto.randomUUID(),
      documentId,
      version,
      revision,
      status: 'ready',
      schemaVersion: RESUME_SCHEMA_VERSION,
      parserVersion: RESUME_PARSER_VERSION,
      model: parsed.model,
      sourceSha256,
      isJapaneseShokumuKeirekisho: parsed.isJapaneseShokumuKeirekisho,
      data: parsed.data,
      warnings: parsed.warnings,
      usage: parsed.usage,
      parsedAt: now,
      createdAt: now,
      updatedAt: now
    }
  }

  private toParsedResume(parse: DocumentVersionParseRecord): ParsedResume {
    if (!parse.data || !parse.parsedAt) {
      throw new Error('Ready parse record is incomplete')
    }
    return {
      schemaVersion: parse.schemaVersion,
      parserVersion: parse.parserVersion,
      model: parse.model,
      parseRevision: parse.revision,
      parsedAt: parse.parsedAt.toISOString(),
      sourceSha256: parse.sourceSha256,
      isJapaneseShokumuKeirekisho: parse.isJapaneseShokumuKeirekisho ?? false,
      warnings: parse.warnings ?? [],
      data: parse.data
    }
  }

  private buildPath(
    documentId: string,
    version: number,
    fileName: string
  ): string {
    return `${this.pathPrefix}/${documentId}/versions/${version}/${fileName}`
  }

  private async assertSourceDigest(
    bytes: Uint8Array,
    expectedSha256: string
  ): Promise<void> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(bytes).buffer
    )
    const actual = Buffer.from(digest).toString('hex')
    if (actual !== expectedSha256) throw new Error('Blob digest mismatch')
  }

  private async safeDelete(pathname: string): Promise<void> {
    try {
      await this.storage.delete(pathname)
    } catch (error) {
      console.error('Blob cleanup failed', {
        error: internalFailureReason(error)
      })
    }
  }

  private async safeFailVersion(
    documentId: string,
    version: number,
    reason: string
  ): Promise<void> {
    try {
      await this.repository.failVersion(documentId, version, reason)
    } catch (error) {
      console.error('Failed-version update failed', {
        documentId,
        version,
        error: internalFailureReason(error)
      })
    }
  }

  private async safeFailParse(
    documentId: string,
    version: number,
    revision: number,
    reason: string
  ): Promise<void> {
    try {
      await this.repository.failParse(documentId, version, revision, reason)
    } catch (error) {
      console.error('Failed-parse update failed', {
        documentId,
        version,
        revision,
        error: internalFailureReason(error)
      })
    }
  }
}
