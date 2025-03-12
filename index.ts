import { SessionToken } from "./lib/session-token";

// Get command line arguments (skip the first two which are node and script path)
const args = process.argv.slice(2);

// Default profile name is 'default' if not specified
const profileName = args.length > 0 ? args[0] : 'default';
// Initialize SessionToken with the specified profile
const sessionToken: SessionToken = new SessionToken(profileName);
// Renew the token
sessionToken.renewed();