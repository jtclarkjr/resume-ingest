// Vercel's Hono framework detector requires a direct entrypoint import.
import 'hono'
import { createApplication } from './app'
import { getRuntimeEnvironment } from './config/env'
import { MongoDocumentRepository } from './repositories/mongo-document.repository'
import { VercelBlobStorage } from './services/blob-storage.service'

const environment = getRuntimeEnvironment()

export default createApplication({
  repository: new MongoDocumentRepository(),
  storage: new VercelBlobStorage(),
  apiKey: environment.DOCUMENT_API_KEY
})
