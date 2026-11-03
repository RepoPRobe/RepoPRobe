import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { InstallationSuspend } from "../../../types/queue-payloads";
import { logActivity } from "../../common/activityLog";
import { QUEUE_EVENTS } from "../../../types/queue-events";

export async function handleInstallationSuspend(payload: InstallationSuspend) {
    try {
        const installationId = payload.installationId;
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $eq: null },
            },
            { $set: { suspendedAt: new Date() } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            await logActivity({
                installationId: githubInstallation._id,
                event: QUEUE_EVENTS.INSTALLATION.SUSPEND,
                status: 'success',
                message: 'GitHub App installation suspended',
            });
            console.log(`Marked installation ${installationId} as suspended`);
        } else {
            console.log(`No GithubInstallation found or deleted one or already suspended one for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.suspend]:", error)
        try {
            const githubInstallation = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (githubInstallation) {
                await logActivity({
                    installationId: githubInstallation._id,
                    event: QUEUE_EVENTS.INSTALLATION.SUSPEND,
                    status: 'error',
                    message: 'Failed to suspend GitHub App installation',
                });
            }
        } catch (logError) {
            console.log("Error while logging activity for installation.suspend:", logError);
        }
    }
}
