import { closeMongoConnection, getMongoContext } from '../src/db/mongodb'
import { VercelBlobStorage } from '../src/services/blob-storage.service'
import type {
  DocumentRecord,
  DocumentVersionParseRecord,
  DocumentVersionRecord
} from '../src/types/document.types'

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const baseUrl = requireEnvironmentValue('BASE_URL')
const apiKey = requireEnvironmentValue('DOCUMENT_API_KEY')
const fixturePath = `${import.meta.dir}/../tests/fixtures/smoke.pdf`

if (process.env.MONGODB_DB_NAME !== 'resume_ingest') {
  throw new Error(
    'Deployment smoke tests require MONGODB_DB_NAME=resume_ingest'
  )
}

const authorization = `Authorization: Bearer ${apiKey}`
let documentId: string | undefined

async function vercelCurl(path: string, curlArguments: string[] = []) {
  const process = Bun.spawn(
    ['vercel', 'curl', path, '--deployment', baseUrl, '--', ...curlArguments],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text()
  ])
  if (status !== 0) {
    throw new Error(
      `vercel curl failed for ${path}: ${stderr.replaceAll(apiKey, '[redacted]')}`
    )
  }
  return stdout
}

async function cleanup(): Promise<void> {
  if (!documentId) return
  const storage = new VercelBlobStorage()
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
  await db.collection<DocumentVersionRecord>('document_versions').deleteMany({
    documentId
  })
  await db
    .collection<DocumentVersionParseRecord>('document_version_parses')
    .deleteMany({ documentId })
  await db
    .collection<DocumentRecord>('documents')
    .deleteOne({ _id: documentId })
}

try {
  const health = JSON.parse(await vercelCurl('/health', ['--silent']))
  if (health.data?.status !== 'ok') throw new Error('Health check failed')

  const docs = await vercelCurl('/docs', ['--silent'])
  if (!docs.includes('/openapi.json')) throw new Error('Swagger UI is invalid')

  const specification = JSON.parse(
    await vercelCurl('/openapi.json', ['--silent'])
  )
  if (specification.openapi !== '3.1.0') {
    throw new Error('OpenAPI 3.1 specification is unavailable')
  }

  const created = JSON.parse(
    await vercelCurl('/v1/documents', [
      '--silent',
      '--request',
      'POST',
      '--header',
      authorization,
      '--form',
      `file=@${fixturePath};type=application/pdf;filename=smoke-v1.pdf`,
      '--form',
      'title=Deployment Smoke Test'
    ])
  )
  documentId = created.data?.id
  if (!documentId || created.data?.currentVersion !== 1) {
    throw new Error('Document creation failed')
  }
  if (
    created.data?.parsedResume?.parseRevision !== 1 ||
    created.data?.parsedResume?.data?.basics?.name?.toUpperCase() !== 'JANE DOE'
  ) {
    throw new Error('Initial résumé parsing failed')
  }

  const second = JSON.parse(
    await vercelCurl(`/v1/documents/${documentId}/versions`, [
      '--silent',
      '--request',
      'POST',
      '--header',
      authorization,
      '--form',
      `file=@${fixturePath};type=application/pdf;filename=smoke-v2.pdf`,
      '--form',
      'changeNote=Deployment smoke revision'
    ])
  )
  if (second.data?.currentVersion !== 2) {
    throw new Error('Second version creation failed')
  }
  if (second.data?.parsedResume?.parseRevision !== 1) {
    throw new Error('Second version résumé parsing failed')
  }

  const reparsed = JSON.parse(
    await vercelCurl(`/v1/documents/${documentId}/versions/2/reparse`, [
      '--silent',
      '--request',
      'POST',
      '--header',
      authorization
    ])
  )
  if (reparsed.data?.parsedResume?.parseRevision !== 2) {
    throw new Error('Résumé reparse failed')
  }

  const combinedWork = JSON.parse(
    await vercelCurl('/v1/resume/work', ['--silent', '--header', authorization])
  )
  if (
    !Array.isArray(combinedWork.data?.work) ||
    !combinedWork.data?.sources?.some(
      (source: {
        documentId?: string
        version?: number
        parseRevision?: number
      }) =>
        source.documentId === documentId &&
        source.version === 2 &&
        source.parseRevision === 2
    )
  ) {
    throw new Error('Combined résumé work generation failed')
  }

  const listed = JSON.parse(
    await vercelCurl(`/v1/documents/${documentId}/versions`, [
      '--silent',
      '--header',
      authorization
    ])
  )
  if (listed.data?.items?.length !== 2) {
    throw new Error('Version listing failed')
  }

  const downloadResponse = await vercelCurl(
    `/v1/documents/${documentId}/versions/2/download`,
    ['--silent', '--include', '--max-redirs', '0', '--header', authorization]
  )
  const location = downloadResponse.match(/\r?\nlocation:\s*([^\r\n]+)/i)?.[1]
  if (!location) throw new Error('Signed download redirect is unavailable')
  const download = await fetch(location)
  if (!download.ok || (await download.arrayBuffer()).byteLength === 0) {
    throw new Error('Signed private download failed')
  }

  console.log('Deployment smoke test passed', {
    baseUrl,
    documentId,
    versions: [1, 2]
  })
} finally {
  try {
    await cleanup()
  } finally {
    await closeMongoConnection()
  }
}
