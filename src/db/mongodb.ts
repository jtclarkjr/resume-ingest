import { attachDatabasePool } from '@vercel/functions'
import { MongoClient, type Db } from 'mongodb'
import { getRuntimeEnvironment } from '../config/env'

export interface MongoContext {
  client: MongoClient
  db: Db
}

let client: MongoClient | undefined
let connection: Promise<MongoContext> | undefined

export async function getMongoContext(): Promise<MongoContext> {
  if (!connection) {
    const environment = getRuntimeEnvironment()
    client = new MongoClient(environment.MONGODB_URI, {
      appName: 'resume-ingest.vercel',
      maxIdleTimeMS: 5_000
    })
    attachDatabasePool(client)
    connection = client
      .connect()
      .then((connectedClient) => ({
        client: connectedClient,
        db: connectedClient.db(environment.MONGODB_DB_NAME)
      }))
      .catch((error: unknown) => {
        connection = undefined
        client = undefined
        throw error
      })
  }
  return connection
}

export async function closeMongoConnection(): Promise<void> {
  await client?.close()
  client = undefined
  connection = undefined
}
