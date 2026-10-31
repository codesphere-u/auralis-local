# Verification record

This file records observed evidence, not intended behavior. Update it against the final published commit. A configured workflow is not proof that GitHub Actions completed successfully.

## Environment observed

- Date: 2026-10-31.
- Host identified as Apple M5 MacBook Pro with 16 GB unified memory.
- macOS 27.2; Node.js 24.22.0; Ollama client and server 0.40.13 (server verified through `/api/version`).
- Installed model inventory includes `qwen3.5:4b`, `qwen3.5:2b`, and `qwen3.5:0.8b`.

Hardware identifiers and personal data are intentionally omitted.

## Automated checks

- Complete local test suite: **24 tests passed**, zero failures, cancellations, skips, or todos, using `node --import tsx --test tests/*.test.ts` on 2026-10-31.
- TypeScript checking and production build completed successfully.
- Package audit reported **zero vulnerabilities** at the time checked. This is a dependency advisory result, not a security audit.

The tests cover request verification, tool policy, approval ownership / expiry / replay, local model metadata, streaming and cancellation, concurrency, output bounds, audit failure handling, and WAV encoding. Fixtures do not establish real transcription accuracy or general model quality. The final published commit SHA and remote CI result are recorded separately below.

## UI validation

Live browser checks exercised the built application at **1440 × 960** and the default narrow **549 × 724** viewport. A real model calculator call returned **15** with its tool activity and audit event visible. A model note proposal was shown for review, approved, and saved to local memory.

These observations verify the exercised paths, not a comprehensive accessibility or cross-browser audit. Microphone transcription was not configured during these checks.

## Live inference

Six short target-machine trials completed with `qwen3.5:0.8b` and `qwen3.5:4b`. Exact observations and limitations are in [the preliminary measurement record](measurements-2026-10-31.md). Loading state was uncontrolled and no memory, power, or thermal measurements were captured. The data is not a controlled comparison with OpenJarvis.

## Voice

The optional whisper.cpp setup is based on current upstream documentation. WAV encoding and resampling have automated tests. The transcription endpoint was unconfigured during live browser checks. Real microphone-to-transcript operation, transcription accuracy, and audible speech output remain unverified.

## Publication

The complete application and documentation were published to the public repository [codesphere-u/auralis-local](https://github.com/codesphere-u/auralis-local) through the GitHub plugin.

- Implementation commit: [`fde5dd76846c0515d7e9029e0cdf4c68d3059d4b`](https://github.com/codesphere-u/auralis-local/commit/fde5dd76846c0515d7e9029e0cdf4c68d3059d4b).
- The remote recursive tree was inspected: all 39 source, configuration, test, license and documentation files were present, with no truncation.
- The local Git checkout matched that remote commit, with a clean working tree and no whitespace errors.
- [GitHub Actions run 41218693127](https://github.com/codesphere-u/auralis-local/actions/runs/41218693127) completed both `verify (ubuntu-latest)` and `verify (macos-latest)` successfully. Each job passed installation, `npm run check` (tests plus TypeScript and production build), and the production dependency audit.

This evidence applies to the implementation commit above. The subsequent documentation-only commit records these results; it does not change application behavior. CI on later commits must be checked against their own SHA.

## Known limits

- No controlled Auralis versus OpenJarvis benchmark.
- No independent security audit.
- No promise of fixed tokens per second or first-token latency on all 16 GB Macs.
- Model weights and transcription runtime are external installations.
- Advanced integrations listed on the roadmap are not part of the current release.
