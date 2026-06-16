import { Webhooks } from '@octokit/webhooks';
import express from 'express';
import dotenv from "dotenv";
import { githubApp } from './github/client.js';
dotenv.config();

const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const PORT = process.env.PORT;

if (!PORT) {
    throw new Error("PORT env not set !!");
}
if (!githubWebhookSecret) {
    throw new Error("GITHUB_WEBHOOK_SECRET env not set !!");
}

const server = express();
const webhooks = new Webhooks({ secret: githubWebhookSecret });

server.post("/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string
    const body = req.body.toString()

    await webhooks.verifyAndReceive({
        id: req.headers['x-github-delivery'] as string,
        name: req.headers['x-github-event'] as any,
        signature,
        payload: body
    })
    res.status(200).send('ok');
});

webhooks.on("issue_comment.created", async ({ payload }) => {
    if (!payload.comment.body.includes("@RepoPRobe")) return;

    const octokit = await githubApp.getInstallationOctokit(payload.installation!.id)
    console.log(JSON.stringify(payload));

    await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        body: '👋 RepoProbe here — I am alive!'
    })
})

server.listen(PORT, () => console.log(`Listening to port ${PORT}`));
