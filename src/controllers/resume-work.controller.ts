import {
  toResumeWorkAggregateDto,
  type ResumeWorkAggregateDto
} from '../dtos/resume-work.dto'
import { ResumeWorkAggregateService } from '../services/resume-work-aggregate.service'
import type { ResumeWorkLanguage } from '../types/resume-work.types'

export class ResumeWorkController {
  constructor(private readonly service: ResumeWorkAggregateService) {}

  async get(language?: ResumeWorkLanguage): Promise<ResumeWorkAggregateDto> {
    return toResumeWorkAggregateDto(
      await this.service.getCombinedWork(language)
    )
  }
}
