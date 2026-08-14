import { describe, expect, test } from 'bun:test'
import { createApplication } from '@/app'
import {
  FakeResumeParser,
  FakeResumeTextExtractor,
  InMemoryBlobStorage,
  InMemoryDocumentRepository
} from './helpers/fakes'
import { docxFile, pdfFile } from './helpers/files'

const API_KEY = 'test-api-key-'.padEnd(64, 'x')

function createSubject() {
  const repository = new InMemoryDocumentRepository()
  const storage = new InMemoryBlobStorage()
  const extractor = new FakeResumeTextExtractor()
  const parser = new FakeResumeParser()
  const app = createApplication({
    repository,
    storage,
    extractor,
    parser,
    apiKey: API_KEY
  })
  const authorization = { Authorization: `Bearer ${API_KEY}` }
  return { app, authorization, repository, storage, extractor, parser }
}

function uploadBody(file: File, field?: { name: string; value: string }) {
  const body = new FormData()
  body.set('file', file)
  if (field) body.set(field.name, field.value)
  return body
}

describe('public documentation routes', () => {
  test('health, OpenAPI, and Swagger UI are public', async () => {
    const { app } = createSubject()

    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/openapi.json')).status).toBe(200)
    const docs = await app.request('/docs')
    expect(docs.status).toBe(200)
    expect(await docs.text()).toContain('/openapi.json')
  })

  test('publishes an OpenAPI 3.1 bearer and multipart contract without secrets', async () => {
    const { app } = createSubject()
    const response = await app.request('/openapi.json')
    const spec = (await response.json()) as any

    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers).toEqual([
      { url: '/', description: 'Current deployment' }
    ])
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer'
    })
    expect(spec.components.schemas.Document.properties).toHaveProperty(
      'parsedResume'
    )
    expect(
      spec.components.schemas.DocumentVersionDetail.allOf[1].properties
    ).toHaveProperty('parsedResume')
    expect(
      spec.components.schemas.DocumentVersionSummary.properties
    ).not.toHaveProperty('parsedResume')
    expect(spec.components.schemas.ParsedResume.properties).toMatchObject({
      parseRevision: { type: 'integer', exclusiveMinimum: 0 },
      data: { $ref: '#/components/schemas/ResumeData' }
    })

    for (const [path, item] of Object.entries<any>(spec.paths)) {
      if (!path.startsWith('/v1/')) continue
      for (const operation of Object.values<any>(item)) {
        expect(operation.security).toEqual([{ bearerAuth: [] }])
      }
    }

    for (const path of [
      '/v1/documents',
      '/v1/documents/{documentId}/versions'
    ]) {
      const schema =
        spec.paths[path].post.requestBody.content['multipart/form-data'].schema
      expect(schema.required).toContain('file')
      expect(schema.properties.file).toMatchObject({
        type: 'string',
        format: 'binary'
      })
    }

    const expectedStatuses: Record<string, Record<string, number[]>> = {
      '/v1/documents': {
        get: [200, 400, 401, 500, 503],
        post: [201, 400, 401, 413, 415, 422, 500, 502, 503]
      },
      '/v1/documents/{documentId}': {
        get: [200, 400, 401, 404, 500, 503]
      },
      '/v1/documents/{documentId}/versions': {
        get: [200, 400, 401, 404, 500, 503],
        post: [201, 400, 401, 404, 413, 415, 422, 500, 502, 503]
      },
      '/v1/documents/{documentId}/versions/{version}': {
        get: [200, 400, 401, 404, 500, 503]
      },
      '/v1/documents/{documentId}/versions/{version}/download': {
        get: [302, 400, 401, 404, 500, 502, 503]
      },
      '/v1/documents/{documentId}/versions/{version}/reparse': {
        post: [200, 400, 401, 404, 422, 500, 502, 503]
      }
    }
    for (const [path, operations] of Object.entries(expectedStatuses)) {
      for (const [method, statuses] of Object.entries(operations)) {
        expect(
          Object.keys(spec.paths[path][method].responses)
            .map(Number)
            .toSorted((left, right) => left - right)
        ).toEqual(statuses)
      }
    }

    expect(JSON.stringify(spec)).not.toContain(API_KEY)
    expect(JSON.stringify(spec)).not.toContain('BLOB_READ_WRITE_TOKEN')
    expect(JSON.stringify(spec)).not.toContain('MONGODB_URI')
  })
})

