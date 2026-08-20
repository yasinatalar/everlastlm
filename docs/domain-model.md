# Domain model

The language below is the one used in code, in the database, and in the UI copy.
Where a term appears in a table name, an entity, and a translation key, it is
spelled the same way in all three.

---

## Bounded contexts

| Context       | Owns                                             | Module               |
| ------------- | ------------------------------------------------ | -------------------- |
| **IAM**       | Profiles, locale/theme preferences               | `modules/iam`        |
| **Notebooks** | Notebooks, membership, sharing                   | `modules/notebooks`  |
| **Sources**   | Source documents, ingestion, chunks, embeddings  | `modules/sources`    |
| **Chat**      | Conversations, messages, retrieval, citations    | `modules/chat`       |
| **Notes**     | User notes                                       | `modules/notes`      |
| **Studio**    | Generated artifacts and audio overviews          | `modules/studio`     |

---

## Ubiquitous language

**Notebook** — the consistency boundary for a piece of research. Holds sources,
conversations, notes and studio artifacts. Everything a user can see is reached
*through* a notebook, which is what reduces authorisation to a single question:
"what is this person's role on this notebook?"

**Member / Role** — a user's standing on one notebook, one of `owner`, `editor`,
`viewer`. Ordered by privilege, so checks read as "at least editor". Owner is
never absent: creating a notebook creates the owner membership in the same
transaction (a trigger), and the last owner cannot be demoted or removed.

**Source** — one document a notebook reasons over: a PDF, DOCX, plain text,
Markdown, or a fetched web page. A source moves through a fixed lifecycle and
never moves backwards:

```
pending → extracting → chunking → embedding → ready
    └───────────┴───────────┴──────────┴──────► failed ──► (retry) extracting
```

Illegal transitions raise rather than being silently accepted, because a
late-arriving worker callback must not resurrect a source the user already
deleted or retried.

**Chunk** — a retrievable passage of a source. Chunks split on paragraph
boundaries, overlap their neighbours, and carry their heading path and page
number. Those two properties are what make a citation useful: the passage reads
as a coherent quote, and it can say "page 14" instead of "chunk 37".

**Citation** — the link from a span of an answer back to the chunk that supports
it, carrying a `marker` (the `[1]` rendered inline), the source, the page, and
the verbatim quoted text. Citations come from the model's own citation records,
not from matching strings after the fact.

**Conversation / Message** — a thread of questions and grounded answers inside one
notebook. Assistant messages store their citations alongside their text so a
reopened conversation is exactly as verifiable as a live one.

**Note** — a user's own writing, either typed or saved from an answer. A note
saved from chat keeps that answer's citations.

**Studio artifact** — something generated from the whole source set rather than
from a question: a study guide, briefing document, FAQ, timeline, or audio
overview. Each kind has its own content shape, modelled as a discriminated union
so a renderer cannot silently omit one.

---

## Aggregates and invariants

### Notebook (`modules/notebooks/domain/notebook.entity.ts`)

- A notebook always has a non-empty title.
- A notebook always has at least one owner.
- Ownership transfer is owner-only, and demotes the previous owner to editor
  rather than dropping their access (enforced by a database trigger, so it holds
  even for a direct SQL write).
- Deletion is a soft delete. Audit records and other members' activity reference
  the notebook, so it is retired rather than erased; every read path filters it
  out immediately.

### Source (`modules/sources/domain/source.entity.ts`)

- Status transitions follow the lifecycle above.
- A source belongs to exactly one notebook and cannot be moved.
- Storage can only be attached before ingestion begins — rebinding a ready
  source's object would orphan its chunks.
- A user-visible failure reason is always a domain phrase, never an upstream
  error message.

### Conversation

- Messages are append-only. Editing a message would invalidate the citations
  stored with it, so the schema grants no UPDATE on `messages` at all.

---

## Ports

The domain declares what it needs; `infrastructure` supplies it. Ports are
abstract classes so they double as NestJS injection tokens while staying free of
framework types.

| Port                    | Implemented by                    |
| ----------------------- | --------------------------------- |
| `NotebookRepository`    | `SupabaseNotebookRepository`      |
| `NotebookReadModel`     | `SupabaseNotebookReadModel`       |
| `SourceRepository`      | `SupabaseSourceRepository`        |
| `SourceStoragePort`     | `SupabaseSourceStorageAdapter`    |
| `TextExtractionPort`    | `TextExtractionAdapter`           |
| `ChunkRetrievalPort`    | `SupabaseRetrievalAdapter`        |
| `ConversationRepository`| `SupabaseConversationRepository`  |
| `EmbeddingPort`         | `VoyageEmbeddingAdapter`          |
| `TextGenerationPort`    | `ClaudeTextGenerationAdapter`     |
| `GroundedAnswerPort`    | `ClaudeGroundedAnswerAdapter`     |
| `SpeechSynthesisPort`   | `ElevenLabsSpeechAdapter` / `NullSpeechAdapter` |

`LlmModule` is the only module that names a vendor.

---

## Reads vs. writes

Commands load an aggregate, invoke behaviour on it, and persist it. Queries skip
the aggregate and go to a read model, because the shapes the UI wants — a
notebook list with the caller's role, member count and source count — belong to
no single aggregate, and assembling them by loading N aggregates would be both
slower and a worse fit.

## Domain events

Aggregates record events (`notebook.created`, `source.ready`, `source.failed`,
…) which the application layer publishes after the write succeeds. Today they
drive the audit trail. They exist so that the next consumer — a notification, a
webhook, a search index — attaches without the producing module learning about
it.
