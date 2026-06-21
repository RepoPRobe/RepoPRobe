import { App, Octokit } from 'octokit'
import dotenv from 'dotenv'
dotenv.config()

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY;
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

if (!appId) {
    throw new Error("GITHUB_APP_ID env not set !!");
}
if (!privateKey) {
    throw new Error("GITHUB_PRIVATE_KEY env not set !!");
}
if (!webhookSecret) {
    throw new Error("GITHUB_WEBHOOK_SECRET env not set !!");
}

export const githubApp = new App({
    appId,
    privateKey,
    webhooks: {
        secret: webhookSecret,
    },
    Octokit
})
