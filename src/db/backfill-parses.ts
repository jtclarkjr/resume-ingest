import { getRuntimeEnvironment } from '../config/env'
import { MongoDocumentRepository } from '../repositories/mongo-document.repository'
import { AiGatewayResumeParser } from '../services/ai-resume-parser.service'
import { VercelBlobStorage } from '../services/blob-storage.service'
import { DocumentService } from '../services/document.service'
import { DocumentResumeTextExtractor } from '../services/resume-text-extractor.service'
import { closeMongoConnection } from './mongodb'

const environment = getRuntimeEnvironment()
const repository = new MongoDocumentRepository()
const service = new DocumentService(
  repository,
  new VercelBlobStorage(),
  new DocumentResumeTextExtractor(),
  new AiGatewayResumeParser(environment.RESUME_PARSER_MODEL)
)

try {
  await repository.ensureIndexes()
  const result = await service.backfillUnparsedVersions()
  console.log('Résumé parse backfill finished', {
    found: result.found,
    parsed: result.parsed,
    failed: result.failed
  })
  if (result.failed.length > 0) process.exitCode = 1
} finally {
  await closeMongoConnection()
}
