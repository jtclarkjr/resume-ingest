import type {
  DocumentDto,
  DocumentSummaryDto,
  DocumentVersionDto
} from '../dtos/document.dto'
import {
  toDocumentDto,
  toDocumentSummaryDto,
  toVersionDto
} from '../dtos/document.dto'
import { DocumentService } from '../services/document.service'

export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  async create(file: File, title?: string): Promise<DocumentDto> {
    return toDocumentDto(await this.service.createDocument(file, title))
  }

  async addVersion(
    documentId: string,
    file: File,
    changeNote?: string
  ): Promise<DocumentDto> {
    return toDocumentDto(
      await this.service.addVersion(documentId, file, changeNote)
    )
  }

  async get(documentId: string): Promise<DocumentDto> {
    return toDocumentDto(await this.service.getDocument(documentId))
  }

  async list(limit?: number, cursor?: string) {
    const page = await this.service.listDocuments(limit, cursor)
    return {
      items: page.items.map(
        toDocumentSummaryDto
      ) satisfies DocumentSummaryDto[],
      nextCursor: page.nextCursor
    }
  }

  async getVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionDto> {
    return toVersionDto(await this.service.getVersion(documentId, version))
  }

  async listVersions(documentId: string, limit?: number, cursor?: string) {
    const page = await this.service.listVersions(documentId, limit, cursor)
    return {
      items: page.items.map(toVersionDto),
      nextCursor: page.nextCursor
    }
  }

  async createDownloadUrl(
    documentId: string,
    version: number
  ): Promise<string> {
    return this.service.createDownloadUrl(documentId, version)
  }
}
