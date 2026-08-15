import { MongoServerError, type Filter } from 'mongodb'
import { getMongoContext, type MongoContext } from '../db/mongodb'
import type {
  DocumentListCursor,
  DocumentRecord,
  DocumentVersionParseRecord,
  DocumentVersionRecord,
  Page,
  ResumeParseResult
} from '../types/document.types'
import type {
  ResumeWorkAggregateCacheRecord,
  ResumeWorkAggregateReady,
  ResumeWorkSource
} from '../types/resume-work.types'
import type {
  DocumentRepository,
  PendingParseInput,
  PendingVersionInput
} from './document.repository'
import { encodeDocumentCursor, encodeVersionCursor } from '../utils/cursor'

type ContextProvider = () => Promise<MongoContext>

export class MongoDocumentRepository implements DocumentRepository {
  constructor(private readonly getContext: ContextProvider = getMongoContext) {}

  async createInitial(
    document: DocumentRecord,
    version: DocumentVersionRecord,
    parse: DocumentVersionParseRecord
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
        await db
          .collection<DocumentVersionParseRecord>('document_version_parses')
          .insertOne(parse, { session })
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
    blob: { pathname: string; etag: string },
    parse: DocumentVersionParseRecord
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
                currentParseRevision: parse.revision,
                nextParseRevision: parse.revision + 1,
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
        await db
          .collection<DocumentVersionParseRecord>('document_version_parses')
          .insertOne(parse, { session })
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

  async reserveParse(
    input: PendingParseInput
  ): Promise<DocumentVersionParseRecord | null> {
    const { client, db } = await this.getContext()
    const session = client.startSession()
    let reserved: DocumentVersionParseRecord | null = null
    try {
      await session.withTransaction(async () => {
        const version = await db
          .collection<DocumentVersionRecord>('document_versions')
          .findOneAndUpdate(
            {
              documentId: input.documentId,
              version: input.version,
              status: 'ready'
            },
            [
              {
                $set: {
                  nextParseRevision: {
                    $add: [
                      {
                        $ifNull: [
                          '$nextParseRevision',
                          {
                            $add: [{ $ifNull: ['$currentParseRevision', 0] }, 1]
                          }
                        ]
                      },
                      1
                    ]
                  }
                }
              }
            ],
            { returnDocument: 'before', session }
          )
        if (!version) return

        const now = new Date()
        reserved = {
          ...input,
          revision:
            version.nextParseRevision ??
            (version.currentParseRevision ?? 0) + 1,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        }
        await db
          .collection<DocumentVersionParseRecord>('document_version_parses')
          .insertOne(reserved, { session })
      })
      return reserved
    } finally {
      await session.endSession()
    }
  }

  async completeParse(
    documentId: string,
    version: number,
    revision: number,
    result: ResumeParseResult
  ): Promise<DocumentVersionParseRecord> {
    const { client, db } = await this.getContext()
    const session = client.startSession()
    let completed: DocumentVersionParseRecord | null = null
    try {
      await session.withTransaction(async () => {
        const now = new Date()
        completed = await db
          .collection<DocumentVersionParseRecord>('document_version_parses')
          .findOneAndUpdate(
            { documentId, version, revision, status: 'pending' },
            {
              $set: {
                status: 'ready',
                model: result.model,
                data: result.data,
                warnings: result.warnings,
                usage: result.usage,
                parsedAt: now,
                updatedAt: now
              }
            },
            { returnDocument: 'after', session }
          )
        if (!completed) throw new Error('Reserved parse revision was not found')
        await db
          .collection<DocumentVersionRecord>('document_versions')
          .updateOne(
            { documentId, version, status: 'ready' },
            {
              $max: { currentParseRevision: revision },
              $set: { updatedAt: now }
            },
            { session }
          )
      })
    } finally {
      await session.endSession()
    }
    if (!completed) throw new Error('Could not complete parse revision')
    return completed
  }

  async failParse(
    documentId: string,
    version: number,
    revision: number,
    reason: string
  ): Promise<void> {
    const { db } = await this.getContext()
    await db
      .collection<DocumentVersionParseRecord>('document_version_parses')
      .updateOne(
        { documentId, version, revision, status: 'pending' },
        {
          $set: {
            status: 'failed',
            failureReason: reason.slice(0, 500),
            updatedAt: new Date()
          }
        }
      )
  }

  async findCurrentReadyParse(
    documentId: string,
    version: number
  ): Promise<DocumentVersionParseRecord | null> {
    const { db } = await this.getContext()
    return db
      .collection<DocumentVersionParseRecord>('document_version_parses')
      .find({ documentId, version, status: 'ready' })
      .sort({ revision: -1 })
      .limit(1)
      .next()
  }

  async findReadyVersionsWithoutParse(
    limit: number
  ): Promise<DocumentVersionRecord[]> {
    const { db } = await this.getContext()
    return db
      .collection<DocumentVersionRecord>('document_versions')
      .aggregate<DocumentVersionRecord>([
        { $match: { status: 'ready', blobPathname: { $type: 'string' } } },
        {
          $lookup: {
            from: 'document_version_parses',
            let: { documentId: '$documentId', version: '$version' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$documentId', '$$documentId'] },
                      { $eq: ['$version', '$$version'] },
                      { $eq: ['$status', 'ready'] }
                    ]
                  }
                }
              },
              { $limit: 1 }
            ],
            as: 'readyParses'
          }
        },
        { $match: { readyParses: { $size: 0 } } },
        { $unset: 'readyParses' },
        { $sort: { createdAt: 1, documentId: 1, version: 1 } },
        { $limit: limit }
      ])
      .toArray()
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

  async listCurrentReadyWorkSources(): Promise<ResumeWorkSource[]> {
    const { db } = await this.getContext()
    return db
      .collection<DocumentRecord>('documents')
      .aggregate<ResumeWorkSource>([
        { $sort: { _id: 1 } },
        {
          $lookup: {
            from: 'document_versions',
            let: { documentId: '$_id', version: '$currentVersion' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$documentId', '$$documentId'] },
                      { $eq: ['$version', '$$version'] },
                      { $eq: ['$status', 'ready'] }
                    ]
                  }
                }
              },
              { $limit: 1 }
            ],
            as: 'versions'
          }
        },
        { $unwind: '$versions' },
        {
          $lookup: {
            from: 'document_version_parses',
            let: {
              documentId: '$_id',
              version: '$versions.version',
              revision: '$versions.currentParseRevision'
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$documentId', '$$documentId'] },
                      { $eq: ['$version', '$$version'] },
                      { $eq: ['$revision', '$$revision'] },
                      { $eq: ['$status', 'ready'] }
                    ]
                  }
                }
              },
              { $limit: 1 }
            ],
            as: 'parses'
          }
        },
        { $unwind: '$parses' },
        {
          $project: {
            _id: 0,
            documentId: '$_id',
            version: '$versions.version',
            parseRevision: '$parses.revision',
            sourceSha256: '$parses.sourceSha256',
            work: '$parses.data.work'
          }
        }
      ])
      .toArray()
  }

  async findResumeWorkAggregate(): Promise<ResumeWorkAggregateCacheRecord | null> {
    const { db } = await this.getContext()
    return db
      .collection<ResumeWorkAggregateCacheRecord>('resume_work_aggregates')
      .findOne({ _id: 'global' })
  }

  async tryAcquireResumeWorkGeneration(
    fingerprint: string,
    owner: string,
    startedAt: Date,
    leaseUntil: Date
  ): Promise<boolean> {
    const { db } = await this.getContext()
    try {
      const result = await db
        .collection<ResumeWorkAggregateCacheRecord>('resume_work_aggregates')
        .updateOne(
          {
            _id: 'global',
            'ready.fingerprint': { $ne: fingerprint },
            $or: [
              { generation: { $exists: false } },
              { 'generation.leaseUntil': { $lte: startedAt } }
            ]
          },
          {
            $set: {
              generation: { fingerprint, owner, startedAt, leaseUntil },
              updatedAt: startedAt
            },
            $setOnInsert: { _id: 'global' }
          },
          { upsert: true }
        )
      return result.matchedCount + result.upsertedCount === 1
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        return false
      throw error
    }
  }

  async completeResumeWorkGeneration(
    fingerprint: string,
    owner: string,
    ready: ResumeWorkAggregateReady
  ): Promise<boolean> {
    const { db } = await this.getContext()
    const result = await db
      .collection<ResumeWorkAggregateCacheRecord>('resume_work_aggregates')
      .updateOne(
        {
          _id: 'global',
          'generation.fingerprint': fingerprint,
          'generation.owner': owner
        },
        {
          $set: { ready, updatedAt: ready.generatedAt },
          $unset: { generation: '' }
        }
      )
    return result.modifiedCount === 1
  }

  async releaseResumeWorkGeneration(
    fingerprint: string,
    owner: string
  ): Promise<void> {
    const { db } = await this.getContext()
    await db
      .collection<ResumeWorkAggregateCacheRecord>('resume_work_aggregates')
      .updateOne(
        {
          _id: 'global',
          'generation.fingerprint': fingerprint,
          'generation.owner': owner
        },
        { $unset: { generation: '' }, $set: { updatedAt: new Date() } }
      )
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
        ),
      db
        .collection<DocumentVersionParseRecord>('document_version_parses')
        .createIndex(
          { documentId: 1, version: 1, revision: 1 },
          { name: 'document_version_parse_unique', unique: true }
        ),
      db
        .collection<DocumentVersionParseRecord>('document_version_parses')
        .createIndex(
          { documentId: 1, version: 1, status: 1, revision: -1 },
          { name: 'document_version_latest_ready_parse' }
        )
    ])
  }
}
