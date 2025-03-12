import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import crypto from "crypto";

/**
 * Represents basic AWS profile information
 * Contains region (optional) and AWS access credentials
 */
interface Profile {
    region?: string;
    aws_access_key_id: string;
    aws_secret_access_key: string;
}

/**
 * Extends Profile to include session token information
 */
interface Credential extends Profile {
    aws_session_token: string;
}

/**
 * Extends Credential to include expiration timestamp
 */
interface Session extends Credential {
    expiration: string;
}

/**
 * Configuration options for a profile including MFA details
 */
interface SettingOption extends Profile {
    serial: string;           // MFA device serial number
    mfa_secret_key: string;   // Secret key for TOTP generation
}

/**
 * Collection of profile settings indexed by profile name
 */
interface Setting {
    [key: string]: SettingOption
}

/**
 * Class for managing AWS session tokens with MFA support
 * Handles profile configuration, credential management, and token generation
 */
export class SessionToken {
    private profiles: Setting;
    private profile: SettingOption;
    private packageFile: string = "package.json";

    /**
     * Returns the path to the .aws directory in user's home folder
     */
    private get aws_path(): string {
        return path.join(path.resolve(os.homedir()), '.aws');
    }

    /**
     * Returns the full path to AWS credentials file
     */
    private get credential_path(): string {
        return path.join(this.aws_path, 'credentials');
    }

    /**
     * Returns the full path to AWS config file
     */
    private get config_path(): string {
        return path.join(this.aws_path, 'config');
    }

    /**
     * Creates a new SessionToken instance
     * @param profileName - AWS profile name to use, defaults to "default"
     */
    constructor(private profileName = "default") {
        this.profiles = this.reloadProfiles();
        this.validationSetting();
        this.logTable('Profiles settings', this.profiles);
        this.profile = this.profiles[this.profileName] || this.profiles[Object.keys(this.profiles)[0]];
    }

    /**
     * Logs table of data to console with formatted output
     * Truncates long strings for better readability
     * @param title - Title for the table
     * @param list - Object to display as table
     */
    private logTable(title: string, list: { [key: string]: Record<string, any> }) {
        console.debug(`===================${title.toUpperCase()}=================`);
        console.table(Object.entries(list).map(([key, setting]) => {
            const obj = Object.entries(setting).reduce((res: Record<string, any>, [k, value]) => {
                res[k.toUpperCase()] = value.length > 30 ? `${value.slice(0, 10)}...${value.slice(-10)}` : value;
                return res;
            }, {});
            return { 'PROFILE_NAME': key, ...obj };
        }));
    }

    /**
     * Reloads profile settings from the setting file
     * @returns Parsed profiles from the settings file
     */
    private reloadProfiles<T = Record<string, any>>(): T {
        const package_path = path.join(process.cwd(), this.packageFile);
        const content: any = JSON.parse(fs.readFileSync(package_path, 'utf-8'));
        return (content['profiles'] || {}) as T;
    }

    /**
     * Renews AWS session token using MFA
     * Creates or updates credential file with new session token
     */
    public renewed() {
        this.validationConfig();
        const credential = this.credential || {};
        const { aws_access_key_id, aws_secret_access_key, region } = this.profile;
        const profileName = this.profileName;
        const profileObj = { aws_access_key_id, aws_secret_access_key, region };
        this.credential = { ...credential, [profileName]: profileObj };
        const session: Session | undefined = this.session;
        if (!session) {
            throw `Unable to determine aws_session_token`;
        }
        this.credential = { ...credential, [profileName]: { ...profileObj, ...session } };
        this.logTable('Token renewed successfully', { [profileName]: session });
    }

    /**
     * Validates and ensures the AWS config file contains necessary profile information
     * Creates or updates profile in config file if needed
     */
    private validationConfig(): void {
        const config = this.config || {};
        const { aws_access_key_id, aws_secret_access_key, region } = this.profile;
        const profileName = this.profileName;
        const profileObj = { aws_access_key_id, aws_secret_access_key, region };
        const profile = config && profileName in config ? config[profileName] : {};
        if (['aws_access_key_id', 'aws_secret_access_key', 'region'].some(key => !(key in profile))) {
            if (!(profileName in config)) {
                console.log(`Profile [${this.profileName}] does not exist, create a new profile.`);
            } else {
                console.log(`profile [${this.profileName}] not enough information. proceed with automatic setup.`);
            }
            this.config = { ...config, [profileName]: profileObj }
        }
    }

