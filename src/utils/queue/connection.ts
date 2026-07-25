import { Redis } from 'ioredis'

if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL env not set !!')
}

export const redisConnection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});
