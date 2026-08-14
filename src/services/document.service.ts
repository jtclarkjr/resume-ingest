import {
  DEFAULT_PAGE_LIMIT,
  ERROR_CODES,
  MAX_PAGE_LIMIT
} from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type { DocumentRepository } from '../repositories/document.repository'
import type {
  BlobStorage,
  DocumentDetails,
  DocumentRecord,
  DocumentVersionRecord,
  Page
} from '../types/document.types'
import { decodeDocumentCursor, decodeVersionCursor } from '../utils/cursor'
import { defaultTitleFromFileName, validateDocumentFile } from '../utils/file'

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function safeLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT)
}

export class DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: BlobStorage,
    private readonly pathPrefix = 'documents'
  ) {}

  async createDocument(file: File, title?: string): Promise<DocumentDetails> {
    const validated = await validateDocumentFile(file)
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
      createdAt: now,
      updatedAt: now
    }

    try {
      await this.repository.createInitial(document, version)
    } catch (error) {
      await this.safeDelete(blob.pathname)
      throw new AppError(
        ERROR_CODES.database,
        'The document metadata could not be stored',
        503,
        errorReason(error)
      )
    }
    return { document, latestVersion: version }
  }

  async addVersion(
    documentId: string,
    file: File,
    changeNote?: string
  ): Promise<DocumentDetails> {
    const validated = await validateDocumentFile(file)
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
      const completed = await this.repository.completeVersion(
        documentId,
        reserved.version,
        blob
      )
      const document = await this.requireDocument(documentId)
      return { document, latestVersion: completed }
    } catch (error) {
      if (blob) await this.safeDelete(blob.pathname)
      await this.safeFail(documentId, reserved.version, errorReason(error))
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
    let latestVersion: DocumentVersionRecord | null = null
    try {
      latestVersion =
        document.currentVersion > 0
          ? await this.repository.findReadyVersion(
              documentId,
              document.currentVersion
            )
          : null
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The current document version could not be read',
        503,
        errorReason(error)
      )
    }
    return { document, latestVersion }
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
  ): Promise<DocumentVersionRecord> {
    let record: DocumentVersionRecord | null
    try {
      record = await this.repository.findReadyVersion(documentId, version)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The document version could not be read',
        503,
        errorReason(error)
      )
    }
    if (!record) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version not found',
        404
      )
    }
    return record
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

  async createDownloadUrl(
    documentId: string,
    version: number
  ): Promise<string> {
    const record = await this.getVersion(documentId, version)
    if (!record.blobPathname) {
      throw new AppError(
        ERROR_CODES.versionNotFound,
        'Document version is not available for download',
        404
      )
    }
    try {
      return await this.storage.createDownloadUrl(record.blobPathname)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.storage,
        'A download URL could not be created',
        502,
        errorReason(error)
      )
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

  private buildPath(
    documentId: string,
    version: number,
    fileName: string
  ): string {
    return `${this.pathPrefix}/${documentId}/versions/${version}/${fileName}`
  }

  private async safeDelete(pathname: string): Promise<void> {
    try {
      await this.storage.delete(pathname)
    } catch (error) {
      console.error('Blob cleanup failed', {
        pathname,
        error: errorReason(error)
      })
    }
  }

  private async safeFail(
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
        error: errorReason(error)
      })
    }
  }
}
