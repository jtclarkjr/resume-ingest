import type { Filter } from 'mongodb'
import { getMongoContext, type MongoContext } from '../db/mongodb'
import type {
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionRecord,
  Page
} from '../types/document.types'
import type {
  DocumentRepository,
  PendingVersionInput
} from './document.repository'
import { encodeDocumentCursor, encodeVersionCursor } from '../utils/cursor'

type ContextProvider = () => Promise<MongoContext>

export class MongoDocumentRepository implements DocumentRepository {
  constructor(private readonly getContext: ContextProvider = getMongoContext) {}

  async createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord
  ): Promise<void> {
    const { client, db } = await this.getContext()
    const session = client.startSession()
    try {
      await session.withTransaction(async () => {
        await db.collection<DocumentRecord>('documents').insertOne(document, {
          session
        })
        await db
          .collection<DocumentVersionRecord>('document_versions')
          .insertOne(version, { session })
      })
    } finally {
      await session.endSession()
    }
  }

  async reserveVersion(
    documentId: string,
    input: PendingVersionInput
  ): Promise<DocumentVersionRecord | null> {
    const { client, db } = await this.getContext()
    const session = client.startSession()
    let reserved: DocumentVersionRecord | null = null
    try {
      await session.withTransaction(async () => {
        const now = new Date()
        const document = await db
          .collection<DocumentRecord>('documents')
          .findOneAndUpdate(
            { _id: documentId },
            { $inc: { nextVersion: 1 }, $set: { updatedAt: now } },
            { returnDocument: 'before', session }
          )
        if (!document) return

        reserved = {
          ...input,
          version: document.nextVersion,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        }
        await db
          .collection<DocumentVersionRecord>('document_versions')
          .insertOne(reserved, { session })
      })
      return reserved
    } finally {
      await session.endSession()
    }
  }

  async completeVersion(
    documentId: string,
    version: number,
    blob: { pathname: string; etag: string }
  ): Promise<DocumentVersionRecord> {
    const { client, db } = await this.getContext()
    const session = client.startSession()
    let completed: DocumentVersionRecord | null = null
    try {
      await session.withTransaction(async () => {
        const now = new Date()
        completed = await db
          .collection<DocumentVersionRecord>('document_versions')
          .findOneAndUpdate(
            { documentId, version, status: 'pending' },
            {
              $set: {
                status: 'ready',
                blobPathname: blob.pathname,
                blobEtag: blob.etag,
                updatedAt: now
              }
            },
            { returnDocument: 'after', session }
          )
        if (!completed) {
          throw new Error('Reserved document version was not found')
        }
        await db
          .collection<DocumentRecord>('documents')
          .updateOne(
            { _id: documentId },
            { $max: { currentVersion: version }, $set: { updatedAt: now } },
            { session }
          )
      })
    } finally {
      await session.endSession()
    }
    if (!completed) throw new Error('Could not complete document version')
    return completed
  }

  async failVersion(
    documentId: string,
    version: number,
    reason: string
  ): Promise<void> {
    const { db } = await this.getContext()
    await db.collection<DocumentVersionRecord>('document_versions').updateOne(
      { documentId, version, status: 'pending' },
      {
        $set: {
          status: 'failed',
          failureReason: reason.slice(0, 500),
          updatedAt: new Date()
        }
      }
    )
  }

  async findDocument(documentId: string): Promise<DocumentRecord | null> {
    const { db } = await this.getContext()
    return db
      .collection<DocumentRecord>('documents')
      .findOne({ _id: documentId })
  }

  async listDocuments(
    limit: number,
    cursor?: DocumentListCursor
  ): Promise<Page<DocumentRecord>> {
    const { db } = await this.getContext()
    const filter: Filter<DocumentRecord> = cursor
      ? {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
          ]
        }
      : {}
    const rows = await db
      .collection<DocumentRecord>('documents')
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray()
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeDocumentCursor({ createdAt: last.createdAt, id: last._id })
          : null
    }
  }

  async findReadyVersion(
    documentId: string,
    version: number
  ): Promise<DocumentVersionRecord | null> {
    const { db } = await this.getContext()
    return db
      .collection<DocumentVersionRecord>('document_versions')
      .findOne({ documentId, version, status: 'ready' })
  }

  async listReadyVersions(
    documentId: string,
    limit: number,
    beforeVersion?: number
  ): Promise<Page<DocumentVersionRecord>> {
    const { db } = await this.getContext()
    const filter: Filter<DocumentVersionRecord> = {
      documentId,
      status: 'ready',
      ...(beforeVersion ? { version: { $lt: beforeVersion } } : {})
    }
    const rows = await db
      .collection<DocumentVersionRecord>('document_versions')
      .find(filter)
      .sort({ version: -1 })
      .limit(limit + 1)
      .toArray()
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return {
      items,
      nextCursor: hasMore && last ? encodeVersionCursor(last.version) : null
    }
  }

  async ensureIndexes(): Promise<void> {
    const { db } = await this.getContext()
    await Promise.all([
      db
        .collection<DocumentRecord>('documents')
        .createIndex({ createdAt: -1, _id: -1 }, { name: 'documents_list' }),
      db
        .collection<DocumentVersionRecord>('document_versions')
        .createIndex(
          { documentId: 1, version: 1 },
          { name: 'document_version_unique', unique: true }
        ),
      db
        .collection<DocumentVersionRecord>('document_versions')
        .createIndex(
          { documentId: 1, status: 1, version: -1 },
          { name: 'document_ready_versions' }
        )
    ])
  }
}
