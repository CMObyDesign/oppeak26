# Service Recommendation Philosophy — Runtime Behavior Spec

```
REFERENCE SPEC ONLY — NOT RUNTIME AUTHORITY

Production behavior lives in the Worker.
Editing this file does not change Solomon.
```

See [`BGA_COPILOT_RUNTIME_SPEC.md`](./BGA_COPILOT_RUNTIME_SPEC.md) for the roadmap section that applies this philosophy (Section 7 — CFO By Design Service Recommendations).

---

## Service Recommendation Philosophy

Service matching is **candidate generation**. It is not automatic sales logic.

`signals_relevant` means:

> "This service is worth considering when these signals are present."

It does **NOT** mean:

> "This service must be sold."

The strategist can confirm, defer, reject, or manually add a service.

Default dependencies and cautions may be stored in the service catalog. **Case-specific strategist judgment controls the final recommendation.**

The system may learn from override patterns, but it must not silently change published rules from a single case. Suggested rule changes require human approval.

---

## What a Valid Service Recommendation Explains

- The problem being solved.
- Why the service fits this case.
- What CFO By Design would handle.
- What the client must handle.
- What may need to happen first.
- Why the recommendation belongs in the roadmap.

Always allow the possibility that the client can execute a roadmap item internally without purchasing an additional service.
