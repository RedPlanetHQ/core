# Security Policy

## Our Commitment to Security

C.O.R.E (Contextual Observation & Recall Engine) takes security seriously. We are committed to protecting user data and maintaining the highest security standards for our memory graph platform.

## Supported Versions

We currently support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting Security Vulnerabilities

We appreciate responsible disclosure of security vulnerabilities. If you discover a security issue, please follow these steps:

### How to Report

**📧 Email**: harshith@tegon.ai

Please include the following information in your report:
- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact and severity assessment
- Any suggested mitigation or fix (if available)
- Your contact information for follow-up

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
2. **Initial Assessment**: We will provide an initial assessment within 5 business days
3. **Investigation**: We will investigate and work on a fix
4. **Resolution**: We will notify you when the issue is resolved
5. **Credit**: With your permission, we will credit you in our security advisories

### Responsible Disclosure Guidelines

- **Do not** publicly disclose the vulnerability until we have had a chance to address it
- **Do not** access or modify user data without explicit permission
- **Do not** perform testing that could impact service availability
- Report the vulnerability as soon as possible after discovery

## Security Best Practices for Users

### For Cloud Users (core.heysol.ai)

- Use strong, unique passwords for your account
- Enable two-factor authentication when available
- Review connected applications and integrations regularly
- Report suspicious activity immediately
- Keep your API keys and access tokens secure

### For Self-Hosted Deployments

- Follow our [Security Hardening Guide](docs/SECURITY_HARDENING.md)
- Use HTTPS/TLS for all communications
- Regularly update dependencies and base images
- Implement proper backup and disaster recovery procedures
- Monitor logs for suspicious activity
- Use strong authentication mechanisms
- Secure your database and Redis instances
- Implement network security controls (firewalls, VPNs)

## Data Protection

### Data Encryption

- **In Transit**: All data is encrypted using TLS 1.3
- **At Rest**: Sensitive data including tokens are encrypted using AES-256
- **Database**: Personal access tokens are stored with cryptographic hashing

### Data Retention

- User data is retained according to our privacy policy
- Users can request data deletion at any time
- Deleted data is permanently removed from our systems within 30 days

### Access Controls

- Role-based access control (RBAC) for all system components
- Principle of least privilege for all user and system accounts
- Regular access reviews and deprovisioning procedures

## Security Architecture

### Authentication & Authorization

- OAuth 2.0 integration (Google)
- Magic link authentication for passwordless login
- Personal Access Tokens for API access
- Workspace-based isolation and access controls

### Infrastructure Security

- Regular security updates and patch management
- Network segmentation and access controls
- Monitoring and alerting for security events
- Regular security assessments and code reviews

## Compliance

We are working toward compliance with:

- **SOC 2 Type II** - Information security management
- **GDPR** - Data protection and privacy rights
- **CCPA** - California consumer privacy rights

## Security Updates

Security updates will be:

- Released as soon as possible after discovery and resolution
- Announced through our official channels
- Documented in our changelog with appropriate severity levels

## Contact Information

For security-related inquiries:
- **Security Team**: harshith@tegon.ai
- **General Support**: [Discord Community](https://discord.gg/YGUZcvDjUa)

## Bug Bounty Program

We are currently evaluating the implementation of a formal bug bounty program. In the meantime, we encourage responsible disclosure and may offer recognition for significant security contributions.

---

*Last Updated: January 2025*
*Version: 1.0*