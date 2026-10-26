import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
type TokenField = 'accessToken' | 'refreshToken';

export function tokenEncryptionKey(): Buffer {
    const value = process.env.TOKEN_ENCRYPTION_KEY;
    if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
        throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 bytes encoded as 64 hex characters');
    }
    return Buffer.from(value, 'hex');
}

export function isEncryptedToken(value: string): boolean {
    return value.startsWith(PREFIX);
}

export function encryptToken(value: string, field: TokenField): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Token is required');
    if (isEncryptedToken(value)) {
        decryptToken(value, field); // Never accept an unauthenticated envelope.
        return value;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey(), iv);
    cipher.setAAD(Buffer.from(field));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptToken(value: string, field: TokenField): string {
    if (!isEncryptedToken(value)) throw new Error('Token migration required');
    const encoded = value.slice(PREFIX.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length <= 28 || bytes.toString('base64') !== encoded) throw new Error('Invalid encrypted token');
    const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(field));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