    /**
     * Validates that profile settings contain all required fields
     * Throws error if profile is missing or incomplete
     */
    private validationSetting(): void {
        if (Object.keys(this.profiles).length === 0) {
            throw `You have not set up profiles`
        }
        const profile = this.profileName in this.profiles ? this.profiles[this.profileName] : undefined;
        if (!profile) {
            throw `Profile [${this.profileName}] does not exist in ${this.packageFile}`
        }
        const keys: Array<string> = ['aws_access_key_id', 'aws_secret_access_key', 'region', 'serial', 'mfa_secret_key'];
        for (const key of keys) {
            if (!(key in profile)) {
                throw `[${key}] of profile [${this.profileName}] does not exist in ${this.packageFile}`
            }
        }
    }

    /**
     * Executes a shell command and returns its output
     * @param command - Command parts to execute
     * @returns Command output or undefined on error
     */
    private command(...command: Array<string>) {
        try {
            const output = execSync(command.join(" "), { encoding: "utf-8" });
            return output;
        } catch (error) {
            console.error("command: ", command.join(" "));
            console.error(error);
            process.exit();
            return undefined;
        }
    }

    /**
     * Gets a new AWS session token using STS and MFA
     * @returns Session object with credentials or undefined on failure
     */
    public get session(): undefined | Session {
        const token = this.generate();
        const command: Array<string> = ["aws", "sts", "get-session-token", "--serial-number", this.profile.serial, "--profile", this.profileName, "--token-code", token];
        const output = this.command(...command);
        if (!output) {
            return undefined;
        }
        const obj = JSON.parse(output);
        if (!("Credentials" in obj)) {
            return undefined;
        }
        const credential: Record<string, any> = obj['Credentials'];
        if (!("SessionToken" in credential)) {
            return undefined;
        }
        return {
            aws_access_key_id: credential['AccessKeyId'],
            aws_secret_access_key: credential['SecretAccessKey'],
            aws_session_token: credential['SessionToken'],
            expiration: credential['Expiration']
        };
    }

    /**
     * Gets current credentials from AWS credentials file
     */
    get credential(): undefined | { [key: string]: Credential } {
        return this.read<Credential>(this.credential_path);
    }

    /**
     * Updates credentials in AWS credentials file
     */
    private set credential(option: { [key: string]: Record<string, any> }) {
        this.write(this.credential_path, option);
    }

    /**
     * Gets current config from AWS config file
     */
    get config(): undefined | { [key: string]: Profile } {
        return this.read<Profile>(this.config_path);
    }

    /**
     * Updates config in AWS config file
     */
    private set config(option: { [key: string]: Record<string, any> }) {
        this.write(this.config_path, option);
    }

    /**
     * Reads and parses AWS config file format
     * @param file_path - Path to the file to read
     * @returns Parsed content or undefined if file doesn't exist
     */
    private read<T = Record<string, any>>(file_path: string): undefined | { [key: string]: T } {
        if (!fs.existsSync(file_path)) {
            return undefined;
        }
        const content = fs.readFileSync(file_path, 'utf-8');
        return this.parse(content) as { [key: string]: T };
    }

    /**
     * Writes data to AWS config file format
     * @param file_path - Path to write the file
     * @param content - Content to write in the file
     */
    private write(file_path: string, content: { [key: string]: Record<string, any> }) {
        const info = path.parse(file_path);
        fs.mkdirSync(info.dir, { recursive: true });
        const lines = Object.entries(content).reduce((res: Array<string>, [key, values]) => {
            const values_lines: Array<string> = Object.entries(values).map(([key, value]) => `${key} = ${value}`);
            res.push(`[${key}]`, ...values_lines, '\n');
            return res;
        }, []);
        fs.writeFileSync(file_path, lines.join('\n'));
    }

