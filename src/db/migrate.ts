import { closeMongoConnection } from './mongodb'
import { MongoDocumentRepository } from '../repositories/mongo-document.repository'

const repository = new MongoDocumentRepository()

try {
  await repository.ensureIndexes()
  console.log('MongoDB indexes are ready')
} finally {
  await closeMongoConnection()
}
