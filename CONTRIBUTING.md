# Contributing to Auralis

Keep changes small enough to review and preserve the local-first boundary. Start with the [architecture](docs/architecture.md), [security model](docs/security.md), and [roadmap](docs/roadmap.md).

## Workflow

1. Create a branch describing the change.
2. Install dependencies with `npm ci` after a lockfile exists.
3. Make the change and update the relevant documentation.
4. Run `npm test` and `npm run build` (which includes TypeScript checking).
5. For interface changes, check narrow and wide layouts, keyboard navigation, disconnected Ollama, active streaming, and reduced motion.
6. Explain the behavior change, validation, and any limits in the pull request.

Do not commit chat exports, private notes, application data, audio recordings, `.env` files, model weights, generated dependencies, or credentials. Use synthetic fixtures.

## Design rules

- Display actual application state. Do not substitute simulated performance numbers, fabricated responses, or invented connection status.
- Avoid remote fonts, tracking, CDN scripts, and hidden provider fallback.
- Keep animations inexpensive and respect `prefers-reduced-motion`.
- Preserve visible labels, focus states, semantic buttons, and screen reader status messages.
- Make destructive controls clear and reversible where possible.

## Tools and providers

A tool request is untrusted model output. A new tool needs a typed argument schema, explicit policy classification, bounded execution, tests for denial paths, and a clear account of side effects. Writes require approval of concrete arguments. A model must never grant itself more permission.

Provider code belongs behind the server boundary. Never let model output supply an arbitrary network destination. Adding a remote provider changes the privacy promise and requires a separate user-facing design and documented opt-in.

## Tests that matter

Add tests for changed behavior and meaningful failure cases. Prefer protocol fixtures and temporary data directories over live services. Security work should include adversarial cases such as malformed JSON, cross-origin requests, tool argument confusion, oversized input, and expired approvals. Avoid tests that only repeat implementation details.

## Dependency updates

Explain why a new dependency is necessary and consider its browser cost, maintenance, license, and network behavior. Commit the updated lockfile. Review install scripts and release notes. A successful package audit is one signal, not proof that code is safe.

## Research and performance claims

Link primary sources, record the date checked, and distinguish upstream claims from local measurements. Include model identity / quantization, context, runtime version, hardware, warm-up, and sample counts with benchmark results. Do not call a change faster until it has been measured under comparable conditions.
