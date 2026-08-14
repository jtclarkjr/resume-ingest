# Resume Ingest API

A Bun, Hono, and TypeScript API for storing immutable PDF and Word document
versions and synchronously converting each version into revisioned,
source-faithful JSON Resume data. Metadata and parse revisions live in MongoDB
Atlas; file bytes live in a private Vercel Blob store.

Interactive Swagger UI is available at `/docs` on local, preview, and production
deployments. The OpenAPI 3.1 contract at `/openapi.json` is generated from the
same Zod schemas used for request validation.

## Requirements

- Bun 1.x
- Vercel CLI authenticated to the linked project
- Existing Vercel MongoDB integration resource `resume-ingest`
- Private Vercel Blob store `resume-ingest-documents`

## Environment

Copy `.env.example` when configuring an environment manually. These values are
required:

```dotenv
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=resume_ingest
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
DOCUMENT_API_KEY=a-random-secret-at-least-32-characters-long
RESUME_PARSER_MODEL=openai/gpt-5.4-mini
# Only needed for direct local development outside Vercel:
AI_GATEWAY_API_KEY=...
```

Vercel Functions receive `VERCEL_OIDC_TOKEN` automatically and the AI SDK uses
it to authenticate to Vercel AI Gateway. It is not the API key for document
routes. Clients and Swagger must continue to send `DOCUMENT_API_KEY` as the
bearer credential. Never paste an OIDC token into Swagger or expose either token
in browser application code.

Never commit these values. `.env*` and `.vercel` are ignored. The Vercel
development variables are pulled into `.env.vercel.local` so an existing
`.env.local` is preserved.

## Local setup

```bash
bun install
vercel link
vercel env pull .env.vercel.local --environment development --yes
bun --env-file=.env.vercel.local run db:migrate
bun run dev
```

`bun run dev` uses `vercel dev` so the local runtime matches deployment routing.
`bun run dev:bun` is available for direct Bun development.

Open these URLs after starting the server:

- Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)
- OpenAPI JSON:
  [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
- Health: [http://localhost:3000/health](http://localhost:3000/health)

## Using Swagger

1. Open `/docs` on the current deployment.
2. Select **Authorize** and paste the `DOCUMENT_API_KEY` value. Swagger sends it
   as an HTTP bearer token and does not retain it across browser sessions.
3. Open `POST /v1/documents`, select **Try it out**, choose a PDF, DOCX, or DOC
   file, optionally enter a title, and execute the request.
4. Copy the returned document `id`.
5. Open `POST /v1/documents/{documentId}/versions`, enter the ID, choose the
   next file, optionally add a change note, and execute it.
6. Use the list or download routes to inspect the immutable versions.
7. The create response contains `parsedResume`. Use the version detail route to
   inspect a specific version, or execute the `reparse` route to append a new
   parse revision without changing the source file.

The Swagger page always calls its own deployment because the OpenAPI server URL
is relative.

## API

Public routes:

| Method | Route           | Description               |
| ------ | --------------- | ------------------------- |
| `GET`  | `/health`       | Liveness and API version  |
| `GET`  | `/openapi.json` | OpenAPI 3.1 specification |
| `GET`  | `/docs`         | Interactive Swagger UI    |

All `/v1` routes require `Authorization: Bearer <DOCUMENT_API_KEY>`.

| Method | Route                                                  | Description                                    |
| ------ | ------------------------------------------------------ | ---------------------------------------------- |
| `POST` | `/v1/documents`                                        | Create a document and version 1                |
| `GET`  | `/v1/documents`                                        | Cursor-paginated document list                 |
| `GET`  | `/v1/documents/:documentId`                            | Document metadata and current version          |
| `POST` | `/v1/documents/:documentId/versions`                   | Upload the next immutable version              |
| `GET`  | `/v1/documents/:documentId/versions`                   | Ready versions, newest first                   |
| `GET`  | `/v1/documents/:documentId/versions/:version`          | One ready version                              |
| `POST` | `/v1/documents/:documentId/versions/:version/reparse`  | Append and promote a new parse revision        |
| `GET`  | `/v1/documents/:documentId/versions/:version/download` | Redirect to a five-minute private download URL |

Successful JSON responses use `{ "data": ..., "requestId": "..." }`. Errors use
`{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.

Pagination accepts `limit` (default `20`, maximum `100`) and an opaque `cursor`
returned by the previous page.

## curl examples

Set shell variables without placing the key in command history:

```bash
export RESUME_API_BASE_URL=http://localhost:3000
read -s RESUME_DOCUMENT_API_KEY
```

Create a document:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $RESUME_DOCUMENT_API_KEY" \
  -F "file=@./resume.pdf;type=application/pdf" \
  -F "title=Jane Doe Resume" \
  "$RESUME_API_BASE_URL/v1/documents"
```

Upload another version:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $RESUME_DOCUMENT_API_KEY" \
  -F "file=@./resume.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -F "changeNote=Added recent experience" \
  "$RESUME_API_BASE_URL/v1/documents/$DOCUMENT_ID/versions"
```

Reparse an immutable version with the currently configured model:

```bash
curl --fail-with-body --request POST \
  -H "Authorization: Bearer $RESUME_DOCUMENT_API_KEY" \
  "$RESUME_API_BASE_URL/v1/documents/$DOCUMENT_ID/versions/1/reparse"
```

List versions and follow a private download redirect:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $RESUME_DOCUMENT_API_KEY" \
  "$RESUME_API_BASE_URL/v1/documents/$DOCUMENT_ID/versions"

curl --fail-with-body --location \
  -H "Authorization: Bearer $RESUME_DOCUMENT_API_KEY" \
  "$RESUME_API_BASE_URL/v1/documents/$DOCUMENT_ID/versions/1/download"
```

## File and version rules

- Maximum file size: 4,000,000 bytes. This leaves multipart overhead below
  Vercel Functions' 4.5 MB request limit.
- Supported formats: `.pdf`, `.docx`, and legacy `.doc`.
- Validation checks the extension, declared MIME type, content signature, and
  size before allocating a version.
- PDF text is extracted with `unpdf`; DOC and DOCX text is extracted with
  `word-extractor`. Empty, malformed, or over-200,000-character extractions are
  rejected with `422`.
- Parsing is synchronous, uses a 60-second AI Gateway timeout, and defaults to
  `openai/gpt-5.4-mini`. A Gateway or structured-output failure returns `502`
  before a new upload version or Blob is committed.
- Extracted plaintext is held only for the parsing call. It is never written to
  MongoDB, Blob, application logs, or the OpenAPI document.
- Version numbers are allocated atomically. Earlier versions and Blob paths are
  never overwritten.
- Parse revisions are append-only. A failed reparse remains internal and never
  replaces the previous ready result.
- Failed internal versions are retained for diagnostics but hidden from public
  reads.
- Files are private. MongoDB contains metadata only, and download endpoints
  create short-lived signed Blob URLs.
- Document and version list endpoints omit the large parsed payload. Document
  detail and version detail responses include `parsedResume`; historical data
  may return it as `null` until backfilled.
- There is no deletion, manual correction, external-ID mapping, or earlier-file
  modification API in v1.

The API remains private. A portfolio should fetch this data server-side or at
build time; do not place `DOCUMENT_API_KEY` in client-side JavaScript.

## Vercel setup

The project uses Tokyo for both the function and Blob store. `vercel.json` pins
Bun 1.x and `hnd1`.

```bash
vercel integration resource connect resume-ingest resume-ingest \
  -e development -e preview -e production --yes

vercel blob create-store resume-ingest-documents \
  --access private --region hnd1 \
  --environment development \
  --environment preview \
  --environment production --yes

vercel env add MONGODB_DB_NAME development,preview,production \
  --value resume_ingest --yes
```

Add one randomly generated 32-byte `DOCUMENT_API_KEY` value to development,
preview, and production. Keep preview and production sensitive. Then pull
development variables and run the migration:

```bash
vercel env pull .env.vercel.local --environment development --yes
bun --env-file=.env.vercel.local run db:migrate
```

Backfill ready historical versions after the migration. The command is
idempotent and logs only counts plus document/version identifiers—never résumé
text or parsed personal data:

```bash
bun --env-file=.env.vercel.local run db:backfill-parses
```

Deploy and open the generated `/docs` URL:

```bash
vercel deploy --dry
vercel deploy
vercel deploy --prod
```

Run the self-cleaning authenticated smoke test against a preview or production
deployment. It creates two versions, downloads the second through a signed URL,
and removes its MongoDB and Blob fixtures even if an assertion fails:

```bash
BASE_URL=https://your-deployment.vercel.app \
bun --env-file=.env.vercel.local run smoke:deployment
```

## Tests and checks

```bash
bun run check
```

The normal suite uses dependency-injected in-memory adapters. The integration
suite performs real MongoDB transactions and private Blob upload/download, uses
`integration-tests/{runId}` Blob paths, and removes its fixtures. It refuses to
run unless the test database name is exact:

```bash
RUN_INTEGRATION_TESTS=1 \
MONGODB_DB_NAME=resume_ingest_test \
bun --env-file=.env.vercel.local test tests/integration
```

Run the production index migration with `MONGODB_DB_NAME=resume_ingest` only
after the integration suite passes.

Real AI Gateway calls are intentionally gated separately from the normal test
suite and use synthetic résumé data. Provide Gateway credentials and opt in:

```bash
RUN_AI_INTEGRATION_TESTS=1 bun test tests/integration/ai-gateway.integration.test.ts
```
