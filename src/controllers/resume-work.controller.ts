import {
  toResumeWorkAggregateDto,
  type ResumeWorkAggregateDto
} from '../dtos/resume-work.dto'
import { ResumeWorkAggregateService } from '../services/resume-work-aggregate.service'

export class ResumeWorkController {
  constructor(private readonly service: ResumeWorkAggregateService) {}

  async get(): Promise<ResumeWorkAggregateDto> {
    return toResumeWorkAggregateDto(await this.service.getCombinedWork())
  }
}
