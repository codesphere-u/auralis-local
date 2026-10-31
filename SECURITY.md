# Security reporting

Please report vulnerabilities privately through GitHub's **Report a vulnerability** flow for this repository when it is available. If private reporting has not been enabled, contact the repository owner through the contact route on their GitHub profile before sharing sensitive details. Do not put real notes, tokens, recordings, exploit payloads containing personal data, or private system information in a public issue.

Include the affected revision, prerequisites, expected and actual behavior, and a minimal synthetic reproduction. State whether the issue crosses the loopback, origin, session, tool approval, storage, or model-service boundary.

Auralis is early-stage software. There is no published support window or promised response time. The latest repository revision is the primary target for fixes. Security settings of Ollama, whisper.cpp, the browser, and macOS remain relevant; these services are not contained by Auralis.

Read [the threat model and deployment limits](docs/security.md). Run locally as an ordinary user, keep services bound to loopback, and do not expose this application through a public tunnel.
