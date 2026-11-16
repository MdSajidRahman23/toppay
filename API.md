# TopPay API (v2) — stable contract
All routes under `/api`. Auth: `Authorization: Bearer <token>` from `POST /api/login`. Tokens expire and are tied to the current shared-login password (changing it logs everybody out).

| Route | Who | Purpose |
|---|---|---|
| `POST /api/login` `{username,password}` | public (rate-limited) | → `{token, role}` |
| `GET /api/me` | login | role + set-up `warnings` (admin) |
| `POST /api/check` `{data, manual:[{tid,kind?}], dismissed:[key]}` | login | evaluate a case. **Only template ids / keys are accepted for manual reasons — no free text.** |
| `GET /api/templates` | login | layered templates (built-in → global admin edit) + `context` (month names) |
| `POST /api/templates` `{text,section}` | admin | new global template |
| `PUT /api/templates/{id}` `{text}` | admin | edit global text |
| `POST /api/templates/{id}/reset` / `/hidden` / `DELETE` | admin | reset, hide, delete custom |
| `GET/PUT /api/admin/shared-login` | admin | the one shared reviewer login |
| `POST /api/feedback` | login | suggestion to owner mail |

## /api/check response
`{api_version:2, status, status_detail, reasons[], passed[], notes[], missing[], fast_track, fast_track_msg, context, data}`
Each reason: `{id, source:auto|manual, kind:reject|return|action, tid, params, why, template, text, dismissed}`.

### Status combination
REJECTED > RETURNED > MORE INFO NEEDED > ACTION REQUIRED > APPROVED. Active manual reject → REJECTED; active manual return → at least RETURNED. Dismissed automatic reasons stay visible but do not count.

### Money rule (SOP)
At least ONE of the last 3 months must have cash-in OR cash-out ≥ 2,000 (each direction on its own; tolerance 60). Fast-track ≥ 6,000. The 3-month total (in+out) is only for MRP ≥ 50,000. Last 7 days before the application are ignored. MRP = Total Product Amount × 0.9.

## Privacy
Never stored on the server: NID, phone, photos, addresses, statements. Local template edits, notes and history live only in the browser (localStorage). The Statement Checker reads the PDF in the browser; only derived numbers reach the form.
