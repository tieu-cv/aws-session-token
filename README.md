# AWS Session Token Tool

A TypeScript tool for automating AWS session token generation with MFA (Multi-Factor Authentication) support.

## Features

- Automatically generates TOTP codes for MFA authentication
- Manages AWS session tokens for multiple profiles
- Updates AWS credentials file with session tokens
- Simple configuration through package.json

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure your profiles in package.json (see configuration section)
4. Run the tool:
   ```bash
   npx ts-node index.ts [profile-name]
   ```

## Prerequisites

- AWS CLI installed and configured
- AWS IAM account with MFA enabled
- Session Manager Plugin installed
- Node.js and npm/yarn

## Configuration

The tool reads profile configuration from the `profiles` section in your `package.json` file.

### Example package.json configuration:

```json
{
  "name": "aws-session-token",
  "version": "1.0.0",
  "description": "AWS session token generator with MFA support",
  "main": "index.ts",
  "scripts": {
    "token": "ts-node index.ts"
  },
  "dependencies": {
    // dependencies here
  },
   "profiles": {
    "default": {
      "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
      "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "region": "us-west-2",
      "serial": "arn:aws:iam::123456789012:mfa/username",
      "mfa_secret_key": "JBSWY3DPEHPK3PXP"
    },
    "development": {
      "aws_access_key_id": "AKIAI44QH8DHBEXAMPLE",
      "aws_secret_access_key": "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY",
      "region": "eu-central-1",
      "serial": "arn:aws:iam::123456789012:mfa/dev-username",
      "mfa_secret_key": "HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ"
    }
  },
}
```

### Required profile properties:

| Property | Description |
|----------|-------------|
| `aws_access_key_id` | Your AWS access key ID |
| `aws_secret_access_key` | Your AWS secret access key |
| `region` | AWS region (e.g., us-west-2) |
| `serial` | ARN of the MFA device (found in AWS IAM console) |
| `mfa_secret_key` | MFA secret key (Base32 encoded) |

## How to find your MFA secret key

The `mfa_secret_key` is required to generate TOTP codes automatically. This is the same secret key that you used when setting up your MFA device:

1. When you first set up MFA in AWS IAM, you received a QR code or a secret key
2. This key is a Base32-encoded string (usually looks like: JBSWY3DPEHPK3PXP)
3. Store this secret key securely in your package.json

If you no longer have access to the secret key, you'll need to deactivate and reactivate MFA for your IAM user to get a new secret key.

## Usage

### Basic usage with default profile:

```bash
npm run token
```

### Specify a different profile:

```bash
npm run token -- development
```

Or directly:

```bash
npx ts-node index.ts development
```

## How it works

1. The tool reads your profile configuration from package.json
2. It generates a TOTP code using your MFA secret key
3. It calls the AWS STS service to get a temporary session token
4. It updates your AWS credentials file with the new session token

## Security considerations

- Store your package.json securely since it contains sensitive credentials
- Consider using environment variables or a secure vault for production use
- The session tokens typically expire after 12 hours

## Troubleshooting

### "Invalid MFA code" error:
- Ensure your computer's clock is synchronized correctly
- Verify that the `mfa_secret_key` is entered correctly
- Make sure the `serial` ARN matches your MFA device in AWS IAM

### "Profile does not exist" error:
- Check that the profile name matches exactly in your package.json
- Ensure all required properties are defined for the profile

## License

MIT