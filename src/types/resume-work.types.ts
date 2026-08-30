import type { ResumeWork } from '../schemas/resume.schema'
import type { ResumeTokenUsage } from './document.types'

export type ResumeWorkLanguage = 'ja'
export type ResumeWorkCacheId = 'global' | ResumeWorkLanguage

export interface ResumeWorkSourceReference {
  documentId: string
  version: number
  parseRevision: number
  sourceSha256: string
}

export interface ResumeWorkSource extends ResumeWorkSourceReference {
  work: ResumeWork[]
}

export interface ResumeWorkCombineResult {
  model: string
  work: ResumeWork[]
  warnings: string[]
  usage: ResumeTokenUsage
}

export interface ResumeWorkCombiner {
  readonly model: string
  combine(
    sources: ResumeWorkSource[],
    language?: ResumeWorkLanguage
  ): Promise<ResumeWorkCombineResult>
}

export interface ResumeWorkAggregateReady {
  fingerprint: string
  combinerVersion: string
  model: string
  work: ResumeWork[]
  warnings: string[]
  sources: ResumeWorkSourceReference[]
  usage: ResumeTokenUsage
  generatedAt: Date
}

export interface ResumeWorkAggregateGeneration {
  fingerprint: string
  owner: string
  startedAt: Date
  leaseUntil: Date
}

export interface ResumeWorkAggregateCacheRecord {
  _id: ResumeWorkCacheId
  ready?: ResumeWorkAggregateReady
  generation?: ResumeWorkAggregateGeneration
  updatedAt: Date
}
