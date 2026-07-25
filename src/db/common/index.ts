import { Schema } from "mongoose";

export interface UserType {
    id: string;
    login: string; // username
    avatarUrl: string;
    githubUrl: string;
    userType: string;
}

export const UserSchema = new Schema<UserType>({
    id: { type: String, required: true },
    login: { type: String, required: true }, // username
    avatarUrl: { type: String, required: true },
    githubUrl: { type: String, required: true },
    userType: { type: String, required: true },
}, { _id: false });