describe('document HTTP routes', () => {
  test('rejects missing and invalid bearer credentials', async () => {
    const { app } = createSubject()

    const missing = await app.request('/v1/documents')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' }
    })

    const invalid = await app.request('/v1/documents', {
      headers: { Authorization: 'Bearer incorrect' }
    })
    expect(invalid.status).toBe(401)
  })

  test('creates a document, adds a version, lists it, and redirects downloads', async () => {
    const { app, authorization } = createSubject()

    const createdResponse = await app.request('/v1/documents', {
      method: 'POST',
      headers: authorization,
      body: uploadBody(pdfFile(), { name: 'title', value: 'Candidate Resume' })
    })
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as any
    const documentId = created.data.id as string
    expect(created.data.title).toBe('Candidate Resume')
    expect(created.data.currentVersion).toBe(1)
    expect(created.data.latestVersion.version).toBe(1)
    expect(created.data.parsedResume.data.basics.name).toBe('Jane Doe')
    expect(created.requestId).toBeString()
    expect(createdResponse.headers.get('cache-control')).toBe(
      'private, no-store'
    )

    const versionResponse = await app.request(
      `/v1/documents/${documentId}/versions`,
      {
        method: 'POST',
        headers: authorization,
        body: uploadBody(docxFile(), {
          name: 'changeNote',
          value: 'Updated history'
        })
      }
    )
    expect(versionResponse.status).toBe(201)
    const secondVersion = (await versionResponse.json()) as any
    expect(secondVersion.data.currentVersion).toBe(2)
    expect(secondVersion.data.latestVersion.version).toBe(2)
    expect(secondVersion.data.parsedResume.parseRevision).toBe(1)

    const listResponse = await app.request(
      `/v1/documents/${documentId}/versions`,
      {
        headers: authorization
      }
    )
    expect(listResponse.status).toBe(200)
    const versionList = (await listResponse.json()) as any
    expect(versionList.data.items.map((item: any) => item.version)).toEqual([
      2, 1
    ])
    expect(versionList.data.items[0].parseRevision).toBe(1)
    expect(versionList.data.items[0]).not.toHaveProperty('parsedResume')
    const documentListResponse = await app.request('/v1/documents', {
      headers: authorization
    })
    const listedBody = (await documentListResponse.json()) as any
    expect(listedBody.data.items[0]).not.toHaveProperty('parsedResume')

    const versionDetail = await app.request(
      `/v1/documents/${documentId}/versions/2`,
      { headers: authorization }
    )
    expect(
      ((await versionDetail.json()) as any).data.parsedResume
    ).not.toBeNull()

    const reparse = await app.request(
      `/v1/documents/${documentId}/versions/2/reparse`,
      { method: 'POST', headers: authorization }
    )
    expect(reparse.status).toBe(200)
    expect(
      ((await reparse.json()) as any).data.parsedResume.parseRevision
    ).toBe(2)

    const download = await app.request(
      `/v1/documents/${documentId}/versions/2/download`,
      { headers: authorization }
    )
    expect(download.status).toBe(302)
    expect(download.headers.get('location')).toContain('blob.example.test')
  })

  test('returns a structured unsupported-media error for spoofed uploads', async () => {
    const { app, authorization } = createSubject()
    const file = new File(['plain text'], 'resume.pdf', {
      type: 'application/pdf'
    })

    const response = await app.request('/v1/documents', {
      method: 'POST',
      headers: authorization,
      body: uploadBody(file)
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', requestId: expect.any(String) }
    })
  })
})
