import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { closeMongoConnection, getMongoContext } from '@/db/mongodb'
import { MongoDocumentRepository } from '@/repositories/mongo-document.repository'
import { VercelBlobStorage } from '@/services/blob-storage.service'
import { DocumentService } from '@/services/document.service'
import type {
  DocumentRecord,
  DocumentVersionRecord
} from '@/types/document.types'
import { docxFile, pdfFile } from '../helpers/files'

const enabled = process.env.RUN_INTEGRATION_TESTS === '1'
const integrationDescribe = enabled ? describe : describe.skip
const runId = crypto.randomUUID()
const prefix = `integration-tests/${runId}`
let documentId: string | undefined

integrationDescribe('MongoDB and private Vercel Blob integration', () => {
  const repository = new MongoDocumentRepository()
  const storage = new VercelBlobStorage()
  const service = new DocumentService(repository, storage, prefix)

  beforeAll(async () => {
    if (process.env.MONGODB_DB_NAME !== 'resume_ingest_test') {
      throw new Error(
        'Integration tests require MONGODB_DB_NAME=resume_ingest_test'
      )
    }
    await repository.ensureIndexes()
  })

  afterAll(async () => {
    try {
      if (!documentId) return
      const { db } = await getMongoContext()
      const versions = await db
        .collection<DocumentVersionRecord>('document_versions')
        .find({ documentId })
        .toArray()
      await Promise.all(
        versions.flatMap((version) =>
          version.blobPathname ? [storage.delete(version.blobPathname)] : []
        )
      )
      await db.collection('document_versions').deleteMany({ documentId })
      await db.collection<DocumentRecord>('documents').deleteOne({
        _id: documentId
      })
    } finally {
      await closeMongoConnection()
    }
  })

  test('persists immutable versions and serves a signed private download', async () => {
    const created = await service.createDocument(
      pdfFile('integration-resume.pdf'),
      `Integration ${runId}`
    )
    documentId = created.document._id
    expect(created.latestVersion?.blobPathname).toStartWith(`${prefix}/`)

    const updated = await service.addVersion(
      documentId,
      docxFile('integration-resume.docx'),
      'Integration revision'
    )
    expect(updated.document.currentVersion).toBe(2)

    const versions = await service.listVersions(documentId)
    expect(versions.items.map((version) => version.version)).toEqual([2, 1])
    expect(
      new Set(versions.items.map((version) => version.blobPathname)).size
    ).toBe(2)

    const signedUrl = await service.createDownloadUrl(documentId, 2)
    const download = await fetch(signedUrl)
    expect(download.status).toBe(200)
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0)

    const { db } = await getMongoContext()
    const indexes = await db.collection('document_versions').indexes()
    expect(
      indexes.some((index) => index.name === 'document_version_unique')
    ).toBe(true)
    expect(
      indexes.some((index) => index.name === 'document_ready_versions')
    ).toBe(true)
  })
})
