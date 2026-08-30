import { describe, expect, test } from 'bun:test'
import { DocumentService } from '@/services/document.service'
import { ResumeWorkAggregateService } from '@/services/resume-work-aggregate.service'
import {
  FakeResumeParser,
  FakeResumeTextExtractor,
  FakeResumeWorkCombiner,
  InMemoryBlobStorage,
  InMemoryDocumentRepository
} from './helpers/fakes'
import { pdfFile } from './helpers/files'

function createSubject() {
  const repository = new InMemoryDocumentRepository()
  const parser = new FakeResumeParser()
  const documentService = new DocumentService(
    repository,
    new InMemoryBlobStorage(),
    new FakeResumeTextExtractor(),
    parser
  )
  const combiner = new FakeResumeWorkCombiner()
  return {
    repository,
    parser,
    combiner,
    documentService,
    service: new ResumeWorkAggregateService(repository, combiner)
  }
}

describe('ResumeWorkAggregateService', () => {
  test('returns and caches an empty aggregate without calling AI', async () => {
    const { combiner, service } = createSubject()

    const first = await service.getCombinedWork()
    const second = await service.getCombinedWork()

    expect(first.work).toEqual([])
    expect(first.sources).toEqual([])
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(combiner.sources).toHaveLength(0)
  })

  test('combines the latest ready version from each document and reuses the cache', async () => {
    const { combiner, documentService, service } = createSubject()
    const firstDocument = await documentService.createDocument(
      pdfFile('first.pdf')
    )
    await documentService.addVersion(
      firstDocument.document._id,
      pdfFile('first-v2.pdf')
    )
    await documentService.createDocument(pdfFile('second.pdf'))

    const first = await service.getCombinedWork()
    const second = await service.getCombinedWork()

    expect(combiner.sources).toHaveLength(1)
    expect(combiner.sources[0]).toHaveLength(2)
    expect(
      combiner.sources[0]!.map((source) => source.version).toSorted()
    ).toEqual([1, 2])
    expect(first.sources).toHaveLength(2)
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  test('excludes legacy parses until a qualifying Japanese reparse succeeds', async () => {
    const { parser, repository, documentService, service } = createSubject()
    const document = await documentService.createDocument(pdfFile())
    const legacyParse = [...repository.parses.values()][0]!
    delete legacyParse.isJapaneseShokumuKeirekisho

    await expect(service.getCombinedWork('ja')).rejects.toMatchObject({
      code: 'JAPANESE_SHOKUMU_KEIREKISHO_REQUIRED',
      status: 422
    })

    parser.result.isJapaneseShokumuKeirekisho = true
    await documentService.reparseVersion(document.document._id, 1)
    const japanese = await service.getCombinedWork('ja')
    const standard = await service.getCombinedWork()

    expect(japanese.sources).toHaveLength(1)
    expect(japanese.sources[0]?.parseRevision).toBe(2)
    expect(japanese.fingerprint).not.toBe(standard.fingerprint)
  })

  test('filters mixed Japanese sources and isolates caches and leases', async () => {
    const { parser, repository, combiner, documentService, service } =
      createSubject()
    parser.result.isJapaneseShokumuKeirekisho = true
    const japaneseDocument = await documentService.createDocument(
      pdfFile('japanese.pdf')
    )
    parser.result.isJapaneseShokumuKeirekisho = false
    await documentService.createDocument(pdfFile('other.pdf'))

    const japanese = await service.getCombinedWork('ja')
    const standard = await service.getCombinedWork()
    const cachedJapanese = await service.getCombinedWork('ja')

    expect(japanese.sources).toHaveLength(1)
    expect(standard.sources).toHaveLength(2)
    expect(cachedJapanese.fingerprint).toBe(japanese.fingerprint)
    expect(combiner.sources.map((sources) => sources.length)).toEqual([1, 2])
    expect(combiner.languages).toEqual(['ja', undefined])
    expect(repository.resumeWorkAggregates.has('global')).toBe(true)
    expect(repository.resumeWorkAggregates.has('ja')).toBe(true)

    parser.result.isJapaneseShokumuKeirekisho = true
    await documentService.addVersion(
      japaneseDocument.document._id,
      pdfFile('japanese-v2.pdf')
    )
    const refreshed = await service.getCombinedWork('ja')
    expect(refreshed.fingerprint).not.toBe(japanese.fingerprint)
    expect(refreshed.sources[0]?.version).toBe(2)

    const now = new Date()
    const leaseUntil = new Date(now.getTime() + 1_000)
    expect(
      await repository.tryAcquireResumeWorkGeneration(
        'global',
        'next',
        'global-owner',
        now,
        leaseUntil
      )
    ).toBe(true)
    expect(
      await repository.tryAcquireResumeWorkGeneration(
        'ja',
        'next',
        'ja-owner',
        now,
        leaseUntil
      )
    ).toBe(true)
  })

  test('regenerates after a new version or current reparse changes the fingerprint', async () => {
    const { combiner, documentService, service } = createSubject()
    const document = await documentService.createDocument(pdfFile())

    const initial = await service.getCombinedWork()
    await documentService.addVersion(document.document._id, pdfFile('v2.pdf'))
    const afterVersion = await service.getCombinedWork()
    await documentService.reparseVersion(document.document._id, 2)
    const afterReparse = await service.getCombinedWork()

    expect(combiner.sources).toHaveLength(3)
    expect(afterVersion.fingerprint).not.toBe(initial.fingerprint)
    expect(afterReparse.fingerprint).not.toBe(afterVersion.fingerprint)
    expect(afterReparse.sources[0]?.parseRevision).toBe(2)
  })

  test('coalesces concurrent stale requests behind one generation lease', async () => {
    const { combiner, documentService, repository, service } = createSubject()
    await documentService.createDocument(pdfFile())
    const originalCombine = combiner.combine.bind(combiner)
    combiner.combine = async (sources) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return originalCombine(sources)
    }

    const [left, right] = await Promise.all([
      service.getCombinedWork(),
      new ResumeWorkAggregateService(repository, combiner).getCombinedWork()
    ])

    expect(combiner.sources).toHaveLength(1)
    expect(left.fingerprint).toBe(right.fingerprint)
  })

  test('queues a newer source fingerprint without letting stale work retake the lease', async () => {
    const { combiner, documentService, repository, service } = createSubject()
    const document = await documentService.createDocument(pdfFile())
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const originalCombine = combiner.combine.bind(combiner)
    let startedFirst: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      startedFirst = resolve
    })
    combiner.combine = async (sources) => {
      if (combiner.sources.length === 0) {
        startedFirst?.()
        await firstBlocked
      }
      return originalCombine(sources)
    }

    const staleRequest = service.getCombinedWork()
    await firstStarted
    await documentService.addVersion(document.document._id, pdfFile('v2.pdf'))
    const freshRequest = new ResumeWorkAggregateService(
      repository,
      combiner
    ).getCombinedWork()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(combiner.sources).toHaveLength(0)
    releaseFirst?.()

    const [stale, fresh] = await Promise.all([staleRequest, freshRequest])
    expect(stale.sources[0]?.version).toBe(1)
    expect(fresh.sources[0]?.version).toBe(2)
    expect(combiner.sources.map((sources) => sources[0]?.version)).toEqual([
      1, 2
    ])
    expect(repository.resumeWorkAggregate?.ready?.sources[0]?.version).toBe(2)
  })

  test('releases the lease and does not serve stale data after generation fails', async () => {
    const { combiner, documentService, repository, service } = createSubject()
    const document = await documentService.createDocument(pdfFile())
    await service.getCombinedWork()
    await documentService.addVersion(document.document._id, pdfFile('v2.pdf'))
    combiner.error = new Error('gateway unavailable')

    await expect(service.getCombinedWork()).rejects.toMatchObject({
      code: 'RESUME_WORK_AGGREGATION_FAILED',
      status: 502
    })
    expect(repository.resumeWorkAggregate?.ready?.sources[0]?.version).toBe(1)
    expect(repository.resumeWorkAggregate?.generation).toBeUndefined()
  })
})
