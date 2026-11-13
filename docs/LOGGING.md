# Reading the developer log

The api and the worker write a line for everything they do to Google Cloud Logging (design §14, "Logging"). This page
is for whoever runs a deployment: where to look, and what to paste. It is not the ledger (design §8), which is the
record; the log is for finding out what happened and why, and is kept 30 days.

You need access to the Google Cloud project (`operator_members` in the Terraform, or the project's owner).

## Where

| What | Where in the Google Cloud console |
|---|---|
| Every line | **Logging → Logs Explorer** |
| Errors, grouped by stack trace, with the file and line | **Error Reporting** |
| One request's lines together | In Logs Explorer, open a line → **Show entries for this trace** |

From a terminal: `gcloud logging read '<query>' --project <project> --limit 50 --format json`.

## What a line holds

| Field | Meaning |
|---|---|
| `severity`, `message` | As Cloud Logging shows them. A request's message is `METHOD /path STATUS`. |
| `httpRequest` | Method, path (no query string), status and time taken: request lines only. Cloud Logging shows it as the entry's own `httpRequest`, not under `jsonPayload`. |
| `route` | The route's pattern, e.g. `/v1/admin/members/:id`. |
| `action` | `Controller.handler`: the code that answered. Search the repository for the handler's name. |
| `accountId`, `roles` | Who called. Never on the request that casts a ballot. |
| `operator` | The System Admin acting as the test persona `accountId`. |
| `requestId` | The same on every line of one request. |
| `problemType` | Why a request was refused, where the refusal has a type. |
| `event`, `seq`, `actor`, `subject` | A ledger event as it was recorded (`context: "Ledger"`). |
| `step`, `done`, `ms` | A step of the worker's every-minute tick (`context: "TasksController"`). |
| `context` | The part of the server that wrote the line. |
| `stack_trace` | An unexpected error's stack trace, in the TypeScript sources. |

No line holds a request body, a query string, a header, an address (IP or email) or a ledger payload.

## Queries

Start every query with the service, then narrow:

```
resource.type="cloud_run_revision"
resource.labels.service_name="api"
```

(`"worker"` for the worker.) Then add one of:

| To see | Add |
|---|---|
| Every request | `httpRequest.requestMethod:*` |
| Everything one account did | `jsonPayload.accountId="<accountId>"` |
| Everything that changed something | `httpRequest.requestMethod!="GET"` |
| Every ledger event | `jsonPayload.context="Ledger"` |
| One kind of event | `jsonPayload.event="role.granted"` |
| One handler | `jsonPayload.action="ApprovalsController.changeRole"` |
| One route | `jsonPayload.route="/v1/admin/roles"` |
| Refused requests | `httpRequest.status>=400` |
| Server errors | `severity>=ERROR` |
| Slow requests | `httpRequest.latency>"1s"` |
| One request, by its id | `jsonPayload.requestId="<id>"` |
| What a test persona's operator did | `jsonPayload.operator="<accountId>"` |
| The worker's steps that did something | `jsonPayload.step:*` |

## More or fewer lines

`LOG_LEVEL` sets the least severe line written: `info` by default. `debug` adds health checks, the worker's steps
that had nothing to do, and Nest's start-up lines. In a deployment it is the Terraform module's `log_level` variable;
locally, set the environment variable before starting the api or worker.
