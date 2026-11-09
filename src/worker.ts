import 'dotenv/config';
import { connectDB, closeDB } from "./db/index.js";
import { commentWorker } from "./workers/comment.worker.js";
import { conflictDetectionWorker } from "./workers/conflict-detection.worker.js";
import { installationWorker } from "./workers/installation.worker.js";
import { pullRequestWorker } from "./workers/pull-request.worker.js";
import { redisConnection } from './utils/queue/connection.js';
import { installationQueue } from './queues/installation.queue.js';
import { pullRequestQueue } from './queues/pull-request.queue.js';
import { commentQueue } from './queues/comment.queue.js';
import { conflictDetectionQueue } from './queues/conflict-detection.queue.js';

async function main() {
    console.log("Connecting to the database...");
    await connectDB();
    console.log("Connected to the database.");

    // no need to await here
    installationWorker.run();
    pullRequestWorker.run();
    commentWorker.run();
    conflictDetectionWorker.run();

    // if .run() didn't throw, means all the workers started
    console.table({
        'Installation worker': true,
        'Pull Request worker': true,
        'Comment worker': true,
        'Conflict Detection worker': true,
    });
}

const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);

    try {
        await Promise.all([
            installationWorker.close(),
            pullRequestWorker.close(),
            commentWorker.close(),
            conflictDetectionWorker.close(),
        ]);
        console.log('All Workers Closed.');

        await closeDB();
        console.log('DB Connection Closed.');

        await Promise.all([
            installationQueue.close(),
            pullRequestQueue.close(),
            commentQueue.close(),
            conflictDetectionQueue.close(),
        ]);
        console.log('All Queues Closed.');

        await redisConnection.quit();
        console.log('Redis Connection Closed.');

        process.exit(0);
    } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().catch((error) => {
    console.error('Failed to start workers:', error);
    process.exit(1);
});
