import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { InstallationUnsuspend } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";

export async function handleInstallationUnsuspend(payload: InstallationUnsuspend) {
    try {
        const installationId = payload.installationId;
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $ne: null },
            },
            { $set: { suspendedAt: null } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            await logActivity({
                installationId: githubInstallation._id,
                event: QUEUE_EVENTS.INSTALLATION.UNSUSPEND,
                status: 'success',
                message: 'GitHub App installation unsuspended',
            });
            console.log(`Marked installation ${installationId} as unsuspended`);
        } else {
            console.log(`No GithubInstallation found for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.unsuspend]:", error)
        try {
            const githubInstallation = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (githubInstallation) {
                await logActivity({
                    installationId: githubInstallation._id,
                    event: QUEUE_EVENTS.INSTALLATION.UNSUSPEND,
                    status: 'error',
                    message: 'Failed to unsuspend GitHub App installation',
                });
            }
        } catch (logError) {
            console.log("Error while logging activity for installation.unsuspend:", logError);
        }
    }
}
