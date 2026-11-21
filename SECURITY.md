# Reporting security issues

Report security issues privately to [kontakt@extraara.se](mailto:kontakt@extraara.se). Include the affected version, expected and actual results, and a small example using synthetic data.

Do not include production documents, credentials or private keys. Discuss disclosure with the maintainer before posting an exploit or personal evidence in a public issue. There is no guaranteed response time.

The verifier reads untrusted files. Its main checks are parsing limits, signatures over the original bytes and explicitly supplied trusted keys. [Trust and limits](docs/TRUST.md) explains what these checks cover.
