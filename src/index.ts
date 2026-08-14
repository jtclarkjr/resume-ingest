// Vercel's Hono framework detector requires a direct entrypoint import.
import 'hono'
import { createApplication } from './app'
import { getRuntimeEnvironment } from './config/env'
import { MongoDocumentRepository } from './repositories/mongo-document.repository'
import { VercelBlobStorage } from './services/blob-storage.service'
import { AiGatewayResumeParser } from './services/ai-resume-parser.service'
import { DocumentResumeTextExtractor } from './services/resume-text-extractor.service'

const environment = getRuntimeEnvironment()

export default createApplication({
  repository: new MongoDocumentRepository(),
  storage: new VercelBlobStorage(),
  extractor: new DocumentResumeTextExtractor(),
  parser: new AiGatewayResumeParser(environment.RESUME_PARSER_MODEL),
  apiKey: environment.DOCUMENT_API_KEY
})