    /**
     * Parses AWS config file format into JavaScript object
     * @param content - File content to parse
     * @returns Parsed object with profile settings
     */
    private parse(content: string): { [key: string]: Record<string, any> } {
        const lines: Array<string> = content.trim().split('\n').map(line => line.trim()).filter(line => line && !line.startsWith("#"));
        const option: { [key: string]: Record<string, any> } = {};
        let key_active: string = '';
        for (const line of lines) {
            const matches = line.match(/^\[(.+)\]$/);
            if (matches) {
                key_active = matches[1].toString();
                option[key_active] = {};
                continue;
            }
            if (key_active && key_active in option && option[key_active]) {
                const [key, ...values] = line.split("=");
                option[key_active][key.trim()] = values.join("=").trim();
            }
        }
        return option;
    }

    /**
     * Generates TOTP code for MFA authentication
     * @returns 6-digit TOTP code
     */
    public generate() {
        const secret = this.profile.mfa_secret_key;
        let counter = 0;
        const period = 30;
        const len = 6;
        let key = this.base32ToHex(secret);
        if (!key) {
            throw new Error("Invalid secret key");
        }

        let epoch = Math.round(new Date().getTime() / 1000.0);
        counter = Math.floor(epoch / period);
        const time = this.leftpad(this.dec2hex(counter), 16, "0");
        if (key.length % 2 === 1) {
            if (key.substr(-1) === "0") {
                key = key.substr(0, key.length - 1);
            } else {
                key += "0";
            }
        }
        const hmacObj = crypto.createHmac('sha1', Buffer.from(key, 'hex'))
            .update(Buffer.from(time, 'hex'))
            .digest('hex');

        const offset = this.hex2dec(hmacObj.substring(hmacObj.length - 1));
        let otp = (this.hex2dec(hmacObj.substr(offset * 2, 8)) & this.hex2dec("7fffffff")) + "";
        if (otp.length < len) {
            otp = new Array(len - otp.length + 1).join("0") + otp;
        }
        return otp.substr(otp.length - len, len).toString();
    }

    /**
     * Pads a string on the left with specified character
     * @param str - String to pad
     * @param len - Desired length
     * @param pad - Character to use for padding
     * @returns Padded string
     */
    private leftpad(str: string, len: number, pad: string): string {
        if (len + 1 >= str.length) {
            str = new Array(len + 1 - str.length).join(pad) + str;
        }
        return str;
    }

    /**
     * Converts decimal to hexadecimal with leading zero if needed
     * @param s - Decimal number
     * @returns Hexadecimal string
     */
    private dec2hex(s: number): string {
        return (s < 15.5 ? "0" : "") + Math.round(s).toString(16);
    }

    /**
     * Converts hexadecimal string to decimal number
     * @param s - Hexadecimal string
     * @returns Decimal number
     */
    private hex2dec(s: string): number {
        return Number(`0x${s}`);
    }

    /**
     * Converts Base32 string to hexadecimal
     * Used for TOTP key conversion
     * @param base32 - Base32 encoded string
     * @returns Hexadecimal string
     */
    private base32ToHex(base32: string): string {
        const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = "";
        let hex = "";
        let padding = 0;

        // Convert each Base32 character to 5 bits
        for (let i = 0; i < base32.length; i++) {
            if (base32.charAt(i) === "=") {
                bits += "00000";
                padding++;
            } else {
                const val = base32chars.indexOf(base32.charAt(i).toUpperCase());
                bits += this.leftpad(val.toString(2), 5, "0");
            }
        }

        // Convert 4 bits at a time to hex
        for (let i = 0; i + 4 <= bits.length; i += 4) {
            const chunk = bits.substr(i, 4);
            hex = hex + Number(`0b${chunk}`).toString(16);
        }

        // Handle padding according to Base32 specification
        switch (padding) {
            case 0:
                break;
            case 6:
                hex = hex.substr(0, hex.length - 8);
                break;
            case 4:
                hex = hex.substr(0, hex.length - 6);
                break;
            case 3:
                hex = hex.substr(0, hex.length - 4);
                break;
            case 1:
                hex = hex.substr(0, hex.length - 2);
                break;
            default:
                throw new Error("Invalid Base32 string");
        }

        return hex;
    }
}