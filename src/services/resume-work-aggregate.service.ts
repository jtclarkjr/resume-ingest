import {
  ERROR_CODES,
  RESUME_WORK_COMBINER_VERSION,
  RESUME_WORK_GENERATION_LEASE_MS,
  RESUME_WORK_GENERATION_POLL_MS,
  RESUME_WORK_GENERATION_WAIT_MS
} from '../constants/document.constants'
import { AppError } from '../errors/app-error'
import type { DocumentRepository } from '../repositories/document.repository'
import type {
  ResumeWorkAggregateReady,
  ResumeWorkCacheId,
  ResumeWorkCombiner,
  ResumeWorkLanguage,
  ResumeWorkSource,
  ResumeWorkSourceReference
} from '../types/resume-work.types'

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sourceReference(source: ResumeWorkSource): ResumeWorkSourceReference {
  return {
    documentId: source.documentId,
    version: source.version,
    parseRevision: source.parseRevision,
    sourceSha256: source.sourceSha256
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export class ResumeWorkAggregateService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly combiner: ResumeWorkCombiner
  ) {}

  async getCombinedWork(
    language?: ResumeWorkLanguage
  ): Promise<ResumeWorkAggregateReady> {
    return this.getCombinedWorkBefore(
      Date.now() + RESUME_WORK_GENERATION_WAIT_MS,
      language
    )
  }

  private async getCombinedWorkBefore(
    deadline: number,
    language?: ResumeWorkLanguage
  ): Promise<ResumeWorkAggregateReady> {
    let sources: ResumeWorkSource[]
    try {
      sources = await this.repository.listCurrentReadyWorkSources(language)
    } catch (error) {
      throw new AppError(
        ERROR_CODES.database,
        'The résumé work sources could not be loaded',
        503,
        error instanceof Error ? error.message : 'DatabaseError'
      )
    }
    if (language === 'ja' && sources.length === 0) {
      throw new AppError(
        ERROR_CODES.japaneseShokumuKeirekishoRequired,
        'No current document has a verified Japanese 職務経歴書 parse',
        422
      )
    }
    const cacheId: ResumeWorkCacheId = language ?? 'global'

    const references = sources.map(sourceReference)
    const fingerprint = await sha256(
      JSON.stringify({
        combinerVersion: RESUME_WORK_COMBINER_VERSION,
        model: this.combiner.model,
        language: language ?? null,
        sources: references
      })
    )
    const owner = crypto.randomUUID()

    while (Date.now() < deadline) {
      let cached
      try {
        cached = await this.repository.findResumeWorkAggregate(cacheId)
      } catch (error) {
        throw new AppError(
          ERROR_CODES.database,
          'The combined work history cache could not be read',
          503,
          error instanceof Error ? error.message : 'DatabaseError'
        )
      }
      if (cached?.ready?.fingerprint === fingerprint) return cached.ready

      const startedAt = new Date()
      let acquired: boolean
      try {
        acquired = await this.repository.tryAcquireResumeWorkGeneration(
          cacheId,
          fingerprint,
          owner,
          startedAt,
          new Date(startedAt.getTime() + RESUME_WORK_GENERATION_LEASE_MS)
        )
      } catch (error) {
        throw new AppError(
          ERROR_CODES.database,
          'The combined work history generation could not be reserved',
          503,
          error instanceof Error ? error.message : 'DatabaseError'
        )
      }

      if (!acquired) {
        await wait(RESUME_WORK_GENERATION_POLL_MS)
        continue
      }

      let combined
      try {
        combined = sources.length
          ? await this.combiner.combine(sources, language)
          : {
              model: this.combiner.model,
              work: [],
              warnings: [],
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0
              }
            }
      } catch (error) {
        await this.release(cacheId, fingerprint, owner)
        if (error instanceof AppError) throw error
        throw new AppError(
          ERROR_CODES.workAggregation,
          'The combined work history could not be generated',
          502,
          error instanceof Error ? error.message : 'WorkAggregationError'
        )
      }

      const ready: ResumeWorkAggregateReady = {
        fingerprint,
        combinerVersion: RESUME_WORK_COMBINER_VERSION,
        model: combined.model,
        work: combined.work,
        warnings: combined.warnings,
        sources: references,
        usage: combined.usage,
        generatedAt: new Date()
      }
      try {
        const completed = await this.repository.completeResumeWorkGeneration(
          cacheId,
          fingerprint,
          owner,
          ready
        )
        if (completed) return ready
        await this.release(cacheId, fingerprint, owner)
        return this.getCombinedWorkBefore(deadline, language)
      } catch (error) {
        await this.release(cacheId, fingerprint, owner)
        if (error instanceof AppError) throw error
        throw new AppError(
          ERROR_CODES.database,
          'The combined work history could not be cached',
          503,
          error instanceof Error ? error.message : 'DatabaseError'
        )
      }
    }

    throw new AppError(
      ERROR_CODES.workAggregationBusy,
      'The combined work history is still being generated',
      503
    )
  }

  private async release(
    cacheId: ResumeWorkCacheId,
    fingerprint: string,
    owner: string
  ): Promise<void> {
    try {
      await this.repository.releaseResumeWorkGeneration(
        cacheId,
        fingerprint,
        owner
      )
    } catch {
      // Preserve the original generation error; the lease expires automatically.
    }
  }
}
