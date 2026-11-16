# Security

Report vulnerabilities through GitHub's private reporting feature if available, otherwise contact a maintainer privately. Never post credentials or private recordings in public issues.

- Keep provider keys server-side. Microphone audio and conversation data reach external providers; obtain consent and review their retention policies.
- Browser Origin checks are not user authentication. Public backends need appropriate access controls, provider spending limits and monitoring; request ceilings do not bound all provider costs.
- Never bundle provider keys in client code; rotate exposed credentials.
- Traces can contain transcripts and output audio. Keep recordings private unless participants authorize sharing.
