import { z } from 'zod'

const RuntimeEnvironmentSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default('resume_ingest'),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  DOCUMENT_API_KEY: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000)
})

export type RuntimeEnvironment = z.infer<typeof RuntimeEnvironmentSchema>

let cachedEnvironment: RuntimeEnvironment | undefined

export function getRuntimeEnvironment(): RuntimeEnvironment {
  cachedEnvironment ??= RuntimeEnvironmentSchema.parse(process.env)
  return cachedEnvironment
}

export function resetRuntimeEnvironmentForTests(): void {
  cachedEnvironment = undefined
}
