import { del, issueSignedToken, presignUrl, put } from '@vercel/blob'
import {
  DOWNLOAD_URL_TTL_MS,
  MAX_FILE_BYTES
} from '../constants/document.constants'
import type {
  BlobStorage,
  BlobUploadResult,
  ValidatedDocumentFile
} from '../types/document.types'

export class VercelBlobStorage implements BlobStorage {
  async upload(
    pathname: string,
    file: ValidatedDocumentFile
  ): Promise<BlobUploadResult> {
    const result = await put(pathname, Buffer.from(file.bytes), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: file.contentType,
      maximumSizeInBytes: MAX_FILE_BYTES
    })
    return { pathname: result.pathname, etag: result.etag }
  }

  async delete(pathname: string): Promise<void> {
    await del(pathname)
  }

  async createDownloadUrl(pathname: string): Promise<string> {
    const validUntil = Date.now() + DOWNLOAD_URL_TTL_MS
    const token = await issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil
    })
    const result = await presignUrl(token, {
      access: 'private',
      operation: 'get',
      pathname,
      validUntil
    })
    return result.presignedUrl
  }
}
