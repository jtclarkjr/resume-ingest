import {
  MAX_FILE_BYTES,
  SUPPORTED_DOCUMENT_TYPES
} from '@/constants/document.constants'

function makeFile(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

export function pdfFile(name = 'resume.pdf'): File {
  return makeFile(
    [...new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')],
    name,
    SUPPORTED_DOCUMENT_TYPES.pdf
  )
}

export function docxFile(name = 'resume.docx'): File {
  return makeFile(
    [0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 128 }, () => 0)],
    name,
    SUPPORTED_DOCUMENT_TYPES.docx
  )
}

export function docFile(name = 'resume.doc'): File {
  return makeFile(
    [
      0xd0,
      0xcf,
      0x11,
      0xe0,
      0xa1,
      0xb1,
      0x1a,
      0xe1,
      ...Array.from({ length: 128 }, () => 0)
    ],
    name,
    SUPPORTED_DOCUMENT_TYPES.doc
  )
}

export function oversizedPdfFile(): File {
  const bytes = new Uint8Array(MAX_FILE_BYTES + 1)
  bytes.set(new TextEncoder().encode('%PDF-'))
  return new File([bytes], 'large.pdf', { type: SUPPORTED_DOCUMENT_TYPES.pdf })
}
