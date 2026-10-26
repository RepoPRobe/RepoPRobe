import 'dotenv/config';
import mongoose from 'mongoose';
import { encryptUserTokens } from '../db/migrations/encryptUserTokens';

try {
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is required');
    await mongoose.connect(process.env.MONGODB_URL);
    await encryptUserTokens();
    console.log('User token migration complete');
} catch {
    console.error('User token migration failed; check database access and encryption key configuration');
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
