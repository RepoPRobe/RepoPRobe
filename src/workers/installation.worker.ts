import { Worker } from 'bullmq';
import { redisConnection } from '../utils/queue/connection.js';
import { QUEUE_EVENTS } from '../types/queue-events.js';
import { handleInstallationCreated } from '../utils/workers/installation/handleInstallationCreated.js';
import { handleInstallationDeleted } from '../utils/workers/installation/handleInstallationDeleted.js';
import { handleInstallationSuspend } from '../utils/workers/installation/handleInstallationSuspend.js';
import { handleInstallationUnsuspend } from '../utils/workers/installation/handleInstallationUnsuspend.js';
import { handleInstallationRepositoriesAdded } from '../utils/workers/installation/handleInstallationRepositoriesAdded.js';
import { handleInstallationRepositoriesRemoved } from '../utils/workers/installation/handleInstallationRepositoriesRemoved.js';

export const installationWorker = new Worker('installation', async (installationPayload) => {
    console.log(`Processing installation ${installationPayload.name}`, installationPayload.id);

    const data = installationPayload.data;

    switch (installationPayload.name) {
        case QUEUE_EVENTS.INSTALLATION.CREATED:
            await handleInstallationCreated(data);
            break;
        case QUEUE_EVENTS.INSTALLATION.DELETED:
            await handleInstallationDeleted(data);
            break;
        case QUEUE_EVENTS.INSTALLATION.SUSPEND:
            await handleInstallationSuspend(data);
            break;
        case QUEUE_EVENTS.INSTALLATION.UNSUSPEND:
            await handleInstallationUnsuspend(data);
            break;
        case QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED:
            await handleInstallationRepositoriesAdded(data);
            break;
        case QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED:
            await handleInstallationRepositoriesRemoved(data);
            break;
        default:
            break;
    }
}, {
    connection: redisConnection,
    concurrency: 1,
    autorun: false,
    lockDuration: 60_000,
})

installationWorker.on('completed', (installationPayload) => {
    console.log(`Installation ${installationPayload.id} completed`)
})

installationWorker.on('failed', (installationPayload, error) => {
    console.log(`Installation ${installationPayload?.id} failed:`, error)
})
