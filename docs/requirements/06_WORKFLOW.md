# 06 · Workflows

## 1. End-to-end project lifecycle
```mermaid
flowchart TD
  A[PM: Create project<br/>client, PM, baseline dates, type] --> B[Select published template]
  B --> C[Preview: N activities, D dependencies]
  C --> D[Generate plan<br/>snapshot template version, create tasks]
  D --> E[Planning: PM reviews owners, estimates,<br/>dates, client contacts]
  E -->|all tasks have owners| F[PM sets project Active]
  F --> G[Team executes: status, evidence, time]
  G --> H{Task needs approval?}
  H -->|yes| I[For Review] --> J{PM approves?}
  J -->|approve| K[Completed]
  J -->|reject + comment| G
  H -->|no| K
  K --> L[Recalculate progress, forecast, health]
  L --> M{All tasks completed or cancelled?}
  M -->|no| G
  M -->|yes| N[PM sets project Completed]
```

## 2. Task status state machine
```mermaid
stateDiagram-v2
  [*] --> ToDo
  ToDo --> InProgress: predecessors done (or PM override)
  ToDo --> Blocked: reason required
  InProgress --> Blocked: reason required
  Blocked --> ToDo: unblock (returns to previous)
  Blocked --> InProgress: unblock (returns to previous)
  InProgress --> ForReview: requires approval + evidence
  InProgress --> Completed: no approval needed, predecessors done
  ForReview --> Completed: PM approves
  ForReview --> InProgress: PM rejects (comment)
  Completed --> InProgress: PM reopens (reason, audited)
  ToDo --> Cancelled: PM only if mandatory
  InProgress --> Cancelled: PM only if mandatory
  Cancelled --> [*]
  Completed --> [*]
```

## 3. Client dependency follow-up
```mermaid
sequenceDiagram
  participant PM
  participant App
  participant Owner as Internal owner
  participant Contact as Client contact (no login)
  PM->>App: Tag contact on client-party task, set due date
  Owner->>Contact: Request deliverable (outside app: email/call)
  Owner->>App: Add follow-up note
  App-->>PM: Task shows on "Waiting on client" + contact pending count
  alt Due date passes
    App-->>PM: Task overdue, counted in "N waiting on client"
    Owner->>App: Mark Blocked "waiting for client template", log Waiting time
  end
  Contact-->>Owner: Sends deliverable (outside app)
  Owner->>App: Attach evidence, unblock, complete / submit for review
```
Note: Phase 1 sends nothing to the client contact (pending Q-02).

## 4. Seed template: SAP Business One Implementation (from blueprint)
| # | Activity | Party | Default responsible | Deliverable / evidence | Depends on |
|---|----------|-------|---------------------|------------------------|-----------|
| 1 | Data gathering | Internal | Consultant | Completed data-gathering document | – |
| 2 | Submit master data template to client | Internal | Consultant | Template sent to client | 1 |
| 3 | Client master data – Items | Client | Client contact (owner: Consultant) | Completed items template | 2 |
| 4 | Client master data – Business Partners | Client | Client contact (owner: Consultant) | Completed BP template | 2 |
| 5 | Validate imported master data | Internal | Data specialist | Validation results and exceptions | 3, 4 |
| 6 | Configure system and validate setup | Internal | Technical specialist | Configuration evidence | 1 |
| 7 | User acceptance testing (UAT) | Internal + client participants | QA / Consultant | Test results and sign-off | 5, 6 |
| 8 | End-user training | Internal | Trainer / Consultant | Training completion record | 7 |
| 9 | Cutover preparation | Internal + client | Project team | Approved cutover checklist | 7 |
| 10 | Go-live and post-implementation support | Internal | Implementation & support teams | Go-live approval and handover | 8, 9 |

Dependencies above are a proposed default (the blueprint doesn't define them) and need confirmation (Q-06). Estimates and offsets are to be supplied by the implementation team (Q-06).

## 5. Time logging flow
1. User opens Time logging → week defaults to current week.
2. Selects project (only member projects) → task (open tasks only) → date → hours → type → notes.
3. Server validates (range, future date, daily total ≤ 24, membership, lock period).
4. Entry saved, task actual hours recalculated, audit entry written.
5. Weekly total and utilization update.

## 6. Template versioning
1. Admin/PM opens a Published template (vN) → "Edit" creates a working draft of vN+1.
2. Edits are saved to the draft; vN remains active for new projects until vN+1 is published.
3. Publish → vN+1 becomes the active version; vN is kept read-only.
4. Projects created from vN keep their snapshot; no migration happens automatically.

## 7. Document lifecycle
See the state diagram in [10 §6](10_DOCUMENT_MANAGEMENT.md).
