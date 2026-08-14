import { z } from '@hono/zod-openapi'
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  SUPPORTED_DOCUMENT_TYPES
} from '../constants/document.constants'
import type {
  DocumentDetails,
  DocumentRecord,
  DocumentVersionDetails,
  DocumentVersionRecord
} from '../types/document.types'
import { ParsedResumeSchema } from '../schemas/resume.schema'

export const RequestIdSchema = z.string().openapi({
  example: '5a480ac1-6f76-49fc-a980-dab8f543b5ed'
})

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'The request is invalid' }),
      details: z.unknown().optional(),
      requestId: RequestIdSchema
    })
  })
  .openapi('ErrorEnvelope')

export const DocumentVersionSummarySchema = z
  .object({
    documentId: z.uuid().openapi({
      example: '7e26c0e2-a185-4a3c-87cc-c49d674accd8'
    }),
    version: z.number().int().positive().openapi({ example: 1 }),
    fileName: z.string().openapi({ example: 'jane-doe-resume.pdf' }),
    extension: z.enum(['pdf', 'docx', 'doc']).openapi({ example: 'pdf' }),
    contentType: z
      .enum([
        SUPPORTED_DOCUMENT_TYPES.pdf,
        SUPPORTED_DOCUMENT_TYPES.docx,
        SUPPORTED_DOCUMENT_TYPES.doc
      ])
      .openapi({ example: SUPPORTED_DOCUMENT_TYPES.pdf }),
    sizeBytes: z.number().int().positive().openapi({ example: 248312 }),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .openapi({
        example:
          '7f83b1657ff1fc53b92dc18148a1d65dfa13514f2d891ef3214cfe46fda14f67'
      }),
    changeNote: z.string().optional().openapi({
      example: 'Added recent experience'
    }),
    parseRevision: z.number().int().positive().nullable().openapi({
      description: 'Current ready parse revision, or null if not parsed.',
      example: 1
    }),
    createdAt: z.iso
      .datetime()
      .openapi({ example: '2026-08-14T10:00:00.000Z' }),
    downloadPath: z.string().openapi({
      example:
        '/v1/documents/7e26c0e2-a185-4a3c-87cc-c49d674accd8/versions/1/download'
    })
  })
  .openapi('DocumentVersionSummary')

export const DocumentVersionDetailSchema = DocumentVersionSummarySchema.extend({
  parsedResume: ParsedResumeSchema.nullable()
}).openapi('DocumentVersionDetail')

export const DocumentSchema = z
  .object({
    id: z.uuid().openapi({
      example: '7e26c0e2-a185-4a3c-87cc-c49d674accd8'
    }),
    title: z.string().openapi({ example: 'Jane Doe Resume' }),
    currentVersion: z.number().int().nonnegative().openapi({ example: 1 }),
    createdAt: z.iso
      .datetime()
      .openapi({ example: '2026-08-14T10:00:00.000Z' }),
    updatedAt: z.iso
      .datetime()
      .openapi({ example: '2026-08-14T10:00:00.000Z' }),
    latestVersion: DocumentVersionSummarySchema.nullable(),
    parsedResume: ParsedResumeSchema.nullable()
  })
  .openapi('Document')

export const DocumentSummarySchema = DocumentSchema.omit({
  latestVersion: true,
  parsedResume: true
}).openapi('DocumentSummary')

export const DocumentResponseSchema = z
  .object({ data: DocumentSchema, requestId: RequestIdSchema })
  .openapi('DocumentResponse')

export const VersionResponseSchema = z
  .object({ data: DocumentVersionDetailSchema, requestId: RequestIdSchema })
  .openapi('VersionResponse')

export const DocumentListResponseSchema = z
  .object({
    data: z.object({
      items: z.array(DocumentSummarySchema),
      nextCursor: z.string().nullable()
    }),
    requestId: RequestIdSchema
  })
  .openapi('DocumentListResponse')

export const VersionListResponseSchema = z
  .object({
    data: z.object({
      items: z.array(DocumentVersionSummarySchema),
      nextCursor: z.string().nullable()
    }),
    requestId: RequestIdSchema
  })
  .openapi('VersionListResponse')

export const CreateDocumentFormSchema = z.object({
  file: z.file().openapi({ type: 'string', format: 'binary' }),
  title: z.string().trim().min(1).max(200).optional().openapi({
    example: 'Jane Doe Resume'
  })
})

export const CreateVersionFormSchema = z.object({
  file: z.file().openapi({ type: 'string', format: 'binary' }),
  changeNote: z.string().trim().min(1).max(500).optional().openapi({
    example: 'Added recent experience'
  })
})

export const DocumentParamsSchema = z.object({
  documentId: z.uuid().openapi({
    param: { name: 'documentId', in: 'path' },
    example: '7e26c0e2-a185-4a3c-87cc-c49d674accd8'
  })
})

export const VersionParamsSchema = DocumentParamsSchema.extend({
  version: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: 'version', in: 'path' },
      example: 1
    })
})

export const PageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .optional(),
  cursor: z.string().min(1).optional()
})

export type DocumentDto = z.infer<typeof DocumentSchema>
export type DocumentSummaryDto = z.infer<typeof DocumentSummarySchema>
export type DocumentVersionSummaryDto = z.infer<
  typeof DocumentVersionSummarySchema
>
export type DocumentVersionDetailDto = z.infer<
  typeof DocumentVersionDetailSchema
>

export function toVersionSummaryDto(
  version: DocumentVersionRecord
): DocumentVersionSummaryDto {
  return {
    documentId: version.documentId,
    version: version.version,
    fileName: version.fileName,
    extension: version.extension,
    contentType:
      version.contentType as DocumentVersionSummaryDto['contentType'],
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
    ...(version.changeNote ? { changeNote: version.changeNote } : {}),
    parseRevision: version.currentParseRevision ?? null,
    createdAt: version.createdAt.toISOString(),
    downloadPath: `/v1/documents/${version.documentId}/versions/${version.version}/download`
  }
}

export function toVersionDetailDto(
  details: DocumentVersionDetails
): DocumentVersionDetailDto {
  return {
    ...toVersionSummaryDto(details.version),
    parsedResume: details.parsedResume
  }
}

export function toDocumentSummaryDto(
  document: DocumentRecord
): DocumentSummaryDto {
  return {
    id: document._id,
    title: document.title,
    currentVersion: document.currentVersion,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  }
}

export function toDocumentDto(details: DocumentDetails): DocumentDto {
  return {
    ...toDocumentSummaryDto(details.document),
    latestVersion: details.latestVersion
      ? toVersionSummaryDto(details.latestVersion)
      : null,
    parsedResume: details.parsedResume
  }
}
