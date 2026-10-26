import { User } from '../schema/User';
import { encryptToken, tokenEncryptionKey } from '../../utils/auth/tokenEncryption';

// Use the raw collection: schema setters must not encrypt the comparison filter.
export async function encryptUserTokens(): Promise<void> {
    tokenEncryptionKey();
    for await (const user of User.collection.find({})) {
        const accessToken = encryptToken(user.accessToken, 'accessToken');
        const refreshToken = encryptToken(user.refreshToken, 'refreshToken');
        if (accessToken === user.accessToken && refreshToken === user.refreshToken) continue;
        await User.collection.updateOne(
            { _id: user._id, accessToken: user.accessToken, refreshToken: user.refreshToken },
            { $set: { accessToken, refreshToken } },
        );
    }
}
