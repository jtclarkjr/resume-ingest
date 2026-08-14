import { describe, expect, test } from 'bun:test'
import { DocumentService } from '@/services/document.service'
import {
  InMemoryBlobStorage,
  InMemoryDocumentRepository
} from './helpers/fakes'
import { pdfFile } from './helpers/files'

function createSubject() {
  const repository = new InMemoryDocumentRepository()
  const storage = new InMemoryBlobStorage()
  return {
    repository,
    storage,
    service: new DocumentService(repository, storage)
  }
}

describe('DocumentService', () => {
  test('creates version one at an immutable UUID path', async () => {
    const { repository, storage, service } = createSubject()

    const result = await service.createDocument(
      pdfFile('Jane Resume.pdf'),
      'Jane Doe'
    )

    expect(result.document._id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.document.currentVersion).toBe(1)
    expect(result.latestVersion?.version).toBe(1)
    expect(result.latestVersion?.status).toBe('ready')
    expect(result.latestVersion?.blobPathname).toBe(
      `documents/${result.document._id}/versions/1/Jane-Resume.pdf`
    )
    expect(repository.versions.size).toBe(1)
    expect(storage.files.size).toBe(1)
  })

  test('compensates for an initial database failure by deleting the Blob', async () => {
    const { repository, storage, service } = createSubject()
    repository.failCreate = true

    await expect(service.createDocument(pdfFile())).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      status: 503
    })
    expect(storage.files.size).toBe(0)
    expect(storage.deleted).toHaveLength(1)
  })

  test('allocates concurrent versions without collisions', async () => {
    const { repository, service } = createSubject()
    const initial = await service.createDocument(pdfFile())

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        service.addVersion(
          initial.document._id,
          pdfFile(`resume-${index + 2}.pdf`),
          `revision ${index + 2}`
        )
      )
    )

    const versions = await service.listVersions(initial.document._id, 20)
    expect(versions.items.map((version) => version.version)).toEqual([
      6, 5, 4, 3, 2, 1
    ])
    expect(
      (await repository.findDocument(initial.document._id))?.currentVersion
    ).toBe(6)
  })

  test('marks a reserved version failed and hides it when upload fails', async () => {
    const { repository, storage, service } = createSubject()
    const initial = await service.createDocument(pdfFile())
    storage.failUploads = true

    await expect(
      service.addVersion(initial.document._id, pdfFile('failed.pdf'))
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR', status: 502 })

    expect(repository.versions.get(`${initial.document._id}:2`)?.status).toBe(
      'failed'
    )
    expect(
      (await service.listVersions(initial.document._id)).items
    ).toHaveLength(1)
  })
})
